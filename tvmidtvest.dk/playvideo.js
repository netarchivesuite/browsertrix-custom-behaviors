class TVMidtvestHLSArchive {
  static id = "TVMidtvestHLSArchive-v2";

  static isMatch() {
    return /(^|\.)tvmidtvest\.dk$/i.test(
      window.location.hostname
    );
  }

  static init() {
    return {};
  }

  // Current Browsertrix docs use singular runInIframe.
  // Keeping plural too does no harm with older/custom setups.
  static runInIframe = false;
  static runInIframes = false;

  async* run(ctx) {
    const {
      sleep,
      doExternalFetch,
      waitForNetworkIdle
    } = ctx.Lib;

    // ============================================================
    // Configuration
    // ============================================================

    const HERO_BUTTON =
      "button.tv-hero-play-button";

    // How long to wait for JW Player to expose an HLS manifest.
    const DISCOVERY_MS = 15000;

    // Number of media resources fetched simultaneously.
    const FETCH_CONCURRENCY = 8;

    // Retry failed Browsertrix external fetches.
    const FETCH_RETRIES = 3;

    // false:
    //   Archive the rendition JW Player actually selected.
    //
    // If only a master playlist is discovered:
    //   choose highest-bandwidth video + associated audio/subtitles.
    //
    // true:
    //   Fetch ALL quality variants.
    //
    // Usually leave this false. Otherwise a 1080p/720p/480p/360p
    // HLS stream may be downloaded four times.
    const FETCH_ALL_VARIANTS = false;

    // Safety limit for EVENT/live playlists which have not yet
    // received #EXT-X-ENDLIST.
    const DYNAMIC_PLAYLIST_MAX_MS =
      4 * 60 * 60 * 1000;

    // ============================================================
    // State
    // ============================================================

    const observedM3U8 = new Set();

    // ============================================================
    // Helpers
    // ============================================================

    const absoluteUrl = (value, base) => {
      try {
        return new URL(value, base).href;
      } catch (_) {
        return null;
      }
    };

    const isM3U8 = url =>
      /\.m3u8(?:$|[?#])/i.test(url || "");

    // ------------------------------------------------------------
    // Parse HLS attribute lists:
    //
    // BANDWIDTH=1234567,AUDIO="audio-1",...
    // ------------------------------------------------------------

    const parseAttributes = line => {
      const result = {};

      const colon = line.indexOf(":");

      const text =
        colon >= 0
          ? line.slice(colon + 1)
          : line;

      const re =
        /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;

      let match;

      while ((match = re.exec(text))) {
        let value = match[2].trim();

        if (
          value.startsWith('"') &&
          value.endsWith('"')
        ) {
          value = value.slice(1, -1);
        }

        result[
          match[1].toUpperCase()
        ] = value;
      }

      return result;
    };

    const getUriAttribute = line => {
      const attributes =
        parseAttributes(line);

      return attributes.URI || null;
    };

    // ============================================================
    // Observe network requests for .m3u8
    // ============================================================

    const collectPerformanceM3U8 = () => {
      const resources =
        performance.getEntriesByType(
          "resource"
        );

      for (const resource of resources) {
        if (isM3U8(resource.name)) {
          observedM3U8.add(
            resource.name
          );
        }
      }
    };

    const observer =
      new PerformanceObserver(list => {
        for (
          const entry of list.getEntries()
        ) {
          if (isM3U8(entry.name)) {
            observedM3U8.add(
              entry.name
            );
          }
        }
      });

    try {
      observer.observe({
        type: "resource",
        buffered: true
      });
    } catch (_) {
      try {
        observer.observe({
          entryTypes: ["resource"]
        });
      } catch (_) {
        // Polling performance entries still works.
      }
    }

    // ============================================================
    // Read playlist
    //
    // This is required because doExternalFetch() deliberately only
    // tells us whether the crawler fetch succeeded; it does not
    // return the response body.
    // ============================================================

    const fetchPlaylistText =
      async url => {

        const response =
          await fetch(url, {
            credentials: "include",

            // We want the actual playlist content,
            // not a possibly stale browser cache entry.
            cache: "no-store"
          });

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status} for ${url}`
          );
        }

        return await response.text();
      };

    // ============================================================
    // Parse MASTER playlist
    // ============================================================

    const parseMaster =
      (text, baseUrl) => {

        const lines = text
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);

        const variants = [];
        const renditions = [];
        const support = [];

        for (
          let i = 0;
          i < lines.length;
          i++
        ) {
          const line = lines[i];

          // ------------------------------------------------------
          // Video variant
          // ------------------------------------------------------

          if (
            line.startsWith(
              "#EXT-X-STREAM-INF:"
            )
          ) {
            const attributes =
              parseAttributes(line);

            let j = i + 1;

            // Find following URI.
            while (
              j < lines.length &&
              lines[j].startsWith("#")
            ) {
              j++;
            }

            if (j < lines.length) {
              const url =
                absoluteUrl(
                  lines[j],
                  baseUrl
                );

              if (url) {
                variants.push({
                  url,

                  bandwidth:
                    Number(
                      attributes.BANDWIDTH ||
                      attributes[
                        "AVERAGE-BANDWIDTH"
                      ] ||
                      0
                    ),

                  audioGroup:
                    attributes.AUDIO ||
                    null,

                  subtitlesGroup:
                    attributes.SUBTITLES ||
                    null
                });
              }
            }

            continue;
          }

          // ------------------------------------------------------
          // Separate audio/subtitles
          // ------------------------------------------------------

          if (
            line.startsWith(
              "#EXT-X-MEDIA:"
            )
          ) {
            const attributes =
              parseAttributes(line);

            const url =
              attributes.URI
                ? absoluteUrl(
                    attributes.URI,
                    baseUrl
                  )
                : null;

            if (url) {
              renditions.push({
                url,

                type:
                  (
                    attributes.TYPE ||
                    ""
                  ).toUpperCase(),

                groupId:
                  attributes[
                    "GROUP-ID"
                  ] || null,

                name:
                  attributes.NAME || "",

                isDefault:
                  (
                    attributes.DEFAULT ||
                    ""
                  ).toUpperCase() ===
                  "YES",

                autoselect:
                  (
                    attributes.AUTOSELECT ||
                    ""
                  ).toUpperCase() ===
                  "YES"
              });
            }

            continue;
          }

          // ------------------------------------------------------
          // Master-level encryption/session resources
          // ------------------------------------------------------

          if (
            line.startsWith(
              "#EXT-X-SESSION-KEY:"
            ) ||
            line.startsWith(
              "#EXT-X-SESSION-DATA:"
            )
          ) {
            const uri =
              getUriAttribute(line);

            if (uri) {
              const url =
                absoluteUrl(
                  uri,
                  baseUrl
                );

              if (url) {
                support.push(url);
              }
            }
          }
        }

        return {
          variants,
          renditions,
          support
        };
      };

    // ============================================================
    // Parse MEDIA playlist
    // ============================================================

    const parseMedia =
      (text, baseUrl) => {

        const lines = text
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);

        const segments = [];
        const support = [];

        let targetDuration = 2;

        for (const line of lines) {

          // ------------------------------------------------------
          // Playlist refresh timing
          // ------------------------------------------------------

          if (
            line.startsWith(
              "#EXT-X-TARGETDURATION:"
            )
          ) {
            const value =
              Number(
                line.split(":", 2)[1]
              );

            if (
              Number.isFinite(value) &&
              value > 0
            ) {
              targetDuration = value;
            }

            continue;
          }

          // ------------------------------------------------------
          // Encryption keys
          // fMP4 init segments
          // Low-latency HLS parts
          // ------------------------------------------------------

          if (
            line.startsWith(
              "#EXT-X-KEY:"
            ) ||
            line.startsWith(
              "#EXT-X-MAP:"
            ) ||
            line.startsWith(
              "#EXT-X-PART:"
            )
          ) {
            const uri =
              getUriAttribute(line);

            if (
              uri &&
              !uri.startsWith("data:")
            ) {
              const url =
                absoluteUrl(
                  uri,
                  baseUrl
                );

              if (url) {
                support.push(url);
              }
            }

            continue;
          }

          // HLS comments/instructions.
          if (line.startsWith("#")) {
            continue;
          }

          // Everything else is a media URI.
          const url =
            absoluteUrl(
              line,
              baseUrl
            );

          if (url) {
            segments.push(url);
          }
        }

        return {
          endList:
            lines.includes(
              "#EXT-X-ENDLIST"
            ),

          targetDuration,

          segments,
          support
        };
      };

    // ============================================================
    // Browsertrix external fetch
    // ============================================================

    const archiveOne =
      async url => {

        for (
          let attempt = 1;
          attempt <= FETCH_RETRIES;
          attempt++
        ) {
          try {
            const success =
              await doExternalFetch(
                url
              );

            if (success) {
              return true;
            }
          } catch (_) {
            // retry below
          }

          if (
            attempt <
            FETCH_RETRIES
          ) {
            await sleep(
              500 * attempt
            );
          }
        }

        return false;
      };

    // ============================================================
    // Fetch resource list in controlled batches
    // ============================================================

    const archiveList =
      async function* (
        urls,
        label
      ) {
        const unique =
          [...new Set(urls)];

        let successful = 0;

        const failed = [];

        for (
          let offset = 0;
          offset < unique.length;
          offset += FETCH_CONCURRENCY
        ) {
          const batch =
            unique.slice(
              offset,
              offset +
                FETCH_CONCURRENCY
            );

          const results =
            await Promise.all(
              batch.map(
                async url => ({
                  url,

                  ok:
                    await archiveOne(
                      url
                    )
                })
              )
            );

          for (
            const result of results
          ) {
            if (result.ok) {
              successful++;
            } else {
              failed.push(
                result.url
              );
            }
          }

          yield {
            msg:
              `TV MIDTVEST: ${label} ` +
              `${Math.min(
                offset +
                  batch.length,
                unique.length
              )}/${unique.length} fetched`
          };
        }

        return {
          total:
            unique.length,

          successful,

          failed
        };
      };

    // ============================================================
    // 1. Open TV MIDTVEST video player
    // ============================================================

    const button =
      document.querySelector(
        HERO_BUTTON
      );

    if (!button) {
      observer.disconnect();

      yield {
        msg:
          "TV MIDTVEST: no hero video button found"
      };

      return;
    }

    button.scrollIntoView({
      block: "center"
    });

    await sleep(300);

    button.click();

    yield {
      msg:
        "TV MIDTVEST: player opened; looking for HLS manifest"
    };

    // ============================================================
    // 2. Wait for JW Player to request .m3u8
    // ============================================================

    const discoveryStarted =
      Date.now();

    let triedMutedPlay = false;

    while (
      Date.now() -
        discoveryStarted <
      DISCOVERY_MS
    ) {
      collectPerformanceM3U8();

      if (
        observedM3U8.size > 0
      ) {
        // Give JW a little longer so separate audio/video
        // playlists also appear.
        await sleep(1500);

        collectPerformanceM3U8();

        break;
      }

      // Some JW configurations don't request the actual manifest
      // until play() has been attempted.
      //
      // We do NOT care whether playback succeeds.
      const video =
        document.querySelector(
          "video"
        );

      if (
        video &&
        !triedMutedPlay
      ) {
        triedMutedPlay = true;

        video.muted = true;
        video.defaultMuted = true;

        try {
          await video.play();
        } catch (_) {
          // Expected in some Browsertrix/JW configurations.
          //
          // The only purpose is to make JW expose the stream.
        }
      }

      await sleep(250);
    }

    collectPerformanceM3U8();

    observer.disconnect();

    // ============================================================
    // 3. Stop actual playback
    //
    // From here forward we fetch the stream ourselves.
    // ============================================================

    const video =
      document.querySelector(
        "video"
      );

    if (
      video &&
      !video.paused
    ) {
      try {
        video.pause();
      } catch (_) {}
    }

    if (
      !observedM3U8.size
    ) {
      yield {
        msg:
          "TV MIDTVEST: no .m3u8 request discovered"
      };

      return;
    }

    yield {
      msg:
        `TV MIDTVEST: discovered ` +
        `${observedM3U8.size} HLS playlist request(s)`
    };

    // ============================================================
    // 4. Read observed playlists
    // ============================================================

    const playlistInfo =
      new Map();

    for (
      const url of observedM3U8
    ) {
      try {
        const text =
          await fetchPlaylistText(
            url
          );

        const isMaster =
          /#EXT-X-STREAM-INF:/i.test(
            text
          );

        playlistInfo.set(
          url,
          {
            url,
            text,
            isMaster
          }
        );
      } catch (error) {
        yield {
          msg:
            `TV MIDTVEST: could not read playlist ` +
            `${url}: ${error.message}`
        };
      }
    }

    const observedMedia =
      [...playlistInfo.values()]
        .filter(
          playlist =>
            !playlist.isMaster
        );

    const observedMasters =
      [...playlistInfo.values()]
        .filter(
          playlist =>
            playlist.isMaster
        );

    // ============================================================
    // 5. Decide which rendition(s) to archive
    // ============================================================

    const mediaPlaylistUrls =
      new Set(
        observedMedia.map(
          playlist =>
            playlist.url
        )
      );

    const manifestUrls =
      new Set(
        observedM3U8
      );

    const masterSupport =
      new Set();

    // If JW already requested a media playlist, that's the best
    // indication of the actual rendition in use.
    //
    // Only fall back to master-playlist selection if JW didn't.
    if (
      !mediaPlaylistUrls.size
    ) {
      for (
        const master
        of observedMasters
      ) {
        const parsed =
          parseMaster(
            master.text,
            master.url
          );

        parsed.support.forEach(
          url =>
            masterSupport.add(
              url
            )
        );

        // --------------------------------------------------------
        // Optional mode: archive every quality.
        // --------------------------------------------------------

        if (
          FETCH_ALL_VARIANTS
        ) {
          parsed.variants.forEach(
            variant =>
              mediaPlaylistUrls.add(
                variant.url
              )
          );

          parsed.renditions.forEach(
            rendition =>
              mediaPlaylistUrls.add(
                rendition.url
              )
          );

          continue;
        }

        // --------------------------------------------------------
        // Default:
        // highest bandwidth video.
        // --------------------------------------------------------

        const variant =
          [...parsed.variants]
            .sort(
              (a, b) =>
                b.bandwidth -
                a.bandwidth
            )[0];

        if (!variant) {
          continue;
        }

        mediaPlaylistUrls.add(
          variant.url
        );

        // --------------------------------------------------------
        // Associated audio
        // --------------------------------------------------------

        if (
          variant.audioGroup
        ) {
          const audio =
            parsed.renditions
              .filter(
                rendition =>
                  rendition.type ===
                    "AUDIO" &&
                  rendition.groupId ===
                    variant.audioGroup
              );

          const chosen =
            audio.find(
              rendition =>
                rendition.isDefault
            ) ||
            audio.find(
              rendition =>
                rendition.autoselect
            ) ||
            audio[0];

          if (chosen) {
            mediaPlaylistUrls.add(
              chosen.url
            );
          }
        }

        // --------------------------------------------------------
        // Associated subtitles
        // --------------------------------------------------------

        if (
          variant.subtitlesGroup
        ) {
          const subtitles =
            parsed.renditions
              .filter(
                rendition =>
                  rendition.type ===
                    "SUBTITLES" &&
                  rendition.groupId ===
                    variant.subtitlesGroup
              );

          const chosen =
            subtitles.find(
              rendition =>
                rendition.isDefault
            ) ||
            subtitles.find(
              rendition =>
                rendition.autoselect
            ) ||
            subtitles[0];

          if (chosen) {
            mediaPlaylistUrls.add(
              chosen.url
            );
          }
        }
      }
    }

    if (
      !mediaPlaylistUrls.size
    ) {
      yield {
        msg:
          "TV MIDTVEST: HLS found, but no media playlist could be selected"
      };

      return;
    }

    yield {
      msg:
        `TV MIDTVEST: tracking ` +
        `${mediaPlaylistUrls.size} active/selected media playlist(s)`
    };

    // ============================================================
    // 6. Parse media playlists
    // ============================================================

    const allSupport =
      new Set(masterSupport);

    const allSegments =
      new Set();

    const mediaStates =
      new Map();

    const loadMediaPlaylist =
      async url => {

        const text =
          await fetchPlaylistText(
            url
          );

        manifestUrls.add(url);

        const parsed =
          parseMedia(
            text,
            url
          );

        mediaStates.set(
          url,
          parsed
        );

        parsed.support.forEach(
          resource =>
            allSupport.add(
              resource
            )
        );

        parsed.segments.forEach(
          segment =>
            allSegments.add(
              segment
            )
        );

        return parsed;
      };

    for (
      const url
      of mediaPlaylistUrls
    ) {
      try {
        await loadMediaPlaylist(
          url
        );
      } catch (error) {
        yield {
          msg:
            `TV MIDTVEST: failed to read media playlist ` +
            `${url}: ${error.message}`
        };

        return;
      }
    }

    // ============================================================
    // 7. If this is EVENT/live HLS, wait for ENDLIST
    //
    // Normal TV MIDTVEST article videos should already have
    // #EXT-X-ENDLIST.
    //
    // But if the playlist is still growing, refresh it until it
    // becomes finite.
    // ============================================================

    const dynamicStarted =
      Date.now();

    while (
      [...mediaStates.values()]
        .some(
          state =>
            !state.endList
        )
    ) {
      if (
        Date.now() -
          dynamicStarted >
        DYNAMIC_PLAYLIST_MAX_MS
      ) {
        yield {
          msg:
            "TV MIDTVEST: dynamic HLS did not reach #EXT-X-ENDLIST before safety cap"
        };

        return;
      }

      const pending =
        [...mediaStates.entries()]
          .filter(
            ([, state]) =>
              !state.endList
          );

      const waitSeconds =
        Math.max(
          1,

          Math.min(
            ...pending.map(
              ([, state]) =>
                state.targetDuration ||
                2
            )
          )
        );

      await sleep(
        waitSeconds * 1000
      );

      for (
        const [url]
        of pending
      ) {
        const before =
          allSegments.size;

        try {
          const state =
            await loadMediaPlaylist(
              url
            );

          const added =
            allSegments.size -
            before;

          yield {
            msg:
              `TV MIDTVEST: refreshed HLS playlist; ` +
              `${added} new segment(s), ` +
              `endList=${state.endList}`
          };
        } catch (error) {
          yield {
            msg:
              `TV MIDTVEST: playlist refresh failed ` +
              `${url}: ${error.message}`
          };
        }
      }
    }

    // ============================================================
    // We now know the complete finite stream.
    // ============================================================

    yield {
      msg:
        `TV MIDTVEST: complete finite HLS manifest found — ` +
        `${allSegments.size} segment URL(s), ` +
        `${allSupport.size} key/init/support URL(s)`
    };

    // ============================================================
    // 8. Archive manifests, keys, init segments etc.
    // ============================================================

    const preliminary = [
      ...manifestUrls,
      ...allSupport
    ];

    const preliminaryGenerator =
      archiveList(
        preliminary,
        "manifest/support resources"
      );

    let preliminaryResult =
      null;

    while (true) {
      const step =
        await preliminaryGenerator.next();

      if (step.done) {
        preliminaryResult =
          step.value;

        break;
      }

      yield step.value;
    }

    if (
      preliminaryResult.failed
        .length
    ) {
      yield {
        msg:
          `TV MIDTVEST: INCOMPLETE — ` +
          `${preliminaryResult.failed.length} ` +
          `manifest/support resource(s) failed`
      };

      return;
    }

    // ============================================================
    // 9. Put segments in playlist order where possible.
    //
    // Batches are sequential:
    //
    // batch 1 must finish
    // before batch 2 starts
    //
    // ...
    //
    // Therefore once the FINAL batch resolves we know every
    // previous segment fetch has also resolved.
    // ============================================================

    const orderedSegments = [];
    const seenSegment =
      new Set();

    for (
      const state
      of mediaStates.values()
    ) {
      for (
        const url
        of state.segments
      ) {
        if (
          !seenSegment.has(url)
        ) {
          seenSegment.add(url);

          orderedSegments.push(
            url
          );
        }
      }
    }

    // In an EVENT playlist older segments can disappear from the
    // sliding window before ENDLIST. Keep anything discovered on
    // previous refreshes too.
    for (
      const url
      of allSegments
    ) {
      if (
        !seenSegment.has(url)
      ) {
        seenSegment.add(url);

        orderedSegments.push(
          url
        );
      }
    }

    // ============================================================
    // 10. Archive ALL HLS segments
    // ============================================================

    const segmentGenerator =
      archiveList(
        orderedSegments,
        "HLS segments"
      );

    let segmentResult = null;

    while (true) {
      const step =
        await segmentGenerator.next();

      if (step.done) {
        segmentResult =
          step.value;

        break;
      }

      yield step.value;
    }

    // ============================================================
    // 11. Don't falsely report complete if any segment failed.
    // ============================================================

    if (
      segmentResult.failed.length
    ) {
      yield {
        msg:
          `TV MIDTVEST: INCOMPLETE — ` +
          `${segmentResult.failed.length}/` +
          `${segmentResult.total} segment(s) ` +
          `failed after ${FETCH_RETRIES} attempts`
      };

      return;
    }

    // ============================================================
    // 12. Final Browsertrix network barrier
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
    // 13. DONE
    //
    // Reaching here means:
    //
    // - playlist ended with ENDLIST
    // - every listed media segment was enumerated
    // - every segment doExternalFetch() resolved successfully
    // - all keys/init files were fetched
    // - Browsertrix network became idle
    //
    // No need to wait for JW playback.
    // ============================================================

    yield {
      msg:
        `TV MIDTVEST: COMPLETE — all ` +
        `${segmentResult.total} HLS segment(s) ` +
        `plus manifests/support resources fetched; ` +
        `behavior ending now`
    };
  }
}
