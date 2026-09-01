class TVMidtvestMediaArchive {
  static id = "TVMidtvestMediaArchive";

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
      doExternalFetch,
      waitForNetworkIdle
    } = ctx.Lib;

    const BUTTON_SELECTOR = "button.tv-hero-play-button";

    const MAX_DISCOVERY_WAIT = 20000;
    const FETCH_CONCURRENCY = 6;

    // ------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------

    const absoluteUrl = (value, base) => {
      try {
        return new URL(value, base).href;
      } catch (_) {
        return null;
      }
    };

    const getAttrUri = (line) => {
      const match = line.match(/\bURI=(?:"([^"]+)"|'([^']+)'|([^,]+))/i);
      return match ? (match[1] || match[2] || match[3]) : null;
    };

    const isManifest = (url) =>
      /\.m3u8(?:$|[?#])/i.test(url);

    const isDirectMedia = (url) =>
      /\.(?:mp4|m4v|webm|mp3|m4a|aac|mov)(?:$|[?#])/i.test(url);

    const discovered = new Set();
    const completed = new Set();
    const failed = new Set();

    const playlistQueue = [];
    const mediaQueue = [];

    // ------------------------------------------------------------
    // Watch network activity BEFORE opening the player.
    // ------------------------------------------------------------

    const collectPerformanceUrls = () => {
      for (const entry of performance.getEntriesByType("resource")) {
        const url = entry.name;

        if (
          /\.m3u8(?:$|[?#])/i.test(url) ||
          /\.(?:mp4|m4v|m4s|ts|aac|m4a|webm)(?:$|[?#])/i.test(url)
        ) {
          discovered.add(url);
        }
      }
    };

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const url = entry.name;

        if (
          /\.m3u8(?:$|[?#])/i.test(url) ||
          /\.(?:mp4|m4v|m4s|ts|aac|m4a|webm)(?:$|[?#])/i.test(url)
        ) {
          discovered.add(url);
        }
      }
    });

    try {
      observer.observe({
        type: "resource",
        buffered: true
      });
    } catch (_) {
      // PerformanceObserver fallback: polling below still works.
    }

    // ------------------------------------------------------------
    // Find TV MIDTVEST play button
    // ------------------------------------------------------------

    let button = null;

    for (let i = 0; i < 40; i++) {
      button = document.querySelector(BUTTON_SELECTOR);

      if (button) {
        break;
      }

      await sleep(250);
    }

    if (!button) {
      observer.disconnect();

      yield {
        msg: "TV MIDTVEST: no video button found"
      };

      return;
    }

    yield {
      msg: "TV MIDTVEST: video button found"
    };

    // ------------------------------------------------------------
    // Open player.
    //
    // We DON'T care whether playback succeeds.
    // We only need TV MIDTVEST to initialise the video player and
    // expose/request the stream manifest.
    // ------------------------------------------------------------

    button.scrollIntoView({
      block: "center"
    });

    await sleep(500);

    button.click();

    yield {
      msg: "TV MIDTVEST: player initialisation triggered"
    };

    // ------------------------------------------------------------
    // Discover manifest/direct media URL.
    // ------------------------------------------------------------

    const started = Date.now();

    let rootUrl = null;

    while (Date.now() - started < MAX_DISCOVERY_WAIT) {
      collectPerformanceUrls();

      // Look directly at video element too.
      const videos = document.querySelectorAll("video");

      for (const video of videos) {
        const candidates = [
          video.currentSrc,
          video.src,
          ...Array.from(video.querySelectorAll("source"))
            .map(source => source.src)
        ].filter(Boolean);

        for (const url of candidates) {
          if (
            url.startsWith("http://") ||
            url.startsWith("https://")
          ) {
            discovered.add(url);
          }
        }
      }

      // Prefer HLS manifest.
      rootUrl =
        [...discovered].find(isManifest) ||
        [...discovered].find(isDirectMedia);

      if (rootUrl) {
        break;
      }

      await sleep(250);
    }

    observer.disconnect();

    if (!rootUrl) {
      yield {
        msg:
          "TV MIDTVEST: no HLS manifest or direct media URL " +
          "discovered"
      };

      return;
    }

    yield {
      msg: `TV MIDTVEST: media source discovered: ${rootUrl}`
    };

    // ------------------------------------------------------------
    // Direct MP4/etc.
    //
    // Browsertrix fetches the complete object, then the behavior ends.
    // ------------------------------------------------------------

    if (!isManifest(rootUrl)) {
      yield {
        msg: `TV MIDTVEST: fetching direct media ${rootUrl}`
      };

      const ok = await doExternalFetch(rootUrl);

      if (ok) {
        yield {
          msg: "TV MIDTVEST: complete direct media fetched"
        };
      } else {
        yield {
          msg: "TV MIDTVEST: direct media fetch failed"
        };
      }

      if (waitForNetworkIdle) {
        await waitForNetworkIdle(1000, 0);
      }

      return;
    }

    // ------------------------------------------------------------
    // HLS
    // ------------------------------------------------------------

    const seenPlaylists = new Set();
    const seenMedia = new Set();

    playlistQueue.push(rootUrl);

    let isLive = false;
    let totalPlaylists = 0;

    // Parse every playlist recursively.
    while (playlistQueue.length) {
      const playlistUrl = playlistQueue.shift();

      if (seenPlaylists.has(playlistUrl)) {
        continue;
      }

      seenPlaylists.add(playlistUrl);

      yield {
        msg: `TV MIDTVEST: reading playlist ${playlistUrl}`
      };

      let response;

      try {
        response = await fetch(playlistUrl, {
          credentials: "include",
          referrerPolicy: "origin-when-cross-origin"
        });
      } catch (e) {
        failed.add(playlistUrl);

        yield {
          msg:
            `TV MIDTVEST: playlist fetch failed: ` +
            `${e.name}: ${e.message}`
        };

        continue;
      }

      if (!response.ok) {
        failed.add(playlistUrl);

        yield {
          msg:
            `TV MIDTVEST: playlist HTTP ${response.status}: ` +
            playlistUrl
        };

        continue;
      }

      const text = await response.text();

      totalPlaylists++;

      // A media playlist without ENDLIST is normally live/event media.
      const hasSegments =
        text.includes("#EXTINF:") ||
        text.includes("#EXT-X-PART:");

      if (
        hasSegments &&
        !text.includes("#EXT-X-ENDLIST")
      ) {
        isLive = true;
      }

      const lines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

      let previousWasStreamInf = false;

      for (const line of lines) {
        // --------------------------------------------------------
        // Master playlist rendition:
        //
        // #EXT-X-STREAM-INF:...
        // video/720.m3u8
        // --------------------------------------------------------

        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          previousWasStreamInf = true;
          continue;
        }

        if (!line.startsWith("#")) {
          const url = absoluteUrl(line, playlistUrl);

          if (!url) {
            previousWasStreamInf = false;
            continue;
          }

          if (
            previousWasStreamInf ||
            isManifest(url)
          ) {
            if (!seenPlaylists.has(url)) {
              playlistQueue.push(url);
            }
          } else {
            seenMedia.add(url);
          }

          previousWasStreamInf = false;
          continue;
        }

        previousWasStreamInf = false;

        // --------------------------------------------------------
        // Alternate audio/subtitle rendition
        // --------------------------------------------------------

        if (line.startsWith("#EXT-X-MEDIA:")) {
          const uri = getAttrUri(line);

          if (uri) {
            const url = absoluteUrl(uri, playlistUrl);

            if (url && !seenPlaylists.has(url)) {
              playlistQueue.push(url);
            }
          }

          continue;
        }

        // --------------------------------------------------------
        // I-frame playlist
        // --------------------------------------------------------

        if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
          const uri = getAttrUri(line);

          if (uri) {
            const url = absoluteUrl(uri, playlistUrl);

            if (url && !seenPlaylists.has(url)) {
              playlistQueue.push(url);
            }
          }

          continue;
        }

        // --------------------------------------------------------
        // Encryption key
        // --------------------------------------------------------

        if (line.startsWith("#EXT-X-KEY:")) {
          const uri = getAttrUri(line);

          if (uri && !uri.startsWith("data:")) {
            const url = absoluteUrl(uri, playlistUrl);

            if (url) {
              seenMedia.add(url);
            }
          }

          continue;
        }

        // --------------------------------------------------------
        // fMP4 init segment
        // --------------------------------------------------------

        if (line.startsWith("#EXT-X-MAP:")) {
          const uri = getAttrUri(line);

          if (uri) {
            const url = absoluteUrl(uri, playlistUrl);

            if (url) {
              seenMedia.add(url);
            }
          }

          continue;
        }

        // --------------------------------------------------------
        // Low-latency HLS parts
        // --------------------------------------------------------

        if (
          line.startsWith("#EXT-X-PART:") ||
          line.startsWith("#EXT-X-PRELOAD-HINT:")
        ) {
          const uri = getAttrUri(line);

          if (uri) {
            const url = absoluteUrl(uri, playlistUrl);

            if (url) {
              seenMedia.add(url);
            }
          }
        }
      }
    }

    // ------------------------------------------------------------
    // Live stream protection
    // ------------------------------------------------------------

    if (isLive) {
      yield {
        msg:
          "TV MIDTVEST: playlist appears to be LIVE " +
          "(no #EXT-X-ENDLIST). Complete-media termination " +
          "is therefore impossible."
      };

      return;
    }

    const resources = [...seenMedia];

    yield {
      msg:
        `TV MIDTVEST: finite VOD found — ` +
        `${totalPlaylists} playlists, ` +
        `${resources.length} media resources`
    };

    // ------------------------------------------------------------
    // Fetch media in parallel batches.
    // ------------------------------------------------------------

    for (
      let offset = 0;
      offset < resources.length;
      offset += FETCH_CONCURRENCY
    ) {
      const batch = resources.slice(
        offset,
        offset + FETCH_CONCURRENCY
      );

      const results = await Promise.all(
        batch.map(async url => {
          try {
            const ok = await doExternalFetch(url);

            if (ok) {
              completed.add(url);
            } else {
              failed.add(url);
            }

            return ok;
          } catch (_) {
            failed.add(url);
            return false;
          }
        })
      );

      const done = Math.min(
        offset + batch.length,
        resources.length
      );

      yield {
        msg:
          `TV MIDTVEST: fetched ${done}/${resources.length} ` +
          `media resources`
      };
    }

    // ------------------------------------------------------------
    // Make sure Browsertrix has finished pending network recording.
    // ------------------------------------------------------------

    if (waitForNetworkIdle) {
      await waitForNetworkIdle(1500, 0);
    } else {
      await sleep(1500);
    }

    // ------------------------------------------------------------
    // Done.
    // ------------------------------------------------------------

    if (failed.size) {
      yield {
        msg:
          `TV MIDTVEST: media archive completed with ` +
          `${completed.size} successful and ` +
          `${failed.size} failed resources`
      };
    } else {
      yield {
        msg:
          `TV MIDTVEST: COMPLETE — all ` +
          `${completed.size} media resources fetched`
      };
    }
  }
}
