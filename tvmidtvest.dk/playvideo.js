class TVMidtvestMP4Archive {
  static id = "TVMidtvestMP4Archive-v4";

  static isMatch() {
    return /(^|\.)tvmidtvest\.dk$/i.test(
      window.location.hostname
    );
  }

  static init() {
    return {};
  }

  static runInIframe = false;
  static runInIframes = false;

  async* run(ctx) {
    const {
      sleep,
      waitForNetworkIdle
    } = ctx.Lib;

    // ============================================================
    // Configuration
    // ============================================================

    const HERO_BUTTON =
      "button.tv-hero-play-button";

    const JW_PLAYBACK_BUTTON =
      ".jw-icon-playback[role='button']";

    const PLAYER_WAIT_MS = 20000;
    const MP4_DISCOVERY_MS = 20000;

    const MAX_PLAY_ATTEMPTS = 20;
    const PLAY_RETRY_MS = 750;

    // Log download progress approximately every 64 MB.
    const PROGRESS_BYTES =
      64 * 1024 * 1024;

    // Hard safety limit.
    const MAX_FILE_SIZE =
      10 * 1024 * 1024 * 1024; // 10 GB

    // ============================================================
    // Helpers
    // ============================================================

    const normalizeLabel = element =>
      (
        element?.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .toLowerCase();

    const isPlayLabel = label =>
      label === "afspil" ||
      label === "play";

    const isPauseLabel = label =>
      label === "pause";

    const isTargetMP4 = url => {
      if (!url) {
        return false;
      }

      try {
        const parsed =
          new URL(url);

        return (
          /\.storagefactory\.io$/i.test(
            parsed.hostname
          ) &&
          /\/midtvest-ovp\/mp4\/.*\.mp4$/i.test(
            parsed.pathname
          )
        );
      } catch (_) {
        return false;
      }
    };

    const formatMB = bytes =>
      (
        bytes /
        1024 /
        1024
      ).toFixed(1);

    // ------------------------------------------------------------
    // Parse:
    //
    // Content-Range: bytes 0-1048575/123456789
    // ------------------------------------------------------------

    const parseContentRange =
      value => {

        if (!value) {
          return null;
        }

        const match =
          value.match(
            /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i
          );

        if (!match) {
          return null;
        }

        return {
          start:
            Number(match[1]),

          end:
            Number(match[2]),

          total:
            match[3] === "*"
              ? null
              : Number(match[3])
        };
      };

    // ============================================================
    // MP4 network discovery
    // ============================================================

    const mp4Candidates =
      new Set();

    const scanForMP4 = () => {
      // ----------------------------------------------------------
      // <video> and <source>
      // ----------------------------------------------------------

      for (
        const video
        of document.querySelectorAll("video")
      ) {
        const urls = [
          video.currentSrc,
          video.src,

          ...[
            ...video.querySelectorAll(
              "source[src]"
            )
          ].map(
            source =>
              source.src
          )
        ];

        for (const url of urls) {
          if (isTargetMP4(url)) {
            mp4Candidates.add(
              url
            );
          }
        }
      }

      // ----------------------------------------------------------
      // Browser resource requests
      // ----------------------------------------------------------

      for (
        const entry
        of performance.getEntriesByType(
          "resource"
        )
      ) {
        if (
          isTargetMP4(entry.name)
        ) {
          mp4Candidates.add(
            entry.name
          );
        }
      }
    };

    // Start observing before opening the player.
    let performanceObserver = null;

    try {
      performanceObserver =
        new PerformanceObserver(
          list => {
            for (
              const entry
              of list.getEntries()
            ) {
              if (
                isTargetMP4(
                  entry.name
                )
              ) {
                mp4Candidates.add(
                  entry.name
                );
              }
            }
          }
        );

      performanceObserver.observe({
        type: "resource",
        buffered: true
      });
    } catch (_) {
      performanceObserver = null;
    }

    scanForMP4();

    // ============================================================
    // 1. Open outer TV MIDTVEST video popover
    // ============================================================

    let heroButton = null;

    const heroStarted =
      Date.now();

    while (
      !heroButton &&
      Date.now() - heroStarted <
        PLAYER_WAIT_MS
    ) {
      heroButton =
        document.querySelector(
          HERO_BUTTON
        );

      if (!heroButton) {
        await sleep(250);
      }
    }

    if (!heroButton) {
      performanceObserver?.disconnect();

      yield {
        msg:
          "TV MIDTVEST: no hero video button found"
      };

      return;
    }

    heroButton.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await sleep(300);

    heroButton.click();

    yield {
      msg:
        "TV MIDTVEST: video popover opened"
    };

    // ============================================================
    // 2. Wait for JW Player controls and <video>
    // ============================================================

    let jwButton = null;
    let video = null;

    const jwStarted =
      Date.now();

    while (
      Date.now() - jwStarted <
        PLAYER_WAIT_MS
    ) {
      jwButton =
        document.querySelector(
          JW_PLAYBACK_BUTTON
        );

      video =
        document.querySelector(
          "video"
        );

      if (
        jwButton &&
        video
      ) {
        break;
      }

      await sleep(250);
    }

    if (!jwButton) {
      performanceObserver?.disconnect();

      yield {
        msg:
          "TV MIDTVEST: JW Player playback button not found"
      };

      return;
    }

    if (!video) {
      performanceObserver?.disconnect();

      yield {
        msg:
          "TV MIDTVEST: JW Player video element not found"
      };

      return;
    }

    yield {
      msg:
        `TV MIDTVEST: JW Player found, state="${jwButton.getAttribute(
          "aria-label"
        )}"`
    };

    // ============================================================
    // 3. Make playback permissible without real user activation
    //
    // Chromium permits muted playback much more readily.
    // ============================================================

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;

    video.setAttribute(
      "muted",
      ""
    );

    video.setAttribute(
      "playsinline",
      ""
    );

    video.preload = "auto";

    // ============================================================
    // 4. Click JW Player until aria-label becomes "Pause"
    // ============================================================

    let jwPlaying = false;

    for (
      let attempt = 1;
      attempt <=
        MAX_PLAY_ATTEMPTS;
      attempt++
    ) {
      // JW Player may recreate this DOM node after each state
      // transition, so always re-query it.
      jwButton =
        document.querySelector(
          JW_PLAYBACK_BUTTON
        );

      video =
        document.querySelector(
          "video"
        ) || video;

      if (!jwButton) {
        yield {
          msg:
            `TV MIDTVEST: JW playback control missing on attempt ${attempt}`
        };

        await sleep(
          PLAY_RETRY_MS
        );

        continue;
      }

      if (video) {
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
      }

      const label =
        normalizeLabel(
          jwButton
        );

      // ----------------------------------------------------------
      // Already playing.
      // ----------------------------------------------------------

      if (
        isPauseLabel(label)
      ) {
        jwPlaying = true;

        yield {
          msg:
            `TV MIDTVEST: JW Player is PLAYING ` +
            `(aria-label="${jwButton.getAttribute(
              "aria-label"
            )}")`
        };

        break;
      }

      // ----------------------------------------------------------
      // Only click if control currently means PLAY.
      //
      // This avoids:
      //
      // Afspil → click → Pause → click again → Afspil
      // ----------------------------------------------------------

      if (
        isPlayLabel(label)
      ) {
        yield {
          msg:
            `TV MIDTVEST: JW play attempt ` +
            `${attempt}/${MAX_PLAY_ATTEMPTS}`
        };

        try {
          jwButton.scrollIntoView({
            block: "center",
            inline: "center"
          });

          await sleep(150);

          jwButton.click();
        } catch (error) {
          yield {
            msg:
              `TV MIDTVEST: JW click failed: ` +
              `${error.name}: ${error.message}`
          };
        }
      } else {
        yield {
          msg:
            `TV MIDTVEST: JW state is ` +
            `"${jwButton.getAttribute(
              "aria-label"
            )}"`
        };
      }

      // Give JW Player time to perform its state transition.
      await sleep(
        PLAY_RETRY_MS
      );

      // ----------------------------------------------------------
      // Check again AFTER the click.
      // ----------------------------------------------------------

      jwButton =
        document.querySelector(
          JW_PLAYBACK_BUTTON
        );

      const newLabel =
        normalizeLabel(
          jwButton
        );

      if (
        isPauseLabel(
          newLabel
        )
      ) {
        jwPlaying = true;

        yield {
          msg:
            `TV MIDTVEST: JW Player entered PLAYING state ` +
            `after attempt ${attempt}`
        };

        break;
      }
    }

    if (!jwPlaying) {
      performanceObserver?.disconnect();

      yield {
        msg:
          `TV MIDTVEST: could not make JW Player enter PLAYING ` +
          `state after ${MAX_PLAY_ATTEMPTS} attempts`
      };

      return;
    }

    // ============================================================
    // 5. Confirm underlying video advances
    // ============================================================

    video =
      document.querySelector(
        "video"
      ) || video;

    if (video) {
      const before =
        Number(
          video.currentTime ||
          0
        );

      await sleep(1200);

      const after =
        Number(
          video.currentTime ||
          0
        );

      yield {
        msg:
          `TV MIDTVEST: playback check ` +
          `${before.toFixed(2)}s -> ` +
          `${after.toFixed(2)}s`
      };
    }

    // ============================================================
    // 6. Discover storagefactory.io MP4
    // ============================================================

    const discoveryStarted =
      Date.now();

    let mp4Url = null;

    while (
      Date.now() -
        discoveryStarted <
      MP4_DISCOVERY_MS
    ) {
      scanForMP4();

      if (
        mp4Candidates.size
      ) {
        mp4Url =
          [...mp4Candidates][0];

        break;
      }

      await sleep(250);
    }

    scanForMP4();

    if (
      !mp4Url &&
      mp4Candidates.size
    ) {
      mp4Url =
        [...mp4Candidates][0];
    }

    performanceObserver?.disconnect();

    if (!mp4Url) {
      yield {
        msg:
          "TV MIDTVEST: storagefactory.io MP4 URL not discovered"
      };

      return;
    }

    yield {
      msg:
        `TV MIDTVEST: MP4 discovered: ${mp4Url}`
    };

    // ============================================================
    // 7. Stop JW playback
    //
    // We no longer need real-time playback. From now on, the
    // crawler downloads the MP4 directly.
    // ============================================================

    video =
      document.querySelector(
        "video"
      );

    if (video) {
      try {
        video.pause();
      } catch (_) {}
    }

    // ============================================================
    // 8. Fetch options
    //
    // JavaScript cannot manually set Referer because Referer is
    // browser-controlled. Using referrer/referrerPolicy keeps the
    // request in TV MIDTVEST origin context.
    // ============================================================

    const baseFetchOptions = {
      method: "GET",

      mode: "cors",

      credentials: "omit",

      cache: "no-store",

      referrer:
        `${window.location.origin}/`,

      referrerPolicy:
        "origin"
    };

    // ============================================================
    // 9. Consume a response body completely.
    //
    // fetch() by itself resolves after response HEADERS arrive.
    //
    // reader.read() until done === true is the important part:
    // it forces Chromium to consume the complete response body.
    // ============================================================

    const consumeResponse =
      async function* (
        response,
        expectedMaximum = null
      ) {
        if (!response.body) {
          throw new Error(
            "Response has no readable body"
          );
        }

        const reader =
          response.body.getReader();

        let received = 0;

        let nextProgress =
          PROGRESS_BYTES;

        while (true) {
          const {
            done,
            value
          } =
            await reader.read();

          if (done) {
            break;
          }

          received +=
            value?.byteLength ||
            0;

          if (
            received >
            MAX_FILE_SIZE
          ) {
            try {
              await reader.cancel();
            } catch (_) {}

            throw new Error(
              `MP4 exceeded ${MAX_FILE_SIZE} byte safety limit`
            );
          }

          if (
            expectedMaximum &&
            received >
              expectedMaximum
          ) {
            throw new Error(
              "Received more bytes than expected"
            );
          }

          if (
            received >=
            nextProgress
          ) {
            yield {
              msg:
                `TV MIDTVEST: fetched ` +
                `${formatMB(
                  received
                )} MB`
            };

            nextProgress +=
              PROGRESS_BYTES;
          }
        }

        return received;
      };

    // ============================================================
    // 10. First try a normal complete GET.
    //
    // Best possible WARC representation:
    //
    // HTTP 200
    // Content-Length: full file
    // complete MP4 body
    // ============================================================

    let fullResponse = null;

    try {
      fullResponse =
        await fetch(
          mp4Url,
          baseFetchOptions
        );
    } catch (error) {
      yield {
        msg:
          `TV MIDTVEST: normal MP4 GET failed: ` +
          `${error.name}: ${error.message}`
      };
    }

    if (
      fullResponse &&
      fullResponse.status === 200
    ) {
      const declaredLength =
        Number(
          fullResponse.headers.get(
            "content-length"
          ) || 0
        );

      if (
        declaredLength >
        MAX_FILE_SIZE
      ) {
        yield {
          msg:
            `TV MIDTVEST: MP4 is too large: ` +
            `${declaredLength} bytes`
        };

        return;
      }

      yield {
        msg:
          `TV MIDTVEST: server returned HTTP 200` +
          (
            declaredLength
              ? ` (${formatMB(
                  declaredLength
                )} MB)`
              : ""
          )
      };

      const generator =
        consumeResponse(
          fullResponse,
          declaredLength ||
            null
        );

      let received = 0;

      try {
        while (true) {
          const step =
            await generator.next();

          if (step.done) {
            received =
              step.value;

            break;
          }

          yield step.value;
        }
      } catch (error) {
        yield {
          msg:
            `TV MIDTVEST: complete GET failed while reading: ` +
            `${error.message}`
        };

        return;
      }

      if (
        declaredLength &&
        received !==
          declaredLength
      ) {
        yield {
          msg:
            `TV MIDTVEST: INCOMPLETE — ` +
            `Content-Length=${declaredLength}, ` +
            `received=${received}`
        };

        return;
      }

      if (
        waitForNetworkIdle
      ) {
        await waitForNetworkIdle(
          1000,
          0
        );
      } else {
        await sleep(1000);
      }

      yield {
        msg:
          `TV MIDTVEST: COMPLETE — ` +
          `${received} bytes (${formatMB(
            received
          )} MB) archived`
      };

      return;
    }

    // ============================================================
    // 11. Progressive HTTP 206 fallback.
    //
    // TV MIDTVEST/storagefactory.io may force byte ranges.
    //
    // We request:
    //
    // Range: bytes=0-
    //
    // If the CDN gives us the complete resource, we're done.
    //
    // If it chooses to return only part of the requested range,
    // Content-Range tells us:
    //
    // bytes 0-1048575/123456789
    //
    // We then request:
    //
    // bytes=1048576-
    //
    // and continue until final byte total-1.
    // ============================================================

    yield {
      msg:
        "TV MIDTVEST: using HTTP byte-range archival"
    };

    let nextByte = 0;
    let totalBytes = null;

    let totalReceived = 0;
    let requestNumber = 0;

    while (true) {
      requestNumber++;

      if (
        totalBytes !== null &&
        nextByte >=
          totalBytes
      ) {
        break;
      }

      const rangeValue =
        `bytes=${nextByte}-`;

      yield {
        msg:
          `TV MIDTVEST: range request ${requestNumber}: ` +
          `${rangeValue}`
      };

      let response;

      try {
        response =
          await fetch(
            mp4Url,
            {
              ...baseFetchOptions,

              headers: {
                Range:
                  rangeValue
              }
            }
          );
      } catch (error) {
        yield {
          msg:
            `TV MIDTVEST: range request failed: ` +
            `${error.name}: ${error.message}`
        };

        return;
      }

      // ----------------------------------------------------------
      // Server can legally ignore Range and return HTTP 200.
      //
      // That's fine: consume full response and finish.
      // ----------------------------------------------------------

      if (
        response.status === 200
      ) {
        if (
          nextByte !== 0
        ) {
          yield {
            msg:
              "TV MIDTVEST: server ignored Range during continuation; cannot safely establish byte coverage"
          };

          return;
        }

        const declaredLength =
          Number(
            response.headers.get(
              "content-length"
            ) || 0
          );

        const generator =
          consumeResponse(
            response,
            declaredLength ||
              null
          );

        let received = 0;

        try {
          while (true) {
            const step =
              await generator.next();

            if (step.done) {
              received =
                step.value;

              break;
            }

            yield step.value;
          }
        } catch (error) {
          yield {
            msg:
              `TV MIDTVEST: HTTP 200 body read failed: ` +
              `${error.message}`
          };

          return;
        }

        if (
          declaredLength &&
          received !==
            declaredLength
        ) {
          yield {
            msg:
              `TV MIDTVEST: INCOMPLETE — expected ` +
              `${declaredLength}, received ${received}`
          };

          return;
        }

        totalReceived =
          received;

        totalBytes =
          declaredLength ||
          received;

        break;
      }

      if (
        response.status !== 206
      ) {
        yield {
          msg:
            `TV MIDTVEST: range request returned unexpected ` +
            `HTTP ${response.status}`
        };

        return;
      }

      const contentRange =
        parseContentRange(
          response.headers.get(
            "content-range"
          )
        );

      if (!contentRange) {
        yield {
          msg:
            "TV MIDTVEST: HTTP 206 response has no usable Content-Range"
        };

        return;
      }

      if (
        contentRange.start !==
        nextByte
      ) {
        yield {
          msg:
            `TV MIDTVEST: unexpected Content-Range start: ` +
            `wanted ${nextByte}, got ${contentRange.start}`
        };

        return;
      }

      if (
        contentRange.total !==
        null
      ) {
        if (
          contentRange.total >
          MAX_FILE_SIZE
        ) {
          yield {
            msg:
              `TV MIDTVEST: MP4 exceeds safety limit: ` +
              `${contentRange.total} bytes`
          };

          return;
        }

        if (
          totalBytes === null
        ) {
          totalBytes =
            contentRange.total;

          yield {
            msg:
              `TV MIDTVEST: MP4 size = ` +
              `${totalBytes} bytes ` +
              `(${formatMB(
                totalBytes
              )} MB)`
          };
        } else if (
          totalBytes !==
          contentRange.total
        ) {
          yield {
            msg:
              "TV MIDTVEST: MP4 size changed during range download"
          };

          return;
        }
      }

      const expectedRangeLength =
        contentRange.end -
        contentRange.start +
        1;

      const generator =
        consumeResponse(
          response,
          expectedRangeLength
        );

      let received = 0;

      try {
        while (true) {
          const step =
            await generator.next();

          if (step.done) {
            received =
              step.value;

            break;
          }

          yield step.value;
        }
      } catch (error) {
        yield {
          msg:
            `TV MIDTVEST: range body read failed: ` +
            `${error.message}`
        };

        return;
      }

      if (
        received !==
        expectedRangeLength
      ) {
        yield {
          msg:
            `TV MIDTVEST: INCOMPLETE RANGE — expected ` +
            `${expectedRangeLength} bytes, got ${received}`
        };

        return;
      }

      totalReceived +=
        received;

      // Next byte is the byte immediately following this
      // Content-Range.
      nextByte =
        contentRange.end +
        1;

      yield {
        msg:
          `TV MIDTVEST: archived bytes ` +
          `${contentRange.start}-${contentRange.end}` +
          (
            totalBytes
              ? ` / ${totalBytes - 1}`
              : ""
          )
      };

      // ----------------------------------------------------------
      // Definitive completion condition.
      // ----------------------------------------------------------

      if (
        totalBytes !== null &&
        nextByte >=
          totalBytes
      ) {
        break;
      }

      // Avoid any tight loop if the server behaves strangely.
      await sleep(100);
    }

    // ============================================================
    // 12. Validate complete byte coverage
    // ============================================================

    if (
      totalBytes !== null &&
      totalReceived !==
        totalBytes
    ) {
      yield {
        msg:
          `TV MIDTVEST: INCOMPLETE — MP4 size=${totalBytes}, ` +
          `downloaded=${totalReceived}`
      };

      return;
    }

    // ============================================================
    // 13. Wait until Browsertrix has finished recording traffic
    // ============================================================

    if (
      waitForNetworkIdle
    ) {
      await waitForNetworkIdle(
        1000,
        0
      );
    } else {
      await sleep(1000);
    }

    // ============================================================
    // 14. Done
    // ============================================================

    yield {
      msg:
        `TV MIDTVEST: COMPLETE — entire MP4 archived: ` +
        `${totalReceived} bytes ` +
        `(${formatMB(
          totalReceived
        )} MB); behavior ending`
    };
  }
}
