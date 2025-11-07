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
    return /.*issuu\.com\/[^\/]+\/docs\/.*/.test(window.location.href);
  }

  static init() { return {}; }
  // optional: run inside iframes (kept false; cross-origin DOM is blocked)
  static runInIframes = true;

 async* run(ctx) {
    await new Promise(r => setTimeout(r, 1000));
   let url = document.querySelector('#DocPageReaderIframe')?.src;
   ctx.log({ msg: "iframe src", url });
    await ctx.Lib.addLink(url);
  }
}
