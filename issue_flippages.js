class NextPagePager {
  // required: id displayed in logs
  static id = "Next Page Pager";

  // required: decide when to run
  // Runs on all pages by default.
  // To target a specific site, replace with:
  //   return window.location.href === "https://example.com/path";
  // Or a regex, e.g.:
  //   return /https:\/\/example\.com\/.+/i.test(window.location.href); 
  static isMatch() {
    return /https:\/\/issuu\.com\/.*&d=[^&]+&u=[^&]+/i.test(window.location.href);
  }

  static init() { return {}; }
  // optional: run inside iframes (kept false; cross-origin DOM is blocked)
  static runInIframes = false;

  // optional: wait for DOM and target element
  async awaitPageLoad() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxWaitMs = 15000;
    const start = Date.now();

    try {
      while (document.readyState !== "complete" && Date.now() - start < maxWaitMs) {
        await sleep(100);
      }
      while (!document.querySelector('[data-testid="page-numbers"]') && Date.now() - start < maxWaitMs) {
        await sleep(200);
      }
    } catch (_) {
      // swallow
    }
  }

  async* run(ctx) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));   
  const text = document.querySelector('[data-testid="page-numbers"]')?.textContent.trim();
    yield { msg: text }; 
  const total = Number(text.match(/\d+(?=\s*$)/)[0]);
  yield { msg: `Total pages (${total})` };
  for (let i = 1, half = Math.floor(total / 2); i <= half; i++) {
    document.querySelector('button[data-testid="button-next-page"]').click();
    await sleep(2000); // wait 2s between clicks } 
  }
  }
}
