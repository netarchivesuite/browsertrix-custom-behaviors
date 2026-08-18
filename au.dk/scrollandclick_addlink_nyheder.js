class ScrollAndClick {
  static id = "Scroll and Click";
  static maxScrolls = 5000; // default maximum scroll iterations

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
    "hent flere artikler"
  ].map(t => t.toLowerCase());

  static isMatch(url) {
    return true; // run on all pages
    // return /[\s\S]*/.test(window.location.href);
    // return window.location.href === "https://www.trm.dk/nyheder/";
  }

  static init() {
    return {};
  }

  async extractBrowserLinks(ctx) {
    const urls = new Set();

    // Extract all normal <a href="..."> links on the page
    for (const a of document.links) {
      if (a.href) {
        urls.add(a.href);
      }
    }

    // Explicitly extract links from Cludo search results
    for (const a of document.querySelectorAll('a[data-cludo-result="searchresult"]')) {
      // Normal href
      if (a.href) {
        urls.add(a.href);
      }

      // Cludo's original URL attribute
      const cludoUrl = a.getAttribute("data-cludo-url");
      if (cludoUrl) {
        try {
          urls.add(new URL(cludoUrl, document.baseURI).href);
        } catch (e) {
          ctx.log({
            msg: "Invalid Cludo URL",
            url: cludoUrl
          });
        }
      }
    }

    ctx.log({
      msg: "Extracted browser links",
      totalUrls: urls.size
    });

    await Promise.allSettled(
      Array.from(urls, url => ctx.Lib.addLink(url))
    );
  }

  static runInIframes = false;

  async* run(ctx) {
    let click = 0;
    const DomElementsMinimumChange = 10;
    let consecutiveSmallChanges = 0;

    let lastCount = document.body.getElementsByTagName("*").length;
    let stableTime = 0;
    let iterations = 0;

    while (true) {
      if (++iterations > ScrollAndClick.maxScrolls) {
        ctx.log({
          msg: "Max scrolls reached",
          iterations
        });
        break;
      }

      // Scroll to bottom
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
      });

      await new Promise(r => setTimeout(r, 1000));

      // Click matching "load more" style elements
      const selectstring = this.selectors.join(",");
      const elems = document.querySelectorAll(selectstring);

      let clicksThisRound = 0;

      for (const elem of elems) {
        const txt = (
          elem.innerText ||
          elem.textContent ||
          ""
        ).toLowerCase().trim();

        if (this.triggerwords.some(w => w === txt)) {
          elem.click();
          click++;
          clicksThisRound++;
        }
      }

      if (clicksThisRound > 0) {
        ctx.log({
          msg: "Clicked load more buttons",
          totalClicks: click,
          thisRound: clicksThisRound
        });
      }

      await new Promise(r => setTimeout(r, 1000));

      // Extract links after content has potentially been added
      await this.extractBrowserLinks(ctx);

      // Detect DOM changes by element count delta
      const newCount = document.body.getElementsByTagName("*").length;
      const delta = newCount - lastCount;

      ctx.log({
        msg: "DomElementsAfterScroll",
        newCount,
        delta
      });

      if (delta >= DomElementsMinimumChange) {
        consecutiveSmallChanges = 0;
        stableTime = 0;
      } else {
        consecutiveSmallChanges += 1;
        stableTime += 1000;
      }

      // Update baseline for next iteration
      lastCount = newCount;

      // Stop if 3 consecutive small changes
      if (consecutiveSmallChanges >= 3) {
        ctx.log({
          msg: "Ending due to consecutive small DOM changes",
          consecutiveSmallChanges,
          threshold: DomElementsMinimumChange
        });
        break;
      }

      // Stop if nothing changes for 10s
      if (stableTime >= 10000) {
        ctx.log({
          msg: "No significant changes for 10 seconds, stopping scroll"
        });
        break;
      }
    }

    // One final extraction to catch anything loaded during the last iteration
    await this.extractBrowserLinks(ctx);
  }
}
