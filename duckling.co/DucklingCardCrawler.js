class DucklingCardCrawlerBehavior {
    static id = "DucklingCardCrawler";
    static runInIframe = false;

    static isMatch() {
        try {
            const url = new URL(window.location.href);

            return (
                url.hostname === "web.duckling.co" &&
                url.pathname === "/" &&
                url.searchParams.get("lang") === "da"
            );
        } catch (_) {
            return false;
        }
    }

    static init() {
        return {
            state: {
                cardsClicked: 0,
                cardsSkipped: 0,
                duplicateDetailHits: 0,
                communityClicks: 0,
                feedChecks: 0,
                navigationFailures: 0,
                feedSafetyStops: 0
            }
        };
    }

    async *run(ctx) {
        const { sleep, getState } = ctx.Lib;

        const CARD_SELECTOR =
            ".card.relative.overflow-hidden.rounded-lg.hover\\:cursor-pointer";

        /*
         * Feed loading.
         *
         * Scroll for at least 30 seconds.
         * Afterwards the feed is considered finished when
         * the number of card DOM elements has remained
         * unchanged for 5 checks x 3 seconds = 15 seconds.
         */
        const MIN_SCROLL_TIME = 30000;
        const COUNT_CHECK_INTERVAL = 3000;
        const STABLE_COUNT_CHECKS_REQUIRED = 5;

        /*
         * Absolute safety limit.
         *
         * This prevents Duckling's broken end-of-feed loader
         * from keeping the behavior alive indefinitely.
         */
        const MAX_SCROLL_TIME = 180000;

        /*
         * Detail page handling.
         */
        const DETAIL_WAIT = 10000;
        const NAV_TIMEOUT = 20000;
        const PAGE_SETTLE_WAIT = 1000;
        const BACK_WAIT = 1500;
        const COMMUNITY_LOAD_WAIT = 2500;

        /*
         * Dedupe information is stored both in memory and
         * localStorage.
         *
         * This means it survives:
         *
         *   - SPA navigation
         *   - history.back()
         *   - Vue rebuilding the DOM
         *
         * It may also survive a Browsertrix requeue if the
         * browser profile/storage itself survives.
         */
        const STORAGE_KEY =
            "__bx_duckling_cardcrawler_v5";

        const clickedFingerprints =
            new Set();

        const visitedDuckIds =
            new Set();

        /*
         * --------------------------------------------------
         * Persistent state
         * --------------------------------------------------
         */

        function loadPersistentState() {
            try {
                const raw =
                    localStorage.getItem(
                        STORAGE_KEY
                    );

                if (!raw) {
                    return;
                }

                const saved =
                    JSON.parse(raw);

                for (
                    const value of
                    saved.clickedFingerprints || []
                ) {
                    clickedFingerprints.add(
                        value
                    );
                }

                for (
                    const value of
                    saved.visitedDuckIds || []
                ) {
                    visitedDuckIds.add(
                        value
                    );
                }

            } catch (_) {
                /*
                 * Continue with in-memory state if
                 * localStorage is unavailable.
                 */
            }
        }

        function savePersistentState() {
            try {
                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify({
                        clickedFingerprints:
                            Array.from(
                                clickedFingerprints
                            ),

                        visitedDuckIds:
                            Array.from(
                                visitedDuckIds
                            )
                    })
                );

            } catch (_) {
                /*
                 * Continue with in-memory state.
                 */
            }
        }

        /*
         * --------------------------------------------------
         * Generic wait
         * --------------------------------------------------
         */

        async function waitFor(
            predicate,
            timeout = NAV_TIMEOUT
        ) {
            const start =
                Date.now();

            while (
                Date.now() - start <
                timeout
            ) {
                try {
                    if (predicate()) {
                        return true;
                    }
                } catch (_) {
                    /*
                     * Vue may temporarily be
                     * rebuilding the DOM.
                     */
                }

                await sleep(100);
            }

            return false;
        }

        /*
         * --------------------------------------------------
         * Normalization
         * --------------------------------------------------
         */

        function normalizeText(value) {
            return (value || "")
                .replace(/\s+/g, " ")
                .trim();
        }

        function normalizeResourceUrl(
            value
        ) {
            if (!value) {
                return "";
            }

            try {
                const url =
                    new URL(
                        value,
                        window.location.href
                    );

                /*
                 * Deliberately remove query string.
                 *
                 * Google Storage URLs are signed and the
                 * signatures change over time.
                 */
                return (
                    url.origin +
                    url.pathname
                );

            } catch (_) {
                return String(value)
                    .split("?")[0];
            }
        }

        /*
         * --------------------------------------------------
         * Extract duck:xxxxxxxx ID
         * --------------------------------------------------
         */

        function extractDuckId(value) {
            if (
                value === null ||
                value === undefined
            ) {
                return null;
            }

            const match =
                String(value).match(
                    /duck:[a-z0-9]+/i
                );

            return match
                ? match[0].toLowerCase()
                : null;
        }

        /*
         * --------------------------------------------------
         * Stable card fingerprint
         * --------------------------------------------------
         *
         * This identifies the card independently of:
         *
         *   - DOM object identity
         *   - signed image URL parameters
         *   - Vue recreating the element
         */

        function getCardFingerprint(
            card
        ) {
            const resources =
                Array.from(
                    card.querySelectorAll(
                        "img[src], video[src], source[src]"
                    )
                )
                .map(element =>
                    normalizeResourceUrl(
                        element.getAttribute(
                            "src"
                        )
                    )
                )
                .filter(Boolean)
                .sort();

            const heading =
                normalizeText(
                    card.querySelector(
                        "h1,h2,h3,h4"
                    )?.textContent
                );

            const profile =
                Array.from(
                    card.querySelectorAll(
                        "span"
                    )
                )
                .map(element =>
                    normalizeText(
                        element.textContent
                    )
                )
                .find(text =>
                    text.startsWith("@")
                ) || "";

            const allText =
                normalizeText(
                    card.textContent
                );

            return JSON.stringify({
                resources,
                heading,
                profile,
                allText
            });
        }

        /*
         * --------------------------------------------------
         * Look for Duck ID inside Vue data
         * --------------------------------------------------
         *
         * Some cards may expose their real Duck ID in
         * Vue component props even though the ID is not
         * present in the rendered HTML.
         *
         * If we can obtain it BEFORE clicking, different
         * card representations pointing at the same Duck
         * can be suppressed without opening the Duck again.
         */

        function findDuckIdInValue(
            value,
            depth = 0,
            seen = new WeakSet()
        ) {
            if (
                value === null ||
                value === undefined ||
                depth > 4
            ) {
                return null;
            }

            if (
                typeof value === "string"
            ) {
                return extractDuckId(
                    value
                );
            }

            if (
                typeof value !== "object"
            ) {
                return null;
            }

            if (
                seen.has(value)
            ) {
                return null;
            }

            seen.add(value);

            if (
                Array.isArray(value)
            ) {
                for (
                    const item of
                    value.slice(0, 20)
                ) {
                    const found =
                        findDuckIdInValue(
                            item,
                            depth + 1,
                            seen
                        );

                    if (found) {
                        return found;
                    }
                }

                return null;
            }

            const keys =
                Object.keys(value)
                    .slice(0, 100);

            /*
             * Look at likely identity fields first.
             */
            const priorityKeys =
                keys.filter(key =>
                    /(^id$|duck|card|item|post|content)/i
                        .test(key)
                );

            for (
                const key of
                priorityKeys
            ) {
                let child;

                try {
                    child =
                        value[key];
                } catch (_) {
                    continue;
                }

                const found =
                    findDuckIdInValue(
                        child,
                        depth + 1,
                        seen
                    );

                if (found) {
                    return found;
                }
            }

            /*
             * Then inspect direct string values.
             */
            for (
                const key of keys
            ) {
                let child;

                try {
                    child =
                        value[key];
                } catch (_) {
                    continue;
                }

                if (
                    typeof child ===
                    "string"
                ) {
                    const found =
                        extractDuckId(
                            child
                        );

                    if (found) {
                        return found;
                    }
                }
            }

            return null;
        }

        /*
         * --------------------------------------------------
         * Obtain Duck ID from a card before click
         * --------------------------------------------------
         */

        function getDuckIdFromCard(
            card
        ) {
            /*
             * First try normal rendered HTML.
             */
            let found =
                extractDuckId(
                    card.outerHTML
                );

            if (found) {
                return found;
            }

            /*
             * Look at links within card.
             */
            for (
                const element of
                card.querySelectorAll(
                    "a[href]"
                )
            ) {
                found =
                    extractDuckId(
                        element.getAttribute(
                            "href"
                        )
                    );

                if (found) {
                    return found;
                }
            }

            /*
             * Finally look at the local Vue component.
             */
            try {
                const component =
                    card.__vueParentComponent;

                if (component) {
                    const safeSources = [
                        component.vnode?.props,
                        component.props,
                        component.attrs
                    ];

                    for (
                        const source of
                        safeSources
                    ) {
                        found =
                            findDuckIdInValue(
                                source
                            );

                        if (found) {
                            return found;
                        }
                    }

                    /*
                     * setupState can contain much more data,
                     * so only inspect likely card-related
                     * properties.
                     */
                    const setupState =
                        component.setupState;

                    if (
                        setupState &&
                        typeof setupState ===
                        "object"
                    ) {
                        for (
                            const key of
                            Object.keys(
                                setupState
                            )
                        ) {
                            if (
                                !/(duck|card|item|post|content)/i
                                    .test(key)
                            ) {
                                continue;
                            }

                            found =
                                findDuckIdInValue(
                                    setupState[key]
                                );

                            if (found) {
                                return found;
                            }
                        }
                    }
                }

            } catch (_) {
                /*
                 * Vue internals are optional.
                 *
                 * The normal card fingerprint
                 * still protects against repeats.
                 */
            }

            return null;
        }

        /*
         * --------------------------------------------------
         * DOM card count
         * --------------------------------------------------
         */

        function countCards() {
            return document
                .querySelectorAll(
                    CARD_SELECTOR
                )
                .length;
        }

        /*
         * --------------------------------------------------
         * Feed signature
         * --------------------------------------------------
         *
         * Used when clicking Community because this may be
         * a pure SPA update without URL change.
         */

        function getFeedSignature() {
            const cards =
                Array.from(
                    document.querySelectorAll(
                        CARD_SELECTOR
                    )
                );

            return JSON.stringify({
                count:
                    cards.length,

                firstCards:
                    cards
                        .slice(0, 12)
                        .map(
                            getCardFingerprint
                        )
            });
        }

        /*
         * --------------------------------------------------
         * Community button
         * --------------------------------------------------
         */

        function findCommunityButton() {
            return (
                Array.from(
                    document.querySelectorAll(
                        "button"
                    )
                )
                .find(button =>
                    normalizeText(
                        button.textContent
                    )
                    .toLowerCase() ===
                    "community"
                ) || null
            );
        }

        /*
         * --------------------------------------------------
         * Scroll until card count stops increasing
         * --------------------------------------------------
         *
         * This is the important replacement for the old
         * fixed 30-second scroll.
         *
         * Duckling may continue trying to fetch more data
         * forever at the end of the feed.
         *
         * We ignore that.
         *
         * The feed is DONE when the number of actual card
         * DOM elements stops increasing.
         */

        async function*
        loadFeedUntilStable(phase) {

            const start =
                Date.now();

            let lastCount =
                countCards();

            let stableChecks =
                0;

            let highestCount =
                lastCount;

            yield getState(
                ctx,
                `${phase}: feed loading started with ` +
                `${lastCount} cards in DOM`
            );

            while (true) {
                window.scrollTo({
                    top:
                        document
                            .documentElement
                            .scrollHeight,

                    behavior:
                        "smooth"
                });

                await sleep(
                    COUNT_CHECK_INTERVAL
                );

                const currentCount =
                    countCards();

                const elapsed =
                    Date.now() -
                    start;

                ctx.state.feedChecks++;

                /*
                 * More cards appeared.
                 */
                if (
                    currentCount >
                    lastCount
                ) {
                    highestCount =
                        Math.max(
                            highestCount,
                            currentCount
                        );

                    stableChecks = 0;

                    yield getState(
                        ctx,
                        `${phase}: card count grew ` +
                        `${lastCount} -> ${currentCount}`
                    );
                }

                /*
                 * No new cards.
                 */
                else if (
                    currentCount ===
                    lastCount
                ) {
                    stableChecks++;

                    yield getState(
                        ctx,
                        `${phase}: card count still ` +
                        `${currentCount} ` +
                        `(${stableChecks}/` +
                        `${STABLE_COUNT_CHECKS_REQUIRED} ` +
                        `stable checks)`
                    );
                }

                /*
                 * Vue temporarily removed/rebuilt cards.
                 *
                 * Do NOT count this as end-of-feed.
                 */
                else {
                    stableChecks = 0;

                    yield getState(
                        ctx,
                        `${phase}: card count changed ` +
                        `${lastCount} -> ${currentCount}; ` +
                        `stability reset`
                    );
                }

                lastCount =
                    currentCount;

                highestCount =
                    Math.max(
                        highestCount,
                        currentCount
                    );

                /*
                 * Normal completion.
                 *
                 * At least 30 seconds have passed AND
                 * card count has been unchanged for
                 * 15 seconds.
                 */
                if (
                    elapsed >=
                        MIN_SCROLL_TIME &&

                    stableChecks >=
                        STABLE_COUNT_CHECKS_REQUIRED
                ) {
                    window.scrollTo({
                        top:
                            document
                                .documentElement
                                .scrollHeight,

                        behavior:
                            "instant"
                    });

                    await sleep(1000);

                    yield getState(
                        ctx,
                        `${phase}: END OF FEED detected. ` +
                        `${countCards()} cards in DOM; ` +
                        `no new cards for ` +
                        `${
                            STABLE_COUNT_CHECKS_REQUIRED *
                            COUNT_CHECK_INTERVAL /
                            1000
                        } seconds`
                    );

                    return;
                }

                /*
                 * Absolute safety stop.
                 */
                if (
                    elapsed >=
                    MAX_SCROLL_TIME
                ) {
                    ctx.state
                        .feedSafetyStops++;

                    yield getState(
                        ctx,
                        `${phase}: MAX_SCROLL_TIME reached. ` +
                        `Continuing with ${countCards()} ` +
                        `cards in DOM; highest observed ` +
                        `${highestCount}`
                    );

                    return;
                }
            }
        }

        /*
         * --------------------------------------------------
         * Restore feed after history.back()
         * --------------------------------------------------
         *
         * Normally Vue retains the loaded cards.
         *
         * If it does not, scroll until the previous number
         * of DOM cards has returned.
         */

        async function restoreFeedIfNeeded(
            targetCount
        ) {
            if (
                countCards() >=
                targetCount
            ) {
                return;
            }

            const start =
                Date.now();

            while (
                countCards() <
                    targetCount &&

                Date.now() -
                    start <
                    15000
            ) {
                window.scrollTo({
                    top:
                        document
                            .documentElement
                            .scrollHeight,

                    behavior:
                        "instant"
                });

                await sleep(1000);
            }
        }

        /*
         * --------------------------------------------------
         * Go back to feed
         * --------------------------------------------------
         */

        async function returnToOverview(
            overviewUrl,
            targetCount
        ) {
            window.history.back();

            const returned =
                await waitFor(() => {
                    return (
                        window.location.href ===
                            overviewUrl &&

                        document.querySelector(
                            CARD_SELECTOR
                        ) !== null
                    );
                });

            if (!returned) {
                ctx.state
                    .navigationFailures++;

                return false;
            }

            await sleep(
                BACK_WAIT
            );

            await restoreFeedIfNeeded(
                targetCount
            );

            return true;
        }

        /*
         * ==================================================
         * START
         * ==================================================
         */

        loadPersistentState();

        yield getState(
            ctx,
            `Duckling behavior starting; ` +
            `restored ` +
            `${clickedFingerprints.size} ` +
            `clicked card fingerprints and ` +
            `${visitedDuckIds.size} ` +
            `visited Duck IDs`
        );

        const phases = [
            "Editorial",
            "Community"
        ];

        /*
         * ==================================================
         * EDITORIAL + COMMUNITY
         * ==================================================
         */

        for (
            let phaseIndex = 0;
            phaseIndex <
                phases.length;
            phaseIndex++
        ) {
            const phase =
                phases[phaseIndex];

            /*
             * ==============================================
             * SWITCH TO COMMUNITY
             * ==============================================
             */

            if (
                phase ===
                "Community"
            ) {
                const communityButton =
                    findCommunityButton();

                if (!communityButton) {
                    yield getState(
                        ctx,
                        "Community button not found; " +
                        "behavior finished"
                    );

                    return;
                }

                const oldUrl =
                    window.location.href;

                const oldSignature =
                    getFeedSignature();

                communityButton
                    .scrollIntoView({
                        behavior:
                            "smooth",

                        block:
                            "center"
                    });

                await sleep(500);

                yield getState(
                    ctx,
                    "Clicking Community"
                );

                communityButton.click();

                ctx.state
                    .communityClicks++;

                /*
                 * Community may:
                 *
                 *   - change URL
                 *   - replace cards without URL change
                 */
                const changed =
                    await waitFor(() => {
                        return (
                            window.location.href !==
                                oldUrl ||

                            getFeedSignature() !==
                                oldSignature
                        );
                    }, NAV_TIMEOUT);

                if (changed) {
                    yield getState(
                        ctx,
                        "Community content change detected"
                    );
                } else {
                    yield getState(
                        ctx,
                        "Community did not produce an " +
                        "explicit URL/signature change; " +
                        "continuing"
                    );
                }

                await sleep(
                    COMMUNITY_LOAD_WAIT
                );
            }

            /*
             * ==============================================
             * LOAD ENTIRE FEED FIRST
             * ==============================================
             */

            for await (
                const update of
                loadFeedUntilStable(
                    phase
                )
            ) {
                yield update;
            }

            /*
             * This is how many cards should exist when
             * returning from each detail page.
             */
            const targetFeedCount =
                countCards();

            yield getState(
                ctx,
                `${phase}: processing ` +
                `${targetFeedCount} cards in DOM`
            );

            /*
             * ==============================================
             * PROCESS ALL CARDS
             * ==============================================
             */

            while (true) {
                const cards =
                    Array.from(
                        document
                            .querySelectorAll(
                                CARD_SELECTOR
                            )
                    );

                let candidate =
                    null;

                let newlySkipped =
                    0;

                /*
                 * Find first card that has NOT already
                 * been accounted for.
                 */
                for (
                    const card of cards
                ) {
                    const fingerprint =
                        getCardFingerprint(
                            card
                        );

                    /*
                     * Same stable card representation was
                     * already clicked.
                     *
                     * NEVER CLICK IT AGAIN.
                     */
                    if (
                        clickedFingerprints
                            .has(
                                fingerprint
                            )
                    ) {
                        continue;
                    }

                    /*
                     * Try to identify the actual Duck before
                     * clicking.
                     */
                    const preClickDuckId =
                        getDuckIdFromCard(
                            card
                        );

                    /*
                     * Different card representation pointing
                     * at a Duck we already visited.
                     *
                     * Account for the card but DO NOT click.
                     */
                    if (
                        preClickDuckId &&
                        visitedDuckIds.has(
                            preClickDuckId
                        )
                    ) {
                        clickedFingerprints
                            .add(
                                fingerprint
                            );

                        ctx.state
                            .cardsSkipped++;

                        newlySkipped++;

                        savePersistentState();

                        continue;
                    }

                    candidate = {
                        card,
                        fingerprint,
                        preClickDuckId
                    };

                    break;
                }

                if (
                    newlySkipped > 0
                ) {
                    yield getState(
                        ctx,
                        `${phase}: skipped ` +
                        `${newlySkipped} duplicate ` +
                        `card representation(s) whose ` +
                        `Duck ID was already visited`
                    );
                }

                /*
                 * No unprocessed cards remain.
                 */
                if (!candidate) {
                    yield getState(
                        ctx,
                        `${phase}: all ` +
                        `${countCards()} DOM cards ` +
                        `accounted for; no unclicked ` +
                        `card remains`
                    );

                    break;
                }

                const {
                    card,
                    fingerprint,
                    preClickDuckId
                } = candidate;

                /*
                 * Bring card into viewport.
                 */
                card.scrollIntoView({
                    behavior:
                        "smooth",

                    block:
                        "center",

                    inline:
                        "center"
                });

                await sleep(500);

                const overviewUrl =
                    window.location.href;

                const oldCard =
                    card;

                const attemptedNumber =
                    ctx.state.cardsClicked +
                    1;

                /*
                 * IMPORTANT:
                 *
                 * Yield BEFORE we reserve/click the card.
                 *
                 * Browsertrix can gracefully interrupt a
                 * behavior at a yield point.
                 */
                yield getState(
                    ctx,
                    `${phase}: clicking card ` +
                    `${attemptedNumber}` +
                    (
                        preClickDuckId
                            ? ` (${preClickDuckId})`
                            : ""
                    )
                );

                /*
                 * ==========================================
                 * AT-MOST-ONCE CRITICAL SECTION
                 * ==========================================
                 *
                 * No yield between:
                 *
                 *   1. persisting the fingerprint
                 *   2. clicking the card
                 *
                 * Therefore this particular stable card
                 * representation cannot intentionally be
                 * clicked twice.
                 */

                clickedFingerprints.add(
                    fingerprint
                );

                savePersistentState();

                card.click();

                ctx.state
                    .cardsClicked++;

                /*
                 * ==========================================
                 * WAIT FOR NAVIGATION
                 * ==========================================
                 */

                const navigationDetected =
                    await waitFor(() => {
                        return (
                            window.location.href !==
                                overviewUrl ||

                            !document
                                .documentElement
                                .contains(
                                    oldCard
                                )
                        );
                    });

                if (
                    !navigationDetected
                ) {
                    ctx.state
                        .navigationFailures++;

                    yield getState(
                        ctx,
                        `${phase}: no navigation detected ` +
                        `after card click. Card remains ` +
                        `marked and will NOT be clicked again.`
                    );

                    continue;
                }

                /*
                 * ==========================================
                 * DETERMINE ACTUAL DUCK ID
                 * ==========================================
                 */

                const detailDuckId =
                    extractDuckId(
                        window.location.href
                    ) ||
                    preClickDuckId;

                const alreadyVisitedDuck =
                    detailDuckId &&
                    visitedDuckIds.has(
                        detailDuckId
                    );

                if (detailDuckId) {
                    visitedDuckIds.add(
                        detailDuckId
                    );

                    savePersistentState();
                }

                /*
                 * If this happens, Duckling supplied two
                 * card representations that we could not
                 * identify as the same Duck before clicking.
                 *
                 * It is logged explicitly for diagnosis.
                 */
                if (
                    alreadyVisitedDuck
                ) {
                    ctx.state
                        .duplicateDetailHits++;

                    yield getState(
                        ctx,
                        `${phase}: DUPLICATE UNDERLYING ` +
                        `DUCK detected after navigation: ` +
                        `${detailDuckId}. The card DOM ` +
                        `fingerprint itself was new.`
                    );
                } else {
                    yield getState(
                        ctx,
                        `${phase}: opened card ` +
                        `${ctx.state.cardsClicked}: ` +
                        `${window.location.href}`
                    );
                }

                /*
                 * ==========================================
                 * WAIT UNTIL PAGE LOAD
                 * ==========================================
                 */

                const pageLoaded =
                    await waitFor(
                        () =>
                            document.readyState ===
                            "complete",

                        NAV_TIMEOUT
                    );

                if (pageLoaded) {
                    yield getState(
                        ctx,
                        `${phase}: card page reports ` +
                        `fully loaded`
                    );
                } else {
                    yield getState(
                        ctx,
                        `${phase}: page-load wait timed ` +
                        `out; using settle delay`
                    );
                }

                /*
                 * Vue may still render dynamic content after
                 * readyState=complete.
                 */
                await sleep(
                    PAGE_SETTLE_WAIT
                );

                /*
                 * ==========================================
                 * WAIT 10 SECONDS
                 * ==========================================
                 */

                yield getState(
                    ctx,
                    `${phase}: waiting 10 seconds ` +
                    `on card detail page`
                );

                await sleep(
                    DETAIL_WAIT
                );

                yield getState(
                    ctx,
                    `${phase}: 10 second detail wait ` +
                    `finished; going back`
                );

                /*
                 * ==========================================
                 * RETURN TO FEED
                 * ==========================================
                 */

                const returned =
                    await returnToOverview(
                        overviewUrl,
                        targetFeedCount
                    );

                /*
                 * If return fails, STOP.
                 *
                 * Do not attempt recovery that might result
                 * in accidentally clicking previous cards.
                 */
                if (!returned) {
                    yield getState(
                        ctx,
                        `${phase}: timed out returning ` +
                        `to feed; stopping behavior to ` +
                        `avoid duplicate clicks`
                    );

                    return;
                }

                yield getState(
                    ctx,
                    `${phase}: returned to feed; ` +
                    `${countCards()} cards currently in DOM`
                );
            }

            /*
             * ==============================================
             * PHASE FINISHED
             * ==============================================
             */

            yield getState(
                ctx,
                `${phase} DONE. ` +
                `Total card clicks: ` +
                `${ctx.state.cardsClicked}; ` +
                `known Duck IDs: ` +
                `${visitedDuckIds.size}; ` +
                `skipped duplicate cards: ` +
                `${ctx.state.cardsSkipped}; ` +
                `post-click duplicate Duck detections: ` +
                `${ctx.state.duplicateDetailHits}`
            );
        }

        /*
         * ==================================================
         * FINISHED
         * ==================================================
         */

        yield getState(
            ctx,
            `Duckling behavior FINISHED. ` +
            `${ctx.state.cardsClicked} card clicks ` +
            `performed; ` +
            `${visitedDuckIds.size} unique Duck IDs ` +
            `observed.`
        );
    }
}
