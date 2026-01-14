// Browsertrix behavior: iterate SoundCloud track buttons, force-stop current audio,
// click next, wait for start, then wait for end via sc-button-pause removal
// or pause→playing sequence.
// Harvest with 1 browserwindow, make a broserprofile with login and be sure to turn of "auto play"
// Crawl soundcloud trackpages: https://soundcloud.com/per_vers/tracks
// Set behaviour limit as high as the combined playtime on the longest trackpage + some

class SoundCloudButtonClassSequencer {
  static id = "SoundCloud Button-Class Sequencer";

  static isMatch() {
   return /https:\/\/soundcloud\.com\/[^/]+\/tracks/.test(window.location.href);
  }

  static init() { return {}; }

  static _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- smart scroll-to-end ----------
  static _atBottom() {
    const doc = document.scrollingElement || document.documentElement;
    return Math.ceil(doc.scrollTop + window.innerHeight) >= doc.scrollHeight - 2;
  }

  static _loadingIndicatorsPresent() {
    try {
      // Broad heuristics. Keep generic to survive class name churn.
      const sel = [
        '.lazyLoadingList__loading',
        '[role="progressbar"]',
        '[aria-busy="true"]',
        '.sc-loading',
        '.spinner',
        '.loading',
        '.soundList__loading',
      ].join(',');
      return !!document.querySelector(sel);
    } catch { return false; }
  }

  static _countPlayButtons() {
    return document.querySelectorAll('a.playButton[role="button"]:not(.sc-button-disabled)').length;
  }

  static _docScrollHeight() {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollHeight;
  }

