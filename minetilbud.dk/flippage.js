class NextPagePager {
  // required: id displayed in logs
  static id = "Next Page Pager";

  // required: decide when to run
  static isMatch() {
    return /^https:\/\/minetilbud\.dk\/katalog\/.*/i.test(window.location.href);
  }

  static init() { return {}; }
  static runInIframes = false;

  // persisted across run()
  pageNumbersText = null;
  total = null;

  async awaitPageLoad() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxWaitMs = 20000;
    const start = Date.now();

    try {
      while (document.readyState !== "complete" && Date.now() - start < maxWaitMs) {
        await sleep(100);
      }

      // Wait for the "next page" svg, then read the previous element as page numbers.
      while (Date.now() - start < maxWaitMs) {
        const nextSvg = document.querySelector('svg[aria-label="Navigate to next page"]');
        if (nextSvg) {
          const pageEl = nextSvg.previousElementSibling;
          const text = pageEl?.textContent?.trim();

          if (text) {
            // Expected format: "01 / 38" (but allow flexible whitespace)
            const m = text.match(/\/\s*(\d+)\s*$/);
            if (m) {
              const n = Number(m[1]);
              if (Number.isFinite(n) && n > 0) {
                this.pageNumbersText = text;
                this.total = n;
                break;
              }
            }
          }
        }
        await sleep(200);
      }
    } catch (_) {
      // swallow
    }
  }

  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    if (this.pageNumbersText) yield { msg: this.pageNumbersText };

    const total = this.total ?? 0;
    if (total) {
      yield { msg: `Total pages (${total})` };

      for (let i = 1; i <= total; i++) {
        document.querySelector('svg[aria-label="Navigate to next page"]')?.click();
        await sleep(2000);
      }
    } else {
      yield { msg: "Total pages unknown" };
    }
  }
}
