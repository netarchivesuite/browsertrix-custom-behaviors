class GetFacebookPosts {
  static id = "Get facebook posts";
  static runInIframes = false;

  static maxPosts = 5;

  static config = {
    scrollDelay: 1400,
    hoverDelay: 550,
    hoverBetweenDelay: 250,
    maxHoverPerScan: 12,
    settleDelay: 700,
    endNoNewRounds: 8,
    bottomPadding: 1200
  };

  static isMatch(url) {
    return /(^|\.)facebook\.com/i.test(new URL(url).hostname);
  }

  static init() {
    return {};
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  scrollStep() {
    return Math.max(450, Math.floor(window.innerHeight * 0.75));
  }

  isVisible(el) {
    if (!el || !document.contains(el)) return false;

    const r = el.getBoundingClientRect();

    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < window.innerHeight &&
      r.left < window.innerWidth
    );
  }

  hasDirectChildSpanWithAriaLabelledby(el) {
    return [...el.children].some(child =>
      child.tagName === "SPAN" &&
      child.hasAttribute("aria-labelledby")
    );
  }

  cleanPostUrl(rawUrl) {
    try {
      const u = new URL(rawUrl, location.href);

      if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
      if (!u.pathname.includes("/posts/")) return null;

      return `${u.origin}${u.pathname}`.replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  collectPostUrlsFromAnchors(found, ctx) {
    const newUrls = [];

    for (const a of document.querySelectorAll("a[href]")) {
      if (found.size >= GetFacebookPosts.maxPosts) break;
      if (!this.isVisible(a)) continue;

      const clean = this.cleanPostUrl(a.href);
      if (!clean || found.has(clean)) continue;

      found.add(clean);
      newUrls.push(clean);

      ctx.log({
        msg: "Found Facebook post URL",
        url: clean,
        totalFound: found.size,
        maxPosts: GetFacebookPosts.maxPosts
      });
    }

    return newUrls;
  }

  getHoverTargets(hovered) {
    return [...document.querySelectorAll('a[href^="?__cft__"], a[href*="__cft__"]')]
      .filter(el =>
        this.isVisible(el) &&
        !hovered.has(el) &&
        this.hasDirectChildSpanWithAriaLabelledby(el)
      );
  }

  async firePointerAndMouseEvents(el) {
    if (!this.isVisible(el)) return false;

    const r = el.getBoundingClientRect();
    const x = Math.floor(r.left + r.width / 2);
    const y = Math.floor(r.top + r.height / 2);

    const pointerInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y
    };

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y
    };

    const events = [
      ["pointerover", PointerEvent, pointerInit],
      ["mouseover", MouseEvent, mouseInit],
      ["pointerenter", PointerEvent, pointerInit],
      ["mouseenter", MouseEvent, mouseInit],
      ["pointermove", PointerEvent, pointerInit],
      ["mousemove", MouseEvent, mouseInit]
    ];

    for (const [type, EventCtor, init] of events) {
      if (!document.contains(el) || !this.isVisible(el)) return false;
      el.dispatchEvent(new EventCtor(type, init));
      await this.sleep(80);
    }

    await this.sleep(GetFacebookPosts.config.hoverDelay);
    return true;
  }

  async hoverVisibleTargets(found, hovered, ctx) {
    let hoveredCount = 0;

    for (let i = 0; i < GetFacebookPosts.config.maxHoverPerScan; i++) {
      if (found.size >= GetFacebookPosts.maxPosts) break;

      const target = this.getHoverTargets(hovered)[0];
      if (!target) break;

      hovered.add(target);

      const before = target.getAttribute("href");
      const ok = await this.firePointerAndMouseEvents(target);

      await this.sleep(GetFacebookPosts.config.hoverBetweenDelay);

      const after = document.contains(target)
        ? target.getAttribute("href")
        : null;

      if (!ok) continue;

      hoveredCount++;

      const cleanAfter = after
        ? this.cleanPostUrl(new URL(after, location.href).href)
        : null;

      if (cleanAfter && !found.has(cleanAfter)) {
        found.add(cleanAfter);

        ctx.log({
          msg: "Found Facebook post URL after hover",
          url: cleanAfter,
          totalFound: found.size,
          maxPosts: GetFacebookPosts.maxPosts
        });
      }

      if (before !== after) {
        ctx.log({
          msg: "Hover changed href",
          before,
          after
        });
      }

      this.collectPostUrlsFromAnchors(found, ctx);
    }

    return hoveredCount;
  }

  async scan(found, hovered, ctx) {
    const beforeCount = found.size;

    this.collectPostUrlsFromAnchors(found, ctx);

    if (found.size < GetFacebookPosts.maxPosts) {
      await this.hoverVisibleTargets(found, hovered, ctx);
      await this.sleep(GetFacebookPosts.config.settleDelay);
      this.collectPostUrlsFromAnchors(found, ctx);
    }

    const added = found.size - beforeCount;

    ctx.log({
      msg: "Scan complete",
      added,
      totalFound: found.size,
      maxPosts: GetFacebookPosts.maxPosts
    });

    return added;
  }

  async waitForFeedToSettle(found, hovered, ctx) {
    let stableRounds = 0;
    let lastHeight = document.body.scrollHeight;

    while (stableRounds < 4 && found.size < GetFacebookPosts.maxPosts) {
      await this.sleep(900);

      const currentHeight = document.body.scrollHeight;
      const visibleLoaders = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')]
        .filter(el => this.isVisible(el));

      await this.scan(found, hovered, ctx);

      if (currentHeight !== lastHeight || visibleLoaders.length) {
        stableRounds = 0;
        lastHeight = currentHeight;
      } else {
        stableRounds++;
      }
    }

    ctx.log({
      msg: "Feed settle check complete",
      stableRounds,
      totalFound: found.size
    });
  }

  async addFoundLinksToCrawl(found, ctx) {
    const urls = [...found];

    ctx.log({
      msg: "Adding discovered Facebook post URLs to crawl",
      count: urls.length
    });

    for (const url of urls) {
      await ctx.Lib.addLink(url);
      ctx.log({
        msg: "Added URL to crawl",
        url
      });
    }
  }

  async* run(ctx) {
    const found = new Set();
    const hovered = new WeakSet();

    let noNewRounds = 0;

    ctx.log({
      msg: "Facebook post collector started",
      pageUrl: location.href,
      maxPosts: GetFacebookPosts.maxPosts
    });

    await this.scan(found, hovered, ctx);

    while (found.size < GetFacebookPosts.maxPosts) {
      const beforeY = window.scrollY;
      const beforeHeight = document.body.scrollHeight;
      const beforeCount = found.size;

      await this.scan(found, hovered, ctx);

      window.scrollBy({
        top: this.scrollStep(),
        behavior: "smooth"
      });

      await this.sleep(GetFacebookPosts.config.scrollDelay);
      await this.scan(found, hovered, ctx);

      const afterY = window.scrollY;
      const afterHeight = document.body.scrollHeight;
      const afterCount = found.size;

      const nearBottom =
        afterY + window.innerHeight >=
        document.body.scrollHeight - GetFacebookPosts.config.bottomPadding;

      const noScrollMovement = Math.abs(afterY - beforeY) < 25;
      const heightDidNotGrow = afterHeight <= beforeHeight;
      const noNewLinks = afterCount === beforeCount;

      if (noNewLinks) {
        noNewRounds++;
      } else {
        noNewRounds = 0;
      }

      ctx.log({
        msg: "Scroll round complete",
        beforeCount,
        afterCount,
        added: afterCount - beforeCount,
        nearBottom,
        noScrollMovement,
        heightDidNotGrow,
        noNewRounds
      });

      if (
        found.size < GetFacebookPosts.maxPosts &&
        (nearBottom || noScrollMovement || heightDidNotGrow || noNewLinks)
      ) {
        await this.waitForFeedToSettle(found, hovered, ctx);
      }

      if (noNewRounds >= GetFacebookPosts.config.endNoNewRounds) {
        ctx.log({
          msg: "No new links for several rounds; nudging scroll/load",
          noNewRounds
        });

        window.scrollBy({ top: 180, behavior: "smooth" });
        await this.sleep(600);
        await this.scan(found, hovered, ctx);

        window.scrollBy({ top: -120, behavior: "smooth" });
        await this.sleep(600);
        await this.scan(found, hovered, ctx);

        window.scrollBy({ top: this.scrollStep(), behavior: "smooth" });
        await this.sleep(GetFacebookPosts.config.scrollDelay);

        noNewRounds = 0;
      }
    }

    ctx.log({
      msg: "Stopping Facebook post collector",
      reason: found.size >= GetFacebookPosts.maxPosts
        ? "Reached max post limit"
        : "Collector ended",
      totalFound: found.size
    });

    await this.addFoundLinksToCrawl(found, ctx);
  }
}
