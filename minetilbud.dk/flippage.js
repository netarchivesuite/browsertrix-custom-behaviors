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

  // Selector for the SVG icon used as the "next page" control
  npButtonSelector = 'svg[aria-label="Navigate to next page"]';

  // Persisted across run()
  lastPageInfo = "";

  async awaitPageLoad() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxWaitMs = 20000;
    const start = Date.now();

    try {
      while (document.readyState !== "complete" && Date.now() - start < maxWaitMs) {
        await sleep(100);
      }

      // Extra check: ensure np-button exists
      while (Date.now() - start < maxWaitMs) {
        const npButton = document.querySelector(this.npButtonSelector);
        if (npButton) return;
        await sleep(200);
      }
    } catch (_) {
      // swallow
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
      }
    };

    const observer = new MutationObserver(clickDecline);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Also try immediately
    clickDecline();
  }

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Auto-decline Cookiebot consent if present, with yield logging
    try {
      this.setupCookiebotAutoDecline((msg) => {
        // Yielding from callback is not possible directly; push to ctx.log if available,
        // and also buffer a message to yield on next tick.
        if (ctx?.log) ctx.log(msg);
        this._cookieLog = msg;
      });
    } catch (_) {
      yield { msg: "Failed to initialize Cookiebot auto-decline." };
    }

    // Initial wait for load + np-button presence
    await this.awaitPageLoad();

    // Emit cookie click log if it happened before run loop started
    if (this._cookieLog) {
      yield { msg: this._cookieLog };
      this._cookieLog = null;
    }

    while (true) {
      // Emit cookie click log if it happened asynchronously
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

      // Optional: wait briefly for page info to change
      const changeStart = Date.now();
      const changeMaxMs = 10000;
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
