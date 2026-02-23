/**
 * Author: Thomas Smedebøl
 * Created: 2026-02-20
 * Last modified: 2026-02-20
 * Version: 1.0.0
 *
 * Purpose: flip pages until end of onlineads, or scroll to bottom on pagevariations without pages to flip.
 * Scope: https:\/\/minetilbud\.dk\/katalog\/.*
 * Assumptions: Ads are located on https:\/\/minetilbud\.dk\/katalog\/.*
 * Dependencies: 
 * Config: https://minetilbud.dk as seed and 1 hop, 1 browserwindow to keep polite
 * Limitations: Will stop working if selectors or aria-label changes
 * Changelog:
 *  - 1.0.0: Initial version
 */

class NextPagePager {
  // required: id displayed in logs
  static id = "Next Page Pager (minetilbud.dk)";

  // required: decide when to run
  static isMatch() {
    return /https:\/\/minetilbud\.dk\/katalog\/.*/i.test(window.location.href);
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  npButtonSelector = 'svg[aria-label="Navigate to next page"]';

  lastPageInfo = "";
  _cookieLog = null;

  async awaitPageLoad() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxWaitMs = 5000;
    const start = Date.now();

    try {
      while (document.readyState !== "complete" && Date.now() - start < maxWaitMs) {
        await sleep(100);
      }

      // Ensure np-button exists; if it doesn't appear in time, scroll to bottom (lazy-load trigger)
      while (Date.now() - start < maxWaitMs) {
        const npButton = document.querySelector(this.npButtonSelector);
        if (npButton) return true;
        await sleep(200);
      }
      yield { awaitPageLoad: timed out waiting for next-page button (selector="${this.npButtonSelector}", elapsedMs=${elapsed}). Will scroll to bottom to trigger lazy-load. };
      // Timed out waiting for np-button: scroll to bottom of page
        try {
        window.scrollTo({top: document.body.scrollHeight,behavior: 'smooth'});
      } catch (_) {
         yield { awaitPageLoad: scrollTo bottom failed (${err?.name || "Error"}: ${err?.message || "no message"}) };
      }
      return false;
    } catch (_) {
       yield { awaitPageLoad: timed out waiting for readyState=complete (state=${document.readyState}, elapsedMs=${elapsed}) };
       return false;
      
    }
  }

  setupCookiebotAutoDecline(onClickLog) {
    const clickDecline = () => {
      const btn = document.getElementById("CybotCookiebotDialogBodyButtonDecline");
      if (btn) {
        btn.click();
        try {
          onClickLog?.("Cookiebot decline clicked");
        } catch {}
        observer.disconnect();
        yield { Cookiebot: onClickLog threw (${err?.name || "Error"}: ${err?.message || "no message"}) };
      }
    };

    const observer = new MutationObserver(clickDecline);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    clickDecline();
  }

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Cookiebot auto-decline (with yield log)
    try {
      this.setupCookiebotAutoDecline((msg) => {
        if (ctx?.log) ctx.log(msg);
        this._cookieLog = msg;
      });
    } catch (_) {
      yield { msg: "Failed to initialize Cookiebot auto-decline." };
    }

    // Wait for load + np-button; if timeout triggers scroll-to-bottom, wait again briefly
    const hadNpButton = await this.awaitPageLoad();
    if (!hadNpButton) {
      yield { msg: "np-button not found after awaitPageLoad; scrolled to bottom to trigger lazy-load." };

      // Give the page a moment after scrolling, then re-check for np-button
      const retryStart = Date.now();
      const retryMaxMs = 10000;
      while (Date.now() - retryStart < retryMaxMs) {
        if (document.querySelector(this.npButtonSelector)) break;
        await sleep(200);
      }
    }

    // Emit cookie click log if it happened early
    if (this._cookieLog) {
      yield { msg: this._cookieLog };
      this._cookieLog = null;
    }

    while (true) {
      // Emit cookie click log if it happens asynchronously
      if (this._cookieLog) {
        yield { msg: this._cookieLog };
        this._cookieLog = null;
      }

      const npButton = document.querySelector(this.npButtonSelector);
      if (!npButton) {
        yield { msg: "np-button not found." };
        break;
      }

      const pageInfoElement = npButton.parentElement?.previousElementSibling;
      if (!pageInfoElement) {
        yield { msg: "Page info element not found." };
        break;
      }

      const currentPageInfo = (pageInfoElement.textContent || "").trim();
      yield { msg: `Current Page Info: ${currentPageInfo}` };

      if (!currentPageInfo) {
        yield { msg: "Current Page Info is empty, stopping." };
        break;
      }

      if (currentPageInfo === this.lastPageInfo) {
        yield { msg: "Page info hasn't changed, stopping." };
        break;
      }

      this.lastPageInfo = currentPageInfo;

      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      npButton.dispatchEvent(clickEvent);

      yield { msg: "Clicked np-button, waiting for 1 second..." };
      await sleep(1000);

      // Wait briefly for page info to change (best-effort)
      const changeStart = Date.now();
      const changeMaxMs = 2000;
      while (Date.now() - changeStart < changeMaxMs) {
        const nextInfo = (pageInfoElement.textContent || "").trim();
        if (nextInfo && nextInfo !== currentPageInfo) {
          yield { msg: `Detected page change: ${nextInfo}` };
          break;
        }
        await sleep(200);
      }
    }
  }
}
