class ClickAdnmOverlayButton {
  static id = "click_adnm_overlay_button";
  static isMatch() {
    return true;
  }

  // Intercepting window.open must run in the same JS context as the page,
  // so keep this true if your behavior executes inside the page.
  static runInIframe = true;

  static init() {
    return {};
  }

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btnSelector = "button.adnm-overlayButton";

    yield ctx.Lib.getState(ctx, `adnm: installing window.open interceptor`);

    // --- Option B: intercept window.open and capture the URL passed to it ---
    const originalOpen = window.open;
    let capturedUrl = null;
    let capturedName = null;

    window.open = function (url, name, features) {
      try {
        capturedUrl = url ?? "";
        capturedName = name ?? "";
        console.log("Popup initial URL:", capturedUrl);
      } catch (_) {}

      // restore immediately to minimize side-effects
      try {
        window.open = originalOpen;
      } catch (_) {}

      return originalOpen.call(window, url, name, features);
    };

    // Also capture clicks on <a target="_blank"> as a fallback (many ads use anchors)
    const onClickCapture = (ev) => {
      try {
        const a = ev.target?.closest?.("a");
        if (a && (a.target === "_blank" || a.rel?.includes("noopener") || a.rel?.includes("noreferrer"))) {
          const href = a.href || a.getAttribute("href") || "";
          if (href) {
            capturedUrl = capturedUrl || href;
            console.log("Popup initial URL (anchor):", href);
          }
        }
      } catch (_) {}
    };
    document.addEventListener("click", onClickCapture, true);

    // --- Find and click the overlay button ---
    yield ctx.Lib.getState(ctx, `adnm: looking for ${btnSelector}`);

    const timeoutMs = 30000;
    const start = Date.now();

    let btn = null;
    while (Date.now() - start < timeoutMs) {
      btn = document.querySelector(btnSelector);
      if (btn && !(btn.offsetWidth === 0 && btn.offsetHeight === 0)) break;
      await sleep(200);
    }

    if (!btn) {
      // cleanup
      try { window.open = originalOpen; } catch (_) {}
      document.removeEventListener("click", onClickCapture, true);

      yield ctx.Lib.getState(ctx, `adnm: ${btnSelector} not found/visible within ${timeoutMs}ms`);
      return;
    }

    try {
      btn.focus();
      btn.click();
      yield ctx.Lib.getState(ctx, `adnm: clicked ${btnSelector}`);
    } catch (e) {
      // cleanup
      try { window.open = originalOpen; } catch (_) {}
      document.removeEventListener("click", onClickCapture, true);

      yield ctx.Lib.getState(ctx, `adnm: click failed: ${String(e)}`);
      return;
    }

    // Wait briefly for window.open to be called and URL captured
    const captureWaitMs = 2000;
    const captureStart = Date.now();
    while (!capturedUrl && Date.now() - captureStart < captureWaitMs) {
      await sleep(50);
    }

    // cleanup
    try { window.open = originalOpen; } catch (_) {}
    document.removeEventListener("click", onClickCapture, true);

    if (capturedUrl) {
      console.log("Popup initial URL:", capturedUrl);
      yield ctx.Lib.getState(
        ctx,
        `adnm: captured popup initial URL: ${capturedUrl}${capturedName ? ` (name=${capturedName})` : ""}`
      );
      return;
    }

    yield ctx.Lib.getState(ctx, `adnm: no popup URL captured (popup may be opened via other means)`);
  }
}
