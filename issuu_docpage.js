class QueueIssuuIframe {
  // required: id displayed in logs
  static id = "Queue Issuu Iframe";

  // required: decide when to run
  // Runs on all pages by default.
  // To target a specific site, replace with:
  //   return window.location.href === "https://example.com/path";
  // Or a regex, e.g.:
  //   return /https:\/\/example\.com\/.+/i.test(window.location.href); 
  static isMatch() {
    return true;//return /issuu\.com\/.+\/docs\//.test(location.href);
  }

  static init() { return {}; }
  // optional: run inside iframes (kept false; cross-origin DOM is blocked)
  static runInIframes = false;

  // optional: wait for DOM and target element
  async awaitPageLoad() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxWaitMs = 15000;
    const start = Date.now();

    try {
      while (document.readyState !== "complete" && Date.now() - start < maxWaitMs) {
        await sleep(100);
      }
      while (!document.querySelector('[data-testid="page-numbers"]') && Date.now() - start < maxWaitMs) {
        await sleep(200);
      }
    } catch (_) {
      // swallow
    }
  }
  async extractBrowserLinks(ctx) {
    const urls = new Set([document.querySelector('#DocPageReaderIframe')?.src].filter(Boolean));
    await Promise.allSettled(Array.from(urls, url => ctx.Lib.addLink(url)));
  }
 async* run(ctx) {
      await this.extractBrowserLinks(ctx);
      yield { msg: "queued viewer" };
      await sleep(2000);               // give the crawler a moment
    
  }
}
