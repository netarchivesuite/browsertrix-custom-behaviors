class MyBehavior
{
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "Sequential Norkon PlayButton Scroller";

  // required: a function that checks if a behavior should be run
  // for a given page.
  // This function can check the DOM / window.location to determine
  // what page it is on. The first behavior that returns 'true'
  // for a given page is used on that page.
  static isMatch() {
    // Example for a single fixed URL:
    // return window.location.href === "https://my-site.example.com/";
    //
    // Example using a regular expression:
    // const href = window.location.href || "";
    // return /livecenter\.norkon\.net/i.test(href);
    //
    // In this behavior we run on any page:
    return true;
  }

  static init() { return {}; }

  // optional: if true, will also check isMatch() and possibly run
  // this behavior in each iframe.
  // if false, or not defined, this behavior will be skipped for iframes.
  static runInIframes = false;

  // optional: if defined, provides a way to define a custom way to determine
  // when a page has finished loading beyond the standard 'load' event.
  //
  // if defined, the crawler will await 'awaitPageLoad()' before moving on to
  // post-crawl processing operations, including link extraction, screenshots,
  // and running main behavior
  async awaitPageLoad() {
    // Intentionally left minimal to avoid unexpected errors.
    // The main run() loop will handle dynamic content as it appears.
  }

  // required: the main behavior async iterator, which should yield for
  // each 'step' in the behavior.
  // When the iterator finishes, the behavior is done.
  async* run(ctx) {
    const processedButtons = new WeakSet();
    const SCROLL_STEP_RATIO = 0.75;  // 75% of viewport height
    const MAX_SCROLL_STEPS = 100;    // safety guard
    const MAX_NO_NEW_CYCLES = 5;     // stop if nothing new appears for a while

    let scrollStep = 0;
    let totalClicked = 0;
    let consecutiveNoNew = 0;

    try {
      yield { msg: "Behavior started: scanning and playing visible Norkon play buttons." };

      while (scrollStep < MAX_SCROLL_STEPS && consecutiveNoNew < MAX_NO_NEW_CYCLES) {
        // 1. Detect all NEW play buttons currently in viewport
        const newButtons = this._findNewPlayableButtonsInViewport(ctx, processedButtons);

        if (newButtons.length > 0) {
          consecutiveNoNew = 0;
          if (ctx && typeof ctx.log === "function") {
            ctx.log({
              level: "info",
              msg: "Found new play buttons in viewport",
              count: newButtons.length,
              scrollStep
            });
          }

          // 2. Click each new button sequentially:
          //    - click
          //    - wait for play->pause path
          //    - wait for pause->play path
          for (let i = 0; i < newButtons.length; i++) {
            const button = newButtons[i];
            processedButtons.add(button);

            const indexInBatch = i + 1;
            const countInBatch = newButtons.length;

            await this._handlePlayButton(ctx, button, indexInBatch, countInBatch, totalClicked);
            totalClicked += 1;
          }

          // After the last element finishes and its SVG path returns to "play",
          // we continue with a smooth scroll (step 3 below).
          yield {
            msg: `Finished processing ${newButtons.length} play buttons; totalClicked=${totalClicked}. Preparing to scroll.`
          };
        } else {
          consecutiveNoNew += 1;
          if (ctx && typeof ctx.log === "function") {
            ctx.log({
              level: "info",
              msg: "No new play buttons in viewport",
              consecutiveNoNew,
              scrollStep
            });
          }
        }

        // 3. Smooth scroll by 75% of viewport height
        scrollStep += 1;
        const reachedBottom = await this._scrollByViewportFraction(ctx, SCROLL_STEP_RATIO);

        yield {
          msg: `Scroll step ${scrollStep} completed (ratio=${SCROLL_STEP_RATIO}). reachedBottom=${reachedBottom}.`
        };

        // If we are at the bottom, check once more for any remaining new buttons.
        if (reachedBottom) {
          const extraButtons = this._findNewPlayableButtonsInViewport(ctx, processedButtons);
          if (extraButtons.length === 0) {
            if (ctx && typeof ctx.log === "function") {
              ctx.log({
                level: "info",
                msg: "Reached bottom and found no additional play buttons. Ending behavior."
              });
            }
            break;
          } else {
            if (ctx && typeof ctx.log === "function") {
              ctx.log({
                level: "info",
                msg: "Reached bottom but found additional play buttons; continuing.",
                count: extraButtons.length
              });
            }
          }
        }

        // Small delay between cycles to allow new content to load.
        await this._safeSleep(ctx, 750);
      }

      yield {
        msg: `Behavior completed: scrollStep=${scrollStep}, totalClicked=${totalClicked}, consecutiveNoNew=${consecutiveNoNew}.`
      };
    } catch (err) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "error",
          msg: "Unhandled error in MyBehavior.run()",
          error: String(err && err.stack ? err.stack : err)
        });
      }
      return;
    }
  }

  // =========================
  // Helper methods
  // =========================

  _normalizeText(value) {
    if (value == null) {
      return "";
    }
    const str = String(value);
    return str.toLowerCase().trim().replace(/\s+/g, " ");
  }

  _normalizePathD(value) {
    if (value == null) {
      return "";
    }
    // For SVG paths, whitespace and case are not meaningful here.
    return String(value).toLowerCase().replace(/\s+/g, "");
  }

  _isDisabled(element) {
    if (!element) {
      return true;
    }

    try {
      if (element.disabled === true) {
        return true;
      }

      if (element.getAttribute && element.getAttribute("disabled") !== null) {
        return true;
      }

      const ariaDisabled = this._normalizeText(
        element.getAttribute ? element.getAttribute("aria-disabled") : ""
      );
      if (ariaDisabled === "true") {
        return true;
      }
    } catch (err) {
      // Swallow here; top-level run() has its own catch.
    }

    return false;
  }

  _isElementInViewport(ctx, element) {
    if (!element) {
      return false;
    }

    try {
      if (ctx && ctx.Lib && typeof ctx.Lib.isInViewport === "function") {
        return !!ctx.Lib.isInViewport(element);
      }
    } catch (err) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "error",
          msg: "Error in ctx.Lib.isInViewport()",
          error: String(err && err.stack ? err.stack : err)
        });
      }
      // Fall through to manual check
    }

    try {
      const rect = element.getBoundingClientRect();
      const vpHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const vpWidth = window.innerWidth || document.documentElement.clientWidth || 0;

      if (!rect || vpHeight <= 0 || vpWidth <= 0) {
        return false;
      }

      // Consider elements at least partially visible.
      const verticallyVisible = rect.bottom >= 0 && rect.top <= vpHeight;
      const horizontallyVisible = rect.right >= 0 && rect.left <= vpWidth;

      return verticallyVisible && horizontallyVisible;
    } catch (err) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "error",
          msg: "Error computing element viewport visibility",
          error: String(err && err.stack ? err.stack : err)
        });
      }
      return false;
    }
  }

  async _safeSleep(ctx, ms) {
    const timeout = typeof ms === "number" && ms > 0 ? ms : 0;

    try {
      if (ctx && ctx.Lib && typeof ctx.Lib.sleep === "function") {
        return await ctx.Lib.sleep(timeout);
      }
    } catch (err) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "error",
          msg: "Error in ctx.Lib.sleep(), falling back to setTimeout",
          error: String(err && err.stack ? err.stack : err)
        });
      }
    }

    return new Promise((resolve) => {
      setTimeout(resolve, timeout);
    });
  }

  _getAllSearchRoots() {
    const roots = [];
    const queue = [];

    const doc = document;
    if (!doc) {
      return roots;
    }

    roots.push(doc);
    queue.push(doc);

    // Traverse DOM looking for open shadow roots.
    while (queue.length > 0) {
      const root = queue.shift();
      let elements;

      try {
        elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
      } catch (err) {
        elements = [];
      }

      for (const el of elements) {
        if (!el) {
          continue;
        }
        if (el.shadowRoot) {
          const sr = el.shadowRoot;
          if (roots.indexOf(sr) === -1) {
            roots.push(sr);
            queue.push(sr);
          }
        }
      }
    }

    return roots;
  }

  _deepQuerySelectorAll(selector) {
    const results = [];
    const roots = this._getAllSearchRoots();

    for (const root of roots) {
      if (!root || !root.querySelectorAll) {
        continue;
      }
      try {
        const nodeList = root.querySelectorAll(selector);
        for (const el of nodeList) {
          results.push(el);
        }
      } catch (err) {
        // Invalid selector or other DOM error; ignore for this root.
      }
    }

    return results;
  }

  _findSvgPathElement(button) {
    if (!button || !button.querySelector) {
      return null;
    }

    try {
      return button.querySelector("svg path");
    } catch (err) {
      return null;
    }
  }

  _getPathState(pathElement) {
    if (!pathElement || !pathElement.getAttribute) {
      return "other";
    }

    const dRaw = pathElement.getAttribute("d");
    const d = this._normalizePathD(dRaw);

    const PLAY_D = this._normalizePathD("M21 12 6 20.5v-17L21 12Z");
    const PAUSE_D = this._normalizePathD("M10 5H7v14h3V5ZM17 5h-3v14h3V5Z");

    if (d === PLAY_D) {
      return "play";
    }
    if (d === PAUSE_D) {
      return "pause";
    }
    return "other";
  }

  async _waitForPathState(ctx, pathElement, desiredState, timeoutMs) {
    const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 10000;
    const start = Date.now();
    let lastState = this._getPathState(pathElement);

    while (Date.now() - start < timeout) {
      lastState = this._getPathState(pathElement);
      if (lastState === desiredState) {
        return true;
      }
      await this._safeSleep(ctx, 250);
    }

    if (ctx && typeof ctx.log === "function") {
      ctx.log({
        level: "warn",
        msg: "Timeout waiting for desired SVG path state",
        desiredState,
        lastState
      });
    }
    return false;
  }

  _findNewPlayableButtonsInViewport(ctx, processedButtons) {
    const selector = 'button[data-testid="playButton"][aria-label]';
    const candidates = this._deepQuerySelectorAll(selector);
    const result = [];

    for (const button of candidates) {
      if (!button) {
        continue;
      }

      if (processedButtons.has(button)) {
        continue;
      }

      if (this._isDisabled(button)) {
        continue;
      }

      if (!this._isElementInViewport(ctx, button)) {
        continue;
      }

      const ariaLabel = this._normalizeText(button.getAttribute("aria-label"));
      if (ariaLabel && ariaLabel.indexOf("play") === -1) {
        // Only act on buttons whose aria-label refers to "Play" (normalized).
        continue;
      }

      const pathElement = this._findSvgPathElement(button);
      if (!pathElement) {
        continue;
      }

      const state = this._getPathState(pathElement);
      if (state !== "play") {
        // We only want buttons in the initial "play" state.
        continue;
      }

      result.push(button);
    }

    return result;
  }

  async _handlePlayButton(ctx, button, indexInBatch, batchSize, totalClickedBefore) {
    if (!button) {
      return;
    }

    const pathElement = this._findSvgPathElement(button);
    if (!pathElement) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "warn",
          msg: "Play button has no SVG path; skipping.",
          indexInBatch,
          batchSize
        });
      }
      return;
    }

    const initialState = this._getPathState(pathElement);
    if (initialState !== "play") {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "info",
          msg: "Play button is not in 'play' state at click time; skipping.",
          indexInBatch,
          batchSize,
          initialState
        });
      }
      return;
    }

    // Ensure the element is scrolled into view before clicking.
    try {
      if (!this._isElementInViewport(ctx, button)) {
        try {
          if (ctx && ctx.Lib && typeof ctx.Lib.scrollIntoView === "function") {
            ctx.Lib.scrollIntoView(button);
          } else if (button.scrollIntoView) {
            button.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          await this._safeSleep(ctx, 300);
        } catch (scrollErr) {
          if (ctx && typeof ctx.log === "function") {
            ctx.log({
              level: "error",
              msg: "Error scrolling button into view before click",
              error: String(scrollErr && scrollErr.stack ? scrollErr.stack : scrollErr)
            });
          }
        }
      }
    } catch (err) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "error",
          msg: "Error checking viewport before click",
          error: String(err && err.stack ? err.stack : err)
        });
      }
    }

    // Click the button.
    try {
      button.click();
    } catch (clickErr) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "error",
          msg: "Error clicking play button",
          error: String(clickErr && clickErr.stack ? clickErr.stack : clickErr),
          indexInBatch,
          batchSize
        });
      }
      return;
    }

    if (ctx && typeof ctx.log === "function") {
      ctx.log({
        level: "info",
        msg: "Clicked play button; waiting for SVG path to change to 'pause'.",
        indexInBatch,
        batchSize,
        totalClickedBefore
      });
    }

    // Wait for SVG path to change to "pause".
    await this._waitForPathState(ctx, pathElement, "pause", 10000);

    if (ctx && typeof ctx.log === "function") {
      ctx.log({
        level: "info",
        msg: "Waiting for SVG path to return to 'play' after playback.",
        indexInBatch,
        batchSize
      });
    }

    // Then wait for it to return to "play".
    await this._waitForPathState(ctx, pathElement, "play", 60000);

    if (ctx && typeof ctx.log === "function") {
      ctx.log({
        level: "info",
        msg: "Finished playback cycle for play button (play->pause->play).",
        indexInBatch,
        batchSize
      });
    }
  }

  async _scrollByViewportFraction(ctx, fraction) {
    const ratio = typeof fraction === "number" && fraction > 0 ? fraction : 0.75;

    try {
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight || 0;
      const scrollAmount = Math.floor(viewportHeight * ratio);

      const currentScroll =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;

      const maxScroll =
        (document.documentElement && document.documentElement.scrollHeight) ||
        document.body.scrollHeight ||
        0;

      const targetScroll = Math.min(currentScroll + scrollAmount, maxScroll - viewportHeight);

      try {
        window.scrollTo({
          top: targetScroll,
          behavior: "smooth"
        });
      } catch (err) {
        // Fallback if smooth behavior is not supported.
        window.scrollTo(0, targetScroll);
      }

      // Give the scroll animation some time to settle.
      await this._safeSleep(ctx, 800);

      const finalScroll =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;

      const reachedBottom =
        viewportHeight + finalScroll + 5 >=
        ((document.documentElement && document.documentElement.scrollHeight) ||
          document.body.scrollHeight ||
          0);

      return !!reachedBottom;
    } catch (err) {
      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "error",
          msg: "Error during smooth scroll step",
          error: String(err && err.stack ? err.stack : err)
        });
      }
      // In case of error, signal "bottom" to avoid infinite loop.
      return true;
    }
  }
}
