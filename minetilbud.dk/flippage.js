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

      // Extra check requested: ensure np-button exists (wait a bit for it)
      while (Date.now() - start < maxWaitMs) {
        const npButton = document.querySelector(this.npButtonSelector);
        if (npButton) return;
        await sleep(200);
      }
    } catch (_) {
      // swallow
    }
  }

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Initial wait for load + np-button presence
    await this.awaitPageLoad();

    while (true) {
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

      // Click the SVG via dispatched event (as in your script)
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      npButton.dispatchEvent(clickEvent);

      yield { msg: "Clicked np-button, waiting for 1 second..." };
      await sleep(1000);

      // Optional: wait for the page info to change (briefly) to reduce misclick loops
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
