class GetFacebookPosts {
  static id = "Get facebook posts";
  static description = "Find Facebook post URLs, add them to the crawl queue, and stop after 20 posts.";
  static maxPosts = 20;
  static runInIframes = false;

  static isMatch(url) {
    try {
      return /(^|\.)facebook\.com$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  static init() {
    return {};
  }

  constructor() {
    this.found = new Set();
    this.hovered = new WeakSet();

    this.scanning = false;
    this.noNewRounds = 0;

    this.config = {
      scrollStep: () => Math.max(450, Math.floor(window.innerHeight * 0.75)),
      scrollDelay: 1400,
      hoverDelay: 700,
      hoverBetweenDelay: 300,
      maxHoverPerScan: 12,
      settleDelay: 700,
      endNoNewRounds: 8,
      bottomPadding: 1200
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  hasReachedLimit() {
    return this.found.size >= this.constructor.maxPosts;
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

  async addFoundUrl(ctx, url, source) {
    if (!url || this.found.has(url) || this.hasReachedLimit()) return false;

    this.found.add(url);

    ctx.log({
      msg: "Found Facebook post URL",
      source,
      url,
      totalFound: this.found.size,
      maxPosts: this.constructor.maxPosts
    });

    await ctx.Lib.addLink(url);

    ctx.log({
      msg: "Added Facebook post URL as new page to crawl",
      url,
      totalAdded: this.found.size,
      maxPosts: this.constructor.maxPosts
    });

    return true;
  }

  async collectPostUrlsFromAnchors(ctx) {
    let added = 0;

    for (const a of document.querySelectorAll("a[href]")) {
      if (this.hasReachedLimit()) break;
      if (!this.isVisible(a)) continue;

      const clean = this.cleanPostUrl(a.href);
      if (!clean) continue;

      if (await this.addFoundUrl(ctx, clean, "visible-anchor")) {
        added++;
      }
    }

    return added;
  }

  getHoverTargets() {
    return [...document.querySelectorAll('a[href^="?__cft__"], a[href*="__cft__"]')]
      .filter(el =>
        this.isVisible(el) &&
        !this.hovered.has(el) &&
        this.hasDirectChildSpanWithAriaLabelledby(el)
      );
  }

  async firePointerAndMouseEvents(ctx, el) {
    if (!this.isVisible(el)) return false;

    // Move the element into a stable viewport position.
    el.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "instant"
    });

    await this.sleep(200);

    if (!this.isVisible(el)) return false;

    const r = el.getBoundingClientRect();
    const x = Math.floor(r.left + r.width / 2);
    const y = Math.floor(r.top + r.height / 2);

    // Confirm the visible point resolves to the target or one of its children.
    const pointTarget = document.elementFromPoint(x, y);

    if (!pointTarget || !(el === pointTarget || el.contains(pointTarget))) {
      ctx.log({
        msg: "Skipping hover target because center point is covered",
        tagName: pointTarget?.tagName,
        className: pointTarget?.className,
        x,
        y
      });

      return false;
    }

    ctx.log({
      msg: "Hovering Facebook target using JavaScript-only synthetic events",
      x,
      y
    });

    // Focus can trigger Facebook/React pre-resolution paths even when hover does not.
    try {
      el.focus({ preventScroll: true });
    } catch {
      try {
        el.focus();
      } catch {
        // Ignore focus failures.
      }
    }

    const commonInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 0,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      pageX: window.scrollX + x,
      pageY: window.scrollY + y,
      movementX: 0,
      movementY: 0,
      button: 0,
      buttons: 0,
      relatedTarget: null
    };

    const pointerInit = {
      ...commonInit,
      pointerId: 1,
      width: 1,
      height: 1,
      pressure: 0,
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "mouse",
      isPrimary: true
    };

    const dispatch = async (target, type, EventCtor, init, delay = 70) => {
      if (!document.contains(target) || !this.isVisible(target)) return false;

      target.dispatchEvent(new EventCtor(type, init));
      await this.sleep(delay);

      return true;
    };

    /*
     * Dispatch on both the resolved point target and the anchor.
     * Facebook often attaches handlers to nested spans/divs rather than the <a>.
     */
    const targets = [...new Set([pointTarget, el])];

    for (const target of targets) {
      await dispatch(target, "pointerover", PointerEvent, pointerInit);
      await dispatch(target, "mouseover", MouseEvent, commonInit);
      await dispatch(target, "pointerenter", PointerEvent, pointerInit);
      await dispatch(target, "mouseenter", MouseEvent, commonInit);
    }

    // Simulate small in-place mouse movement over the element.
    for (let i = 0; i < 5; i++) {
      const moveInit = {
        ...commonInit,
        clientX: x + i,
        clientY: y + i,
        screenX: window.screenX + x + i,
        screenY: window.screenY + y + i,
        pageX: window.scrollX + x + i,
        pageY: window.scrollY + y + i,
        movementX: i === 0 ? 0 : 1,
        movementY: i === 0 ? 0 : 1
      };

      const pointerMoveInit = {
        ...pointerInit,
        ...moveInit
      };

      for (const target of targets) {
        await dispatch(target, "pointermove", PointerEvent, pointerMoveInit, 60);
        await dispatch(target, "mousemove", MouseEvent, moveInit, 60);
      }
    }

    await this.sleep(this.config.hoverDelay);

    return true;
  }

  async hoverVisibleTargets(ctx) {
    let hoveredCount = 0;

    for (let i = 0; i < this.config.maxHoverPerScan; i++) {
      if (this.hasReachedLimit()) break;

      const target = this.getHoverTargets()[0];
      if (!target) break;

      this.hovered.add(target);

      const before = target.getAttribute("href");
      const ok = await this.firePointerAndMouseEvents(ctx, target);

      await this.sleep(this.config.hoverBetweenDelay);

      const after = document.contains(target)
        ? target.getAttribute("href")
        : null;

      if (!ok) continue;

      hoveredCount++;

      const cleanAfter = after
        ? this.cleanPostUrl(new URL(after, location.href).href)
        : null;

      await this.addFoundUrl(ctx, cleanAfter, "hover-resolved-anchor");

      if (before !== after) {
        ctx.log({
          msg: "Facebook hover changed anchor href",
          before,
          after
        });
      }

      await this.collectPostUrlsFromAnchors(ctx);
    }

    return hoveredCount;
  }

  async scan(ctx) {
    if (this.scanning || this.hasReachedLimit()) return 0;

    this.scanning = true;

    const beforeCount = this.found.size;

    await this.collectPostUrlsFromAnchors(ctx);
    await this.hoverVisibleTargets(ctx);
    await this.sleep(this.config.settleDelay);
    await this.collectPostUrlsFromAnchors(ctx);

    const added = this.found.size - beforeCount;

    if (added > 0) {
      this.noNewRounds = 0;

      ctx.log({
        msg: "Facebook post scan added new URL(s)",
        added,
        totalFound: this.found.size,
        maxPosts: this.constructor.maxPosts
      });
    } else {
      this.noNewRounds++;

      ctx.log({
        msg: "Facebook post scan found no new URLs",
        noNewRounds: this.noNewRounds,
        totalFound: this.found.size,
        maxPosts: this.constructor.maxPosts
      });
    }

    this.scanning = false;
    return added;
  }

  async waitForFeedToSettle(ctx) {
    let stableRounds = 0;
    let lastHeight = document.body.scrollHeight;

    while (!this.hasReachedLimit() && stableRounds < 4) {
      await this.sleep(900);

      const currentHeight = document.body.scrollHeight;
      const visibleLoaders = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')]
        .filter(el => this.isVisible(el));

      await this.scan(ctx);

      if (currentHeight !== lastHeight || visibleLoaders.length) {
        stableRounds = 0;
        lastHeight = currentHeight;
      } else {
        stableRounds++;
      }
    }
  }

  async* run(ctx) {
    ctx.log({
      msg: "Starting Facebook post URL collection",
      maxPosts: this.constructor.maxPosts,
      pageUrl: location.href
    });

    await this.scan(ctx);

    while (!this.hasReachedLimit()) {
      const beforeY = window.scrollY;
      const beforeHeight = document.body.scrollHeight;
      const beforeCount = this.found.size;

      await this.scan(ctx);

      window.scrollBy({
        top: this.config.scrollStep(),
        behavior: "smooth"
      });

      await this.sleep(this.config.scrollDelay);
      await this.scan(ctx);

      const afterY = window.scrollY;
      const afterHeight = document.body.scrollHeight;
      const afterCount = this.found.size;

      const nearBottom =
        afterY + window.innerHeight >= document.body.scrollHeight - this.config.bottomPadding;

      const noScrollMovement = Math.abs(afterY - beforeY) < 25;
      const heightDidNotGrow = afterHeight <= beforeHeight;
      const noNewLinks = afterCount === beforeCount;

      if (nearBottom || noScrollMovement || heightDidNotGrow || noNewLinks) {
        await this.waitForFeedToSettle(ctx);
      }

      if (this.noNewRounds >= this.config.endNoNewRounds) {
        ctx.log({
          msg: "No new Facebook post URLs for several rounds; nudging feed",
          noNewRounds: this.noNewRounds
        });

        window.scrollBy({ top: 180, behavior: "smooth" });
        await this.sleep(600);
        await this.scan(ctx);

        window.scrollBy({ top: -120, behavior: "smooth" });
        await this.sleep(600);
        await this.scan(ctx);

        window.scrollBy({
          top: this.config.scrollStep(),
          behavior: "smooth"
        });

        await this.sleep(this.config.scrollDelay);

        this.noNewRounds = 0;
      }
    }

    ctx.log({
      msg: "Stopping Facebook post URL collection; post limit reached",
      totalFound: this.found.size,
      maxPosts: this.constructor.maxPosts,
      urls: [...this.found]
    });
  }
}
