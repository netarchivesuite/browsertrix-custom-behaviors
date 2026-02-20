/**
 * Author: (ported from Chrome extension for user)
 * Created: 2026-02-20
 * Last modified: 2026-02-20
 * Version: 1.0.1
 *
 * Purpose:
 *  - On facebook.com, slowly scroll through long pages.
 *  - While scrolling, auto-click "see more" / "load more comments" style buttons once each.
 *  - Also auto-switch comment sorting from "Mest relevante"/"Nyeste" to "Alle kommentarer"
 *    via the popup menu.
 *  - Handle popups/dialogs by applying the same logic inside them, then closing and resuming.
 *
 * Forward-only guarantee (monotonic scroll):
 *  - Tracks the maximum scroll position reached for the window and each scrollable dialog container.
 *  - If DOM/layout changes cause the browser to "jump back" (scroll position decreases),
 *    the script clamps back to the max reached and continues forward.
 *
 * Scope:
 *  - https://www.facebook.com/*
 *  - https://web.facebook.com/*
 *
 * Dependencies:
 *  - None (plain DOM + JS).
 *
 * Limitations:
 *  - Will stop working if Facebook changes relevant selectors or button texts.
 */

class FacebookAutoExpandBehavior {
  // required: id displayed in logs
  static id = "Facebook Auto Expander (facebook.com)";

