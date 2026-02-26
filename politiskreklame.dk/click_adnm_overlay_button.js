class ClickAdnmOverlayButton {
  static id = "click_adnm_overlay_button";

  static isMatch() {
    return true;
  }

  static runInIframe = true;

  static init() {
    return {};
  }

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const selector = "div.adsm-wallpaper-r button";

    yield ctx.Lib.getState(ctx, `adnm: starting; looking for ${selector}`);

    const timeoutMs = 10000;
    const intervalMs = 200;
    const start = Date.now();

    const forceClick = (el) => {
      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 0,
      };

      el.dispatchEvent(new PointerEvent("pointerdown", eventOptions));
      el.dispatchEvent(new MouseEvent("mousedown", eventOptions));
      el.dispatchEvent(new PointerEvent("pointerup", eventOptions));
      el.dispatchEvent(new MouseEvent("mouseup", eventOptions));
      el.dispatchEvent(new MouseEvent("click", eventOptions));
    };

    while (Date.now() - start < timeoutMs) {
      const btn = document.querySelector(selector);

      if (btn) {
        const visible = !(btn.offsetWidth === 0 && btn.offsetHeight === 0);

        if (visible) {
          try {
            btn.scrollIntoView({ block: "center", inline: "center" });
            btn.focus();
            forceClick(btn);

            yield ctx.Lib.getState(ctx, `adnm: force-clicked ${selector}`);

            // 5 second wait after click
            await sleep(5000);

            yield ctx.Lib.getState(ctx, `adnm: waited 5000ms after click`);
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
