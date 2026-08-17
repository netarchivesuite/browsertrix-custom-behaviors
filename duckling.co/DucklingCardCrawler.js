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

        const SCROLL_TIME = 30000;
        const SCROLL_INTERVAL = 800;

        const DETAIL_WAIT = 3000;
        const BACK_WAIT = 5000;

        const NAV_TIMEOUT = 15000;
        const COMMUNITY_LOAD_WAIT = 3000;

        /*
         * Duckling currently has Editorial + Community.
         * We therefore switch to Community once after Editorial
         * has been exhausted.
         */
        const MAX_COMMUNITY_CLICKS = 1;

        /*
         * Stores stable identities of cards already visited.
         * This remains alive throughout this behavior run.
         */
        const visitedCards = new Set();

        /*
         * --------------------------------------------------
         * Helper: wait for arbitrary condition
         * --------------------------------------------------
         */
        async function waitFor(predicate, timeout = NAV_TIMEOUT) {
            const start = Date.now();

            while (Date.now() - start < timeout) {
                try {
                    if (predicate()) {
                        return true;
                    }
                } catch (_) {
                    // DOM may temporarily be changing
                }

                await sleep(100);
            }

            return false;
        }

        /*
         * --------------------------------------------------
         * Helper: stable card ID
         *
         * Google Storage URLs are signed and their query
         * parameters change, so only origin + pathname
         * are used.
         * --------------------------------------------------
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
                    imageUrl = url.origin + url.pathname;
                } catch (_) {
                    imageUrl = image.src.split("?")[0];
                }
            }

            return [
                imageUrl,
                profile || "",
                heading ? heading.textContent.trim() : ""
            ].join("|");
        }

        /*
         * --------------------------------------------------
         * Helper: find first card not yet visited
         * --------------------------------------------------
         */
        function findNextCard() {
            const cards = Array.from(
                document.querySelectorAll(CARD_SELECTOR)
            );

            for (const card of cards) {
                const key = getCardKey(card);

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
         * --------------------------------------------------
         * Helper: find Community button
         * --------------------------------------------------
         */
        function findCommunityButton() {
            /*
             * First try the classes supplied from Duckling.
             */
            const candidates = Array.from(
                document.querySelectorAll(
                    "button.bg-transparent.text-duckling_black.flex-1.rounded-full.py-4.text-lg.font-semibold.transition-colors"
                )
            );

            let button = candidates.find(
                element =>
                    (element.textContent || "").trim() ===
                    "Community"
            );

            /*
             * Fallback in case Tailwind classes change slightly.
             */
            if (!button) {
                button = Array.from(
                    document.querySelectorAll("button")
                ).find(
                    element =>
                        (element.textContent || "")
                            .trim()
                            .toLowerCase() === "community"
                );
            }

            return button || null;
        }

        /*
         * --------------------------------------------------
         * Helper: signature of currently displayed cards
         *
         * Used to detect an SPA update where URL does not
         * change.
         * --------------------------------------------------
         */
        function getCardSignature() {
            return Array.from(
                document.querySelectorAll(CARD_SELECTOR)
            )
                .slice(0, 10)
                .map(getCardKey)
                .join("||");
        }

        /*
         * --------------------------------------------------
         * 30 second infinite-scroll pass
         * --------------------------------------------------
         */
        async function scrollFor30Seconds() {
            const start = Date.now();

            while (Date.now() - start < SCROLL_TIME) {
                window.scrollTo({
                    top: document.documentElement.scrollHeight,
                    behavior: "smooth"
                });

                await sleep(SCROLL_INTERVAL);
            }

            /*
             * One final bottom position.
             */
            window.scrollTo({
                top: document.documentElement.scrollHeight,
                behavior: "instant"
            });

            /*
             * Give final lazy-loaded cards a little time.
             */
            await sleep(2000);
        }

        /*
         * --------------------------------------------------
         * START
         * --------------------------------------------------
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
             * LOAD ALL CARDS IN CURRENT SECTION
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
                `${document.querySelectorAll(CARD_SELECTOR).length} cards currently in DOM`,
                "scrollPasses"
            );

            /*
             * ==============================================
             * VISIT EVERY NEW CARD
             * ==============================================
             */

            while (true) {
                const next = findNextCard();

                if (!next) {
                    break;
                }

                const { card, key } = next;

                /*
                 * Mark before click so a navigation problem
                 * doesn't cause the same card to be repeatedly
                 * clicked.
                 */
                visitedCards.add(key);

                const cardNumber =
                    ctx.state.cardsClicked + 1;

                card.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                    inline: "center"
                });

                await sleep(500);

                const overviewUrl =
                    window.location.href;

                const oldCard = card;

                yield getState(
                    ctx,
                    `Clicking card ${cardNumber} in ${phase}`
                );

                /*
                 * ==========================================
                 * OPEN CARD
                 * ==========================================
                 */

                card.click();

                /*
                 * Duckling is a Vue SPA. Usually the URL
                 * changes. As fallback, also accept the
                 * original card being detached from DOM.
                 */
                const navigationDetected =
                    await waitFor(() => {
                        return (
                            window.location.href !==
                                overviewUrl ||
                            !document.documentElement.contains(
                                oldCard
                            )
                        );
                    });

                if (!navigationDetected) {
                    ctx.state.navigationFailures++;

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
                 * Requirement:
                 * remain on card page for 3 seconds.
                 */
                await sleep(DETAIL_WAIT);

                /*
                 * ==========================================
                 * RETURN TO LIST
                 * ==========================================
                 */

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
                    ctx.state.navigationFailures++;

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
                 * Allow Vue to reconstruct / settle the list.
                 */
                await sleep(BACK_WAIT);

                /*
                 * DO NOT keep a reference to the old NodeList.
                 * findNextCard() performs a completely new DOM
                 * lookup after every navigation.
                 */
            }

            /*
             * ==============================================
             * NO MORE UNVISITED CARDS
             * ==============================================
             */

            yield getState(
                ctx,
                `No more new cards in ${phase}. ` +
                `${visitedCards.size} unique cards visited so far.`
            );

            /*
             * If we have already switched to Community,
             * we're finished.
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
             * SWITCH TO COMMUNITY
             * ==============================================
             */

            const communityButton =
                findCommunityButton();

            if (!communityButton) {
                yield getState(
                    ctx,
                    'Community button not found; behavior finished'
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
             * Community may be a pure Vue state change and
             * therefore may not change the URL.
             *
             * Accept either:
             *   - URL changes
             *   - visible card set changes
             */
            const communityChanged =
                await waitFor(() => {
                    return (
                        window.location.href !== oldUrl ||
                        getCardSignature() !==
                            oldSignature
                    );
                }, NAV_TIMEOUT);

            if (!communityChanged) {
                yield getState(
                    ctx,
                    "No explicit Community navigation detected; continuing after timeout"
                );
            } else {
                yield getState(
                    ctx,
                    "Community content change detected"
                );
            }

            /*
             * Additional page-load wait requested.
             */
            await sleep(COMMUNITY_LOAD_WAIT);

            phase = "Community";

            /*
             * Loop starts again:
             *
             *   30 sec scroll
             *   -> find cards
             *   -> open each
             *   -> wait 3 sec
             *   -> back
             *   -> next card
             */
        }
    }
}