  static _waitForDomQuiet({ quietMs = 700, maxMs = 4000 } = {}) {
    return new Promise(resolve => {
      let lastChange = Date.now();
      const start = Date.now();

      const mark = () => { lastChange = Date.now(); };

      const mo = new MutationObserver(mark);
      try {
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: false });
      } catch {}

      const iv = setInterval(() => {
        const now = Date.now();
        const quietLongEnough = now - lastChange >= quietMs;
        const hitMax = now - start >= maxMs;
        if (quietLongEnough || hitMax) {
          try { mo.disconnect(); } catch {}
          clearInterval(iv);
          resolve();
        }
      }, 100);
    });
  }

  static async _smartScrollToEnd(ctx, {
    maxWaitMs = 120000,
    settleTicks = 3,
    stepPx = 900,
    stepDelayMs = 80,
    quietMs = 700
  } = {}) {
    const log = (msg, extra) => ctx.log(extra ? { msg, ...extra } : { msg });

    const doc = document.scrollingElement || document.documentElement;
    let stable = 0;
    let prevH = 0;
    let prevCount = 0;
    const t0 = Date.now();

    // Ensure we start near top to avoid missing lazy-load thresholds
    try { doc.scrollTop = 0; } catch {}
    await this._sleep(200);

    while (Date.now() - t0 < maxWaitMs && stable < settleTicks) {
      // Step down to bottom to trigger lazy loads reliably
      const target = (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight;
      for (let y = doc.scrollTop; y < target; y += stepPx) {
        window.scrollTo(0, Math.min(y + stepPx, target));
        await this._sleep(stepDelayMs);
      }
      // Nudge bottom a couple of times
      window.scrollTo(0, target);
      await this._sleep(120);
      window.scrollTo(0, Math.max(0, target - 1));
      await this._sleep(120);
      window.scrollTo(0, target);

      // Wait for DOM quiet or timeout
      await this._waitForDomQuiet({ quietMs, maxMs: 4000 });

      // Sample metrics
      const h = this._docScrollHeight();
      const count = this._countPlayButtons();
      const growthH = h > prevH + 2;          // tolerate tiny rounding noise
      const growthC = count > prevCount;

      log("Scroll pass", { h, count, loading: this._loadingIndicatorsPresent(), stable, growthH, growthC });

      if (!growthH && !growthC && this._atBottom() && !this._loadingIndicatorsPresent()) {
        stable += 1;
      } else {
        stable = 0;
      }

      prevH = Math.max(prevH, h);
      prevCount = Math.max(prevCount, count);
    }

    log("Reached real end or max wait", { stable, prevH, prevCount, elapsedMs: Date.now() - t0 });
  }
  // ---------- end smart scroll-to-end ----------

  static _isBtnPlaying(btn) {
    try {
      if (!btn) return false;
      if (btn.classList.contains("sc-button-pause")) return true;
      const aria = btn.getAttribute("aria-checked");
      if (aria && aria.toLowerCase() === "true") return true;
    } catch {}
    return false;
  }

  static _getActiveBtn() {
    return document.querySelector('a.playButton[role="button"].sc-button-pause, a.playButton[role="button"][aria-checked="true"]');
  }

  static async _forceStop(ctx) {
    const log = (msg, extra) => ctx.log(extra ? { msg, ...extra } : { msg });

    try {
      const pc = document.querySelector("button.playControl");
      const isPlaying = !!pc && (pc.className.includes("playing") ||
        /pause/i.test(pc.getAttribute("aria-label") || pc.title || ""));
      if (isPlaying) { pc.click(); log("Clicked global playControl to pause"); }
    } catch {}

    try {
      const active = SoundCloudButtonClassSequencer._getActiveBtn();
      if (active) { active.click(); log("Clicked active track to pause"); }
    } catch {}

    try {
      for (const m of document.querySelectorAll("audio,video")) { try { m.pause(); } catch {} }
      log("Issued pause() to all media");
    } catch {}

    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      if (!SoundCloudButtonClassSequencer._getActiveBtn()) break;
      await SoundCloudButtonClassSequencer._sleep(100);
    }
  }

  static _waitForStartOnBtn(btn, { timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      if (SoundCloudButtonClassSequencer._isBtnPlaying(btn)) return resolve({ via: "already-playing" });

      const cleanup = [];
      const done = (res, err) => {
        cleanup.forEach(fn => { try { fn(); } catch {} });
        err ? reject(err) : resolve(res);
      };

      const mo = new MutationObserver(() => {
        if (SoundCloudButtonClassSequencer._isBtnPlaying(btn)) done({ via: "button-class" });
      });
      try {
        mo.observe(btn, { attributes: true, attributeFilter: ["class", "aria-checked"] });
        cleanup.push(() => mo.disconnect());
      } catch {}

      const onEvt = (e) => {
        if (!(e.target instanceof HTMLMediaElement)) return;
        if (SoundCloudButtonClassSequencer._isBtnPlaying(btn)) done({ via: "media-event", ev: e.type });
      };
      document.addEventListener("play", onEvt, true);
      document.addEventListener("playing", onEvt, true);
      cleanup.push(() => {
        document.removeEventListener("play", onEvt, true);
        document.removeEventListener("playing", onEvt, true);
      });

      const poll = setInterval(() => {
        if (SoundCloudButtonClassSequencer._isBtnPlaying(btn)) done({ via: "poll" });
      }, 200);
      cleanup.push(() => clearInterval(poll));

      const to = setTimeout(() => done(null, new Error("start-timeout")), timeoutMs);
      cleanup.push(() => clearTimeout(to));
    });
  }

  static _waitForEndOfBtn(btn, { timeoutMs = 180000, gapMs = 3000 } = {}) {
    return new Promise((resolve, reject) => {
      let lastPauseAt = 0;
      const cleanup = [];
      const done = (res, err) => {
        cleanup.forEach(fn => { try { fn(); } catch {} });
        err ? reject(err) : resolve(res);
      };

      const mo = new MutationObserver(() => {
        if (!SoundCloudButtonClassSequencer._isBtnPlaying(btn)) done({ via: "button-class-removed" });
      });
      try {
        mo.observe(btn, { attributes: true, attributeFilter: ["class", "aria-checked"] });
        cleanup.push(() => mo.disconnect());
      } catch {}

      const bodyObs = new MutationObserver(() => {
        const cur = SoundCloudButtonClassSequencer._getActiveBtn();
        if (cur && cur !== btn) done({ via: "active-button-switched" });
      });
      try {
        bodyObs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "aria-checked"] });
        cleanup.push(() => bodyObs.disconnect());
      } catch {}

      const onPause = (e) => { if (e.target instanceof HTMLMediaElement) lastPauseAt = Date.now(); };
      const onPlaying = () => {
        const dt = Date.now() - lastPauseAt;
        if (lastPauseAt && dt >= 0 && dt <= gapMs) done({ via: "pause->playing", dt });
      };
      const onEnded = () => done({ via: "ended-event" });
      document.addEventListener("pause", onPause, true);
      document.addEventListener("playing", onPlaying, true);
      document.addEventListener("ended", onEnded, true);
      cleanup.push(() => {
        document.removeEventListener("pause", onPause, true);
        document.removeEventListener("playing", onPlaying, true);
        document.removeEventListener("ended", onEnded, true);
      });

      const to = setTimeout(() => done(null, new Error("endpattern-timeout")), timeoutMs);
      cleanup.push(() => clearTimeout(to));
    });
  }

  async *run(ctx) {
    const log = (msg, extra) => ctx.log(extra ? { msg, ...extra } : { msg });

    // New: load to real end before collecting buttons
    await SoundCloudButtonClassSequencer._smartScrollToEnd(ctx, {
      maxWaitMs: 120000,
      settleTicks: 3,
      stepPx: 600,
      stepDelayMs: 120,
      quietMs: 700
    });

    const buttons = Array.from(document.querySelectorAll('a.playButton[role="button"]:not(.sc-button-disabled):not([aria-disabled="true"])'));
    if (!buttons.length) { log('No elements found: a.playButton[role="button"]:not(.sc-button-disabled):not([aria-disabled="true"])'); return; }
    log(`Found ${buttons.length} play buttons after full scroll`);

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      if (!btn || !btn.isConnected) { log("Button missing or detached", { index: i }); continue; }

      try { btn.scrollIntoView({ block: "center", inline: "center" }); } catch {}
      await SoundCloudButtonClassSequencer._sleep(200);

      await SoundCloudButtonClassSequencer._forceStop(ctx);

      const waitStart = SoundCloudButtonClassSequencer._waitForStartOnBtn(btn, { timeoutMs: 20000 });
      log(`Clicking play button ${i + 1}/${buttons.length}`);
      try { btn.click(); } catch (e) { log("Click failed", { index: i, error: String(e) }); continue; }

      try {
        const started = await waitStart;
        log("Audio started", started);
      } catch (e) {
        log("Start wait timed out, moving on", { index: i, error: String(e) });
        await SoundCloudButtonClassSequencer._sleep(300);
        yield;
        continue;
      }

      try {
        const ended = await SoundCloudButtonClassSequencer._waitForEndOfBtn(btn, { timeoutMs: 180000, gapMs: 3000 });
        log("Audio end detected", ended);
      } catch (e) {
        log("End pattern wait timed out, moving on", { index: i, error: String(e) });
      }

      await SoundCloudButtonClassSequencer._sleep(300);
      yield;
    }

    log("Done iterating play buttons");
  }
}
