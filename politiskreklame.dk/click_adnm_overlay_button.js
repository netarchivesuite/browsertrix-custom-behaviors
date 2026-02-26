class ClickAdnmOverlayButton {
  static id = "click_adnm_overlay_button";

  static isMatch() {
    return true;
  }

  // Match epages naming. If your environment truly supports plural,
  // keeping singular usually still works only if singular is the expected key.
  static runInIframe = true;

  static init() {
    return {};
  }

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const selector = "button.adnm-overlayButton";

    yield ctx.Lib.getState(ctx, `adnm: starting; looking for ${selector}`);

    const timeoutMs = 10000;
    const intervalMs = 200;
    const start = Date.now();

    // Poll until button appears and is clickable-ish
    while (Date.now() - start < timeoutMs) {
      const btn = document.querySelector(selector);

      if (btn) {
        // Basic visibility check similar to epages
        const visible = !(btn.offsetWidth === 0 && btn.offsetHeight === 0);

        if (visible) {
          try {
            btn.focus();
            btn.click();
            yield ctx.Lib.getState(ctx, `adnm: clicked ${selector}`);
            return;
          } catch (e) {
            yield ctx.Lib.getState(ctx, `adnm: found ${selector} but click failed: ${String(e)}`);
            return;
          }
        }
      }

      await sleep(intervalMs);
    }

    yield ctx.Lib.getState(ctx, `adnm: ${selector} not found/visible within ${timeoutMs}ms`);
  }
}
