class TVMidtvestMP4Archive {
  static id = "TVMidtvestMP4Archive-v3";

  static isMatch() {
    return /(^|\.)tvmidtvest\.dk$/i.test(window.location.hostname);
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async* run(ctx) {
    const {
      sleep,
      waitForNetworkIdle
    } = ctx.Lib;

    const HERO_BUTTON =
      "button.tv-hero-play-button";

    const DISCOVERY_TIMEOUT = 20000;

    // Log roughly every 64 MB while downloading.
    const PROGRESS_BYTES =
      64 * 1024 * 1024;

    // Safety limit.
    const MAX_FILE_SIZE =
      10 * 1024 * 1024 * 1024; // 10 GB

    const isTargetMP4 = url => {
      if (!url) return false;

      try {
        const u = new URL(url);

        return (
          /\.storagefactory\.io$/i.test(u.hostname) &&
          /\/midtvest-ovp\/mp4\/.*\.mp4(?:$|[?#])/i.test(
            u.pathname + u.search
          )
        );
      } catch (_) {
        return false;
      }
    };

    const candidates = new Set();

    // ------------------------------------------------------------
    // Find MP4 URLs already exposed by the player/browser.
    // ------------------------------------------------------------

    const scanForMP4 = () => {
      // <video>
      for (const video of document.querySelectorAll("video")) {
        const urls = [
          video.currentSrc,
          video.src,
          ...[...video.querySelectorAll("source[src]")]
            .map(source => source.src)
        ];

        for (const url of urls) {
          if (isTargetMP4(url)) {
            candidates.add(url);
          }
        }
      }

      // Network resource entries are useful if JW Player uses
      // currentSrc/blob URLs internally.
      for (
        const entry
        of performance.getEntriesByType("resource")
      ) {
        if (isTargetMP4(entry.name)) {
          candidates.add(entry.name);
        }
      }
    };

    // ------------------------------------------------------------
    // Watch network activity before opening player.
    // ------------------------------------------------------------

    let observer = null;

    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (isTargetMP4(entry.name)) {
            candidates.add(entry.name);
          }
        }
      });

