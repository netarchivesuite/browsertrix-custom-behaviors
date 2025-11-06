class ScrollAndClickBehavior {
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "Scroll and Click Behavior";

  // required: a function that checks if a behavior should be run
  // for a given page.
  static isMatch() {
    return true;
  }
  
  static init() { return {}; }

  // optional: if true, will also check isMatch() and possibly run
  // this behavior in each iframe.
  static runInIframes = false;

  // required: the main behavior async iterator, which should yield for
  // each 'step' in the behavior.
  async* run(ctx) {
    const viewportHeight = window.innerHeight;
    const scrollAmount = viewportHeight * 0.75; // Scroll by 75% of viewport height

    let previousElements = new Set();

    while (true) {
      // Scroll down
      window.scrollBy(0, scrollAmount);
      yield { msg: "Scrolled down" };

      // Wait for a moment to allow new elements to load
      await ctx.Lib.sleep(500);

      // Find all button elements
      const elements = Array.from(ctx.Lib.xpathNodes("//button[@id='activate-carousel']"));

      // Filter out previously clicked elements
      const newElements = elements.filter(elem => !previousElements.has(elem));

      for (const elem of newElements) {
        if (ctx.Lib.isInViewport(elem) && !elem.disabled && elem.getAttribute('aria-disabled') !== 'true') {
          try {
            elem.click();
            previousElements.add(elem); // Mark this element as clicked
            yield { msg: "Clicked on a new element" };
          } catch (error) {
            ctx.log({ level: "error", msg: "Error clicking element", error: error.message });
          }
        }
      }

      // If no new elements were found, break the loop to avoid infinite scrolling
      if (newElements.length === 0) {
        yield { msg: "No new elements to click, stopping behavior." };
        break;
      }
    }
  }
}
