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

 async* run(ctx) {
    await new Promise(r => setTimeout(r, 1000));
   ctx.log({ msg: "iframe src", document.querySelector('#DocPageReaderIframe')?.src });
    await ctx.Lib.addLink("https://issuu.com/rd4?p=1&d=metalmagasinet_2025_nr._3&u=danskmetalweb");
  }
}
