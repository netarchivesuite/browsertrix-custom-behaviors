class ScrollAndClickBehavior
{
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "Scroll 75% and click caret/plus/comments";

  // required: a function that checks if a behavior should be run
  // for a given page.
  // This function can check the DOM / window.location to determine
  // what page it is on. The first behavior that returns 'true'
  // for a given page is used on that page.
  static isMatch() {
    //return true; //run on all pages
    return /^https:\/\/www\.reddit\.com\/r\/[^\/]+\/comments\/[^\/]+/.test(window.location.href);

    //return location.hostname.endsWith('reddit.com') && /^\/r\/[^/]+\/comments\/[^/]+/.test(location.pathname);
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

  }

  // required: the main behavior async iterator, which should yield for
  // each 'step' in the behavior.
  // When the iterator finishes, the behavior is done.
  // (See below for more info)
  async* run(ctx) {
    //... yield ctx.getState("starting behavior");

    const selectors = [
      `button:has(svg[icon-name="caret-down-outline"] > path[d="M10 13.7a.897.897 0 01-.636-.264l-4.6-4.6a.9.9 0 111.272-1.273L10 11.526l3.964-3.963a.9.9 0 011.272 1.273l-4.6 4.6A.897.897 0 0110 13.7z"])`,
      `button:has(svg > path[d="M10 1a9 9 0 100 18 9 9 0 000-18zm0 16.2a7.2 7.2 0 117.2-7.2 7.208 7.208 0 01-7.2 7.2zm.9-8.1H14v1.8h-3.1V14H9.1v-3.1H6V9.1h3.1V6h1.8v3.1z"])`,
      `button[name="comments-action-button"][data-post-click-location="comments-button"]`,
    ];

    const stepPx = Math.max(1, Math.floor(window.innerHeight * 0.75));
    const clicked = new WeakSet();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const isVisible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const markClicked = (el) => {
      el.dataset.btxClicked = "1";
      clicked.add(el);
    };

    const wasClicked = (el) =>
      el.dataset.btxClicked === "1" || clicked.has(el);

    const findNewTargets = () => {
      const out = [];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (!wasClicked(el) && isVisible(el)) out.push(el);
        }
      }
      return out;
    };

    let totalClicks = 0;
    let scrolls = 0;

    while (true) {
      const beforeY = window.scrollY;
      window.scrollBy(0, stepPx);
      scrolls++;
      yield { msg: "Scrolled by 75% viewport height", scrolls, y: window.scrollY, stepPx };

      await sleep(1000);

      const targets = findNewTargets();
      let passClicks = 0;

      for (const el of targets) {
        markClicked(el);
        try { el.click(); } catch (e) { /* ignore */ }
        totalClicks++;
        passClicks++;
        yield { msg: "Clicked matching element", totalClicks, passClicks };
        await sleep(1000);
      }

      const atBottom = Math.ceil(window.scrollY + window.innerHeight) >= Math.floor(document.documentElement.scrollHeight);
      if (passClicks === 0 && (atBottom || window.scrollY === beforeY)) {
        break;
      }
    }

    //... yield ctx.getState("behavior complete");
  }
}