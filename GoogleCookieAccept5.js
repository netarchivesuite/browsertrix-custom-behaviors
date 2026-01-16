class GoogleCookieAccept5 {
  static id = "GoogleCookieAccept5";

  static isMatch(url) {
    // Only run on Google's consent pages
    return window.location.href.includes("consent.google.com");
  }

  static init() {
    return {};
  }

  async* run(ctx) {
    const { Lib } = ctx;

    // Small wait to let the consent UI render
    await Lib.sleep(3000);

    // Robust, simple: find the first button whose aria-label contains "accept" (case-insensitive)
    const btn = document.querySelector('button[aria-label*="accept" i]');

    if (btn) {
      btn.click();
      ctx.log({
        msg: "Clicked accept button",
        ariaLabel: btn.getAttribute("aria-label"),
        innerText: btn.innerText,
        textContent: btn.textContent,
      });
    } else {
      ctx.log({ msg: "No matching accept button found" });
    }
  }
}
