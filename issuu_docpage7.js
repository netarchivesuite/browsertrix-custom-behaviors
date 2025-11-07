class QueueIssuuIframe {
  // required: id displayed in logs
  static id = "Queue Issuu Iframe";

  // required: decide when to run
  static isMatch() {
    return /https:\/\/issuu\.com\/[^\/]+\/docs\/.*/.test(window.location.href);
  }

  static init() { return {}; }
  // optional: run inside iframes (kept false; cross-origin DOM is blocked)
  static runInIframes = true;

// constants you already use elsewhere
const TARGET_ID = "DocPageReaderIframe";
const PREFIX = "https://issuu.com/rd4";

async function waitForStableIframeSrc({
  id = TARGET_ID,
  prefix = PREFIX,
  timeoutMs = 30000,
  stableMs = 600,
  pollMs = 250,
} = {}) {
  return new Promise((resolve, reject) => {
    let last = null;
    let lastChangeTs = 0;
    const deadline = Date.now() + timeoutMs;

    const pickValue = () => {
      const el = document.getElementById(id);
      if (!el) return null;

      // Prefer attribute first to avoid early about:blank
      const v =
        el.getAttribute("src") ||
        el.getAttribute("data-src") ||
        el.src;

      if (!v || !v.startsWith(prefix)) return null;
      return v;
    };

    const finish = (v) => {
      cleanup();
      resolve(v);
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
        finish(v);
      }
    };

    // Observe src changes on the current element
    let observedEl = document.getElementById(id);
    const observer = observedEl
      ? new MutationObserver(tick)
      : null;
    if (observer && observedEl) {
      observer.observe(observedEl, {
        attributes: true,
        attributeFilter: ["src"],
      });
    }

    const poller = setInterval(tick, pollMs);
    const cleanup = () => {
      try { observer && observer.disconnect(); } catch {}
      clearInterval(poller);
    };

    tick();
  });
}

// Called by the crawler before post-crawl work
async function awaitPageLoad() {
  const { waitUntilNode } = ctx.Lib;

  // 1) Ensure the iframe element exists
  await waitUntilNode(`//iframe[@id='${TARGET_ID}']`);

  // 2) Wait for a stable, prefixed src
  let url = null;
  try {
    url = await waitForStableIframeSrc();
  } catch (e) {
    ctx.log({ msg: "awaitPageLoad: iframe src not ready", err: String(e) });
  }

  // 3) Cache for later phases
  ctx.state = ctx.state || {};
  ctx.state.iframeSrc = url || null;
  ctx.log({ msg: "awaitPageLoad: iframe src", url });
}

  

  
  async* run(ctx) {
const { addLink } = ctx.Lib;

let url = ctx.state?.iframeSrc;
if (!url) {
  // Fallback if something replaced the node after awaitPageLoad
  try { url = await waitForStableIframeSrc(); } catch {}
}

ctx.log({ msg: "iframe src", url });
if (url) await addLink(url);
  }
}
