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
    const iframe = await ctx.Lib.waitUntil(() => document.querySelector("#DocPageReaderIframe"));
    await new Promise(r => setTimeout(r, 1000));
    ctx.log({ msg: "iframe src", iframe?.getAttribute("src") });
    //const url = iframe?.src || iframe?.getAttribute("src");
    //ctx.log({ msg: "iframe src", url });

    let url = document.querySelector('#DocPageReaderIframe')?.src;
    ctx.log({ msg: "iframe src", url });

    if (url) await addLink(url);
  }
}
