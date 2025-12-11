class AutoCookieScrollBehavior {
  static id = "Auto Cookie Accept + Scroll";

  static isMatch() {
    return true;
  }

  static init() { return {}; }

  // Required: The main behavior async iterator

  static runInIframes = false;

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

    yield { msg: "AutoCookieScrollBehavior: scrolling finished" };
  }
}
