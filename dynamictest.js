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
    let maxScroll = 10;
    let scrolls = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    
    while (true) {
      // Scroll down
      window.scrollBy(0, scrollAmount);
      scrolls++;
      yield { msg: "Scrolled down" };

      // Wait for a moment to allow new elements to load
      await sleep(1000);

      // Find all button elements using document.querySelectorAll
      const elements = Array.from(document.querySelectorAll("button#activate-carousel"));

      
      for (const elem of elements) {
          try {
            elem.click();
            yield { msg: "Clicked on a new element" };
            await sleep(1000);
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
