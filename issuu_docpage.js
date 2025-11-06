class QueueIssuuIframe {
  static id = "Queue Issuu iframe";
  static isMatch() { return /issuu\.com\/.+\/docs\//.test(location.href); }
  static async* run(ctx) {
    const { waitUntilNode, addLink, log, sleep } = ctx.Lib;
    const iframe = await waitUntilNode(() => document.querySelector('iframe[src*="issuu.com"]'), 15000);
    if (iframe?.src) {
      addLink(iframe.src);            // crawl the viewer as a top-level page
      log({ msg: "queued viewer", url: iframe.src });
      yield { msg: "queued viewer" };
      await sleep(200);               // give the crawler a moment
    }
  }
}
