class ClickAdnmOverlayButton {
  static id = "click_adnm_overlay_button";

  static isMatch() {
    return true;
  }

  // This behavior must run in the Playwright context (needs `page.waitForEvent("popup")`)
  static runInIframe = false;

  static init() {
    return {};
  }

  async* run(ctx) {
    const timeout = 30000;
    const selector = "button.adnm-overlayButton";

    // Try common locations for the Playwright `page` object
    const page =
      ctx?.page ||
      ctx?.Playwright?.page ||
      ctx?.playwright?.page ||
      ctx?.browser?.page;

    if (!page?.waitForEvent || !page?.locator) {
      yield ctx.Lib.getState(
        ctx,
        `adnm: missing Playwright page on ctx (expected ctx.page). Cannot capture popup URL.`
      );
      return;
    }

    yield ctx.Lib.getState(ctx, `adnm: waiting for popup; clicking ${selector}`);

    let popup;
    try {
      [popup] = await Promise.all([
        page.waitForEvent("popup", { timeout }),
        page.locator(selector).click({ timeout }),
      ]);
    } catch (e) {
      yield ctx.Lib.getState(
        ctx,
        `adnm: failed to click / no popup within ${timeout}ms: ${String(e)}`
      );
      return;
    }

    // Wait for navigation to settle (redirects). Be tolerant if the site uses SPA/no nav events.
    try {
      await popup.waitForNavigation({ waitUntil: "networkidle", timeout });
    } catch (_) {
      // ignore
    }

    // Additional settle: load state if available (Playwright has it)
    try {
      await popup.waitForLoadState("load", { timeout });
    } catch (_) {
      // ignore
    }

    const finalUrl = popup.url();

    // Send final url to log
    console.log("Popup final URL:", finalUrl);
    yield ctx.Lib.getState(ctx, `adnm: popup final URL: ${finalUrl}`);

    // Stop behavior after achieved
    return;
  }
}
