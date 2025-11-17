class QueueLiveBlogIframe {
  // required: id displayed in logs
  static id = "Queue LiveBlog Iframe";

  // required: decide when to run
  static isMatch() {
    return /https:\/\/www\.dr\.dk.*liveblog.*/.test(window.location.href);
  }

  static init() { return {}; }

  // do not run inside cross-origin iframes
  static runInIframes = false;

  // --- config ---
  static TARGET_ID = "DocPageReaderIframe";
  static PREFIX   = "https://livecenter.norkon.net/frame/";
  static TIMEOUT  = 30000;
  static STABLE   = 600;
  static POLL     = 250;

  static waitForStableIframeSrc({ id, prefix, timeoutMs, stableMs, pollMs }) {
    return new Promise((resolve, reject) => {
      let last = null;
      let lastChangeTs = 0;
      const deadline = Date.now() + timeoutMs;

      const pickValue = () => {
        const el = document.getElementById(id);
        if (!el) return null;
        const v =
          el.getAttribute("src") ||
          el.getAttribute("data-src") ||
          el.src;
        if (!v || !v.startsWith(prefix)) return null;
        return v;
      };

      let observer = null;
      let poller = null;
      const cleanup = () => {
        try { observer && observer.disconnect(); } catch {}
        if (poller) clearInterval(poller);
      };

      const tick = () => {
        if (Date.now() > deadline) {
          cleanup();
          reject(new Error("timeout waiting for stable iframe src"));
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

      const el = document.getElementById(id);
      if (el) {
        observer = new MutationObserver(tick);
        observer.observe(el, { attributes: true, attributeFilter: ["src"] });
      }

      poller = setInterval(tick, pollMs);
      tick();
    });
  }

  // optional hook: crawler awaits this before post-crawl operations
  async awaitPageLoad(ctx) {
    const { waitUntilNode } = ctx.Lib;

    // 1) ensure iframe element exists
    await waitUntilNode(`//iframe[@id='${QueueLiveBlogIframe.TARGET_ID}']`);

    // 2) wait for a stable, prefixed src
    let url = null;
    try {
      url = await QueueLiveBlogIframe.waitForStableIframeSrc({
        id: QueueLiveBlogIframe.TARGET_ID,
        prefix: QueueLiveBlogIframe.PREFIX,
        timeoutMs: QueueLiveBlogIframe.TIMEOUT,
        stableMs: QueueLiveBlogIframe.STABLE,
        pollMs: QueueLiveBlogIframe.POLL,
      });
    } catch (e) {
      ctx.log({ msg: "awaitPageLoad: iframe src not ready", err: String(e) });
    }

    // 3) cache for later
    ctx.state = ctx.state || {};
    ctx.state.iframeSrc = url || null;
    ctx.log({ msg: "awaitPageLoad: iframe src", url });
  }

  async *run(ctx) {
    const { waitUntilNode, addLink } = ctx.Lib;

    // prefer the cached value from awaitPageLoad()
    let url = ctx.state?.iframeSrc || null;

    if (!url) {
      // fallback if the node was replaced after awaitPageLoad
      await waitUntilNode(`//iframe[@id='${QueueLiveBlogIframe.TARGET_ID}']`);
      try {
        url = await QueueLiveBlogIframe.waitForStableIframeSrc({
          id: QueueLiveBlogIframe.TARGET_ID,
          prefix: QueueLiveBlogIframe.PREFIX,
          timeoutMs: QueueLiveBlogIframe.TIMEOUT,
          stableMs: QueueLiveBlogIframe.STABLE,
          pollMs: QueueLiveBlogIframe.POLL,
        });
      } catch (e) {
        ctx.log({ msg: "run: iframe src wait failed", err: String(e) });
      }
    }

    ctx.log({ msg: "iframe src", url });
    if (url) await addLink(url);
  }
}