  // required: decide when to run
  static isMatch() {
    return /https:\/\/(www|web)\.facebook\.com\//i.test(window.location.href);
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const SCROLL_STEP_PX = 50;        // small step for very slow scroll
    const SCROLL_DELAY_MS = 500;      // time between scroll steps
    const POST_CLICK_WAIT_MS = 2000;  // wait after each click for AJAX / reflow

    const TARGET_TEXTS = [
      "Se mere",
      "Vis flere kommentarer",
      "Vis flere svar"
    ];

    const log = (msg) => {
      if (ctx?.log) ctx.log(msg);
      return { msg };
    };

    // ---------------------------------------------------------------------
    // Forward-only (monotonic) scroll guards
    // ---------------------------------------------------------------------

    let maxWindowY = 0;
    const maxElementTop = new WeakMap(); // per scroll container

    function clampWindowForward() {
      const y = window.scrollY || window.pageYOffset || 0;
      if (y > maxWindowY) maxWindowY = y;

      // If layout shifts moved us back, snap forward to the max we’ve seen.
      if (y + 1 < maxWindowY) {
        window.scrollTo({ top: maxWindowY, behavior: "auto" });
      }
    }

    function clampElementForward(el) {
      if (!el) return;
      const cur = el.scrollTop || 0;
      const prevMax = maxElementTop.get(el) ?? 0;
      const nextMax = Math.max(prevMax, cur);
      if (nextMax !== prevMax) maxElementTop.set(el, nextMax);

      // If layout shifts moved us back, snap forward to the max we’ve seen.
      if (cur + 1 < nextMax) {
        el.scrollTop = nextMax; // direct set is most reliable inside dialogs
      }
    }

    function getWindowForwardBase() {
      clampWindowForward();
      return maxWindowY;
    }

    function getElementForwardBase(el) {
      clampElementForward(el);
      return maxElementTop.get(el) ?? (el?.scrollTop ?? 0);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function normalizeText(str) {
      return (str || "").replace(/\s+/g, " ").trim();
    }

    function matchesSvarNumber(text) {
      // match any text that ends with: "<number> svar"
      // e.g. "Vis 12 svar", "12 svar", "Se alle 3 svar"
      return /\d+\s+svar$/i.test(text);
    }

    function isTargetButton(el) {
      if (!el || el.getAttribute("role") !== "button") return false;
      const text = normalizeText(el.innerText || el.textContent || "");
      if (TARGET_TEXTS.includes(text)) return true;
      if (matchesSvarNumber(text)) return true;
      return false;
    }

    // Menu button: div[aria-haspopup="menu"] with text "Mest relevante" or "Nyeste"
    function isNyesteMenuButton(el) {
      if (!el) return false;
      if (el.getAttribute("aria-haspopup") !== "menu") return false;
      const text = normalizeText(el.innerText || el.textContent || "");
      return text === "Mest relevante" || text === "Nyeste";
    }

    function isInViewport(el) {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;

      return (
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= vh &&
        rect.left <= vw
      );
    }

    function markClicked(el) {
      el.dataset.fbScrollerClicked = "1";
    }

    function alreadyClicked(el) {
      return el.dataset.fbScrollerClicked === "1";
    }

    function markNyesteHandled(el) {
      el.dataset.fbScrollerNyesteHandled = "1";
    }

    function nyesteHandled(el) {
      return el.dataset.fbScrollerNyesteHandled === "1";
    }

    function findVisibleTargetButton(root) {
      const scope = root || document;
      const candidates = scope.querySelectorAll(
        'div[role="button"]:not([data-fb-scroller-clicked])'
      );

      for (const el of candidates) {
        if (!isTargetButton(el)) continue;
        if (isInViewport(el)) return el;
      }
      return null;
    }

    function findVisibleNyesteButton(root) {
      const scope = root || document;
      const candidates = scope.querySelectorAll(
        'div[aria-haspopup="menu"]:not([data-fb-scroller-nyeste-handled])'
      );

      for (const el of candidates) {
        if (!isNyesteMenuButton(el)) continue;
        if (isInViewport(el)) return el;
      }
      return null;
    }

    // Find menu item "Alle kommentarer" – prioritize text match on inner span,
    // then fall back to menuitem text.
    function findAlleKommentarerMenuItem() {
      // 1) Prefer matching by the inner span text "Alle kommentarer"
      const spans = document.querySelectorAll('span[dir="auto"]');
      for (const span of spans) {
        const text = normalizeText(span.innerText || span.textContent || "");
        if (text === "Alle kommentarer") {
          const menuItem = span.closest('div[role="menuitem"]');
          if (menuItem && isInViewport(menuItem)) return menuItem;
        }
      }

      // 2) Fallback: any div[role="menuitem"] whose visible text is "Alle kommentarer"
      const items = document.querySelectorAll('div[role="menuitem"]');
      for (const el of items) {
        const text = normalizeText(el.innerText || el.textContent || "");
        if (text === "Alle kommentarer" && isInViewport(el)) return el;
      }
      return null;
    }

    function atBottomOfWindow() {
      // Use forward base so "bottom" decisions are based on max reached.
      const maxScroll =
        document.documentElement.scrollHeight || document.body.scrollHeight;
      const base = getWindowForwardBase();
      const viewport =
        window.innerHeight || document.documentElement.clientHeight;
      return base + viewport >= maxScroll - 5;
    }

    function scrollWindowStep() {
      // Always advance from the highest position we’ve reached, not the current.
      const base = getWindowForwardBase();

      const maxScroll =
        document.documentElement.scrollHeight || document.body.scrollHeight;
      const viewport =
        window.innerHeight || document.documentElement.clientHeight;

      if (base + viewport >= maxScroll - 5) return false;

      const target = base + SCROLL_STEP_PX;
      // "auto" avoids smooth-scroll jitter during reflow/layout shifts
      window.scrollTo({ top: target, behavior: "auto" });
      clampWindowForward();
      return true;
    }

    function atBottomOfElement(el) {
      if (!el) return true;

      const maxScroll = el.scrollHeight;
      const base = getElementForwardBase(el);
      const viewport = el.clientHeight;

      return base + viewport >= maxScroll - 5;
    }

    function scrollElementStep(el) {
      if (!el) return false;

      const maxScroll = el.scrollHeight;
      const base = getElementForwardBase(el);
      const viewport = el.clientHeight;

      if (base + viewport >= maxScroll - 5) return false;

      const target = base + SCROLL_STEP_PX;
      el.scrollTop = target; // stable for nested scrollers
      clampElementForward(el);
      return true;
    }

    function findUnprocessedDialog() {
      const dialogs = document.querySelectorAll(
        'div[role="dialog"]:not([data-fb-scroller-dialog-processed])'
      );
      for (const dlg of dialogs) return dlg;
      return null;
    }

    function markDialogProcessed(dialog) {
      if (dialog) dialog.dataset.fbScrollerDialogProcessed = "1";
    }

    function getDialogScrollContainer(dialog) {
      if (!dialog) return null;

      // If dialog itself scrolls, use it.
      if (dialog.scrollHeight - dialog.clientHeight > 50) return dialog;

      // Otherwise find a scrollable descendant
      const candidates = dialog.querySelectorAll("div, section, main, article");
      for (const c of candidates) {
        if (c.scrollHeight - c.clientHeight > 50) return c;
      }

      // Fallback: dialog itself
      return dialog;
    }

    function closeDialog(dialog) {
      if (!dialog) return;

      // Try a generic "close" button by aria-label (English & Danish)
      const closeBtn =
        dialog.querySelector('[role="button"][aria-label="Close"]') ||
        dialog.querySelector('[role="button"][aria-label="Luk"]');

      if (closeBtn) {
        closeBtn.click();
        return;
      }

      // Fallback: send Escape key event
      const evt = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(evt);
    }

    // Handle clicking "Mest relevante"/"Nyeste" and then "Alle kommentarer"
    async function handleNyesteMenuFlow(btn, mode, element) {
      markNyesteHandled(btn);

      // Clamp before interaction (helps if FB shifted us back)
      if (mode === "window") clampWindowForward();
      else clampElementForward(element);

      btn.click();

      // Wait a short time for the menu to appear
      await sleep(400);

      const menuItem = findAlleKommentarerMenuItem();
      if (menuItem) menuItem.click();
    }

    async function processScrollContext({ mode, element }) {
      let keepGoing = true;

      while (keepGoing) {
        const rootScope = mode === "window" ? document : element;

        // Always enforce forward-only at the start of each cycle.
        if (mode === "window") clampWindowForward();
        else clampElementForward(element);

        // 1) Regular expand buttons
        let btn = findVisibleTargetButton(rootScope);
        if (btn && !alreadyClicked(btn)) {
          markClicked(btn);

          // Clamp before click (layout shifts happen a lot right after)
          if (mode === "window") clampWindowForward();
          else clampElementForward(element);

          btn.click();

          await sleep(POST_CLICK_WAIT_MS);

          // Clamp after click + ajax/reflow
          if (mode === "window") clampWindowForward();
          else clampElementForward(element);

          continue; // rescan before scrolling
        }

        // 2) "Mest relevante"/"Nyeste" → "Alle kommentarer"
        const nyesteBtn = findVisibleNyesteButton(rootScope);
        if (nyesteBtn && !nyesteHandled(nyesteBtn)) {
          await handleNyesteMenuFlow(nyesteBtn, mode, element);

          await sleep(POST_CLICK_WAIT_MS);

          // Clamp after menu selection + reflow
          if (mode === "window") clampWindowForward();
          else clampElementForward(element);

          continue; // rescan before scrolling
        }

        // 3) Scrolling logic
        if (mode === "dialog") {
          if (atBottomOfElement(element)) {
            keepGoing = false;
            break;
          }

          const scrolled = scrollElementStep(element);
          if (!scrolled) {
            keepGoing = false;
            break;
          }

          await sleep(SCROLL_DELAY_MS);

          // Clamp again after delay (FB can shift content during idle)
          clampElementForward(element);
          continue;
        }

        if (mode === "window") {
          if (atBottomOfWindow()) {
            keepGoing = false;
            break;
          }

          const scrolled = scrollWindowStep();
          if (!scrolled) {
            keepGoing = false;
            break;
          }

          await sleep(SCROLL_DELAY_MS);

          // Clamp again after delay
          clampWindowForward();
        }
      }
    }

    // ---------------------------------------------------------------------
    // Main behavior loop
    // ---------------------------------------------------------------------

    yield log("Starting Facebook Auto Expander behavior (forward-only scroll).");

    // Give Facebook a moment to settle
    await sleep(2000);
    clampWindowForward();

    try {
      while (true) {
        // Enforce forward-only before any major decision
        clampWindowForward();

        const dialog = findUnprocessedDialog();
        if (dialog) {
          const scrollContainer = getDialogScrollContainer(dialog);

          // Initialize dialog forward base to current position
          clampElementForward(scrollContainer);

          yield log("Found dialog; processing its content.");
          await processScrollContext({ mode: "dialog", element: scrollContainer });

          markDialogProcessed(dialog);
          closeDialog(dialog);

          yield log("Finished dialog; closed and returning to main page.");

          // Closing a dialog can cause FB to jump the page; clamp immediately.
          await sleep(200);
          clampWindowForward();

          await sleep(300);
          continue;
        }

        if (!atBottomOfWindow()) {
          yield log("Processing main window scroll context.");
          await processScrollContext({ mode: "window", element: null });
        }

        // Clamp after any main processing
        clampWindowForward();

        if (atBottomOfWindow() && !findUnprocessedDialog()) {
          yield log("Reached bottom of main window and no more dialogs; stopping.");
          break;
        }

        await sleep(500);
        clampWindowForward();
      }
    } catch (e) {
      yield log(`Error in Facebook Auto Expander: ${String(e)}`);
    }
  }
}
