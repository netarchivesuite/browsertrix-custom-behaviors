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
    const { sleep, isInViewport, scrollIntoView, scrollAndClick } = ctx.Lib;

    // helpers
    const normalize = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

    const firstDeep = (selector) => {
      try {
        const direct = document.querySelector(selector);
        if (direct) return direct;
        // search one level of open shadow roots
        for (const host of document.querySelectorAll("*")) {
          if (host.shadowRoot) {
            const found = host.shadowRoot.querySelector(selector);
            if (found) return found;
          }
        }
      } catch (_) {}
      return null;
    };

    try {
      const el = firstDeep('[data-testid="page-numbers"]');
      if (!el) {
        ctx.log({ level: "error", msg: "Element [data-testid='page-numbers'] not found" });
        return;
      }

      const text = normalize(el.textContent);
      const match = /\/\s*(\d+)\s*$/.exec(text);
      if (!match) {
        ctx.log({ level: "error", msg: "Failed to parse total pages from text", text });
        return;
      }

      const total = Number(match[1]);
      if (!Number.isFinite(total) || total <= 0) {
        ctx.log({ level: "error", msg: "Invalid total page count", total });
        return;
      }

      yield { msg: `Total pages detected: ${total}` };

      const btnSelector = "button[data-testid='button-next-page']";

      for (let i = 0; i < total; i++) {
        let btn = firstDeep(btnSelector);
        if (!btn) {
          ctx.log({ level: "error", msg: "Next-page button not found", step: i + 1 });
          break;
        }

        // skip if disabled
        const ariaDisabled = btn.getAttribute("aria-disabled") === "true";
        const isDisabled = !!btn.disabled || ariaDisabled;
        if (isDisabled) {
          ctx.log({ level: "info", msg: "Next-page button disabled; stopping", step: i + 1 });
          break;
        }

        // ensure in viewport
        try {
          if (!isInViewport(btn)) {
            await scrollIntoView(btn);
          }
        } catch (_) {}

        // click with fallback
        let clicked = false;
        try {
          btn.click();
          clicked = true;
        } catch (e) {
          ctx.log({ level: "error", msg: "Direct click failed; trying scrollAndClick", error: String(e) });
          try {
            await scrollAndClick(btn);
            clicked = true;
          } catch (e2) {
            ctx.log({ level: "error", msg: "scrollAndClick failed", error: String(e2) });
          }
        }

        if (!clicked) {
          ctx.log({ level: "error", msg: "Could not click next-page button", step: i + 1 });
          break;
        }

        yield { msg: `Clicked next page (${i + 1}/${total})` };
        await sleep(2000); // wait 2s between clicks
      }

      yield { msg: "Paging sequence complete" };
    } catch (err) {
      ctx.log({ level: "error", msg: "Unhandled error in behavior", error: String(err) });
      return;
    }
  }
}
