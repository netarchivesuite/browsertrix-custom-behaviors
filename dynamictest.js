class ScrollAndClickBehavior {
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "Scroll and Click Behavior";
  set maxScroll = 10;
  set scrolls = 0;

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

    while (true) {
      // Scroll down
      window.scrollBy(0, scrollAmount);
      scrolls++;
      yield { msg: "Scrolled down" };

      // Wait for a moment to allow new elements to load
      await ctx.Lib.sleep(500);

      // Find all button elements using document.querySelectorAll
      const elements = Array.from(document.querySelectorAll("button#activate-carousel"));

      
      for (const elem of elements) {
          try {
            elem.click();
            yield { msg: "Clicked on a new element" };
          } catch (error) {
            ctx.log({ level: "error", msg: "Error clicking element", error: error.message });
          }
      }

       if (scrolls > maxScroll) {
        break;
      }
    }
  }
}
