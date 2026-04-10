/**
 * Author: Thomas Smedebøl
 * Created: 2026-04-10
 * Last modified: 2026-04-10
 * Version: 1.0.1
 *
 * Purpose: scrape rss feeds from this form: <rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0" xml:base="https://www.version2.dk/">
 * Scope: Point to a relevant rss feed url
 * Assumptions: People follow standards, rss-links are on same domain
 * Dependencies:
 * Config: same domain, rss-url as seed and 1 hop, 1 browserwindow to keep polite
 * Limitations:
 * Changelog:
 *  - 1.0.0: Initial version
 *  - 1.0.1: Added top-level failure logging and per-link try/catch
 */

class rss_scraper {
  static id = "rss_scraper";

  static isMatch(url) {
    return true; // run on all pages
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async* run(ctx) {
    try {
      const content = document.body?.innerText || "";

      if (!content) {
        ctx.log({
          level: "warn",
          msg: "RSS scrape found no body innerText content",
          url: location.href,
        });
        return;
      }

      const itemBlocks = [...content.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);

      if (itemBlocks.length === 0) {
        ctx.log({
          level: "warn",
          msg: "RSS scrape found no <item> blocks",
          url: location.href,
        });
        return;
      }

      const links = itemBlocks
        .map((block, index) => {
          const link = block.match(/<link>(.*?)<\/link>/i)?.[1]?.trim();

          if (!link) {
            ctx.log({
              level: "warn",
              msg: "RSS item missing <link>",
              itemIndex: index,
              url: location.href,
            });
          }

          return link;
        })
        .filter(Boolean);

      ctx.log({
        msg: "Extracted links array",
        count: links.length,
        links,
      });

      for (const link of links) {
        try {
          ctx.Lib.addLink(link);
        } catch (error) {
          ctx.log({
            level: "error",
            msg: "Failed to add extracted RSS link",
            link,
            error: error?.message || String(error),
            url: location.href,
          });
        }
      }
    } catch (error) {
      ctx.log({
        level: "error",
        msg: "Unhandled failure during RSS scrape",
        error: error?.message || String(error),
        stack: error?.stack,
        url: location.href,
      });
    }
  }
}
