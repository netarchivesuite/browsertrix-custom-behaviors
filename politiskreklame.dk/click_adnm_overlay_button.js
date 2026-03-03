/**
 * Author: Thomas Smedebøl
 * Created: 2026-02-27
 * Last modified: 2026-03-03
 * Version: 1.1.0
 *
 * Purpose: get info about political advertising on mainstreammedia made temporary availible on politiskreklame.dk
 * Scope: all using political advertising
 * Assumptions: There has to be a supported overlay element
 * Dependencies:
 * Config: Should work on anything.
 * Limitations: The ads info (budget) are only availible for the duration of the campaign.
 * Changelog:
 *  - 1.1.0: Added multiple overlay selectors and centralized selector config
 *  - 1.0.0: Initial version
 */

// ==============================
// Selectors (Maintainability)
// ==============================
const SELECTORS = {
  overlayTriggers: [
    "button.adnm-overlayButton",
    'div.adnm-overlayNotice[role="button"]',
    "div.adn-ttpa-container",
  ],
};

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

    const overlaySelector = SELECTORS.overlayTriggers.join(",");

    const isVisible = (el) =>
      el &&
      !(el.offsetWidth === 0 && el.offsetHeight === 0) &&
      getComputedStyle(el).visibility !== "hidden" &&
      getComputedStyle(el).display !== "none";

    const extractAndDecodeFinalUrl = (captured) => {
      if (!captured) return null;

      const marker = "https%3A%2F%2Fpolitiskreklame.dk";
      let idx = captured.lastIndexOf(marker);

      if (idx === -1) {
        const m = captured.match(/https%3A%2F%2F[^&]+$/);
        if (m) idx = captured.lastIndexOf(m[0]);
      }

      if (idx === -1) return null;

      const encodedTail = captured.slice(idx);

      try {
        return decodeURIComponent(encodedTail);
      } catch (_) {
        try {
          return decodeURI(encodedTail);
        } catch (_) {
          return null;
        }
      }
    };

    yield ctx.Lib.getState(ctx, `adnm: installing window.open interceptor`);

    const originalOpen = window.open;
    let capturedUrl = null;
    let capturedName = null;

    window.open = function (url, name, features) {
      try {
        capturedUrl = url ?? "";
        capturedName = name ?? "";
        console.log("Popup initial URL:", capturedUrl);
      } catch (_) {}

      try {
        window.open = originalOpen;
      } catch (_) {}

      return originalOpen.call(window, url, name, features);
    };

    const onClickCapture = (ev) => {
      try {
        const a = ev.target?.closest?.("a");
        if (
          a &&
          (a.target === "_blank" ||
            a.rel?.includes("noopener") ||
            a.rel?.includes("noreferrer"))
        ) {
          const href = a.href || a.getAttribute("href") || "";
          if (href) {
            capturedUrl = capturedUrl || href;
            console.log("Popup initial URL (anchor):", href);
          }
        }
      } catch (_) {}
    };
    document.addEventListener("click", onClickCapture, true);

    yield ctx.Lib.getState(
      ctx,
      `adnm: looking for overlay triggers (${overlaySelector})`
    );

    const timeoutMs = 30000;
    const start = Date.now();

    let trigger = null;

    while (Date.now() - start < timeoutMs) {
      const candidates = document.querySelectorAll(overlaySelector);
      for (const el of candidates) {
        if (isVisible(el)) {
          trigger = el;
          break;
        }
      }
      if (trigger) break;
      await sleep(200);
    }

    if (!trigger) {
      try {
        window.open = originalOpen;
      } catch (_) {}
      document.removeEventListener("click", onClickCapture, true);

      yield ctx.Lib.getState(
        ctx,
        `adnm: no visible overlay trigger found within ${timeoutMs}ms`
      );
      return;
    }

    try {
      trigger.focus?.();
      trigger.click();
      yield ctx.Lib.getState(
        ctx,
        `adnm: clicked overlay trigger (${trigger.tagName.toLowerCase()}.${trigger.className})`
      );
    } catch (e) {
      try {
        window.open = originalOpen;
      } catch (_) {}
      document.removeEventListener("click", onClickCapture, true);

      yield ctx.Lib.getState(ctx, `adnm: click failed: ${String(e)}`);
      return;
    }

    const captureWaitMs = 2000;
    const captureStart = Date.now();
    while (!capturedUrl && Date.now() - captureStart < captureWaitMs) {
      await sleep(50);
    }

    try {
      window.open = originalOpen;
    } catch (_) {}
    document.removeEventListener("click", onClickCapture, true);

    if (capturedUrl) {
      const finalUrl = extractAndDecodeFinalUrl(capturedUrl);

      if (finalUrl) {
        console.log("Decoded final URL:", finalUrl);

        try {
          ctx.Lib.addLink(finalUrl);
        } catch (_) {}

        yield ctx.Lib.getState(
          ctx,
          `adnm: captured popup initial URL: ${capturedUrl}${
            capturedName ? ` (name=${capturedName})` : ""
          }\nadnm: extracted final URL: ${finalUrl}`
        );
        return;
      }

      yield ctx.Lib.getState(
        ctx,
        `adnm: captured popup initial URL: ${capturedUrl}${
          capturedName ? ` (name=${capturedName})` : ""
        }\nadnm: marker not found / could not decode tail`
      );
      return;
    }

    yield ctx.Lib.getState(
      ctx,
      `adnm: no popup URL captured (popup may be opened via other means)`
    );
  }
}
