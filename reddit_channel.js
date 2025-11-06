class RedditChannel {
  static id = "RedditChannel";
  static maxScrolls = 500; // hard cap

  static isMatch() {
    //return true; // run on all pages https://www.reddit.com/r/Denmark/
  return /^https:\/\/www\.reddit\.com\/r\/Denmark\/$/.test(window.location.href);
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  /**
   * Collect links defensively.
   */
  async extractBrowserLinks(ctx) {
    try {
      const urls = new Set(
        Array.from(document.links, (a) => a && a.href).filter(Boolean)
      );
      await Promise.allSettled(Array.from(urls, (url) => ctx.Lib.addLink(url)));
    } catch (err) {
      ctx.log({ msg: "Link extraction failed", error: String(err) });
    }
  }

  /** Utility: robust scrollHeight */
  static _scrollHeight() {
    const { body, documentElement: html } = document;
    return Math.max(
      body?.scrollHeight || 0,
      html?.scrollHeight || 0,
      body?.offsetHeight || 0,
      html?.offsetHeight || 0,
      body?.clientHeight || 0,
      html?.clientHeight || 0
    );
  }

  /** Utility: check if viewport bottom is at or past document bottom */
  static _atBottom(epsilon = 2) {
    const y = window.scrollY || window.pageYOffset || 0;
    const h = window.innerHeight || 0;
    const max = RedditChannel._scrollHeight();
    return y + h >= max - epsilon;
  }

  /** Utility: scroll to current bottom */
  static _scrollToBottom() {
    try {
      const max = RedditChannel._scrollHeight();
      window.scrollTo({ top: max, left: 0, behavior: "instant" });
    } catch (_) {
      // fallback
      window.scrollTo(0, Number.MAX_SAFE_INTEGER);
    }
  }

  /**
   * Wait for new content after a bottom scroll.
   * Uses both scrollHeight growth and a MutationObserver.
   */
  static _waitForPotentialGrowth({ timeoutMs = 6000, pollMs = 300, epsilon = 20, ctx } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      let lastHeight = RedditChannel._scrollHeight();
      let sawAdds = false;

      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.addedNodes && m.addedNodes.length) {
            sawAdds = true;
            break;
          }
        }
      });

      try {
        obs.observe(document, { childList: true, subtree: true });
      } catch (err) {
        ctx?.log?.({ msg: "MutationObserver failed", error: String(err) });
      }

      const tick = () => {
        const now = Date.now();
        const h = RedditChannel._scrollHeight();
        const grew = h > lastHeight + epsilon;
        lastHeight = h;

        if (sawAdds || grew) {
          obs.disconnect();
          resolve({ grew: true, height: h });
          return;
        }

        if (now - start >= timeoutMs) {
          obs.disconnect();
          resolve({ grew: false, height: h });
          return;
        }

        setTimeout(tick, pollMs);
      };

      setTimeout(tick, pollMs);
    });
  }

  /** Sleep */
  static _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Main runner */
  async *run(ctx) {
    const maxScrolls = this.constructor.maxScrolls || 500;

    let iterations = 0;
    let stableRounds = 0; // consecutive no-growth confirmations
    const maxStableRounds = 5; // require stability >= 2 rounds before stopping

    // Initial link harvest before scrolling
    await this.extractBrowserLinks(ctx);

    while (iterations < maxScrolls) {
      iterations++;

      // Scroll to the current bottom
      RedditChannel._scrollToBottom();
      yield {
        msg: "Scrolled to bottom",
        iterations,
        y: window.scrollY,
        innerHeight: window.innerHeight,
        docHeight: RedditChannel._scrollHeight(),
      };

      // Give the page a moment to kick off lazy loads
      await RedditChannel._sleep(2000);

      // Wait to see if new content arrives
      const { grew } = await RedditChannel._waitForPotentialGrowth({ ctx });

      // Harvest any links visible now
      await this.extractBrowserLinks(ctx);

      if (RedditChannel._atBottom() && !grew) {
        stableRounds++;
      } else {
        stableRounds = 0; // reset if any change
      }

      yield {
        msg: "Post-bottom check",
        atBottom: RedditChannel._atBottom(),
        newContentDetected: grew,
        stableRounds,
      };

      // Stop if we've reached bottom and seen stability for a few rounds
      if (stableRounds >= maxStableRounds) {
        ctx.log({ msg: "Bottom reached and stable. Stopping.", iterations });
        break;
      }
    }

    if (iterations >= maxScrolls) {
      ctx.log({ msg: "Max scrolls reached", iterations });
    }
  }
}
