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
  static runInIframes = true;

 static async* run(ctx) {
    const { waitUntilNode, addLink, log, sleep } = ctx.Lib;

    const iframe = await waitUntilNode(() =>
      document.querySelector('#DocPageReaderIframe')
      || document.querySelector('iframe[src*="issuu.com"]')
      || document.querySelector('iframe[id*="DocPage"]'),
      15000
    );

    const raw = iframe?.getAttribute('src') || iframe?.dataset?.src;
    if (!raw) { yield { msg: 'no iframe src' }; return; }

    const url = new URL(raw, location.href).href;  // handle relative src
    addLink(url);                                   // enqueue viewer as top-level
    log({ msg: 'queued viewer', url });
    yield { msg: 'queued viewer', url };
    await sleep(100);
  }
}
