class GoogleCookieAccept3 {
  static id = "GoogleCookieAccept3";
  
  selectors = [
    "a",
    "button",
    "button.lc-load-more",
    "span[role=treeitem]",
    "button#load-more-posts",
    "#pagenation",
    "button.CybotCookiebotDialogBodyButton"
  ];
  triggerwords = [
    "se mere",
    "åbn",
    "flere kommentarer",
    "se flere",
    "indlæs flere nyheder",
    "hent flere",
    "vis flere",
    "tillad alle",
    "Acceptér alle"
  ].map(t => t.toLowerCase());

  static isMatch(url) {
    //return window.location.href.includes("consent.google.com");
    return true; //run on all pages
    //return /[\s\S]*/.test(window.location.href);
    //return window.location.href === "https://www.trm.dk/nyheder/";
  }

  static init() {
    return {};
  }

  static runInIframes = true;

  async* run(ctx) {
    let click = 0;
    const { Lib } = ctx;
    await Lib.sleep(3000);
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
        ctx.log({ msg: "Clicked Accept buttons", totalClicks: click, thisRound: elems.length });
      }


    }
  }