      observer.observe({
        type: "resource",
        buffered: true
      });
    } catch (_) {
      observer = null;
    }

    scanForMP4();

    // ------------------------------------------------------------
    // Initialize JW Player if necessary.
    // ------------------------------------------------------------

    if (!candidates.size) {
      let button = null;

      for (let i = 0; i < 40; i++) {
        button =
          document.querySelector(HERO_BUTTON);

        if (button) break;

        await sleep(250);
      }

      if (!button) {
        observer?.disconnect();

        yield {
          msg:
            "TV MIDTVEST: no video play button found"
        };

        return;
      }

      button.scrollIntoView({
        block: "center"
      });

      await sleep(300);

      // Synthetic click is sufficient to initialize JW Player,
      // even if Chromium subsequently refuses/interrupts playback.
      button.click();

      yield {
        msg:
          "TV MIDTVEST: JW Player initialized"
      };
    }

    // ------------------------------------------------------------
    // Wait for storagefactory.io MP4.
    // ------------------------------------------------------------

    const discoveryStarted = Date.now();

    let attemptedPlay = false;

    while (
      !candidates.size &&
      Date.now() - discoveryStarted <
        DISCOVERY_TIMEOUT
    ) {
      scanForMP4();

      // Some JW Player configurations don't expose/request the
      // source until playback is attempted.
      if (!attemptedPlay) {
        const video =
          document.querySelector("video");

        if (video) {
          attemptedPlay = true;

          video.muted = true;
          video.defaultMuted = true;
          video.preload = "auto";

          try {
            await video.play();
          } catch (_) {
            // Not important.
            // We only want JW Player to expose the MP4 URL.
          }
        }
      }

      await sleep(250);
    }

    scanForMP4();

    observer?.disconnect();

    if (!candidates.size) {
      yield {
        msg:
          "TV MIDTVEST: storagefactory.io MP4 not discovered"
      };

      return;
    }

    // ------------------------------------------------------------
    // Stop real-time playback.
    //
    // We are going to archive the MP4 directly instead.
    // ------------------------------------------------------------

    for (const video of document.querySelectorAll("video")) {
      try {
        video.pause();
      } catch (_) {}
    }

    const mp4Url =
      [...candidates][0];

    yield {
      msg:
        `TV MIDTVEST: MP4 discovered: ${mp4Url}`
    };

    // ------------------------------------------------------------
    // Browser-context request.
    //
    // For a cross-origin request this deliberately sends:
    //
    // Referer: https://www.tvmidtvest.dk/
    //
    // when running on www.tvmidtvest.dk.
    // ------------------------------------------------------------

    const fetchOptions = {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",

      referrer:
        `${window.location.origin}/`,

      referrerPolicy:
        "origin"
    };

    // ------------------------------------------------------------
    // Consume an HTTP response completely.
    //
    // Merely awaiting fetch() is NOT enough:
    // fetch() resolves when response headers arrive.
    //
    // Reading until reader.done ensures Chromium actually
    // downloads the entire response body.
    // ------------------------------------------------------------

    const consumeResponse =
      async function* (response, description) {

        if (!response.body) {
          throw new Error(
            "Response has no readable body"
          );
        }

        const contentLength =
          Number(
            response.headers.get(
              "content-length"
            ) || 0
          );

        if (
          contentLength >
          MAX_FILE_SIZE
        ) {
          throw new Error(
            `Media exceeds safety limit: ` +
            `${contentLength} bytes`
          );
        }

        const reader =
          response.body.getReader();

        let received = 0;
        let nextReport =
          PROGRESS_BYTES;

        while (true) {
          const {
            done,
            value
          } = await reader.read();

          if (done) break;

          received +=
            value?.byteLength || 0;

          if (
            received >
            MAX_FILE_SIZE
          ) {
            try {
              await reader.cancel();
            } catch (_) {}

            throw new Error(
              "Media exceeded safety limit while downloading"
            );
          }

          if (
            received >= nextReport
          ) {
            yield {
              msg:
                `TV MIDTVEST: ${description}: ` +
                `${(
                  received /
                  1024 /
                  1024
                ).toFixed(1)} MB fetched`
            };

            nextReport +=
              PROGRESS_BYTES;
          }
        }

        return {
          received,
          contentLength
        };
      };

    // ============================================================
    // METHOD 1 — preferred
    //
    // Request the MP4 normally.
    //
    // If storagefactory returns HTTP 200, this gives Browsertrix
    // one complete MP4 response in the WARC. This is preferable
    // to hundreds of separate 206 range captures.
    // ============================================================

    let response = null;

    try {
      response =
        await fetch(
          mp4Url,
          fetchOptions
        );

      yield {
        msg:
          `TV MIDTVEST: full MP4 request returned HTTP ` +
          `${response.status}`
      };
    } catch (error) {
      yield {
        msg:
          `TV MIDTVEST: full MP4 fetch failed: ` +
          `${error.name}: ${error.message}`
      };
    }

    if (
      response &&
      response.status === 200
    ) {
      const generator =
        consumeResponse(
          response,
          "full MP4"
        );

      let result = null;

      while (true) {
        const step =
          await generator.next();

        if (step.done) {
          result = step.value;
          break;
        }

        yield step.value;
      }

      if (
        result.contentLength &&
        result.received !==
          result.contentLength
      ) {
        yield {
          msg:
            `TV MIDTVEST: INCOMPLETE — expected ` +
            `${result.contentLength} bytes but received ` +
            `${result.received}`
        };

        return;
      }

      if (waitForNetworkIdle) {
        await waitForNetworkIdle(
          1000,
          0
        );
      } else {
        await sleep(1000);
      }

      yield {
        msg:
          `TV MIDTVEST: COMPLETE — full MP4 archived, ` +
          `${result.received} bytes fetched`
      };

      return;
    }

    // ============================================================
    // METHOD 2 — Range fallback
    //
    // storagefactory may insist on progressive/range semantics.
    //
    // "bytes=0-" means:
    //
    // byte zero THROUGH THE END OF THE FILE.
    //
    // So this remains a single complete media transfer.
    // ============================================================

    yield {
      msg:
        "TV MIDTVEST: trying open-ended byte-range fetch"
    };

    let rangeResponse;

    try {
      rangeResponse =
        await fetch(
          mp4Url,
          {
            ...fetchOptions,

            headers: {
              Range:
                "bytes=0-"
            }
          }
        );
    } catch (error) {
      yield {
        msg:
          `TV MIDTVEST: range fetch failed: ` +
          `${error.name}: ${error.message}`
      };

      return;
    }

    if (
      rangeResponse.status !== 206 &&
      rangeResponse.status !== 200
    ) {
      yield {
        msg:
          `TV MIDTVEST: range request failed with HTTP ` +
          `${rangeResponse.status}`
      };

      return;
    }

    yield {
      msg:
        `TV MIDTVEST: open range returned HTTP ` +
        `${rangeResponse.status}; downloading to EOF`
    };

    const rangeGenerator =
      consumeResponse(
        rangeResponse,
        "MP4 byte range"
      );

    let rangeResult = null;

    while (true) {
      const step =
        await rangeGenerator.next();

      if (step.done) {
        rangeResult =
          step.value;
        break;
      }

      yield step.value;
    }

    // "Range: bytes=0-" explicitly requests from byte zero until
    // the end of the representation. Reaching EOF therefore gives
    // us complete byte coverage.
    if (
      rangeResult.contentLength &&
      rangeResult.received !==
        rangeResult.contentLength
    ) {
      yield {
        msg:
          `TV MIDTVEST: INCOMPLETE — range body expected ` +
          `${rangeResult.contentLength} bytes but received ` +
          `${rangeResult.received}`
      };

      return;
    }

    if (waitForNetworkIdle) {
      await waitForNetworkIdle(
        1000,
        0
      );
    } else {
      await sleep(1000);
    }

    yield {
      msg:
        `TV MIDTVEST: COMPLETE — complete MP4 range ` +
        `0-EOF archived, ${rangeResult.received} bytes fetched`
    };
  }
}
