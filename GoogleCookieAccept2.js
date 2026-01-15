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
    const { Lib } = ctx;
    const btn = document.querySelector('button[aria-label*="accept" i]');
      if (btn) {
        btn.click();
        ctx.log({msg: "Accept button clicked"});
    }
  }

  async* run(ctx) {

  }
}
