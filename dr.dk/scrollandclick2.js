class ScrollAndClick2 {
  static id = "Scroll and Click2";
  static maxScrolls = 100;
  static runInIframes = true;

  selectors = [
    "a",
    "button",
    "button.lc-load-more",
    "span[role=treeitem]",
    "button#load-more-posts",
    "#pagenation",
    "button.CybotCookiebotDialogBodyButton",
  ];

  triggerWords = [
    "se mere",
    "åbn",
    "flere kommentarer",
    "se flere",
    "indlæs flere nyheder",
    "hent flere",
    "vis flere",
    "tillad alle",
    "tidligere opslag",
  ].map((t) => t.toLowerCase());

  domElementsMinimumChange = 10;

  static isMatch(url) {
    return true;
  }

  static init() {
    return {};
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async extractBrowserLinks(ctx) {
    const urls = new Set(
      Array.from(document.links, (a) => a.href).filter(Boolean)
    );
    await Promise.allSettled(Array.from(urls, (url) => ctx.Lib.addLink(url)));
  }

  getMatchingElements() {
    return Array.from(document.querySelectorAll(this.selectors.join(","))).filter(
      (elem) => {
        const txt = (elem.innerText || elem.textContent || "")
          .toLowerCase()
          .trim();
        return this.triggerWords.includes(txt);
      }
    );
  }

  isVisibleOnScreen(elem) {
    if (!elem || !document.contains(elem)) return false;

    const rect = elem.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  async scrollUntilMatchingVisible(ctx, maxSteps = 20, stepSize = 500) {
    for (let step = 0; step < maxSteps; step++) {
      const visibleMatch = this.getMatchingElements().find((elem) =>
        this.isVisibleOnScreen(elem)
      );

      if (visibleMatch) return visibleMatch;

      window.scrollBy(0, stepSize);
      await this.wait(300);
    }

    return (
      this.getMatchingElements().find((elem) => this.isVisibleOnScreen(elem)) ||
      null
    );
  }

  async clickAndRetry(ctx, elem, state) {
    const txt = (elem.innerText || elem.textContent || "")
      .toLowerCase()
      .trim();

    let clicks = 0;

    try {
      elem.click();
      state.totalClicks++;
      clicks++;
      ctx.log({
        msg: "Clicked matching element",
        text: txt,
        totalClicks: state.totalClicks,
      });
    } catch (err) {
      ctx.log({
        msg: "Initial click failed",
        text: txt,
        error: String(err),
      });
      return clicks;
    }

    await this.wait(1000);

    const visibleElem = await this.scrollUntilMatchingVisible(ctx);

    if (visibleElem) {
      const visibleTxt = (visibleElem.innerText || visibleElem.textContent || "")
        .toLowerCase()
        .trim();

      try {
        visibleElem.click();
        state.totalClicks++;
        clicks++;
        ctx.log({
          msg: "Clicked again after scroll",
          text: visibleTxt,
          totalClicks: state.totalClicks,
        });
      } catch (err) {
        ctx.log({
          msg: "Second click failed",
          text: visibleTxt,
          error: String(err),
        });
      }
    } else {
      ctx.log({
        msg: "No matching visible element found for second click",
        text: txt,
      });
    }

    return clicks;
  }

  async* run(ctx) {
    const state = {
      totalClicks: 0,
      consecutiveSmallChanges: 0,
      stableTime: 0,
      iterations: 0,
      lastCount: document.body.getElementsByTagName("*").length,
      seenLinks: new Set(
        Array.from(document.links, (a) => a.href).filter(Boolean)
      ),
    };

    while (true) {
      state.iterations++;

      if (state.iterations > this.constructor.maxScrolls) {
        ctx.log({
          msg: "Max scrolls reached",
          iterations: state.iterations,
          totalClicks: state.totalClicks,
        });
        break;
      }

      window.scrollBy(0, 800);
      await this.wait(1000);

      const elems = this.getMatchingElements();
      let clicksThisRound = 0;

      for (const elem of elems) {
        clicksThisRound += await this.clickAndRetry(ctx, elem, state);
      }

      ctx.log({
        msg: "Round summary",
        iteration: state.iterations,
        matchesFound: elems.length,
        clicksThisRound,
        totalClicks: state.totalClicks,
      });

      await this.wait(1000);

      for (const a of document.links) {
        if (a.href) state.seenLinks.add(a.href);
      }

      await this.extractBrowserLinks(ctx);

      if (clicksThisRound > 0) {
        const newCount = document.body.getElementsByTagName("*").length;
        const delta = newCount - state.lastCount;

        ctx.log({
          msg: "DOM after click",
          iteration: state.iterations,
          newCount,
          delta,
          totalClicks: state.totalClicks,
        });

        if (delta >= this.domElementsMinimumChange) {
          state.consecutiveSmallChanges = 0;
          state.stableTime = 0;
        } else {
          state.consecutiveSmallChanges += 1;
          state.stableTime += 1000;
        }

        state.lastCount = newCount;

        if (state.consecutiveSmallChanges >= 3) {
          ctx.log({
            msg: "Stopping: consecutive small DOM changes",
            consecutiveSmallChanges: state.consecutiveSmallChanges,
            threshold: this.domElementsMinimumChange,
            totalClicks: state.totalClicks,
          });
          break;
        }

        if (state.stableTime >= 20000) {
          ctx.log({
            msg: "Stopping: no significant changes for 20 seconds",
            stableTime: state.stableTime,
            totalClicks: state.totalClicks,
          });
          break;
        }
      } else {
        ctx.log({
          msg: "No clicks this round, skipping DOM stability check",
          iteration: state.iterations,
        });
      }

      yield false;
    }

    ctx.log({
      msg: "Finished",
      totalIterations: state.iterations,
      totalClicks: state.totalClicks,
      totalUniqueLinks: state.seenLinks.size,
    });

    yield true;
  }
}
