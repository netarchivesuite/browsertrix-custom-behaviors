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

    // Wait until the iframe exists AND its src starts with the target prefix
    const iframe = await waitUntilNode(
      "//iframe[@id='DocPageReaderIframe' and starts-with(@src,'https://issuu.com/rd4')]"
    );

    const url = iframe?.src || iframe?.getAttribute("src");
    ctx.log({ msg: "iframe src", url });
    if (url) await addLink(url);
  }
}
