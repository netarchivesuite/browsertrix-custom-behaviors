class NextPagePager {
  // required: id displayed in logs
  static id = "Next Page Pager";

  // required: decide when to run
  static isMatch() {
    return /https:\/\/issuu\.com\/.*&d=[^&]+&u=[^&]+/i.test(window.location.href);
  }

  static init() { return {}; }
  static runInIframes = false;

  // persisted across run()
  pageNumbersText = null;
  total = null;

  // wait for DOM, click the slider, and resolve total pages
  async awaitPageLoad() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxWaitMs = 20000;
    const start = Date.now();

    try {
      while (document.readyState !== "complete" && Date.now() - start < maxWaitMs) {
        await sleep(100);
      }

      // Try to interact with the slider once
      try {
        const root = document.querySelector('[data-testid="page-controls-slider"] .slider');
        if (root) {
          const track = root.querySelector('.slider__track-container') || root;
          const thumb = root.querySelector('.slider__thumb'); // kept for parity with original
          const r = track.getBoundingClientRect();
          const x = Math.floor(r.left + 1);
          const y = Math.floor(r.top + r.height / 2);

          const emit = (target, type, opts = {}) => {
            const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, ...opts };
            try { target.dispatchEvent(new PointerEvent(type, base)); } catch {}
            try { target.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), base)); } catch {}
          };

          emit(track, 'pointerdown');
          emit(track, 'pointerup', { buttons: 0 });
          try { track.click(); } catch {}
        }
      } catch {}

      // Wait for page numbers text and a valid total
      while (Date.now() - start < maxWaitMs) {
        const text = document.querySelector('[data-testid="page-numbers"]')?.textContent?.trim();
        if (text) {
          const m = text.match(/\d+(?=\s*$)/);
          if (m) {
            const n = Number(m[0]);
            if (Number.isFinite(n) && n > 0) {
              this.pageNumbersText = text;
              this.total = n;
              break;
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
      const half = Math.floor(total / 2);
      for (let i = 1; i <= half; i++) {
        document.querySelector('button[data-testid="button-next-page"]')?.click();
        await sleep(2000);
      }
    } else {
      yield { msg: "Total pages unknown" };
    }
  }
}
