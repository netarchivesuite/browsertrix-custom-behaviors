class GoogleCookieAccept2
{
  static id = "GoogleCookieAccept2";

  static isMatch() {
    return window.location.href.includes("consent.google.com");
  }

  static init() {
    return {};
  }

  async* run(ctx) {
  const { Lib } = ctx;
  await Lib.sleep(3000);



        for await (const elem of document.querySelectorAll('button[aria-label*="accept" i]')) {
      elem.click();

      const maxAttempts = 10;
      let attempts = 0;
      while(true) {
        if (attempts >= maxAttempts) {
          break;
        }
        attempts++;

        
        await Lib.sleep(500);
      }
      yield Lib.getState(ctx, "Played track", "tracksPlayed");
    }
   }
}
