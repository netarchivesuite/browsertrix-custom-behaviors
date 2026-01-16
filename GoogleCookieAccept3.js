class GoogleCookieAccept3 {
  static id = "GoogleCookieAccept3";
  
  selectors = [
    "button"
  ];
  triggerwords = [
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
    const { Lib } = ctx;
    await Lib.sleep(3000);
     
      const elems = document.querySelectorAll("button");
      for await (const elem of elems) {
          ctx.log({ msg: "Clicked Accept buttons", InnerText: elem.innerText, textContent: elem.textContent });
          await Lib.sleep(10000);
        }
      }
    }
