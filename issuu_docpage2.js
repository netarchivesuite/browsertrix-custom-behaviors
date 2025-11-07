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

    // wait for the iframe by XPath
    const iframe = await waitUntilNode("//iframe[@id='DocPageReaderIframe']");
    ctx.log({ msg: "iframe src", iframe.getAttribute("src") });
    //const url = iframe?.src || iframe?.getAttribute("src");
    //ctx.log({ msg: "iframe src", url });

    let url = iframe.getAttribute("src");
    ctx.log({ msg: "url", url });

    await addLink(url);
  }
}
