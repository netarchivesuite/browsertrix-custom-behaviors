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
    // wait for the iframe by XPath
    const iframe = await ctx.Lib.waitUntil(() => document.querySelector("#DocPageReaderIframe"));
    await new Promise(r => setTimeout(r, 1000));
    
    let url = iframe.src;
    ctx.log({ msg: "iframe src", url });
    await ctx.Lib.addLink(url);
    
  }
}
