class AutoCookieScrollBehavior {
  static id = "Auto Cookie Accept + Scroll";

  static isMatch() {
    return true;
  }

  static init() {
    return {};
  }

  static runInIframes = true;

  async *run(msg) {
    const maxScreens = 15;
    let screensScrolled = 0;

    const cookieButtonSelectors = [
      "button.fc-cta-consent",
      'button[aria-label*="accept" i]',
    ];

    function sleep(ms) {
      return new Promise((res) => setTimeout(res, ms));
    }

    function isElementVisible(el) {
      if (!el || !(el instanceof Element)) return false;

      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      )
        return false;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      // "First seen" = intersects the viewport
      const inViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;

      return inViewport;
    }

    const clicked = new WeakSet();

    async function clickCookieButtonsIfSeen() {
      for (const sel of cookieButtonSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (clicked.has(el)) continue;
          if (!isElementVisible(el)) continue;

          try {
            el.click();
            clicked.add(el);
            console.log("Clicked cookie button:", sel, el);
            await sleep(300); // allow UI to update after consent click
          } catch (e) {
            // If click fails, don't mark as clicked so it can retry later
            console.warn("Cookie button click failed:", sel, e);
          }
        }
      }
    }

    // Attempt immediately (in case banner is already visible)
    await clickCookieButtonsIfSeen();

    while (screensScrolled < maxScreens) {
      // Attempt before each scroll (banner could appear while idle)
      await clickCookieButtonsIfSeen();

      const before = window.scrollY;
      const viewportHeight = window.innerHeight;

      window.scrollBy({ top: viewportHeight, behavior: "smooth" });

      await sleep(750);

      // Attempt again after scroll (buttons may enter viewport)
      await clickCookieButtonsIfSeen();

      const after = window.scrollY;

      if (after === before) {
        console.log("Reached page end.");
        break;
      }

      screensScrolled++;
    }

    yield { msg: "AutoCookieScrollBehavior: scrolling finished" };
  }
}
