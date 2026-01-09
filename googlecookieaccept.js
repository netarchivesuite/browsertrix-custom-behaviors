class GoogleCookieAccept {
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "GoogleCookieAccept";

  // required: a function that checks if a behavior should be run
  // for a given page. This example uses a regex to match the URL.
  static isMatch() {
  https://consent.google.com/
    return /.*consent\.google\.com\/.*/.test(window.location.href);
  }

  static init() { return {}; }

  // optional: if true, will also check isMatch() and possibly run
  // this behavior in each iframe.
  // if false, or not defined, this behavior will be skipped for iframes.
  static runInIframes = false;

  // required: the main behavior async iterator
  async* run(ctx) {
    try {
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
      // Try a real user-like click
      el.scrollIntoView?.({ block: "center", inline: "center" });
      el.focus?.({ preventScroll: true });

      // Prefer dispatching a MouseEvent; fallback to .click()
      const evt = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
      const dispatched = el.dispatchEvent(evt);
      if (!dispatched) el.click();
      else el.click?.(); // some sites only react to .click()

      window.__consentClickDone = true;
      ctx.log({ level: "error", msg: "[consent-click] Clicked"});
      return true;
    } catch (e) {
      ctx.log({ level: "error", msg: "[consent-click] Failed"});
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

    // Priority 1: button/role=button with keyword in text/aria-label
    for (const el of els) {
      const isBtnish = el.tagName === "BUTTON" || norm(el.getAttribute("role")) === "button";
      if (isBtnish && textMatches(el)) return clickOnce(el, "button/role=button text|aria match");
    }

    // Priority 2: <a> with keyword in text/aria-label
    for (const el of els) {
      if (el.tagName === "A" && textMatches(el)) return clickOnce(el, "link text|aria match");
    }

    // Priority 3: button/role=button with class containing "consent"
    for (const el of els) {
      const isBtnish = el.tagName === "BUTTON" || norm(el.getAttribute("role")) === "button";
      if (isBtnish && classMatchesConsent(el)) return clickOnce(el, "button/role=button class contains consent");
    }

    return false;
  };

  // One-time scan now, then a short observer window for late-loading banners.
  if (findAndClick()) return;

  const start = performance.now();
  const obs = new MutationObserver(() => {
    if (window.__consentClickDone) return obs.disconnect();
    if (performance.now() - start > MAX_SCAN_MS) return obs.disconnect();
    findAndClick();
  });

  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  setTimeout(() => obs.disconnect(), MAX_SCAN_MS);
    } catch (error) {
      ctx.log({ level: "error", msg: "An error occurred in the behavior: " + error.message });
    }
  }
}
