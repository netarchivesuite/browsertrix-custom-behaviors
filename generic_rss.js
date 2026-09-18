class RSSFeedLinks {
    static id = "RSSFeedLinks";

    static runInIframe = false;

    static init() {
        return {
            state: {},
            opts: {}
        };
    }

    /*
     * IMPORTANT:
     * Only run when "rss" or "feed" occurs somewhere in the URL.
     *
     * Examples:
     *   https://example.com/rss
     *   https://example.com/rss.xml
     *   https://example.com/feed
     *   https://example.com/news/feed/
     *   https://example.com/?feed=rss2
     *   https://example.com/something?rss=1
     */
    static isMatch() {
        const url = window.location.href.toLowerCase();

        return url.includes("rss") || url.includes("feed");
    }

    async *run(ctx) {
        const { addLink } = ctx.Lib;

        const pageUrl = window.location.href;

        let added = 0;
        let failed = 0;

        const stats = {
            candidates: 0,
            duplicates: 0,
            invalid: 0,
            nonHttp: 0,
            selfLinks: 0
        };

        const found = new Set();
        const formats = new Set();

        // ------------------------------------------------------------
        // Logging helper
        // ------------------------------------------------------------

        const log = (msg, extra = {}) => ({
            msg: `[RSSFeedLinks] ${msg}`,
            ...extra
        });

        yield log(`START: ${pageUrl}`);
        yield log(`Content-Type: ${document.contentType || "unknown"}`);

        // ------------------------------------------------------------
        // Helpers
        // ------------------------------------------------------------

        function localName(node) {
            return (
                node?.localName ||
                node?.nodeName ||
                ""
            )
                .toLowerCase()
                .split(":")
                .pop();
        }

        function getAttributeByLocalName(element, wantedName) {
            if (!element?.attributes) {
                return null;
            }

            wantedName = wantedName.toLowerCase();

            for (const attr of Array.from(element.attributes)) {
                if (localName(attr) === wantedName) {
                    return attr.value;
                }
            }

            return null;
        }

        function directChildrenByName(element, wantedName) {
            if (!element?.children) {
                return [];
            }

            wantedName = wantedName.toLowerCase();

            return Array.from(element.children).filter(
                child => localName(child) === wantedName
            );
        }

        function descendantsByName(element, wantedName) {
            if (!element?.getElementsByTagName) {
                return [];
            }

            wantedName = wantedName.toLowerCase();

            return Array.from(
                element.getElementsByTagName("*")
            ).filter(
                child => localName(child) === wantedName
            );
        }

        // ------------------------------------------------------------
        // URL normalization / deduplication
        // ------------------------------------------------------------

        function addCandidate(value) {
            if (value === undefined || value === null) {
                return false;
            }

            // Handle objects occasionally found in JSON feeds:
            //
            // "link": {
            //     "href": "...",
            //     "url": "..."
            // }

            if (typeof value === "object") {
                if (Array.isArray(value)) {
                    let result = false;

                    for (const entry of value) {
                        if (addCandidate(entry)) {
                            result = true;
                        }
                    }

                    return result;
                }

                let result = false;

                for (const key of [
                    "url",
                    "href",
                    "link",
                    "permalink"
                ]) {
                    if (value[key] && addCandidate(value[key])) {
                        result = true;
                    }
                }

                return result;
            }

            stats.candidates++;

            let str = String(value).trim();

            if (!str) {
                stats.invalid++;
                return false;
            }

            // Remove literal CDATA wrappers if present
            str = str
                .replace(/^<!\[CDATA\[/i, "")
                .replace(/\]\]>$/i, "")
                .trim();

            if (!str) {
                stats.invalid++;
                return false;
            }

            try {
                const url = new URL(str, pageUrl);

                if (
                    url.protocol !== "http:" &&
                    url.protocol !== "https:"
                ) {
                    stats.nonHttp++;
                    return false;
                }

                // Fragments do not represent a separate crawl target.
                url.hash = "";

                const normalized = url.href;

                // Avoid adding the feed page itself again.
                try {
                    const current = new URL(pageUrl);
                    current.hash = "";

                    if (normalized === current.href) {
                        stats.selfLinks++;
                        return false;
                    }
                } catch (_) {
                    // Ignore.
                }

                if (found.has(normalized)) {
                    stats.duplicates++;
                    return false;
                }

                found.add(normalized);

                return true;

            } catch (_) {
                stats.invalid++;
                return false;
            }
        }

        // ------------------------------------------------------------
        // RSS / RDF parser
        // ------------------------------------------------------------

        function parseRSS(doc) {
            if (!doc?.getElementsByTagName) {
                return 0;
            }

            const all = Array.from(
                doc.getElementsByTagName("*")
            );

            const items = all.filter(
                element => localName(element) === "item"
            );

            if (!items.length) {
                return 0;
            }

            formats.add(`RSS/RDF (${items.length} items)`);

            for (const item of items) {
                let gotNormalLink = false;

                // Prefer direct <link> children.
                let links = directChildrenByName(item, "link");

                // Tolerate less conventional structures.
                if (!links.length) {
                    links = descendantsByName(item, "link");
                }

                for (const link of links) {
                    const rel = (
                        link.getAttribute?.("rel") || ""
                    ).toLowerCase();

                    // Ignore obvious non-article links.
                    if (
                        rel === "self" ||
                        rel === "enclosure" ||
                        rel === "replies" ||
                        rel === "license"
                    ) {
                        continue;
                    }

                    if (
                        addCandidate(link.getAttribute?.("href"))
                    ) {
                        gotNormalLink = true;
                    }

                    if (
                        addCandidate(link.textContent)
                    ) {
                        gotNormalLink = true;
                    }
                }

                // RSS GUID fallback.
                //
                // <guid isPermaLink="true">
                //     https://example.com/article
                // </guid>

                if (!gotNormalLink) {
                    const guids = descendantsByName(
                        item,
                        "guid"
                    );

                    for (const guid of guids) {
                        const value = (
                            guid.textContent || ""
                        ).trim();

                        const isPermalink = (
                            guid.getAttribute?.("isPermaLink") ||
                            guid.getAttribute?.("ispermalink") ||
                            ""
                        ).toLowerCase();

                        if (
                            isPermalink === "true" ||
                            /^https?:\/\//i.test(value)
                        ) {
                            addCandidate(value);
                        }
                    }
                }

                // RSS 1.0 / RDF fallback:
                //
                // <item rdf:about="https://example.com/article">

                if (!gotNormalLink) {
                    const about = getAttributeByLocalName(
                        item,
                        "about"
                    );

                    if (about) {
                        addCandidate(about);
                    }
                }
            }

            return items.length;
        }

        // ------------------------------------------------------------
        // Atom parser
        // ------------------------------------------------------------

        function parseAtom(doc) {
            if (!doc?.getElementsByTagName) {
                return 0;
            }

            const all = Array.from(
                doc.getElementsByTagName("*")
            );

            const entries = all.filter(
                element => localName(element) === "entry"
            );

            if (!entries.length) {
                return 0;
            }

            formats.add(`Atom (${entries.length} entries)`);

            for (const entry of entries) {
                let links = directChildrenByName(
                    entry,
                    "link"
                );

                if (!links.length) {
                    links = descendantsByName(
                        entry,
                        "link"
                    );
                }

                /*
                 * Atom normally looks like:
                 *
                 * <link
                 *     rel="alternate"
                 *     type="text/html"
                 *     href="https://example.com/article"
                 * />
                 */

                const alternate = links.filter(link => {
                    const rel = (
                        link.getAttribute?.("rel") ||
                        "alternate"
                    ).toLowerCase();

                    return (
                        rel === "alternate" ||
                        rel === ""
                    );
                });

                const candidates =
                    alternate.length
                        ? alternate
                        : links;

                for (const link of candidates) {
                    const rel = (
                        link.getAttribute?.("rel") || ""
                    ).toLowerCase();

                    if (
                        rel === "self" ||
                        rel === "enclosure" ||
                        rel === "replies" ||
                        rel === "license" ||
                        rel === "related"
                    ) {
                        continue;
                    }

                    addCandidate(
                        link.getAttribute?.("href")
                    );

                    // Support broken/non-standard Atom.
                    if (!link.getAttribute?.("href")) {
                        addCandidate(link.textContent);
                    }
                }
            }

            return entries.length;
        }

        // ------------------------------------------------------------
        // Generic XML feed parser
        // ------------------------------------------------------------

        function parseGenericXML(doc) {
            if (!doc?.getElementsByTagName) {
                return 0;
            }

            const all = Array.from(
                doc.getElementsByTagName("*")
            );

            /*
             * Some custom/news feeds use containers such as:
             *
             * <article>
             * <story>
             * <post>
             * <release>
             */

            const containers = all.filter(element =>
                [
                    "article",
                    "story",
                    "post",
                    "release",
                    "record"
                ].includes(localName(element))
            );

            if (!containers.length) {
                return 0;
            }

            formats.add(
                `Generic XML feed (${containers.length} records)`
            );

            for (const container of containers) {
                const links = descendantsByName(
                    container,
                    "link"
                );

                for (const link of links) {
                    addCandidate(
                        link.getAttribute?.("href")
                    );

                    addCandidate(
                        link.getAttribute?.("url")
                    );

                    addCandidate(
                        link.textContent
                    );
                }

                // Other common URL fields.
                for (const fieldName of [
                    "url",
                    "permalink",
                    "href"
                ]) {
                    const elements = descendantsByName(
                        container,
                        fieldName
                    );

                    for (const element of elements) {
                        addCandidate(
                            element.textContent
                        );
                    }
                }
            }

            return containers.length;
        }

        // ------------------------------------------------------------
        // Sitemap / XML URL-list fallback
        //
        // Useful for feed-like XML endpoints that return:
        //
        // <urlset>
        //   <url>
        //     <loc>https://...</loc>
        //   </url>
        // </urlset>
        // ------------------------------------------------------------

        function parseXMLUrlList(doc) {
            if (!doc?.getElementsByTagName) {
                return 0;
            }

            const root = localName(
                doc.documentElement
            );

            if (
                root !== "urlset" &&
                root !== "sitemapindex"
            ) {
                return 0;
            }

            const locs = Array.from(
                doc.getElementsByTagName("*")
            ).filter(
                element => localName(element) === "loc"
            );

            if (!locs.length) {
                return 0;
            }

            formats.add(
                `XML URL list (${locs.length} URLs)`
            );

            for (const loc of locs) {
                addCandidate(loc.textContent);
            }

            return locs.length;
        }

        // ------------------------------------------------------------
        // JSON Feed parser
        // ------------------------------------------------------------

        function parseJSON(json) {
            if (!json || typeof json !== "object") {
                return 0;
            }

            let items = [];

            if (Array.isArray(json.items)) {
                items = json.items;
            } else if (Array.isArray(json.entries)) {
                items = json.entries;
            } else if (Array.isArray(json.posts)) {
                items = json.posts;
            } else if (Array.isArray(json.articles)) {
                items = json.articles;
            } else if (Array.isArray(json.results)) {
                items = json.results;
            }

            if (!items.length) {
                return 0;
            }

            formats.add(
                `JSON Feed/API (${items.length} items)`
            );

            for (const item of items) {
                if (!item || typeof item !== "object") {
                    continue;
                }

                // JSON Feed standard
                addCandidate(item.url);
                addCandidate(item.external_url);

                // Common alternatives
                addCandidate(item.link);
                addCandidate(item.links);
                addCandidate(item.href);
                addCandidate(item.permalink);
                addCandidate(item.web_url);

                // Only use ID as fallback if it itself looks
                // like an HTTP URL.
                if (
                    typeof item.id === "string" &&
                    /^https?:\/\//i.test(item.id)
                ) {
                    addCandidate(item.id);
                }
            }

            return items.length;
        }

        // ------------------------------------------------------------
        // Parse the current browser DOM first.
        //
        // This handles normal:
        //   application/rss+xml
        //   application/atom+xml
        //   application/xml
        //   text/xml
        // ------------------------------------------------------------

        let rssItems = 0;
        let atomEntries = 0;
        let genericEntries = 0;
        let xmlUrls = 0;
        let jsonItems = 0;

        try {
            rssItems += parseRSS(document);
            atomEntries += parseAtom(document);

            if (!rssItems && !atomEntries) {
                genericEntries += parseGenericXML(
                    document
                );

                xmlUrls += parseXMLUrlList(
                    document
                );
            }
        } catch (error) {
            yield log(
                `DOM parsing warning: ${error.message}`
            );
        }

        // ------------------------------------------------------------
        // Obtain visible/raw text.
        //
        // Important for feeds served as:
        //
        // text/plain
        // application/json
        //
        // or feeds displayed inside <pre>.
        // ------------------------------------------------------------

        let rawText = "";

        try {
            rawText =
                document.body?.innerText ||
                document.documentElement?.textContent ||
                "";
        } catch (_) {
            rawText = "";
        }

        const trimmed = rawText.trim();

        // ------------------------------------------------------------
        // JSON fallback
        // ------------------------------------------------------------

        if (
            trimmed.startsWith("{") ||
            trimmed.startsWith("[") ||
            (
                document.contentType &&
                document.contentType
                    .toLowerCase()
                    .includes("json")
            )
        ) {
            try {
                const json = JSON.parse(trimmed);

                jsonItems += parseJSON(json);

            } catch (error) {
                yield log(
                    `JSON parse attempt failed: ${error.message}`
                );
            }
        }

        // ------------------------------------------------------------
        // Raw XML fallback
        //
        // Useful when the server delivered XML as text/plain.
        // ------------------------------------------------------------

        if (trimmed.startsWith("<")) {
            try {
                const parser = new DOMParser();

                const xml = parser.parseFromString(
                    trimmed,
                    "application/xml"
                );

                const parserError =
                    xml.getElementsByTagName(
                        "parsererror"
                    );

                if (!parserError.length) {
                    rssItems += parseRSS(xml);
                    atomEntries += parseAtom(xml);

                    if (!rssItems && !atomEntries) {
                        genericEntries +=
                            parseGenericXML(xml);

                        xmlUrls +=
                            parseXMLUrlList(xml);
                    }
                }

            } catch (error) {
                yield log(
                    `Raw XML parse attempt failed: ${error.message}`
                );
            }
        }

        // ------------------------------------------------------------
        // Parsing report
        // ------------------------------------------------------------

        if (formats.size) {
            yield log(
                `Detected: ${Array.from(formats).join(", ")}`
            );
        } else {
            yield log(
                "No recognized RSS, Atom, RDF, JSON Feed or XML feed structure detected."
            );
        }

        const links = Array.from(found);

        yield log(
            `Found ${links.length} unique HTTP(S) target URLs.`,
            {
                found: links.length,
                candidates: stats.candidates,
                duplicates: stats.duplicates,
                invalid: stats.invalid,
                nonHttp: stats.nonHttp,
                selfLinks: stats.selfLinks
            }
        );

        if (!links.length) {
            yield log("DONE: No URLs to add.");
            return;
        }

        // ------------------------------------------------------------
        // Submit URLs to Browsertrix
        // ------------------------------------------------------------
        //
        // Avoid producing thousands of log messages on huge feeds.
        //
        // <= 50 URLs:
        //     log every URL
        //
        // > 50 URLs:
        //     log first 10, every 100th, and the final URL
        // ------------------------------------------------------------

        const verbose = links.length <= 50;

        for (let i = 0; i < links.length; i++) {
            const url = links[i];

            try {
                await addLink(url);
                added++;

                const shouldLog =
                    verbose ||
                    i < 10 ||
                    added % 100 === 0 ||
                    i === links.length - 1;

                if (shouldLog) {
                    yield log(
                        `addLink ${added}/${links.length}: ${url}`,
                        {
                            added,
                            total: links.length
                        }
                    );
                }

            } catch (error) {
                failed++;

                yield log(
                    `ERROR adding ${url}: ${error.message}`,
                    {
                        added,
                        failed,
                        total: links.length
                    }
                );
            }
        }

        // ------------------------------------------------------------
        // Final report
        // ------------------------------------------------------------

        yield log(
            `DONE: ${added}/${links.length} URLs submitted with addLink()` +
            (failed ? `, ${failed} failed.` : "."),
            {
                found: links.length,
                added,
                failed,
                duplicates: stats.duplicates,
                invalid: stats.invalid,
                nonHttp: stats.nonHttp,
                selfLinks: stats.selfLinks
            }
        );
    }
}
