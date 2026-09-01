class TVMidtvestKalturaYtDlpBehavior {
  static id = "tvmidtvest-kaltura-ytdlp";
  static runInIframes = true;

  static init() {
    return {
      state: {
        playButtonFound: false,
        playButtonClicked: false,
        popoverOpened: false,
        playerChangeDetected: false,
        entriesFound: 0,
        mp4sFound: 0,
        fetched: 0,
      },
      opts: {},
    };
  }

  static isMatch() {
    const host = String(location.hostname || "").toLowerCase();
    const ref = String(document.referrer || "").toLowerCase();

    return (
      host === "tvmidtvest.dk" ||
      host.endsWith(".tvmidtvest.dk") ||
      host.includes("kaltura") ||
      ref.includes("tvmidtvest.dk")
    );
  }

  async *run(ctx) {
    const {
      getState,
      sleep,
      doExternalFetch,
      addLink,
    } = ctx.Lib;

    const DEFAULT_PARTNER_ID = "1953371";

    const isTop =
      window.top === window;

    const entries =
      new Map();

    const directMedia =
      new Map();


    // ============================================================
    // Helpers
    // ============================================================

    function cleanUrl(raw) {
      if (!raw) {
        return null;
      }

      try {
        return new URL(
          String(raw).trim(),
          document.baseURI
        ).href;
      } catch (_) {
        return null;
      }
    }


    function addDirectMedia(
      rawUrl,
      source
    ) {
      const url =
        cleanUrl(rawUrl);

      if (!url) {
        return;
      }

      if (
        !/^https?:/i.test(url)
      ) {
        return;
      }

      const lower =
        url.toLowerCase();

      let type = null;

      if (
        /\.mp4(?:$|[?#])/i.test(lower)
      ) {
        type = "mp4";
      } else if (
        /\.m3u8(?:$|[?#])/i.test(lower)
      ) {
        type = "hls";
      } else if (
        /\.mpd(?:$|[?#])/i.test(lower)
      ) {
        type = "dash";
      }

      if (!type) {
        return;
      }

      if (
        !directMedia.has(url)
      ) {
        directMedia.set(
          url,
          {
            url,
            type,
            source,
          }
        );
      }
    }


    function cleanPartnerId(value) {
      const v =
        String(value || "")
          .replace(/^_/, "")
          .trim();

      return /^\d+$/.test(v)
        ? v
        : null;
    }


    function cleanEntryId(value) {
      const v =
        String(value || "")
          .trim();

      return /^\d_[A-Za-z0-9]+$/.test(v)
        ? v
        : null;
    }


    function addEntry(
      partnerId,
      entryId,
      source
    ) {
      const p =
        cleanPartnerId(
          partnerId
        );

      const e =
        cleanEntryId(
          entryId
        );

      if (!p || !e) {
        return;
      }

      const key =
        `${p}:${e}`;

      if (
        entries.has(key)
      ) {
        return;
      }

      entries.set(
        key,
        {
          partnerId: p,
          entryId: e,
          source,
        }
      );
    }


    // ============================================================
    // STEP 1
    //
    // WAIT FOR + CLICK TV MIDTVEST PLAY BUTTON
    // ============================================================

    if (isTop) {
      yield getState(
        ctx,
        "TV MIDTVEST: waiting for hero play button"
      );


      let playButton =
        null;


      // Wait up to 15 seconds.
      for (
        let i = 0;
        i < 60;
        i++
      ) {
        playButton =
          document.querySelector(
            "button.tv-hero-play-button"
          );

        if (playButton) {
          break;
        }

        await sleep(250);
      }


      if (!playButton) {
        yield getState(
          ctx,
          "TV MIDTVEST: FAILED - hero play button not found"
        );

        return;
      }


      ctx.state.playButtonFound =
        true;


      yield getState(
        ctx,
        "TV MIDTVEST: hero play button found"
      );


      // ----------------------------------------------------------
      // Snapshot state BEFORE click
      // ----------------------------------------------------------

      const resourcesBefore =
        new Set(
          performance
            .getEntriesByType(
              "resource"
            )
            .map(
              entry =>
                entry.name
            )
        );


      const iframeCountBefore =
        document.querySelectorAll(
          "iframe"
        ).length;


      const videoCountBefore =
        document.querySelectorAll(
          "video"
        ).length;


      let popoverBefore =
        document.querySelector(
          "#video-popover"
        );


      const popoverHTMLBefore =
        popoverBefore
          ? popoverBefore.innerHTML
          : null;


      // ----------------------------------------------------------
      // Scroll button into view
      // ----------------------------------------------------------

      try {
        playButton.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "instant",
        });
      } catch (_) {
        try {
          playButton.scrollIntoView();
        } catch (_) {}
      }


      await sleep(500);


      // ----------------------------------------------------------
      // CLICK ONCE
      //
      // This is the important missing operation.
      // ----------------------------------------------------------

      yield getState(
        ctx,
        "TV MIDTVEST: clicking hero play button"
      );


      try {
        playButton.click();

        ctx.state.playButtonClicked =
          true;
      } catch (e) {
        yield getState(
          ctx,
          `TV MIDTVEST: play button click failed: ${
            e &&
            e.message
              ? e.message
              : e
          }`
        );

        return;
      }


      // ==========================================================
      // STEP 2
      //
      // WAIT FOR POPOVER / PLAYER / NETWORK CHANGE
      // ==========================================================

      yield getState(
        ctx,
        "TV MIDTVEST: waiting for video popover/player to initialize"
      );


      let changeReason =
        null;


      // Up to 20 seconds after click.
      for (
        let attempt = 0;
        attempt < 80;
        attempt++
      ) {
        const popover =
          document.querySelector(
            "#video-popover"
          );


        // --------------------------------------------------------
        // Has popover opened?
        // --------------------------------------------------------

        if (popover) {
          let open =
            false;

          try {
            open =
              popover.matches(
                ":popover-open"
              );
          } catch (_) {}


          // Alpine / CSS fallback.
          if (
            open ||
            popover.hasAttribute(
              "open"
            ) ||
            popover.getAttribute(
              "aria-hidden"
            ) === "false"
          ) {
            ctx.state.popoverOpened =
              true;
          }


          // Content of existing popover changed.
          if (
            popoverHTMLBefore !== null &&
            popover.innerHTML !==
              popoverHTMLBefore
          ) {
            changeReason =
              "video-popover DOM changed";
          }
        }


        // --------------------------------------------------------
        // New iframe?
        // --------------------------------------------------------

        const iframeCount =
          document.querySelectorAll(
            "iframe"
          ).length;


        if (
          iframeCount >
          iframeCountBefore
        ) {
          changeReason =
            `new iframe created (${iframeCountBefore} -> ${iframeCount})`;
        }


        // --------------------------------------------------------
        // New <video>?
        // --------------------------------------------------------

        const videoCount =
          document.querySelectorAll(
            "video"
          ).length;


        if (
          videoCount >
          videoCountBefore
        ) {
          changeReason =
            `new video element created (${videoCountBefore} -> ${videoCount})`;
        }


        // --------------------------------------------------------
        // New media/player network requests?
        // --------------------------------------------------------

        const resourcesNow =
          performance.getEntriesByType(
            "resource"
          );


        for (
          const entry
          of resourcesNow
        ) {
          const url =
            entry.name;


          if (
            resourcesBefore.has(
              url
            )
          ) {
            continue;
          }


          if (
            /kaltura|video|player|manifest|m3u8|mpd|mp4|flavor|playlist/i.test(
              url
            )
          ) {
            changeReason =
              `new player/network resource: ${url}`;

            break;
          }
        }


        if (changeReason) {
          break;
        }


        await sleep(250);
      }


      if (changeReason) {
        ctx.state.playerChangeDetected =
          true;

        yield getState(
          ctx,
          `TV MIDTVEST: player initialized - ${changeReason}`
        );
      } else {
        yield getState(
          ctx,
          "TV MIDTVEST: no obvious player change detected yet; continuing extraction anyway"
        );
      }


      // Give JS player another moment after the first mutation.
      await sleep(2000);


      // ==========================================================
      // STEP 3
      //
      // LOG WHAT ACTUALLY APPEARED
      // ==========================================================

      for (
        const iframe
        of document.querySelectorAll(
          "iframe"
        )
      ) {
        if (iframe.src) {
          yield getState(
            ctx,
            `TV MIDTVEST: iframe after click: ${iframe.src}`
          );
        }
      }


      for (
        const video
        of document.querySelectorAll(
          "video"
        )
      ) {
        if (video.currentSrc) {
          yield getState(
            ctx,
            `TV MIDTVEST: video.currentSrc after click: ${video.currentSrc}`
          );
        }

        if (video.src) {
          yield getState(
            ctx,
            `TV MIDTVEST: video.src after click: ${video.src}`
          );
        }
      }
    }


    // ============================================================
    // STEP 4
    //
    // Scan resulting DOM/network data.
    // ============================================================

    function scanText(
      input,
      source
    ) {
      if (!input) {
        return;
      }

      const text =
        String(input)
          .replace(
            /\\u002F/gi,
            "/"
          )
          .replace(
            /\\\//g,
            "/"
          )
          .replace(
            /&amp;/gi,
            "&"
          );


      // ----------------------------------------------------------
      // Direct media URLs
      // ----------------------------------------------------------

      const mediaRegex =
        /https?:\/\/[^"'<> \t\r\n]+?\.(?:mp4|m3u8|mpd)(?:\?[^"'<> \t\r\n]*)?/gi;


      let m;


      while (
        (m =
          mediaRegex.exec(
            text
          )) !== null
      ) {
        addDirectMedia(
          m[0],
          source
        );
      }


      // ----------------------------------------------------------
      // Kaltura partner IDs
      // ----------------------------------------------------------

      const partners =
        new Set();


      const partnerPatterns = [
        /\/p\/(\d{5,})\b/gi,
        /\/partner_id\/(\d{5,})\b/gi,
        /["']partnerId["']\s*[:=]\s*["']?_?(\d{5,})/gi,
        /["']partner_id["']\s*[:=]\s*["']?_?(\d{5,})/gi,
        /["']wid["']\s*[:=]\s*["']_?(\d{5,})/gi,
        /[?&]wid=_?(\d{5,})/gi,
      ];


      for (
        const re
        of partnerPatterns
      ) {
        while (
          (m =
            re.exec(
              text
            )) !== null
        ) {
          partners.add(
            m[1]
          );
        }
      }


      // ----------------------------------------------------------
      // Kaltura entry IDs
      // ----------------------------------------------------------

      const entryIds =
        new Set();


      const entryPatterns = [
        /\/entryId\/(\d_[A-Za-z0-9]+)/gi,
        /\/entry_id\/(\d_[A-Za-z0-9]+)/gi,
        /[?&]entry_?id=(\d_[A-Za-z0-9]+)/gi,
        /["']entry_?id["']\s*[:=]\s*["'](\d_[A-Za-z0-9]+)["']/gi,
      ];


      for (
        const re
        of entryPatterns
      ) {
        while (
          (m =
            re.exec(
              text
            )) !== null
        ) {
          entryIds.add(
            m[1]
          );
        }
      }


      // On TV MIDTVEST we know the partner.
      if (
        entryIds.size &&
        !partners.size
      ) {
        partners.add(
          DEFAULT_PARTNER_ID
        );
      }


      for (
        const p
        of partners
      ) {
        for (
          const e
          of entryIds
        ) {
          addEntry(
            p,
            e,
            source
          );
        }
      }
    }


    // ------------------------------------------------------------
    // HTML after video initialization
    // ------------------------------------------------------------

    try {
      scanText(
        document.documentElement
          .innerHTML,
        "document-after-click"
      );
    } catch (_) {}


    // ------------------------------------------------------------
    // iframe URLs
    // ------------------------------------------------------------

    for (
      const iframe
      of document.querySelectorAll(
        "iframe[src]"
      )
    ) {
      scanText(
        iframe.src,
        "iframe-after-click"
      );
    }


    // ------------------------------------------------------------
    // <video> and <source>
    // ------------------------------------------------------------

    for (
      const video
      of document.querySelectorAll(
        "video"
      )
    ) {
      addDirectMedia(
        video.currentSrc,
        "video.currentSrc"
      );

      addDirectMedia(
        video.src,
        "video.src"
      );


      for (
        const source
        of video.querySelectorAll(
          "source[src]"
        )
      ) {
        addDirectMedia(
          source.src,
          "video-source"
        );
      }
    }


    // ------------------------------------------------------------
    // Performance/network
    // ------------------------------------------------------------

    for (
      const entry
      of performance.getEntriesByType(
        "resource"
      )
    ) {
      scanText(
        entry.name,
        "performance"
      );

      addDirectMedia(
        entry.name,
        "performance"
      );
    }


    // ============================================================
    // STEP 5
    //
    // If click exposed an MP4 directly, archive it immediately.
    // ============================================================

    const directMp4 =
      [...directMedia.values()]
        .find(
          media =>
            media.type ===
              "mp4"
        );


    if (directMp4) {
      ctx.state.mp4sFound++;


      yield getState(
        ctx,
        `TV MIDTVEST: direct MP4 discovered after click [${directMp4.source}]: ${directMp4.url}`
      );


      if (
        typeof doExternalFetch ===
        "function"
      ) {
        try {
          const ok =
            await doExternalFetch(
              directMp4.url
            );

          if (ok) {
            ctx.state.fetched++;

            yield getState(
              ctx,
              `TV MIDTVEST: SUCCESS - direct MP4 fetched: ${directMp4.url}`
            );

            return;
          }
        } catch (_) {}
      }
    }


    // ============================================================
    // STEP 6
    //
    // Report HLS/DASH too.
    //
    // This is important because yt-dlp may actually see a manifest,
    // rather than a literal .mp4.
    // ============================================================

    for (
      const media
      of directMedia.values()
    ) {
      if (
        media.type !== "mp4"
      ) {
        yield getState(
          ctx,
          `TV MIDTVEST: ${media.type.toUpperCase()} discovered after click [${media.source}]: ${media.url}`
        );
      }
    }


    // ============================================================
    // STEP 7
    //
    // Kaltura API extraction if an entry ID appeared.
    // ============================================================

    ctx.state.entriesFound =
      entries.size;


    if (!entries.size) {
      yield getState(
        ctx,
        "TV MIDTVEST: extraction stopped - player was initialized, but no Kaltura entry_id was found"
      );

      return;
    }


    for (
      const item
      of entries.values()
    ) {
      yield getState(
        ctx,
        `TV MIDTVEST/Kaltura: found partner=${item.partnerId}, entry=${item.entryId} via ${item.source}`
      );


      const payload = {
        apiVersion:
          "3.3.0",

        clientTag:
          "html5:v3.1.0",

        format: 1,

        ks: "",

        partnerId:
          item.partnerId,

        1: {
          expiry: 86400,

          service:
            "session",

          action:
            "startWidgetSession",

          widgetId:
            `_${item.partnerId}`,
        },

        2: {
          action:
            "list",

          filter: {
            redirectFromEntryId:
              item.entryId,
          },

          service:
            "baseentry",

          ks:
            "{1:result:ks}",

          responseProfile: {
            type: 1,

            fields:
              "createdAt,dataUrl,duration,name,plays,thumbnailUrl,userId",
          },
        },

        3: {
          action:
            "getbyentryid",

          entryId:
            item.entryId,

          service:
            "flavorAsset",

          ks:
            "{1:result:ks}",
        },
      };


      let data;


      try {
        const response =
          await fetch(
            "https://cdnapi.kaltura.com/api_v3/service/multirequest",
            {
              method:
                "POST",

              credentials:
                "omit",

              headers: {
                "Content-Type":
                  "application/json",

                Accept:
                  "application/json",
              },

              body:
                JSON.stringify(
                  payload
                ),
            }
          );


        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }


        data =
          await response.json();

      } catch (e) {
        yield getState(
          ctx,
          `TV MIDTVEST/Kaltura: API request failed: ${
            e &&
            e.message
              ? e.message
              : e
          }`
        );

        continue;
      }


      const info =
        data &&
        data[1] &&
        Array.isArray(
          data[1].objects
        )
          ? data[1].objects[0]
          : null;


      const flavors =
        data &&
        data[2] &&
        Array.isArray(
          data[2].objects
        )
          ? data[2].objects
          : [];


      if (
        !info ||
        !info.dataUrl ||
        !flavors.length
      ) {
        yield getState(
          ctx,
          "TV MIDTVEST/Kaltura: API returned no usable baseentry/flavor data"
        );

        continue;
      }


      const mp4Flavors =
        flavors
          .filter(
            f => {
              const ext =
                String(
                  f.fileExt ||
                  "mp4"
                ).toLowerCase();

              return (
                f.id &&
                Number(f.status) ===
                  2 &&
                ext === "mp4"
              );
            }
          )
          .sort(
            (a, b) =>
              Number(
                b.height || 0
              ) -
                Number(
                  a.height || 0
                ) ||
              Number(
                b.bitrate || 0
              ) -
                Number(
                  a.bitrate || 0
                )
          );


      if (!mp4Flavors.length) {
        yield getState(
          ctx,
          "TV MIDTVEST/Kaltura: no ready MP4 flavor returned"
        );

        continue;
      }


      const flavor =
        mp4Flavors[0];


      let videoUrl =
        String(
          info.dataUrl
        ).replace(
          /\/$/,
          ""
        );


      if (
        videoUrl.includes(
          "/flvclipper/"
        )
      ) {
        videoUrl =
          videoUrl.replace(
            /\/flvclipper\/.*/,
            "/serveFlavor"
          );
      }


      videoUrl +=
        `/flavorId/${flavor.id}`;


      ctx.state.mp4sFound++;


      yield getState(
        ctx,
        `TV MIDTVEST/Kaltura: selected ${flavor.height || "?"}p MP4: ${videoUrl}`
      );


      if (
        typeof doExternalFetch ===
        "function"
      ) {
        try {
          const ok =
            await doExternalFetch(
              videoUrl
            );

          if (ok) {
            ctx.state.fetched++;

            yield getState(
              ctx,
              `TV MIDTVEST/Kaltura: SUCCESS - MP4 fetched: ${videoUrl}`
            );

            return;
          }
        } catch (_) {}
      }


      if (
        typeof addLink ===
        "function"
      ) {
        try {
          await addLink(
            videoUrl
          );

          yield getState(
            ctx,
            `TV MIDTVEST/Kaltura: MP4 added to crawl queue: ${videoUrl}`
          );

          return;
        } catch (_) {}
      }
    }


    yield getState(
      ctx,
      "TV MIDTVEST: FAILED - video initialized, but no archiveable MP4 was obtained"
    );
  }
}
