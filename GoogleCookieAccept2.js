class GoogleCookieAccept2
{
  static id = "GoogleCookieAccept2";

  static isMatch() {
    return window.location.href.includes("consent.google.com");
  }

  static init() {
    return {};
  }

  async awaitPageLoad(ctx) {


  }

  async* run(ctx) {
  const { Lib } = ctx;
  await Lib.sleep(3000);
      const btn = document.querySelector('button[aria-label*="accept" i]');
      if (btn) {
        btn.click();
        ctx.log({msg: "Accept button clicked"});
    }
  }
}
