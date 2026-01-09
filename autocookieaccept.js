class AutoCookieScrollBehavior {
  static id = "Auto Cookie Accept + Scroll";

  static isMatch() {
    return true;
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async *run(msg) {
    // ---- Cookie/consent auto-click (integrated) ----
    const KEYWORDS = ["accept", "tillad"];
    const MAX_SCAN_MS = 1500;

    const norm = (s) => (s ?? "").toString().trim().toLowerCase();

    const textMatches = (el) => {
      const txt = norm(el.innerText || el.textContent);
      const aria = norm(el.getAttribute?.("aria-label"));
      return KEYWORDS.some((k) => txt.includes(k) || aria.includes(k));
    };

    const classMatchesConsent = (el) => {
      const cls = norm(el.className);
      return cls.includes("consent");
    };

    const isVisibleClickable = (el) => {
      if (!el || typeof el.click !== "function") return false;
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (style.pointerEvents === "none") return false;
      return true;
    };

    const clickOnce = (el, reason) => {
      if (!el) return false;
      if (window.__consentClickDone) return true;

      try {
        el.scrollIntoView?.({ block: "center", inline: "center" });
        el.focus?.({ preventScroll: true });

        const evt = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
        const dispatched = el.dispatchEvent(evt);
        if (!dispatched) el.click();
        else el.click?.();

        window.__consentClickDone = true;

        // Signal the generator to yield an empty msg as soon as it can.
        window.__consentClickYieldPending = true;

        console.log("[consent-click] Clicked:", el, "| reason:", reason);
        return true;
      } catch (e) {
        console.warn("[consent-click] Click failed:", e);
        return false;
      }
    };

    const candidates = () => {
      const sel = [
        "button",
        "[role='button']",
        "a",
        "input[type='button']",
        "input[type='submit']",
        "[onclick]",
      ].join(",");
      return Array.from(document.querySelectorAll(sel));
    };

    const findAndClick = () => {
      const els = candidates().filter(isVisibleClickable);

      for (const el of els) {
        const isBtnish = el.tagName === "BUTTON" || norm(el.getAttribute("role")) === "button";
        if (isBtnish && textMatches(el)) return clickOnce(el, "button/role=button text|aria match");
      }

      for (const el of els) {
        if (el.tagName === "A" && textMatches(el)) return clickOnce(el, "link text|aria match");
      }

      for (const el of els) {
        const isBtnish = el.tagName === "BUTTON" || norm(el.getAttribute("role")) === "button";
        if (isBtnish && classMatchesConsent(el)) {
          return clickOnce(el, "button/role=button class contains consent");
        }
      }

      return false;
    };

    const runConsentAutoclickWindow = () => {
      if (window.__consentClickDone) return;

      if (findAndClick()) return;

      const start = performance.now();
      const obs = new MutationObserver(() => {
        if (window.__consentClickDone) return obs.disconnect();
        if (performance.now() - start > MAX_SCAN_MS) return obs.disconnect();
        findAndClick();
      });

      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      setTimeout(() => obs.disconnect(), MAX_SCAN_MS);
    };

    const flushClickYield = async function* () {
      if (window.__consentClickYieldPending) {
        window.__consentClickYieldPending = false;
        yield { msg: "" };
      }
    };

    // Run once at start
    runConsentAutoclickWindow();
    yield* flushClickYield();

    // ---- Scroll behavior ----
    const maxScreens = 15;
    let screensScrolled = 0;

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    while (screensScrolled < maxScreens) {
      const before = window.scrollY;
      const viewportHeight = window.innerHeight;

      window.scrollBy({ top: viewportHeight, behavior: "smooth" });

      await sleep(750);

      // Run again during scrolling (some banners appear after scroll)
      runConsentAutoclickWindow();
      yield* flushClickYield();

      const after = window.scrollY;

      if (after === before) {
        console.log("Reached page end.");
        break;
      }

      screensScrolled++;
    }

    // Flush in case a click happened right at the end
    yield* flushClickYield();

    yield { msg: "AutoCookieScrollBehavior: scrolling finished" };
  }
}
