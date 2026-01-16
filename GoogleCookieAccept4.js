class GoogleCookieAccept4 {
  static id = "GoogleCookieAccept4";
  
  static isMatch(url) {
    //return window.location.href.includes("consent.google.com");
    return true; //run on all pages
    //return /[\s\S]*/.test(window.location.href);
    //return window.location.href === "https://www.trm.dk/nyheder/";
  }

  static init() {
    return {};
  }

  async* run(ctx) {
    const { Lib } = ctx;
    await Lib.sleep(3000);
     
      const elems = document.querySelectorAll('button[aria-label*="accept" i]');
      for await (const elem of elems) {
          ctx.log({ msg: "Clicked Accept buttons", InnerText: elem.innerText, textContent: elem.textContent });
          await Lib.sleep(10000);
        }
      }
    }
