// Browsertrix behavior: wait for cued overlay play button, click once, then wait for replay button and exit. Only meant to be used on specific metadata+video capturing site

class PlayEmbeddedYoutubeVideo {
  static id = "PlayEmbeddedYoutubeVideo";

  static isMatch() {
    // Keep match generic to YouTube pages where the overlay exists.
    return true;
  }

  static init() { return {}; }

  static _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  static _nowIso() { return new Date().toISOString(); }

  static async _waitForSelector(selector, { timeoutMs = 20000, pollMs = 200 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await this._sleep(pollMs);
    }
    return null;
  }

  async *run(ctx) {
    const log = (msg, extra) => ctx.log(extra ? { msg, ...extra } : { msg });

    const playSel = "button.ytmCuedOverlayPlayButton";
    const replaySel = "button.endscreen-replay-button";

    // 1) Wait (max 20s) for overlay play button, then click once
    const playBtn = await PlayEmbeddedYoutubeVideo._waitForSelector(playSel, { timeoutMs: 20000 });
    if (!playBtn) {
      log("Timed out waiting for overlay play button", { selector: playSel, timeoutMs: 20000, at: PlayEmbeddedYoutubeVideo._nowIso() });
      return;
    }

    try {
      playBtn.click();
      log("Clicked overlay play button", { selector: playSel, at: PlayEmbeddedYoutubeVideo._nowIso() });
    } catch (e) {
      log("Failed to click overlay play button", { selector: playSel, error: String(e), at: PlayEmbeddedYoutubeVideo._nowIso() });
      return;
    }

    // 2) Wait for endscreen replay button to show, then end behavior
    const replayBtn = await PlayEmbeddedYoutubeVideo._waitForSelector(replaySel, { timeoutMs: 20 * 60 * 1000 });
    if (!replayBtn) {
      log("Timed out waiting for endscreen replay button", { selector: replaySel, at: PlayEmbeddedYoutubeVideo._nowIso() });
      return;
    }

    log("Video finished playing (endscreen replay button appeared)", { selector: replaySel, at: PlayEmbeddedYoutubeVideo._nowIso() });
    return;
  }
}
