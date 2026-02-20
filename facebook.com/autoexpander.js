/**
 * Author: (ported from Chrome extension for user)
 * Created: 2026-02-20
 * Last modified: 2026-02-20
 * Version: 1.0.0
 *
 * Purpose:
 *  - On facebook.com, slowly scroll through long pages.
 *  - While scrolling, auto-click "see more" / "load more comments" style buttons once each.
 *  - Also auto-switch comment sorting from "Mest relevante"/"Nyeste" to "Alle kommentarer"
 *    via the popup menu.
 *  - Handle popups/dialogs by applying the same logic inside them, then closing and resuming.
 *
 * Scope:
 *  - https://www.facebook.com/*
 *  - https://web.facebook.com/*
 *
 * Assumptions:
 *  - Facebook uses:
 *      div[role="button"] with innerText:
 *        "Se mere", "Vis flere kommentarer", "Vis flere svar"
 *      or any text ending in /<number> svar/
 *    for expansion.
 *  - Comment sort menu trigger:
 *      div[aria-haspopup="menu"] with innerText "Mest relevante" or "Nyeste"
 *    and a popup menu item "Alle kommentarer" rendered as a div[role="menuitem"].
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
    const POST_CLICK_WAIT_MS = 2000;  // wait after each click for AJAX

    const TARGET_TEXTS = [
      "Se mere",
      "Vis flere kommentarer",
      "Vis flere svar"
    ];

    const log = (msg) => {
      if (ctx?.log) ctx.log(msg);
      return { msg };
    };

    // ---------- Helpers ----------

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
        if (isInViewport(el)) {
          return el;
        }
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
        if (isInViewport(el)) {
          return el;
        }
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
          if (menuItem && isInViewport(menuItem)) {
            return menuItem;
          }
        }
      }

      // 2) Fallback: any div[role="menuitem"] whose visible text is "Alle kommentarer"
      const items = document.querySelectorAll('div[role="menuitem"]');
      for (const el of items) {
        const text = normalizeText(el.innerText || el.textContent || "");
        if (text === "Alle kommentarer" && isInViewport(el)) {
          return el;
        }
      }
      return null;
    }

    function scrollWindowStep() {
      const maxScroll =
        document.documentElement.scrollHeight || document.body.scrollHeight;
      const current =
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        0;
      const viewport =
        window.innerHeight || document.documentElement.clientHeight;
      if (current + viewport >= maxScroll - 5) {
        return false; // bottom reached
      }
      window.scrollBy({ top: SCROLL_STEP_PX, behavior: "smooth" });
      return true;
    }

    function atBottomOfWindow() {
      const maxScroll =
        document.documentElement.scrollHeight || document.body.scrollHeight;
      const current =
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        0;
      const viewport =
        window.innerHeight || document.documentElement.clientHeight;
      return current + viewport >= maxScroll - 5;
    }

    function scrollElementStep(el) {
      if (!el) return false;
      const maxScroll = el.scrollHeight;
      const current = el.scrollTop;
      const viewport = el.clientHeight;
      if (current + viewport >= maxScroll - 5) {
        return false;
      }
      el.scrollBy({ top: SCROLL_STEP_PX, behavior: "smooth" });
      return true;
    }

    function atBottomOfElement(el) {
      if (!el) return true;
      const maxScroll = el.scrollHeight;
      const current = el.scrollTop;
      const viewport = el.clientHeight;
      return current + viewport >= maxScroll - 5;
    }

    function findUnprocessedDialog() {
      const dialogs = document.querySelectorAll(
        'div[role="dialog"]:not([data-fb-scroller-dialog-processed])'
      );
      for (const dlg of dialogs) {
        return dlg;
      }
      return null;
    }

    function markDialogProcessed(dialog) {
      if (dialog) {
        dialog.dataset.fbScrollerDialogProcessed = "1";
      }
    }

    function getDialogScrollContainer(dialog) {
      if (!dialog) return null;

      // If dialog itself scrolls, use it.
      if (dialog.scrollHeight - dialog.clientHeight > 50) {
        return dialog;
      }

      // Otherwise find a scrollable descendant
      const candidates = dialog.querySelectorAll("div, section, main, article");
      for (const c of candidates) {
        if (c.scrollHeight - c.clientHeight > 50) {
          return c;
        }
      }
      // fallback: dialog itself
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
    async function handleNyesteMenuFlow(btn) {
      markNyesteHandled(btn);
      btn.click();

      // Wait a short time for the menu to appear
      await sleep(400);

      const menuItem = findAlleKommentarerMenuItem();
      if (menuItem) {
        menuItem.click();
      }
      // Caller will wait POST_CLICK_WAIT_MS afterwards
    }

    async function processScrollContext({ mode, element }) {
      let keepGoing = true;

      while (keepGoing) {
        const rootScope = mode === "window" ? document : element;

        // 1) Regular expand buttons
        let btn = findVisibleTargetButton(rootScope);
        if (btn && !alreadyClicked(btn)) {
          markClicked(btn);
          btn.click();
          await sleep(POST_CLICK_WAIT_MS);
          continue; // rescan before scrolling
        }

        // 2) "Mest relevante"/"Nyeste" → "Alle kommentarer"
        const nyesteBtn = findVisibleNyesteButton(rootScope);
        if (nyesteBtn && !nyesteHandled(nyesteBtn)) {
          await handleNyesteMenuFlow(nyesteBtn);
          await sleep(POST_CLICK_WAIT_MS);
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
        }
      }
    }

    // ---------- Main behavior loop ----------

    yield log("Starting Facebook Auto Expander behavior.");

    // Give Facebook a moment to settle
    await sleep(2000);

    try {
      while (true) {
        const dialog = findUnprocessedDialog();
        if (dialog) {
          const scrollContainer = getDialogScrollContainer(dialog);
          yield log("Found dialog; processing its content.");
          await processScrollContext({ mode: "dialog", element: scrollContainer });
          markDialogProcessed(dialog);
          closeDialog(dialog);
          yield log("Finished dialog; closed and returning to main page.");
          await sleep(500);
          continue;
        }

        if (!atBottomOfWindow()) {
          yield log("Processing main window scroll context.");
          await processScrollContext({ mode: "window", element: null });
        }

        if (atBottomOfWindow() && !findUnprocessedDialog()) {
          yield log("Reached bottom of main window and no more dialogs; stopping.");
          break;
        }

        await sleep(500);
      }
    } catch (e) {
      yield log(`Error in Facebook Auto Expander: ${String(e)}`);
    }
  }
}
