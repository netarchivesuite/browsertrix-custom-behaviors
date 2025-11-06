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
    return true;
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

// Target the viewer iframe. Adjust selector if Issuu changes it.
  const viewer = page.frameLocator('iframe[src*="issuu.com"], iframe[title*="Issuu"], iframe[title*="viewer"]').first();

  // Wait until the page counter appears inside the frame
  await viewer.locator('[data-testid="page-numbers"]').waitFor({ state: 'visible' });

  // Click Next N times
  const next = viewer.locator('[data-testid="button-next-page"]');
  for (let i = 0; i < 9; i++) {
    await next.click();
    await page.waitForTimeout(500); // or wait for the counter to change
  } 


  }
}
