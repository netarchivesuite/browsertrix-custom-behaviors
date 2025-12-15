class ScrollAndClick {
  static id = "berlingske.dk cookie og liveblogs";
  

  static isMatch(url) {
    //return true; //run on all pages
    return /(^|\.)berlingske\.dk([/:?#]|$)/i.test(window.location.hostname);
    //return window.location.href === "https://www.trm.dk/nyheder/";
  }

  static init() {
    return {};
  }

  static runInIframes = true;

  async awaitPageLoad() {
    const COOKIE_SELECTOR = "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll";
    const COOKIE_WINDOW_MS = 5000;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + COOKIE_WINDOW_MS;

    while (Date.now() < deadline) {
      const btn = document.querySelector(COOKIE_SELECTOR);
      if (btn) {
        btn.click();
        break;
      }
      await sleep(100);
    }
  }

  async *run(ctx) {
    const MAX_SCROLLS = 500;
    const SCROLL_PAUSE_MS = 650;
    const LOAD_MORE_PAUSE_MS = 2000;

    const LOAD_MORE_TEXT_RE = /^\s*vis flere\s*$/i;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const isInViewport = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    };

    const findLoadMoreInView = () => {
      const buttons = Array.from(document.querySelectorAll("button"));
      for (const b of buttons) {
        const t = (b.textContent || "").trim();
        if (LOAD_MORE_TEXT_RE.test(t) && isInViewport(b)) return b;
      }
      return null;
    };

    const atBottom = () => {
      const doc = document.documentElement;
      const scrollTop = window.pageYOffset ?? doc.scrollTop ?? 0;
      const vh = window.innerHeight || doc.clientHeight || 0;
      const scrollHeight = doc.scrollHeight || 0;
      return scrollTop + vh >= scrollHeight - 2;
    };

    let scrolls = 0;
    let loadMoreClicks = 0;

    yield { msg: "start", url: window.location.href };

    while (scrolls < MAX_SCROLLS) {
      const loadMore = findLoadMoreInView();
      if (loadMore) {
        loadMore.click();
        loadMoreClicks++;
        yield { msg: 'clicked "Vis flere"', loadMoreClicks, scrolls };
        await sleep(LOAD_MORE_PAUSE_MS);
        continue;
      }

      if (atBottom()) {
        yield { msg: "bottom reached", loadMoreClicks, scrolls };
        break;
      }

      window.scrollBy(0, window.innerHeight || 0);
      scrolls++;
      yield { msg: "scrolled", loadMoreClicks, scrolls };
      await sleep(SCROLL_PAUSE_MS);
    }

    yield { msg: "done", loadMoreClicks, scrolls };
  }


}
