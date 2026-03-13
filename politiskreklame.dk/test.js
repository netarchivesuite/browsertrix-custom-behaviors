/**
 * Author: Thomas Smedebøl
 * Created: 2026-02-27
 * Last modified: 2026-03-13
 * Version: 1.1.0
 *
 * Purpose: get info about political advertising on mainstreammedia made temporary availible on politiskreklame.dk
 * Scope: all using political advertising
 * Assumptions: There is a clickable button or link whose innerText starts with "POLITISK REKLAME"
 * Dependencies:
 * Config: Should work on anything.
 * Limitations: The ads info (budget) are only availible for the duration of the campaign.
 * Changelog:
 *  - 1.0.0: Initial version
 *  - 1.1.0: Click button/a by text prefix and auto-scroll to bottom before searching
 */

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
    const textPrefix = "POLITISK REKLAME";

    const normalizeText = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const isVisible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.pointerEvents === "none"
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const getPageHeight = () =>
      Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        document.body?.offsetHeight || 0,
        document.documentElement?.offsetHeight || 0,
        document.body?.clientHeight || 0,
        document.documentElement?.clientHeight || 0
      );

    const scrollToBottomUntilStable = async () => {
      let previousHeight = -1;
      let stableCount = 0;
      const maxIterations = 50;

      for (let i = 0; i < maxIterations; i++) {
        const currentHeight = getPageHeight();
        window.scrollTo(0, currentHeight);
        await sleep(750);

        const newHeight = getPageHeight();
        if (newHeight <= previousHeight || newHeight === currentHeight) {
          stableCount += 1;
        } else {
          stableCount = 0;
        }

        previousHeight = newHeight;

        // Require stability twice to avoid stopping during lazy-load jitter
        if (stableCount >= 2) {
          break;
        }
      }
    };

    const findMatchingElement = () => {
      const candidates = Array.from(document.querySelectorAll("button, a"));

      for (const el of candidates) {
        if (!isVisible(el)) continue;

        const text = normalizeText(el.innerText || el.textContent);
        if (text.startsWith(textPrefix.toLowerCase())) {
          return el;
        }
      }

      return null;
    };

    // Extract the last URL starting at "https%3A%2F%2Fpolitiskreklame.dk" (or any https%3A%2F%2F...),
    // decode it into a real URL, and return it.
    const extractAndDecodeFinalUrl = (captured) => {
      if (!captured) return null;

      const marker = "https%3A%2F%2Fpolitiskreklame.dk";
      let idx = captured.lastIndexOf(marker);

      if (idx === -1) {
        const matches = captured.match(/https%3A%2F%2F[^&]+/g);
        if (matches && matches.length > 0) {
          const last = matches[matches.length - 1];
          idx = captured.lastIndexOf(last);
        }
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

    // --- Intercept window.open and capture the URL passed to it ---
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

    // Also capture clicks on anchors as a fallback
    const onClickCapture = (ev) => {
      try {
        const a = ev.target?.closest?.("a");
        if (a) {
          const href = a.href || a.getAttribute("href") || "";
          if (href) {
            capturedUrl = capturedUrl || href;
            console.log("Popup initial URL (anchor):", href);
          }
        }
      } catch (_) {}
    };
    document.addEventListener("click", onClickCapture, true);

    // --- Scroll to page bottom until page height stops growing ---
    yield ctx.Lib.getState(ctx, `adnm: scrolling to page bottom`);
    await scrollToBottomUntilStable();
    yield ctx.Lib.getState(ctx, `adnm: reached page bottom (height stable)`);

    // --- Find and click matching button/link ---
    yield ctx.Lib.getState(
      ctx,
      `adnm: looking for visible button/a whose text starts with "${textPrefix}"`
    );

    const timeoutMs = 30000;
    const start = Date.now();

    let target = null;
    while (Date.now() - start < timeoutMs) {
      target = findMatchingElement();
      if (target) break;
      await sleep(200);
    }

    if (!target) {
      try {
        window.open = originalOpen;
      } catch (_) {}
      document.removeEventListener("click", onClickCapture, true);

      yield ctx.Lib.getState(
        ctx,
        `adnm: no visible button/a found with text starting "${textPrefix}" within ${timeoutMs}ms`
      );
      return;
    }

    try {
      target.scrollIntoView({ block: "center", inline: "center" });
      await sleep(150);
      target.focus();
      target.click();

      yield ctx.Lib.getState(
        ctx,
        `adnm: clicked ${target.tagName.toLowerCase()} with text "${(
          target.innerText ||
          target.textContent ||
          ""
        ).trim()}"`
      );
    } catch (e) {
      try {
        window.open = originalOpen;
      } catch (_) {}
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
