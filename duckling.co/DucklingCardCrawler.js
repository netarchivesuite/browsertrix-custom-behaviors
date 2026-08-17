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
                communityClicks: 0,
                scrollPasses: 0,
                navigationFailures: 0
            }
        };
    }

    async *run(ctx) {
        const { sleep, getState } = ctx.Lib;

        const CARD_SELECTOR =
            ".card.relative.overflow-hidden.rounded-lg.hover\\:cursor-pointer";

        // Scroll the feed for 30 seconds to trigger lazy loading.
        const SCROLL_TIME = 30000;
        const SCROLL_INTERVAL = 800;

        // After a card page has fully loaded, remain there for 20 seconds.
        const DETAIL_WAIT = 20000;

        // Extra settling time after returning to the overview.
        const BACK_WAIT = 1500;

        // Maximum time to wait for navigation/state changes.
        const NAV_TIMEOUT = 15000;

        // Extra settling time after switching to Community.
        const COMMUNITY_LOAD_WAIT = 3000;

        // We start in Editorial, then switch to Community once.
        const MAX_COMMUNITY_CLICKS = 1;

        // Keep track of all cards visited during this behavior run.
        const visitedCards = new Set();

        /*
         * Wait until predicate() becomes true or timeout expires.
         */
        async function waitFor(predicate, timeout = NAV_TIMEOUT) {
            const start = Date.now();

            while (Date.now() - start < timeout) {
                try {
                    if (predicate()) {
                        return true;
                    }
                } catch (_) {
                    // DOM may temporarily be changing.
                }

                await sleep(100);
            }

            return false;
        }

        /*
         * Generate a stable ID for a card.
         *
         * Duckling image URLs use signed Google Storage query
         * parameters which can change, so only origin + pathname
         * are used from the image URL.
         */
        function getCardKey(card) {
            const image =
                card.querySelector('img[alt="Duck image"]') ||
                card.querySelector("img");

            const heading = card.querySelector("h2");

            const spans = Array.from(
                card.querySelectorAll("span")
            );

            const profile = spans
                .map(node => (node.textContent || "").trim())
                .find(text => text.startsWith("@"));

            let imageUrl = "";

            if (image && image.src) {
                try {
                    const url = new URL(image.src);

                    imageUrl =
                        url.origin +
                        url.pathname;
                } catch (_) {
                    imageUrl =
                        image.src.split("?")[0];
                }
            }

            return [
                imageUrl,
                profile || "",
                heading
                    ? heading.textContent.trim()
                    : ""
            ].join("|");
        }

        /*
         * Find the first card which has not yet been visited.
         *
         * The DOM is queried again every time because Vue may
         * reconstruct the feed after navigation.
         */
        function findNextCard() {
            const cards = Array.from(
                document.querySelectorAll(
                    CARD_SELECTOR
                )
            );

            for (const card of cards) {
                const key =
                    getCardKey(card);

                if (!visitedCards.has(key)) {
                    return {
                        card,
                        key
                    };
                }
            }

            return null;
        }

        /*
         * Locate the Community button.
         */
        function findCommunityButton() {
            const candidates = Array.from(
                document.querySelectorAll(
                    "button.bg-transparent.text-duckling_black.flex-1.rounded-full.py-4.text-lg.font-semibold.transition-colors"
                )
            );

            let button = candidates.find(
                element =>
                    (element.textContent || "")
                        .trim()
                        .toLowerCase() ===
                    "community"
            );

            /*
             * Fallback in case Duckling changes some
             * Tailwind classes.
             */
            if (!button) {
                button = Array.from(
                    document.querySelectorAll(
                        "button"
                    )
                ).find(
                    element =>
                        (element.textContent || "")
                            .trim()
                            .toLowerCase() ===
                        "community"
                );
            }

            return button || null;
        }

        /*
         * Build a small signature from the currently visible
         * cards. This lets us detect SPA changes even if the
         * URL remains unchanged.
         */
        function getCardSignature() {
            return Array.from(
                document.querySelectorAll(
                    CARD_SELECTOR
                )
            )
                .slice(0, 10)
                .map(getCardKey)
                .join("||");
        }

        /*
         * Scroll repeatedly to the bottom for 30 seconds.
         */
        async function scrollFor30Seconds() {
            const start =
                Date.now();

            while (
                Date.now() - start <
                SCROLL_TIME
            ) {
                window.scrollTo({
                    top:
                        document.documentElement
                            .scrollHeight,
                    behavior: "smooth"
                });

                await sleep(
                    SCROLL_INTERVAL
                );
            }

            /*
             * Make one final jump to the absolute bottom.
             */
            window.scrollTo({
                top:
                    document.documentElement
                        .scrollHeight,
                behavior: "instant"
            });

            /*
             * Give the final lazy-loaded content time
             * to appear.
             */
            await sleep(2000);
        }

        /*
         * ==================================================
         * START
         * ==================================================
         */

        yield getState(
            ctx,
            "Duckling behavior starting"
        );

        let communityClicks = 0;
        let phase = "Editorial";

        while (true) {
            /*
             * ==============================================
             * SCROLL CURRENT FEED FOR 30 SECONDS
             * ==============================================
             */

            yield getState(
                ctx,
                `Starting 30 second scroll in ${phase}`
            );

            await scrollFor30Seconds();

            yield getState(
                ctx,
                `Finished scroll in ${phase}; ` +
                    `${
                        document.querySelectorAll(
                            CARD_SELECTOR
                        ).length
                    } cards currently in DOM`,
                "scrollPasses"
            );

            /*
             * ==============================================
             * VISIT ALL UNVISITED CARDS
             * ==============================================
             */

            while (true) {
                const next =
                    findNextCard();

                if (!next) {
                    break;
                }

                const {
                    card,
                    key
                } = next;

                /*
                 * Mark the card as visited before clicking.
                 *
                 * This prevents repeatedly clicking a card
                 * if navigation fails.
                 */
                visitedCards.add(key);

                const cardNumber =
                    ctx.state.cardsClicked +
                    1;

                card.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                    inline: "center"
                });

                await sleep(500);

                const overviewUrl =
                    window.location.href;

                const oldCard =
                    card;

                yield getState(
                    ctx,
                    `Clicking card ${cardNumber} in ${phase}`
                );

                /*
                 * ==========================================
                 * CLICK CARD
                 * ==========================================
                 */

                card.click();

                /*
                 * Detect navigation.
                 *
                 * Duckling is a Vue SPA. Navigation may
                 * change the URL, or the original card node
                 * may simply disappear from the DOM.
                 */
                const navigationDetected =
                    await waitFor(() => {
                        return (
                            window.location.href !==
                                overviewUrl ||
                            !document.documentElement
                                .contains(
                                    oldCard
                                )
                        );
                    });

                if (!navigationDetected) {
                    ctx.state
                        .navigationFailures++;

                    yield getState(
                        ctx,
                        `No navigation detected after clicking card ${cardNumber}`
                    );

                    continue;
                }

                yield getState(
                    ctx,
                    `Opened card ${cardNumber}: ${window.location.href}`,
                    "cardsClicked"
                );

                /*
                 * ==========================================
                 * WAIT FOR CARD PAGE TO LOAD FULLY
                 * ==========================================
                 *
                 * On a normal navigation readyState changes.
                 * On SPA navigation it may already be
                 * "complete", but this still ensures that
                 * normal document loading has completed.
                 */
                const pageLoaded =
                    await waitFor(() => {
                        return (
                            document.readyState ===
                            "complete"
                        );
                    }, NAV_TIMEOUT);

                if (pageLoaded) {
                    yield getState(
                        ctx,
                        `Card ${cardNumber} page reports fully loaded`
                    );
                } else {
                    yield getState(
                        ctx,
                        `Card ${cardNumber} load wait timed out; continuing`
                    );
                }

                /*
                 * Give Vue / dynamic content an additional
                 * second to settle before starting the
                 * requested 20-second wait.
                 */
                await sleep(1000);

                yield getState(
                    ctx,
                    `Card ${cardNumber} ready; waiting 20 seconds`
                );

                /*
                 * ==========================================
                 * REMAIN ON CARD FOR 20 SECONDS
                 * ==========================================
                 */

                await sleep(
                    DETAIL_WAIT
                );

                yield getState(
                    ctx,
                    `20 second wait finished for card ${cardNumber}; going back`
                );

                /*
                 * ==========================================
                 * RETURN TO FEED
                 * ==========================================
                 */

                window.history.back();

                /*
                 * Wait until we are back on the original
                 * overview and cards are visible again.
                 */
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

                    yield getState(
                        ctx,
                        `Timed out returning from card ${cardNumber}`
                    );
                } else {
                    yield getState(
                        ctx,
                        `Returned from card ${cardNumber}`
                    );
                }

                /*
                 * Give Vue time to reconstruct and settle
                 * the feed.
                 */
                await sleep(
                    BACK_WAIT
                );

                /*
                 * findNextCard() now performs a completely
                 * fresh DOM lookup for the next card.
                 */
            }

            /*
             * ==============================================
             * NO MORE NEW CARDS IN CURRENT SECTION
             * ==============================================
             */

            yield getState(
                ctx,
                `No more new cards in ${phase}. ` +
                    `${visitedCards.size} unique cards visited so far.`
            );

            /*
             * We have already processed Community.
             * The behavior is now finished.
             */
            if (
                communityClicks >=
                MAX_COMMUNITY_CLICKS
            ) {
                yield getState(
                    ctx,
                    `Duckling behavior finished. ` +
                        `${visitedCards.size} unique cards visited.`
                );

                return;
            }

            /*
             * ==============================================
             * CLICK COMMUNITY
             * ==============================================
             */

            const communityButton =
                findCommunityButton();

            if (!communityButton) {
                yield getState(
                    ctx,
                    "Community button not found; behavior finished"
                );

                return;
            }

            const oldUrl =
                window.location.href;

            const oldSignature =
                getCardSignature();

            communityButton.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            await sleep(500);

            yield getState(
                ctx,
                "Clicking Community"
            );

            communityButton.click();

            communityClicks++;

            yield getState(
                ctx,
                "Community clicked",
                "communityClicks"
            );

            /*
             * Community may be a pure SPA state change
             * without a URL change.
             *
             * Accept either:
             *
             *   - URL changes
             *   - card contents change
             */
            const communityChanged =
                await waitFor(() => {
                    return (
                        window.location.href !==
                            oldUrl ||
                        getCardSignature() !==
                            oldSignature
                    );
                }, NAV_TIMEOUT);

            if (communityChanged) {
                yield getState(
                    ctx,
                    "Community content change detected"
                );
            } else {
                yield getState(
                    ctx,
                    "No explicit Community navigation detected; continuing"
                );
            }

            /*
             * Give Community content additional time
             * to finish loading.
             */
            await sleep(
                COMMUNITY_LOAD_WAIT
            );

            phase = "Community";

            /*
             * Main loop now starts again:
             *
             * Community
             *   -> scroll for 30 seconds
             *   -> find all new cards
             *   -> click card
             *   -> wait for page load
             *   -> wait 20 seconds
             *   -> back
             *   -> next card
             *   -> finish when no new cards remain
             */
        }
    }
}
