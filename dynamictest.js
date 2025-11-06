class ScrollAndClickBehavior {
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "Scroll and Click Behavior";


  // required: a function that checks if a behavior should be run
  // for a given page.
  static isMatch() {
    return true;
  }
    async awaitPageLoad() {

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

                await sleep(2000);
                document.querySelector('#activate-carousel')?.click();
            await sleep(1000);
    while (true) {
      
              try {
            document.querySelector('#activate-carousel')?.click();
            await sleep(1000);
            document.querySelector('#enhance-acc')?.click();

            yield { msg: "Clicked on a new element" };
            await sleep(1000);
          } catch (error) {
            ctx.log({ level: "error", msg: "Error clicking element", error: error.message });
          }
            await sleep(1000);
        // Scroll down
      window.scrollBy({ top: scrollAmount, left: 0, behavior: 'smooth' });
      scrolls++;
      yield { msg: "Scrolled down" };

      // Wait for a moment to allow new elements to load
      await sleep(1000);




       if (scrolls > maxScroll) {
        break;
      }
    }
  }
}
