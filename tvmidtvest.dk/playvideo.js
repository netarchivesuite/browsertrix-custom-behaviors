class TVMidtvestMP4Archive {
  static id = "TVMidtvestMP4Archive-v5";

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
      waitForNetworkIdle,
      doExternalFetch
    } = ctx.Lib;

    // ============================================================
    // Configuration
    // ============================================================

    const HERO_BUTTON =
      "button.tv-hero-play-button";

    const JW_PLAYBACK_BUTTON =
      ".jw-icon-playback[role='button']";

    // Total time allowed for discovering the MP4.
    const MP4_DISCOVERY_TIMEOUT_MS = 30000;

    // How often to retry the optional playback stimulation.
    const STIMULATE_INTERVAL_MS = 1200;

    // Progress log interval.
    const PROGRESS_BYTES =
      64 * 1024 * 1024;

    // Safety cap.
    const MAX_FILE_SIZE =
      10 * 1024 * 1024 * 1024; // 10 GB

    // ============================================================
    // Helpers
    // ============================================================

    const formatMB = bytes =>
      (
        bytes /
        1024 /
        1024
      ).toFixed(1);

    const isTargetMP4 = value => {
      if (
        !value ||
        typeof value !== "string"
      ) {
        return false;
      }

      try {
        const url =
          new URL(
            value,
            window.location.href
          );

        return (
          /\.storagefactory\.io$/i.test(
            url.hostname
          ) &&
          /\/midtvest-ovp\/mp4\/.*\.mp4$/i.test(
            url.pathname
          )
        );
      } catch (_) {
        return false;
      }
    };

    // ============================================================
    // Candidate MP4 URLs
    //
    // Higher score = stronger evidence this is the actual source
    // being used by JW Player.
    // ============================================================

    const candidates =
      new Map();

    const addCandidate =
      (
        value,
        score,
        source
      ) => {
        if (!isTargetMP4(value)) {
          return;
        }

        let url;

        try {
          url =
            new URL(
              value,
              window.location.href
            ).href;
        } catch (_) {
          return;
        }

        const existing =
          candidates.get(url);

        if (
          !existing ||
          score >
            existing.score
        ) {
          candidates.set(
            url,
            {
              url,
              score,
              source
            }
          );
        }
      };

    const bestCandidate = () => {
      if (!candidates.size) {
        return null;
      }

      return [
        ...candidates.values()
      ].sort(
        (a, b) =>
          b.score -
          a.score
      )[0];
    };

    // ============================================================
    // Recursively inspect JW configuration objects
    // ============================================================

    const inspectObject =
      (
        value,
        score = 40,
        source = "object",
        depth = 0,
        seen = new WeakSet()
      ) => {
        if (
          value === null ||
          value === undefined ||
          depth > 7
        ) {
          return;
        }

        if (
          typeof value === "string"
        ) {
          addCandidate(
            value,
            score,
            source
          );

          return;
        }

        if (
          typeof value !== "object"
        ) {
          return;
        }

        if (seen.has(value)) {
          return;
        }

        seen.add(value);

        if (Array.isArray(value)) {
          for (
            const item
            of value
          ) {
            inspectObject(
              item,
              score,
              source,
              depth + 1,
              seen
            );
          }

          return;
        }

        for (
          const [
            key,
            child
          ] of Object.entries(
            value
          )
        ) {
          let childScore =
            score;

          const lowerKey =
            key.toLowerCase();

          if (
            lowerKey === "file" ||
            lowerKey === "src"
          ) {
            childScore += 15;
          }

          inspectObject(
            child,
            childScore,
            `${source}.${key}`,
            depth + 1,
            seen
          );
        }
      };

    // ============================================================
    // Locate JW Player instance
    // ============================================================

    const getJWPlayer = () => {
      if (
        typeof window.jwplayer !==
        "function"
      ) {
        return null;
      }

      // Prefer the actual visible player id.
      try {
        const container =
          document.querySelector(
            ".jwplayer[id]"
          );

        if (container?.id) {
          const player =
            window.jwplayer(
              container.id
            );

          if (player) {
            return player;
          }
        }
      } catch (_) {}

      // Fallback to default player.
      try {
        return window.jwplayer();
      } catch (_) {
        return null;
      }
    };

    // ============================================================
    // Scan JW Player API
    // ============================================================

    const scanJWPlayer = () => {
      const player =
        getJWPlayer();

      if (!player) {
        return null;
      }

      // ----------------------------------------------------------
      // Current playlist item
      // ----------------------------------------------------------

      try {
        if (
          typeof player.getPlaylistItem ===
          "function"
        ) {
          const item =
            player.getPlaylistItem();

          if (item) {
            // Current file.
            addCandidate(
              item.file,
              110,
              "jw.getPlaylistItem.file"
            );

            // JW documentation says sources represents the
            // currently utilized source.
            if (
              Array.isArray(
                item.sources
              )
            ) {
              for (
                const source
                of item.sources
              ) {
                addCandidate(
                  source?.file,
                  115,
                  "jw.getPlaylistItem.sources"
                );
              }
            }

            // Lower priority: configured alternatives.
            if (
              Array.isArray(
                item.allSources
              )
            ) {
              for (
                const source
                of item.allSources
              ) {
                addCandidate(
                  source?.file,
                  70,
                  "jw.getPlaylistItem.allSources"
                );
              }
            }

            inspectObject(
              item,
              50,
              "jw.getPlaylistItem"
            );
          }
        }
      } catch (_) {}

      // ----------------------------------------------------------
      // Entire JW playlist
      // ----------------------------------------------------------

      try {
        if (
          typeof player.getPlaylist ===
          "function"
        ) {
          inspectObject(
            player.getPlaylist(),
            45,
            "jw.getPlaylist"
          );
        }
      } catch (_) {}

      return player;
    };

    // ============================================================
    // Scan DOM
    // ============================================================

    const scanDOM = () => {
      for (
        const video
        of document.querySelectorAll(
          "video"
        )
      ) {
        // Strongest evidence.
        addCandidate(
          video.currentSrc,
          130,
          "video.currentSrc"
        );

        addCandidate(
          video.src,
          100,
          "video.src"
        );

        for (
          const source
          of video.querySelectorAll(
            "source[src]"
          )
        ) {
          addCandidate(
            source.src,
            90,
            "video source"
          );
        }
      }
    };

    // ============================================================
    // Scan Performance API
    //
    // An actual network request is very strong evidence that this
    // is the source selected by the player.
    // ============================================================

    const scanPerformance = () => {
      try {
        for (
          const entry
          of performance.getEntriesByType(
            "resource"
          )
        ) {
          addCandidate(
            entry.name,
            125,
            "performance resource"
          );
        }
      } catch (_) {}
    };

    // ============================================================
    // Scan embedded page markup as a low-priority fallback.
    // ============================================================

    const scanHTML = () => {
      try {
        let html =
          document.documentElement
            ?.innerHTML ||
          "";

        // Common JSON escaping.
        html =
          html
            .replace(
              /\\u002[fF]/g,
              "/"
            )
            .replace(
              /\\\//g,
              "/"
            )
            .replace(
              /&amp;/g,
              "&"
            );

        const re =
          /https?:\/\/[^"'<>\\\s]*storagefactory\.io\/midtvest-ovp\/mp4\/[^"'<>\\\s]+?\.mp4(?:\?[^"'<>\\\s]*)?/gi;

        const matches =
          html.match(re) ||
          [];

        for (
          const url
          of matches
        ) {
          addCandidate(
            url,
            20,
            "page HTML"
          );
        }
      } catch (_) {}
    };

    const scanEverything = () => {
      scanDOM();
      scanPerformance();
      scanHTML();

      return scanJWPlayer();
    };

    // ============================================================
    // Watch future network activity
    // ============================================================

    let observer = null;

    try {
      observer =
        new PerformanceObserver(
          list => {
            for (
              const entry
              of list.getEntries()
            ) {
              addCandidate(
                entry.name,
                125,
                "PerformanceObserver"
              );
            }
          }
        );

      observer.observe({
        type: "resource",
        buffered: true
      });
    } catch (_) {
      observer = null;
    }

    // ============================================================
    // Initial scan
    //
    // IMPORTANT:
    // If MP4 is already exposed, nothing else is required.
    // ============================================================

    let player =
      scanEverything();

    let selected =
      bestCandidate();

    // ============================================================
    // Open TV MIDTVEST popover IF needed.
    //
    // Failure here does NOT fail the behavior.
    // Only failure to discover an MP4 eventually does.
    // ============================================================

    if (!selected) {
      let heroButton = null;

      for (
        let i = 0;
        i < 40;
        i++
      ) {
        heroButton =
          document.querySelector(
            HERO_BUTTON
          );

        if (heroButton) {
          break;
        }

        await sleep(250);
      }

      if (heroButton) {
        try {
          heroButton.scrollIntoView({
            block: "center",
            inline: "center"
          });

          await sleep(200);

          heroButton.click();

          yield {
            msg:
              "TV MIDTVEST: video popover initialization triggered"
          };
        } catch (error) {
          yield {
            msg:
              `TV MIDTVEST: hero button click failed, continuing MP4 discovery: ` +
              `${error.message}`
          };
        }
      } else {
        yield {
          msg:
            "TV MIDTVEST: hero button not found; continuing MP4 discovery anyway"
        };
      }
    }

    // ============================================================
    // Discovery loop
    //
    // MP4 DISCOVERY IS THE ONLY SUCCESS REQUIREMENT.
    //
    // Everything below is just stimulation.
    // ============================================================

    const discoveryStarted =
      Date.now();

    let lastStimulate = 0;

    while (
      !selected &&
      Date.now() -
        discoveryStarted <
        MP4_DISCOVERY_TIMEOUT_MS
    ) {
      player =
        scanEverything() ||
        player;

      selected =
        bestCandidate();

      if (selected) {
        break;
      }

      const now =
        Date.now();

      if (
        now -
          lastStimulate >=
        STIMULATE_INTERVAL_MS
      ) {
        lastStimulate =
          now;

        // --------------------------------------------------------
        // JW Player API stimulation
        //
        // State does NOT matter.
        // --------------------------------------------------------

        player =
          getJWPlayer() ||
          player;

        if (player) {
          try {
            if (
              typeof player.setMute ===
              "function"
            ) {
              player.setMute(true);
            }
          } catch (_) {}

          try {
            if (
              typeof player.play ===
              "function"
            ) {
              player.play();
            }
          } catch (_) {}
        }

        // --------------------------------------------------------
        // Native <video> stimulation
        //
        // Failure does NOT matter.
        // --------------------------------------------------------

        for (
          const video
          of document.querySelectorAll(
            "video"
          )
        ) {
          try {
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            video.preload = "auto";

            video.setAttribute(
              "muted",
              ""
            );

            video.setAttribute(
              "playsinline",
              ""
            );

            const promise =
              video.play();

            if (
              promise &&
              typeof promise.catch ===
                "function"
            ) {
              promise.catch(
                () => {}
              );
            }
          } catch (_) {}
        }

        // --------------------------------------------------------
        // JW playback button stimulation
        //
        // Again: we NEVER require aria-label="Pause".
        // --------------------------------------------------------

        try {
          const button =
            document.querySelector(
              JW_PLAYBACK_BUTTON
            );

          const label =
            (
              button?.getAttribute(
                "aria-label"
              ) ||
              ""
            )
              .trim()
              .toLowerCase();

          if (
            button &&
            (
              label === "afspil" ||
              label === "play"
            )
          ) {
            button.click();
          }
        } catch (_) {}
      }

      await sleep(250);
    }

    // Final scan.
    scanEverything();

    selected =
      bestCandidate();

    observer?.disconnect();

    // ============================================================
    // ONLY startup failure condition
    // ============================================================

    if (!selected) {
      yield {
        msg:
          `TV MIDTVEST: FAILED — no storagefactory.io MP4 discovered ` +
          `within ${MP4_DISCOVERY_TIMEOUT_MS / 1000} seconds`
      };

      return;
    }

    const mp4Url =
      selected.url;

    yield {
      msg:
        `TV MIDTVEST: MP4 discovered via ${selected.source}: ${mp4Url}`
    };

    // ============================================================
    // Stop ordinary playback.
    //
    // We now have the URL. Playback state is irrelevant.
    // ============================================================

    try {
      player =
        getJWPlayer() ||
        player;

      if (
        player &&
        typeof player.pause ===
          "function"
      ) {
        player.pause();
      }
    } catch (_) {}

    for (
      const video
      of document.querySelectorAll(
        "video"
      )
    ) {
      try {
        video.pause();
      } catch (_) {}
    }

    // ============================================================
    // Fetch configuration
    //
    // Run in the TV MIDTVEST page context so Chromium supplies
    // the TV MIDTVEST referrer.
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
    // Content-Range parser
    //
    // Example:
    //
    // Content-Range: bytes 0-1048575/287492834
    // ============================================================

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
    // Completely consume one HTTP response.
    //
    // fetch() resolving is NOT sufficient.
    //
    // reader.done === true is our transfer-completion barrier.
    // ============================================================

    const consumeResponse =
      async function* (
        response,
        aggregateOffset = 0
      ) {
        if (!response.body) {
          throw new Error(
            "HTTP response has no readable body"
          );
        }

        const declaredLength =
          Number(
            response.headers.get(
              "content-length"
            ) ||
            0
          );

        if (
          declaredLength >
          MAX_FILE_SIZE
        ) {
          throw new Error(
            `Response exceeds safety limit: ${declaredLength} bytes`
          );
        }

        const reader =
          response.body.getReader();

        let received = 0;

        let nextProgress =
          (
            Math.floor(
              aggregateOffset /
              PROGRESS_BYTES
            ) +
            1
          ) *
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

          const aggregate =
            aggregateOffset +
            received;

          if (
            aggregate >
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
            aggregate >=
            nextProgress
          ) {
            yield {
              msg:
                `TV MIDTVEST: MP4 fetch progress ` +
                `${formatMB(
                  aggregate
                )} MB`
            };

            while (
              aggregate >=
              nextProgress
            ) {
              nextProgress +=
                PROGRESS_BYTES;
            }
          }
        }

        if (
          declaredLength &&
          received !==
            declaredLength
        ) {
          throw new Error(
            `Content-Length=${declaredLength}, ` +
            `but received=${received}`
          );
        }

        return received;
      };

    const drain =
      async function* (
        response,
        aggregateOffset
      ) {
        const generator =
          consumeResponse(
            response,
            aggregateOffset
          );

        let bytes = 0;

        while (true) {
          const step =
            await generator.next();

          if (step.done) {
            bytes =
              step.value;

            break;
          }

          yield step.value;
        }

        return bytes;
      };

    // ============================================================
    // 1. Preferred archival request:
    //
    // plain GET
    //
    // If the CDN returns HTTP 200, this is ideal because Browsertrix
    // records one complete MP4 response.
    // ============================================================

    let normalResponse = null;
    let pageFetchFailure = null;

    try {
      normalResponse =
        await fetch(
          mp4Url,
          baseFetchOptions
        );
    } catch (error) {
      pageFetchFailure =
        error;

      yield {
        msg:
          `TV MIDTVEST: browser-context full GET failed: ` +
          `${error.name}: ${error.message}`
      };
    }

    if (
      normalResponse &&
      normalResponse.status === 200
    ) {
      const contentLength =
        Number(
          normalResponse.headers.get(
            "content-length"
          ) ||
          0
        );

      yield {
        msg:
          `TV MIDTVEST: HTTP 200 full MP4 response` +
          (
            contentLength
              ? `, ${formatMB(
                  contentLength
                )} MB`
              : ""
          )
      };

      const generator =
        drain(
          normalResponse,
          0
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
            `TV MIDTVEST: full MP4 transfer failed: ${error.message}`
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
          `TV MIDTVEST: COMPLETE — full HTTP 200 MP4 archived, ` +
          `${received} bytes (${formatMB(
            received
          )} MB); behavior ending`
      };

      return;
    }

    // If normal GET returned something other than 200, don't waste
    // bandwidth reading an unwanted partial response.
    if (
      normalResponse &&
      normalResponse.body
    ) {
      try {
        await normalResponse.body.cancel();
      } catch (_) {}
    }

    // ============================================================
    // 2. Progressive MP4 range mode
    //
    // Explicit:
    //
    // Range: bytes=0-
    //
    // This means byte zero through EOF.
    //
    // If the CDN returns a smaller explicit Content-Range, continue
    // exactly where that response stopped.
    // ============================================================

    yield {
      msg:
        "TV MIDTVEST: attempting explicit byte-range archival"
    };

    let nextByte = 0;
    let knownTotal = null;
    let aggregateReceived = 0;
    let rangeNumber = 0;

    let rangeModeStarted =
      false;

    while (true) {
      rangeNumber++;

      const range =
        `bytes=${nextByte}-`;

      let response;

      try {
        response =
          await fetch(
            mp4Url,
            {
              ...baseFetchOptions,

              headers: {
                Range:
                  range
              }
            }
          );

        rangeModeStarted =
          true;
      } catch (error) {
        pageFetchFailure =
          error;

        yield {
          msg:
            `TV MIDTVEST: range request failed: ` +
            `${error.name}: ${error.message}`
        };

        break;
      }

      // ----------------------------------------------------------
      // Server ignored Range and sent entire representation.
      //
      // This is actually ideal.
      // ----------------------------------------------------------

      if (
        response.status === 200
      ) {
        yield {
          msg:
            "TV MIDTVEST: CDN ignored Range and returned HTTP 200 full MP4"
        };

        const generator =
          drain(
            response,
            0
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
              `TV MIDTVEST: HTTP 200 MP4 read failed: ${error.message}`
          };

          return;
        }

        aggregateReceived =
          received;

        knownTotal =
          Number(
            response.headers.get(
              "content-length"
            ) ||
            received
          );

        break;
      }

      if (
        response.status !== 206
      ) {
        yield {
          msg:
            `TV MIDTVEST: unexpected HTTP ${response.status} ` +
            `for ${range}`
        };

        break;
      }

      const contentRange =
        parseContentRange(
          response.headers.get(
            "content-range"
          )
        );

      // ----------------------------------------------------------
      // If Content-Range is exposed, we can prove exact coverage.
      // ----------------------------------------------------------

      if (contentRange) {
        if (
          contentRange.start !==
          nextByte
        ) {
          yield {
            msg:
              `TV MIDTVEST: INCOMPLETE — requested byte ${nextByte}, ` +
              `server started at ${contentRange.start}`
          };

          return;
        }

        if (
          contentRange.total !==
          null
        ) {
          knownTotal =
            contentRange.total;

          if (
            knownTotal >
            MAX_FILE_SIZE
          ) {
            yield {
              msg:
                `TV MIDTVEST: MP4 exceeds safety limit: ` +
                `${knownTotal} bytes`
            };

            return;
          }

          if (
            rangeNumber === 1
          ) {
            yield {
              msg:
                `TV MIDTVEST: MP4 size ${knownTotal} bytes ` +
                `(${formatMB(
                  knownTotal
                )} MB)`
            };
          }
        }

        const expectedLength =
          contentRange.end -
          contentRange.start +
          1;

        const generator =
          drain(
            response,
            aggregateReceived
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
              `TV MIDTVEST: range body failed: ${error.message}`
          };

          return;
        }

        if (
          received !==
          expectedLength
        ) {
          yield {
            msg:
              `TV MIDTVEST: INCOMPLETE RANGE — ` +
              `expected ${expectedLength} bytes, received ${received}`
          };

          return;
        }

        aggregateReceived +=
          received;

        nextByte =
          contentRange.end +
          1;

        yield {
          msg:
            `TV MIDTVEST: archived byte range ` +
            `${contentRange.start}-${contentRange.end}` +
            (
              knownTotal
                ? ` / ${knownTotal - 1}`
                : ""
            )
        };

        if (
          knownTotal !== null &&
          nextByte >=
            knownTotal
        ) {
          break;
        }

        // CDN returned only part of our open-ended request.
        // Continue at the exact next byte.
        continue;
      }

      // ----------------------------------------------------------
      // Content-Range may be hidden by CORS response-header rules.
      //
      // But this request was explicitly:
      //
      // Range: bytes=N-
      //
      // Consume the response all the way to EOF.
      // ----------------------------------------------------------

      yield {
        msg:
          `TV MIDTVEST: HTTP 206 for ${range}; ` +
          `Content-Range not exposed, consuming open-ended range to EOF`
      };

      const generator =
        drain(
          response,
          aggregateReceived
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
            `TV MIDTVEST: byte-range transfer failed: ${error.message}`
        };

        return;
      }

      aggregateReceived +=
        received;

      // An explicit open-ended range N- represents N through EOF.
      // With no visible Content-Range there is no further byte
      // boundary available to request.
      break;
    }

    // ============================================================
    // Successful page-context range capture
    // ============================================================

    if (
      rangeModeStarted &&
      aggregateReceived > 0
    ) {
      if (
        knownTotal !== null &&
        aggregateReceived !==
          knownTotal
      ) {
        yield {
          msg:
            `TV MIDTVEST: INCOMPLETE — expected ${knownTotal} bytes, ` +
            `archived ${aggregateReceived}`
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
          `TV MIDTVEST: COMPLETE — MP4 byte coverage archived, ` +
          `${aggregateReceived} bytes ` +
          `(${formatMB(
            aggregateReceived
          )} MB); behavior ending`
      };

      return;
    }

    // ============================================================
    // 3. Browsertrix external-fetch fallback
    //
    // Useful primarily when browser-context fetch() is blocked
    // by CORS.
    //
    // Browsertrix's autoplay/autofetch system uses this same
    // external-fetch mechanism for discovered media resources.
    // ============================================================

    if (
      typeof doExternalFetch ===
      "function"
    ) {
      yield {
        msg:
          "TV MIDTVEST: page-context fetch unavailable; trying Browsertrix external fetch"
      };

      let success = false;

      try {
        success =
          await doExternalFetch(
            mp4Url
          );
      } catch (error) {
        yield {
          msg:
            `TV MIDTVEST: Browsertrix external fetch exception: ` +
            `${error.message}`
        };
      }

      if (success) {
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
            "TV MIDTVEST: COMPLETE — Browsertrix external MP4 fetch completed; behavior ending"
        };

        return;
      }
    }

    // ============================================================
    // MP4 discovery succeeded, but complete archival did not.
    // ============================================================

    yield {
      msg:
        `TV MIDTVEST: MP4 DISCOVERED but complete archive fetch failed` +
        (
          pageFetchFailure
            ? `: ${pageFetchFailure.name}: ${pageFetchFailure.message}`
            : ""
        )
    };
  }
}
