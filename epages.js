class epages {
  // required: an id for this behavior, will be displayed in the logs
  static id = "epages";

  // required: a function that checks if a behavior should be run for a given page.
  static isMatch() {
    return /^https:\/\/www\.e-pages\.dk\/[^\/]+\/[^\/]+\/$/.test(window.location.href);
  }

  // required: typically should be left as-is.
  static init() {
    return {};
  }

  // optional
  static runInIframe = false;

  // optional: custom page-load readiness check
  async awaitPageLoad() {
    // Return true once the "Næste side" button is present (or immediately if already present)
    const hasNext = () =>
      !!document.querySelector('button[aria-label="Næste side"]');

    if (hasNext()) return true;

    // Poll briefly until found (or time out and return false)
    const timeoutMs = 15000;
    const intervalMs = 250;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (hasNext()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    return false;
  }

  // required: main behavior
  async* run(ctx) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const nextSelector = 'button[aria-label="Næste side"]';

    yield ctx.Lib.getState(ctx, "epages: starting; will click “Næste side” until it disappears");

    // Loop: click "Næste side" until not found
    while (true) {
      const nextBtn = document.querySelector(nextSelector);

      if (!nextBtn) {
        yield ctx.Lib.getState(ctx, 'epages: “Næste side” not found anymore; stopping page-turn loop');
        break;
      }

      try {
        nextBtn.focus();
        nextBtn.click();

        yield ctx.Lib.getState(ctx, 'epages: clicked “Næste side”; waiting 2s');
        await sleep(2000);
      } catch (e) {
        yield ctx.Lib.getState(ctx, `epages: error clicking “Næste side”: ${String(e)}`);
        break;
      }
    }

    // Then try clicking pdf menu item
    const pdfBtn = document.getElementById("pdfMenuItem");
    if (pdfBtn) {
      try {
        pdfBtn.focus();
        pdfBtn.click();
        yield ctx.Lib.getState(ctx, "epages: clicked #pdfMenuItem; waiting 5s");
        await sleep(5000);
      } catch (e) {
        yield ctx.Lib.getState(ctx, `epages: error clicking #pdfMenuItem: ${String(e)}`);
       
      }
    } else {
      yield ctx.Lib.getState(ctx, "epages: #pdfMenuItem not found; ending");
    }

    yield ctx.Lib.getState(ctx, "epages: done");
  }
}
