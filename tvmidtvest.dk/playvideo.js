class TVMidtvestVideo {
  static id = "TVMidtvestVideo";

  static isMatch() {
    return /(^|\.)tvmidtvest\.dk$/i.test(window.location.hostname);
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async* run(ctx) {
    const { sleep } = ctx.Lib;

    const BUTTON_SELECTOR = "button.tv-hero-play-button";

    // ------------------------------------------------------------
    // 1. Find play button
    // ------------------------------------------------------------

    let button = null;

    for (let i = 0; i < 30; i++) {
      button = document.querySelector(BUTTON_SELECTOR);

      if (button) {
        break;
      }

      await sleep(250);
    }

    if (!button) {
      yield {
        msg: "TV MIDTVEST: no video play button found"
      };
      return;
    }

    button.scrollIntoView({
      block: "center",
      behavior: "instant"
    });

    await sleep(500);

    // ------------------------------------------------------------
    // 2. Open video player
    // ------------------------------------------------------------

    button.click();

    yield {
      msg: "TV MIDTVEST: clicked video button"
    };

    // ------------------------------------------------------------
    // 3. Wait for <video>
    // ------------------------------------------------------------

    let video = null;

    for (let i = 0; i < 60; i++) {
      video =
        document.querySelector("#video-popover video") ||
        document.querySelector("video");

      if (video) {
        break;
      }

      await sleep(250);
    }

    if (!video) {
      yield {
        msg: "TV MIDTVEST: video element not found"
      };
      return;
    }

    yield {
      msg: "TV MIDTVEST: video element found"
    };

    // ------------------------------------------------------------
    // 4. Prepare muted autoplay
    // ------------------------------------------------------------

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");

    // ------------------------------------------------------------
    // 5. IMPORTANT:
    //    Let TV MIDTVEST finish initializing its own player.
    //
    // Calling play() immediately causes their player to call
    // pause() afterwards, producing:
    //
    // AbortError: play() request was interrupted by pause()
    // ------------------------------------------------------------

    await sleep(3000);

    // ------------------------------------------------------------
    // 6. Wait until player actually has a source
    // ------------------------------------------------------------

    for (let i = 0; i < 40; i++) {
      const hasSource =
        !!video.currentSrc ||
        !!video.src ||
        !!video.querySelector("source[src]");

      if (hasSource && video.readyState >= 1) {
        break;
      }

      await sleep(250);
    }

    yield {
      msg:
        "TV MIDTVEST: source=" +
        (video.currentSrc || video.src || "unknown") +
        " readyState=" +
        video.readyState
    };

    // ------------------------------------------------------------
    // 7. Retry playback.
    //
    // The site's player may issue one or more pause() calls while
    // initializing. We simply wait until that process has finished
    // and start playback again.
    // ------------------------------------------------------------

    let playing = false;

    for (let attempt = 1; attempt <= 8; attempt++) {
      video.muted = true;
      video.defaultMuted = true;

      const startTime = video.currentTime;

      yield {
        msg:
          `TV MIDTVEST: play attempt ${attempt}, ` +
          `paused=${video.paused}, ` +
          `readyState=${video.readyState}`
      };

      try {
        await video.play();
      } catch (e) {
        yield {
          msg:
            `TV MIDTVEST: play attempt ${attempt} interrupted: ` +
            `${e.name}: ${e.message}`
        };
      }

      // Give the site time to pause it again.
      await sleep(2000);

      const advanced =
        video.currentTime > startTime + 0.1;

      if (!video.paused && advanced) {
        playing = true;

        yield {
          msg:
            "TV MIDTVEST: playback confirmed at " +
            video.currentTime.toFixed(2) +
            " seconds"
        };

        break;
      }

      await sleep(1000);
    }

    if (!playing) {
      yield {
        msg:
          "TV MIDTVEST: could not keep video playing after retries"
      };

      return;
    }

    // ------------------------------------------------------------
    // 8. Keep behavior alive while video/network requests happen.
    //
    // Browsertrix can capture manifests/segments during this time.
    // ------------------------------------------------------------

    let previousTime = video.currentTime;

    for (let i = 0; i < 15; i++) {
      await sleep(2000);

      // If TV MIDTVEST pauses it later, restart it.
      if (video.paused && !video.ended) {
        video.muted = true;

        try {
          await video.play();

          yield {
            msg: "TV MIDTVEST: restarted paused video"
          };
        } catch (e) {
          yield {
            msg:
              `TV MIDTVEST: restart failed: ` +
              `${e.name}: ${e.message}`
          };
        }
      }

      if (video.currentTime !== previousTime) {
        previousTime = video.currentTime;
      }

      if (video.ended) {
        yield {
          msg: "TV MIDTVEST: video ended"
        };
        break;
      }
    }

    yield {
      msg:
        "TV MIDTVEST: finished video behavior at " +
        video.currentTime.toFixed(2) +
        " seconds"
    };
  }
}
