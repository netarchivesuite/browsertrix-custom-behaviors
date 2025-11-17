class ScrollAndClick {
  static id = "Scroll and Click";
  static maxScrolls = 500; // default maximum scroll iterations
  selectors = [
    "a",
    "button",
    "button.lc-load-more",
    "span[role=treeitem]",
    "button#load-more-posts",
    "#pagenation"
  ];
  triggerwords = [
    "se mere",
    "åbn",
    "flere kommentarer",
    "se flere",
    "indlæs flere nyheder",
    "hent flere",
    "vis flere",
    "tillad alle"
  ].map(t => t.toLowerCase());

  static isMatch(url) {
    return true; //run on all pages
    //return /[\s\S]*/.test(window.location.href);
    //return window.location.href === "https://www.trm.dk/nyheder/";
  }

  static init() {
    return {};
  }

  async extractBrowserLinks(ctx) {
    const urls = new Set(Array.from(document.links, a => a.href).filter(Boolean));
    await Promise.allSettled(Array.from(urls, url => ctx.Lib.addLink(url)));
  }

  static runInIframes = true;

  async* run(ctx) {
    let click = 0;
    const DomElementsMinimumChange = 10;
    let consecutiveSmallChanges = 0;

    let lastCount = document.body.getElementsByTagName("*").length;
    let stableTime = 0;
    let iterations = 0;

    while (true) {
      if (++iterations > this.maxScrolls) {
        ctx.log({ msg: "Max scrolls reached", iterations });
        break;
      }

      // scroll to bottom
      window.scrollTo({ top: document.body.scrollHeight-200, behavior: "smooth" });
      //window.scrollBy({ top: 400, behavior: "smooth" });
      //document.querySelector("button.lc-load-more").scrollIntoView({ behavior: "smooth" });
      
      await new Promise(r => setTimeout(r, 1000));

      // click if matched
      const selectstring = this.selectors.join(",");
      const elems = document.querySelectorAll(selectstring);
      for (const elem of elems) {
        const txt = (elem.innerText || elem.textContent || "").toLowerCase().trim();
        if (this.triggerwords.some(w => w === txt)) {
          elem.click();
          click++;
        }
      }
      if (elems.length > 0) {
        ctx.log({ msg: "Clicked load more buttons", totalClicks: click, thisRound: elems.length });
      }

      await new Promise(r => setTimeout(r, 1000));
      await this.extractBrowserLinks(ctx);

      // detect DOM changes by element count delta
      const newCount = document.body.getElementsByTagName("*").length;
      const delta = newCount - lastCount;
      ctx.log({ msg: "DomElementsAfterScroll", newCount, delta });

      if (delta >= DomElementsMinimumChange) {
        consecutiveSmallChanges = 0;
        stableTime = 0;
      } else {
        consecutiveSmallChanges += 1;
        stableTime += 1000;
      }

      // update baseline for next iteration
      lastCount = newCount;

      // stop if 3 consecutive small changes
      if (consecutiveSmallChanges >= 3) {
        ctx.log({
          msg: "Ending due to consecutive small DOM changes",
          consecutiveSmallChanges,
          threshold: DomElementsMinimumChange
        });
        break;
      }

      // stop if nothing changes for 10s
      if (stableTime >= 20000) {
        ctx.log({ msg: "No significant changes for 20 seconds, stopping scroll" });
        break;
      }
    }
  }
}
