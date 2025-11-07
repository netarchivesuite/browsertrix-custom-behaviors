class QueueIssuuIframe {
  // required: id displayed in logs
  static id = "Queue Issuu Iframe";

  // required: decide when to run
  static isMatch() {
    return true; ///https:\/\/issuu\.com\/[^\/]+\/docs\/.*/.test(location.href);
  }

  static init() { return {}; }
  // optional: run inside iframes (kept false; cross-origin DOM is blocked)
  static runInIframes = true;

  async* run(ctx) {
    const { waitUntilNode, addLink } = ctx.Lib;

    // wait until the iframe is present in the DOM
    const iframe = await waitUntilNode('#DocPageReaderIframe'); // optional second arg is timeout (ms)

    const url = iframe?.src;
    ctx.log({ msg: "iframe src", url });

    if (url) {
      await addLink(url);
    }
  }
}
