class AutoCookieScrollBehavior {
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "Auto Cookie Accept + Scroll";

  // required: a function that checks if a behavior should be run
  // for a given page.
  // This function can check the DOM / window.location to determine
  // what page it is on. The first behavior that returns 'true'
  // for a given page is used on that page.
  static isMatch() {
    // Always run on any page:
    // To target a single URL instead, you could do:
    //   return window.location.href === "https://my-site.example.com/";
    //
    // Or to use a regular expression:
    //   return /https:\/\/example\.com\/.*/.test(window.location.href);
    return true;
  }

  static init() {
    return {};
  }

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
    try {
      if (document.readyState === "complete") {
        return;
      }

      await new Promise((resolve) => {
        function onReadyStateChange() {
          try {
            if (document.readyState === "complete") {
              document.removeEventListener("readystatechange", onReadyStateChange);
              resolve();
            }
          } catch {
            // swallow any error here to avoid uncaught exceptions
          }
        }
        document.addEventListener("readystatechange", onReadyStateChange);
      });
    } catch (e) {
      try {
        // No ctx here, so fall back to console logging only.
        console.error("[AutoCookieScrollBehavior] awaitPageLoad error", e);
      } catch {
        // ignore secondary errors
      }
    }
  }

  // required: the main behavior async iterator, which should yield for
  // each 'step' in the behavior.
  // When the iterator finishes, the behavior is done.
  async* run(ctx) {
    try {
      yield { msg: "AutoCookieScrollBehavior: starting behavior" };

      // "After pageload run this if no cookies is set"
      let hasCookies = false;
      try {
        hasCookies =
          typeof document.cookie === "string" &&
          document.cookie.trim().length > 0;
      } catch {
        hasCookies = false;
      }

      if (!hasCookies) {
        this.startCookieAutoAccept(ctx);
        yield { msg: "AutoCookieScrollBehavior: cookie auto-accept started (no cookies detected)" };
      } else if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "info",
          msg: "AutoCookieScrollBehavior: cookies already present, skipping auto-accept",
          cookieLength: (document.cookie || "").length
        });
      }

      // Then run the scrolling behavior
      await this.autoScrollPage(ctx);
      yield { msg: "AutoCookieScrollBehavior: scrolling finished" };
    } catch (error) {
      try {
        if (ctx && typeof ctx.log === "function") {
          ctx.log({
            level: "error",
            msg: "AutoCookieScrollBehavior: unhandled error in run()",
            error: String(error),
            stack: error && error.stack ? String(error.stack) : null
          });
        }
      } catch {
        // ignore secondary logging errors
      }
      return;
    }
  }

  /**
   * Implements the cookie auto-accept logic, adapted from the provided IIFE,
   * with additional robustness:
   * - text normalization
   * - viewport checks
   * - disabled / aria-disabled checks
   * - Shadow DOM traversal
   * - try/catch around all DOM interactions
   */
  startCookieAutoAccept(ctx) {
    try {
      // Hvor længe vi bliver ved med at lede (ms)
      const DURATION = 5000;
      // Interval mellem forsøg (ms)
      const INTERVAL = 1000;
      const endTime = Date.now() + DURATION;
      let clickedSomething = false;

      // Kendte selectors fra typiske cookie consent-platforme
      const knownSelectors = [
        // OneTrust
        "#onetrust-accept-btn-handler",
        'button[aria-label="Accept cookies"]',
        'button[aria-label="Accept Cookies"]',
        'button[aria-label="Accept all cookies"]',
        'button[aria-label="Accept All Cookies"]',
        // Cookiebot
        "#CybotCookiebotDialogBodyButtonAccept",
        "#CybotCookiebotDialogBodyButtonAcceptAll",
        ".CybotCookiebotDialogBodyButtonAccept",
        ".CybotCookiebotDialogBodyButtonAcceptAll",
        // Cookie Information (ofte brugt i DK)
        'button[data-cookie-action="accept"]',
        'button[data-cookie-action="acceptAll"]',
        "button.cookie-accept-all",
        "button.js-cookie-accept-all",
        // IAB TCF / andre generiske frameworks
        'button[title="Accept all"]',
        'button[title="Accept All"]',
        'button[mode="primary"][data-ref="accept-all"]',
        'button[aria-label*="Accept all"]',
        'button[aria-label*="Accept All"]',
        'button[aria-label="Accepter alt: Accepter vores databehandling og luk"]'
      ];

      // Tekster vi leder efter (engelsk og dansk)
      const positiveTexts = [
        // Engelsk
        "accept all",
        "accept all cookies",
        "allow all",
        "allow all cookies",
        "i accept",
        "i agree",
        "yes, i agree",
        "got it",
        "got it!",
        "ok, got it",
        "accept",
        "agree",
        "yes, i accept",
        "ok",
        "okay",
        // Dansk
        "accepter alle",
        "accepter alle cookies",
        "tillad alle",
        "tillad alle cookies",
        "jeg accepterer",
        "jeg accepterer alle",
        "jeg accepterer alle cookies",
        "accepter",
        "tillad",
        "ok",
        "ok, forstået",
        "forstået",
        "accepter cookies",
        "gem",
        "brug alle cookies"
      ];

      // Hjælpefunktion: normaliser tekst
      function normalizeText(txt) {
        try {
          return (txt || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        } catch {
          return "";
        }
      }

      // Hjælpefunktion: tjek om element må klikkes
      function isElementInteractable(el) {
        if (!el) {
          return false;
        }

        try {
          // Skip disabled / aria-disabled
          if (typeof el.disabled !== "undefined" && el.disabled) {
            return false;
          }

          const ariaDisabledRaw =
            (el.getAttribute && el.getAttribute("aria-disabled")) || "";
          const ariaDisabled = normalizeText(ariaDisabledRaw);
          if (ariaDisabled === "true") {
            return false;
          }
        } catch {
          // If we can't read attributes, be conservative and allow further checks
        }

        // Basic style-based visibility checks
        try {
          const style = window.getComputedStyle(el);
          if (!style) {
            return false;
          }
          if (
            style.visibility === "hidden" ||
            style.display === "none" ||
            style.opacity === "0"
          ) {
            return false;
          }
        } catch {
          // If computedStyle fails, don't treat as fatal
        }

        // Viewport checks
        try {
          if (ctx && ctx.Lib && typeof ctx.Lib.isInViewport === "function") {
            if (!ctx.Lib.isInViewport(el)) {
              // Try to scroll into view, then re-check
              try {
                if (ctx.Lib.scrollIntoView) {
                  ctx.Lib.scrollIntoView(el);
                } else if (typeof el.scrollIntoView === "function") {
                  el.scrollIntoView({ block: "center", behavior: "smooth" });
                }
              } catch {
                // ignore scroll errors
              }
              if (!ctx.Lib.isInViewport(el)) {
                return false;
              }
            }
          } else if (typeof el.getBoundingClientRect === "function") {
            const rect = el.getBoundingClientRect();
            const vh =
              window.innerHeight ||
              (document.documentElement && document.documentElement.clientHeight) ||
              0;
            const vw =
              window.innerWidth ||
              (document.documentElement && document.documentElement.clientWidth) ||
              0;

            if (
              rect.bottom <= 0 ||
              rect.top >= vh ||
              rect.right <= 0 ||
              rect.left >= vw
            ) {
              return false;
            }
          }
        } catch {
          // If viewport logic fails, fall back to allowing the click
        }

        return true;
      }

      // Support Shadow DOM: find elements matching selector in document + open shadow roots
      function getAllMatching(selector) {
        const results = [];
        const visitedRoots = new Set();

        try {
          function traverse(root) {
            if (!root || visitedRoots.has(root)) {
              return;
            }
            visitedRoots.add(root);

            if (root.querySelectorAll) {
              let nodeList = [];
              try {
                nodeList = root.querySelectorAll(selector);
              } catch (e) {
                if (ctx && typeof ctx.log === "function") {
                  ctx.log({
                    level: "error",
                    msg: "[CookieAutoAccept] Invalid selector",
                    selector,
                    error: String(e)
                  });
                }
                nodeList = [];
              }
              for (let i = 0; i < nodeList.length; i++) {
                results.push(nodeList[i]);
              }
            }

            // Traverse into any open shadow roots
            try {
              const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT,
                null
              );
              let current = walker.nextNode();
              while (current) {
                if (current.shadowRoot) {
                  traverse(current.shadowRoot);
                }
                current = walker.nextNode();
              }
            } catch {
              // ignore if TreeWalker can't be created on this root
            }
          }

          traverse(document);
        } catch (e) {
          if (ctx && typeof ctx.log === "function") {
            ctx.log({
              level: "error",
              msg: "[CookieAutoAccept] Error during getAllMatching traversal",
              selector,
              error: String(e)
            });
          }
        }

        return results;
      }

      // Forsøg at klikke på element, hvis det er synligt, i viewport og klikbart
      function safeClick(el) {
        if (!el) {
          return false;
        }

        if (!isElementInteractable(el)) {
          return false;
        }

        try {
          el.click();
          return true;
        } catch (e) {
          try {
            if (ctx && typeof ctx.log === "function") {
              ctx.log({
                level: "error",
                msg: "[CookieAutoAccept] Error clicking element",
                error: String(e)
              });
            }
          } catch {
            // ignore logging errors
          }
          return false;
        }
      }

      // Forsøg kendte selectors først
      function clickKnownSelectors() {
        let clicked = false;

        try {
          knownSelectors.forEach((sel) => {
            try {
              const elems = getAllMatching(sel);
              elems.forEach((el) => {
                if (safeClick(el)) {
                  clicked = true;
                  if (ctx && typeof ctx.log === "function") {
                    ctx.log({
                      level: "info",
                      msg: "[CookieAutoAccept] Klikkede kendt selector",
                      selector: sel
                    });
                  }
                }
              });
            } catch {
              // continue with next selector
            }
          });
        } catch {
          // ignore and just return clicked state
        }

        return clicked;
      }

      // Generel søgning efter knapper m.m. baseret på tekst
      function clickByText() {
        let clicked = false;

        let candidates = [];
        try {
          candidates = getAllMatching(
            'button, [role="button"], input[type="button"], input[type="submit"]'
          );
        } catch {
          candidates = [];
        }

        try {
          candidates.forEach((el) => {
            if (clicked) {
              return;
            }

            let rawText = "";
            try {
              rawText =
                (el.textContent || "") +
                " " +
                (el.value || "") +
                " " +
                (el.getAttribute && el.getAttribute("aria-label")) +
                " " +
                (el.getAttribute && el.getAttribute("title"));
            } catch {
              rawText = "";
            }

            const txt = normalizeText(rawText);
            if (!txt) {
              return;
            }

            for (let i = 0; i < positiveTexts.length; i++) {
              const p = positiveTexts[i];
              if (txt.indexOf(p) !== -1) {
                if (safeClick(el)) {
                  clicked = true;
                  if (ctx && typeof ctx.log === "function") {
                    ctx.log({
                      level: "info",
                      msg: "[CookieAutoAccept] Klikkede knap med tekst-match",
                      text: txt
                    });
                  }
                }
                break;
              }
            }
          });
        } catch {
          // ignore, just return whether anything was clicked
        }

        return clicked;
      }

      // Kombineret forsøg pr. "tick"
      const self = this;
      let timerId = null;
      let observer = null;

      function tryAccept() {
        try {
          if (Date.now() > endTime) {
            if (ctx && typeof ctx.log === "function") {
              ctx.log({
                level: "info",
                msg: "[CookieAutoAccept] Stoppede efter tidsgrænse",
                clickedSomething
              });
            }
            if (timerId !== null) {
              clearInterval(timerId);
            }
            if (observer) {
              try {
                observer.disconnect();
              } catch {
                // ignore
              }
            }
            return;
          }

          // Først forsøg kendte selectors
          let anyClicked = clickKnownSelectors();

          // Hvis ikke, prøv generel tekst-match
          if (!anyClicked) {
            anyClicked = clickByText();
          }

          if (anyClicked) {
            clickedSomething = true;
          }
        } catch (e) {
          try {
            if (ctx && typeof ctx.log === "function") {
              ctx.log({
                level: "error",
                msg: "[CookieAutoAccept] Error in tryAccept",
                error: String(e)
              });
            }
          } catch {
            // ignore
          }
        }
      }

      // Kør løbende i et stykke tid (til popuppen dukker op)
      timerId = setInterval(tryAccept, INTERVAL);

      // MutationObserver til at reagere, når DOM ændres (popup loader efterfølgende)
      try {
        observer = new MutationObserver(function () {
          try {
            tryAccept();
          } catch (e) {
            if (ctx && typeof ctx.log === "function") {
              ctx.log({
                level: "error",
                msg: "[CookieAutoAccept] Error in MutationObserver callback",
                error: String(e)
              });
            }
          }
        });

        const target = document.documentElement || document.body;
        if (target) {
          observer.observe(target, {
            childList: true,
            subtree: true
          });
        }
      } catch (e) {
        if (ctx && typeof ctx.log === "function") {
          ctx.log({
            level: "error",
            msg: "[CookieAutoAccept] Kunne ikke starte MutationObserver",
            error: String(e)
          });
        }
      }

      // Kør første gang med det samme
      tryAccept();

      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "info",
          msg:
            "[CookieAutoAccept] Script startet. Forsøger at acceptere cookies i ~" +
            DURATION / 1000 +
            " sekunder."
        });
      }
    } catch (e) {
      try {
        if (ctx && typeof ctx.log === "function") {
          ctx.log({
            level: "error",
            msg: "AutoCookieScrollBehavior: unhandled error in startCookieAutoAccept()",
            error: String(e),
            stack: e && e.stack ? String(e.stack) : null
          });
        }
      } catch {
        // ignore secondary logging errors
      }
    }
  }

  /**
   * Implements the scrolling IIFE:
   *
   * (async () => {
   *   const maxScreens = 15;
   *   let screensScrolled = 0;
   *   function sleep(ms) { ... }
   *   while (screensScrolled < maxScreens) { ... }
   * })();
   */
  async autoScrollPage(ctx) {
    const maxScreens = 15;
    let screensScrolled = 0;

    async function sleepMs(ms) {
      try {
        if (ctx && ctx.Lib && typeof ctx.Lib.sleep === "function") {
          await ctx.Lib.sleep(ms);
        } else {
          await new Promise((res) => setTimeout(res, ms));
        }
      } catch {
        // Fallback sleep
        await new Promise((res) => setTimeout(res, ms));
      }
    }

    try {
      while (screensScrolled < maxScreens) {
        let before = 0;
        let viewportHeight = 0;

        try {
          before =
            window.scrollY ||
            window.pageYOffset ||
            (document.documentElement && document.documentElement.scrollTop) ||
            0;
          viewportHeight =
            window.innerHeight ||
            (document.documentElement && document.documentElement.clientHeight) ||
            0;
        } catch {
          before = 0;
          viewportHeight = 0;
        }

        try {
          // Smooth + low-overhead scroll
          if (ctx && ctx.Lib && typeof ctx.Lib.scrollToOffset === "function") {
            ctx.Lib.scrollToOffset(before + viewportHeight);
          } else {
            window.scrollBy({ top: viewportHeight, behavior: "smooth" });
          }
        } catch (scrollErr) {
          if (ctx && typeof ctx.log === "function") {
            ctx.log({
              level: "error",
              msg: "[AutoScroll] Scroll error",
              error: String(scrollErr)
            });
          }
        }

        // Wait for the scroll to complete and content to load
        await sleepMs(750); // adjust if site loads slowly

        let after = 0;
        try {
          after =
            window.scrollY ||
            window.pageYOffset ||
            (document.documentElement && document.documentElement.scrollTop) ||
            0;
        } catch {
          after = before;
        }

        // If no movement -> end reached
        if (after === before) {
          if (ctx && typeof ctx.log === "function") {
            ctx.log({
              level: "info",
              msg: "[AutoScroll] Reached page end.",
              screensScrolled
            });
          } else {
            try {
              console.log("[AutoScroll] Reached page end.");
            } catch {
              // ignore
            }
          }
          break;
        }

        screensScrolled++;

        if (ctx && typeof ctx.log === "function") {
          ctx.log({
            level: "info",
            msg: "[AutoScroll] Scrolling step completed.",
            screensScrolled
          });
        }

        // Loop continues until maxScreens is reached or end detected
      }

      if (ctx && typeof ctx.log === "function") {
        ctx.log({
          level: "info",
          msg: "[AutoScroll] Scrolling finished.",
          screensScrolled
        });
      } else {
        try {
          console.log(
            "[AutoScroll] Scrolling finished. Screens scrolled:",
            screensScrolled
          );
        } catch {
          // ignore console errors
        }
      }
    } catch (e) {
      try {
        if (ctx && typeof ctx.log === "function") {
          ctx.log({
            level: "error",
            msg: "AutoCookieScrollBehavior: unhandled error in autoScrollPage()",
            error: String(e),
            stack: e && e.stack ? String(e.stack) : null
          });
        }
      } catch {
        // ignore secondary logging errors
      }
    }
  }
}
