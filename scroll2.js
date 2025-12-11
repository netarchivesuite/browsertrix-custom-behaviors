class scroll2 {
  // Required: An ID for this behavior, will be displayed in the logs when the behavior is run.
  static id = "Smooth Scroll Behavior";

  // Required: Function that checks if a behavior should be run for a given page.
  static isMatch() {
    return window.location.href === "https://smedebol.dk/kb/dynamictest.html";
  }

  // Optional: If defined, provides a custom way to determine when a page has finished loading.
  async awaitPageLoad() {

  }
  static init() { return {}; }

  // Required: The main behavior async iterator
  async *run(msg) {
    const maxScreens = 15;
    let screensScrolled = 0;

    function sleep(ms) {
      return new Promise(res => setTimeout(res, ms));
    }

    while (screensScrolled < maxScreens) {
      const before = window.scrollY;
      const viewportHeight = window.innerHeight;

      window.scrollBy({ top: viewportHeight, behavior: "smooth" });

      await sleep(750);

      const after = window.scrollY;

      if (after === before) {
        console.log("Reached page end.");
        break;
      }

      screensScrolled++;
    }

    yield { msg: "Scroll2-behavior: scrolling finished" };
  }
}
