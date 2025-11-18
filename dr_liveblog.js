class QueueLiveBlogIframe {
  // required: id displayed in logs
  static id = "Queue LiveBlog Iframe";

  // required: decide when to run
  static isMatch() {
    return /https:\/\/www\.dr\.dk.*live.*/.test(window.location.href);
  }

  static init() { return {}; }

  // do not run inside cross-origin iframes
  static runInIframes = false;

  // --- config ---
  static TIMEOUT = 30000;
  static STABLE  = 600;
  static POLL    = 250;

  // url":"https:\/\/livecenter\.norkon\.net\/frame[^\"]+
  static LIVE_CENTER_REGEX =
    /url":"(https:\/\/livecenter\.norkon\.net\/frame[^"]+)/;

  static waitForStableLiveCenterUrl({ timeoutMs, stableMs, pollMs }) {
    return new Promise((resolve, reject) => {
      let last = null;
      let lastChangeTs = 0;
      const deadline = Date.now() + timeoutMs;

      const pickValue = () => {
        // Search in the full HTML (or text) for the JSON field
        const html = document.documentElement?.innerHTML || "";
        const m = html.match(QueueLiveBlogIframe.LIVE_CENTER_REGEX);
        if (!m || !m[1]) return null;
        return m[1]; // the actual URL
      };

      let poller = null;

      const cleanup = () => {
        if (poller) clearInterval(poller);
      };

      const tick = () => {
        if (Date.now() > deadline) {
          cleanup();
          reject(new Error("timeout waiting for livecenter url"));
          return;
        }

        const v = pickValue();
        if (!v) return;

        if (v !== last) {
          last = v;
          lastChangeTs = Date.now();
        } else if (Date.now() - lastChangeTs >= stableMs) {
          cleanup();
          resolve(v);
        }
      };

      poller = setInterval(tick, pollMs);
      tick();
    });
  }

  // optional hook: crawler awaits this before post-crawl operations
  async awaitPageLoad(ctx) {
    let url = null;
    try {
      url = await QueueLiveBlogIframe.waitForStableLiveCenterUrl({
        timeoutMs: QueueLiveBlogIframe.TIMEOUT,
        stableMs: QueueLiveBlogIframe.STABLE,
        pollMs: QueueLiveBlogIframe.POLL,
      });
    } catch (e) {
      ctx.log({ msg: "awaitPageLoad: livecenter url not ready", err: String(e) });
    }

    // cache for later
    ctx.state = ctx.state || {};
    ctx.state.liveCenterUrl = url || null;
    ctx.log({ msg: "awaitPageLoad: livecenter url", url });
  }

  async *run(ctx) {
    const { addLink } = ctx.Lib;

    // prefer the cached value from awaitPageLoad()
    let url = ctx.state?.liveCenterUrl || null;

    if (!url) {
      // fallback if content changed after awaitPageLoad
      try {
        url = await QueueLiveBlogIframe.waitForStableLiveCenterUrl({
          timeoutMs: QueueLiveBlogIframe.TIMEOUT,
          stableMs: QueueLiveBlogIframe.STABLE,
          pollMs: QueueLiveBlogIframe.POLL,
        });
      } catch (e) {
        ctx.log({ msg: "run: livecenter url wait failed", err: String(e) });
      }
    }

    ctx.log({ msg: "livecenter url", url });
    if (url) await addLink(url);
  }
}
