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

  async* run(ctx) {
const { waitUntilNode, addLink } = ctx.Lib;

const TARGET_ID = "DocPageReaderIframe";
const PREFIX = "https://issuu.com/rd4";
const TIMEOUT_MS = 30000;     // total max wait
const STABLE_MS  = 500;       // require value to be unchanged for this long
const POLL_MS    = 250;

// 1) Ensure the iframe exists in DOM
const iframeNode = await waitUntilNode(`//iframe[@id='${TARGET_ID}']`);
if (!iframeNode) {
  ctx.log({ msg: "iframe not found" });
  return;
}

// 2) Wait for a stable src that matches the prefix
const url = await (async () => new Promise((resolve, reject) => {
  let last = null;
  let lastChangeTs = 0;
  const deadline = Date.now() + TIMEOUT_MS;

  const pickValue = () => {
    // Re-query each time in case the node is replaced
    const el = document.getElementById(TARGET_ID);
    if (!el) return null;

    // Prefer the attribute. Properties often return "about:blank" initially.
    const val =
      el.getAttribute("src") ||
      el.getAttribute("data-src") || // handle lazy loaders
      el.src;

    if (!val) return null;
    if (!val.startsWith(PREFIX)) return null;
    return val;
  };

  const done = (v) => {
    cleanup();
    resolve(v);
  };

  const onTick = () => {
    if (Date.now() > deadline) {
      cleanup();
      reject(new Error("timeout waiting for iframe src"));
      return;
    }
    const v = pickValue();
    if (!v) return;

    if (v !== last) {
      last = v;
      lastChangeTs = Date.now();
    } else if (Date.now() - lastChangeTs >= STABLE_MS) {
      done(v);
    }
  };

  const observer = new MutationObserver(onTick);
  const el = document.getElementById(TARGET_ID);
  if (el) observer.observe(el, { attributes: true, attributeFilter: ["src"] });

  const poller = setInterval(onTick, POLL_MS);
  const cleanup = () => {
    try { observer.disconnect(); } catch {}
    clearInterval(poller);
  };

  // kick off immediately
  onTick();
}))().catch(err => {
  ctx.log({ msg: "iframe src wait failed", err: String(err) });
  return null;
});

ctx.log({ msg: "iframe src", url });
if (url) await addLink(url);
  }
}
