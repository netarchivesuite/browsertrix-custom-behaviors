class ScrollAndClickBehavior {
  static id = "Scroll 75% and click Reddit expand/reply controls";

  static isMatch() {
    return /^https:\/\/www\.reddit\.com\/r\/[^\/]+\/comments\/[^\/]+/.test(
      window.location.href
    );
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async awaitPageLoad() {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  async* run(ctx) {
    const selectors = [
      // Expand/caret controls
      `button:has(svg[icon-name="caret-down-outline"])`,

      // "Se flere kommentarer"
      `button:has(svg[icon-name="caret-down"])`,

      // "1 svar mere", "2 svar mere", etc.
      `button:has(faceplate-tracker[noun="more_replies"])`,

      // Fallback for Reddit's add-circle more-replies button
      `button:has(svg[icon-name="add-circle"])`,

      // Comment action buttons
      `button[name="comments-action-button"][data-post-click-location="comments-button"]`
    ];

    const sleep = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const clicked = new WeakSet();

    const stepPx = Math.max(
      1,
      Math.floor(window.innerHeight * 0.75)
    );

    const isVisible = (el) => {
      if (!el || !el.isConnected) {
        return false;
      }

      const style = window.getComputedStyle(el);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = el.getBoundingClientRect();

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.top <= window.innerHeight
      );
    };

    const wasClicked = (el) => {
      return (
        clicked.has(el) ||
        el.dataset.btxClicked === "1"
      );
    };

    const markClicked = (el) => {
      clicked.add(el);
      el.dataset.btxClicked = "1";
    };

    const findNewTargets = () => {
      const results = [];
      const seen = new Set();

      for (const selector of selectors) {
        let matches;

        try {
          matches = document.querySelectorAll(selector);
        } catch (e) {
          continue;
        }

        for (const el of matches) {
          if (
            !seen.has(el) &&
            !wasClicked(el) &&
            isVisible(el)
          ) {
            seen.add(el);
            results.push(el);
          }
        }
      }

      return results;
    };

    let totalClicks = 0;
    let scrolls = 0;
    let emptyPasses = 0;

    const maxScrolls = 500;
    const maxClicks = 1000;

    while (
      scrolls < maxScrolls &&
      totalClicks < maxClicks
    ) {
      const beforeY = window.scrollY;
      const beforeHeight =
        document.documentElement.scrollHeight;

      window.scrollBy({
        top: stepPx,
        left: 0,
        behavior: "instant"
      });

      scrolls++;

      yield {
        msg: "Scrolled 75% of viewport",
        scrolls,
        y: window.scrollY,
        stepPx
      };

      await sleep(1000);

      let passClicks = 0;

      /*
       * Re-scan after every click because Reddit may insert
       * additional expandable controls dynamically.
       */
      while (totalClicks < maxClicks) {
        const targets = findNewTargets();

        if (targets.length === 0) {
          break;
        }

        const el = targets[0];

        markClicked(el);

        try {
          el.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant"
          });

          await sleep(250);

          el.click();

          totalClicks++;
          passClicks++;

          yield {
            msg: "Clicked Reddit expand/comment control",
            totalClicks,
            passClicks
          };

          // Give Reddit time to load newly expanded comments/replies.
          await sleep(1000);
        } catch (e) {
          yield {
            msg: "Click failed",
            error: String(e)
          };
        }
      }

      const currentHeight =
        document.documentElement.scrollHeight;

      const atBottom =
        Math.ceil(
          window.scrollY + window.innerHeight
        ) >=
        Math.floor(currentHeight - 2);

      const didNotMove =
        window.scrollY === beforeY;

      const pageDidNotGrow =
        currentHeight <= beforeHeight;

      if (
        passClicks === 0 &&
        (atBottom || didNotMove) &&
        pageDidNotGrow
      ) {
        emptyPasses++;
      } else {
        emptyPasses = 0;
      }

      if (emptyPasses >= 2) {
        break;
      }

      if (atBottom) {
        await sleep(1500);
      }
    }

    yield {
      msg: "Behavior complete",
      scrolls,
      totalClicks
    };
  }
}
