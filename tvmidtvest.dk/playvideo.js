class TVMidtvestYtDlpBehavior {
  static id = "tvmidtvest-ytdlp-like-video";
  static runInIframes = false;

  static init() {
    return {
      state: {
        candidates: 0,
        fetched: 0,
      },
      opts: {},
    };
  }

  static isMatch() {
    return /(^|\.)tvmidtvest\.dk$/i.test(window.location.hostname);
  }

  async *run(ctx) {
    const {
      getState,
      sleep,
      doExternalFetch,
      addLink,
    } = ctx.Lib;

    yield getState(
      ctx,
      "TV MIDTVEST: extracting video source like yt-dlp"
    );

    const candidates = new Map();

    // Higher number = more trustworthy.
    const sourceRank = {
      "jw-playlist": 1000,
      "jw-item": 950,
      "dom-video": 900,
      "jw-config": 800,
      "performance": 500,
      "inline-script": 300,
    };

    // ------------------------------------------------------------
    // URL helpers
    // ------------------------------------------------------------

    function cleanUrl(raw) {
      if (typeof raw !== "string") {
        return null;
      }

      let value = raw
        .trim()
        .replace(/\\u0026/gi, "&")
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/gi, "&");

      if (!value) {
        return null;
      }

      if (/^(?:blob:|data:|javascript:)/i.test(value)) {
        return null;
      }

      if (value.startsWith("//")) {
        value = window.location.protocol + value;
      }

      try {
        return new URL(value, document.baseURI).href;
      } catch (_) {
        return null;
      }
    }

    function inferKind(url, type = "") {
      const t = String(type || "").toLowerCase();
      const u = String(url || "").toLowerCase();

      if (
        t.includes("mp4") ||
        /\.mp4(?:$|[?#])/i.test(u)
      ) {
        return "mp4";
      }

      if (
        t.includes("mpegurl") ||
        t.includes("m3u8") ||
        /\.m3u8(?:$|[?#])/i.test(u)
      ) {
        return "hls";
      }

      if (
        t.includes("dash") ||
        t.includes("mpd") ||
        /\.mpd(?:$|[?#])/i.test(u)
      ) {
        return "dash";
      }

      return null;
    }

    function qualityOf(obj = {}) {
      // JW Player often provides height directly.
      const height = Number(obj.height || 0);

      if (Number.isFinite(height) && height > 0) {
        return height;
      }

      // Or labels such as "1080p", "720p", etc.
      const text =
        `${obj.label || ""} ` +
        `${obj.name || ""} ` +
        `${obj.title || ""}`;

      const match = text.match(
        /(?:^|\D)(\d{3,4})\s*p?(?:\D|$)/i
      );

      if (match) {
        return Number(match[1]);
      }

      // Last-resort estimate from width.
      const width = Number(obj.width || 0);

      if (Number.isFinite(width) && width > 0) {
        return Math.round(width * 9 / 16);
      }

      return 0;
    }

    function addCandidate(rawUrl, source, meta = {}) {
      const url = cleanUrl(rawUrl);

      if (!url || !/^https?:/i.test(url)) {
        return;
      }

      const kind = inferKind(
        url,
        meta.type ||
        meta.mimeType ||
        meta.mime ||
        ""
      );

      if (!kind) {
        return;
      }

      const candidate = {
        url,
        kind,
        source,
        sourceRank: sourceRank[source] || 0,
        quality: qualityOf(meta),
      };

      const old = candidates.get(url);

      if (
        !old ||
        candidate.sourceRank > old.sourceRank ||
        candidate.quality > old.quality
      ) {
        candidates.set(url, candidate);
      }
    }

    // ------------------------------------------------------------
    // JW Player extraction
    //
    // This is the important yt-dlp-like part:
    //
    //     jwplayer(...).setup(...)
    //             ↓
    //       playlist / sources
    //             ↓
    //         direct file URL
    //
    // We use JW Player's runtime API instead of parsing JS when
    // possible, because the browser has already evaluated setup().
    // ------------------------------------------------------------

    function addSourceObject(sourceObj, source) {
      if (!sourceObj) {
        return;
      }

      if (typeof sourceObj === "string") {
        addCandidate(sourceObj, source);
        return;
      }

      if (typeof sourceObj !== "object") {
        return;
      }

      addCandidate(
        sourceObj.file ||
        sourceObj.src ||
        sourceObj.url,
        source,
        sourceObj
      );
    }

    function harvestPlaylistItem(
      item,
      source = "jw-playlist"
    ) {
      if (!item || typeof item !== "object") {
        return;
      }

      // Old/simplified JW Player configuration:
      //
      // {
      //   file: "....mp4"
      // }

      addCandidate(
        item.file ||
        item.src ||
        item.url,
        "jw-item",
        item
      );

      // Modern JW Player:
      //
      // {
      //   sources: [
      //     { file: "...1080.mp4", label: "1080p" },
      //     { file: "...720.mp4",  label: "720p" }
      //   ]
      // }

      const sourceLists = [
        item.sources,
        item.allSources,
      ];

      for (const list of sourceLists) {
        if (!Array.isArray(list)) {
          continue;
        }

        for (const sourceObj of list) {
          addSourceObject(sourceObj, source);
        }
      }
    }

    function harvestJWPlayer(player) {
      if (!player) {
        return;
      }

      // Preferred source.
      try {
        const playlist = player.getPlaylist?.();

        if (Array.isArray(playlist)) {
          for (const item of playlist) {
            harvestPlaylistItem(
              item,
              "jw-playlist"
            );
          }
        }
      } catch (_) {}

      // Current playlist item.
      try {
        const item =
          player.getPlaylistItem?.();

        harvestPlaylistItem(
          item,
          "jw-playlist"
        );
      } catch (_) {}

      // Configuration fallback.
      try {
        const cfg = player.getConfig?.();

        if (cfg && typeof cfg === "object") {
          if (Array.isArray(cfg.playlist)) {
            for (const item of cfg.playlist) {
              harvestPlaylistItem(
                item,
                "jw-config"
              );
            }
          } else if (
            cfg.playlist &&
            typeof cfg.playlist === "object"
          ) {
            harvestPlaylistItem(
              cfg.playlist,
              "jw-config"
            );
          }

          addCandidate(
            cfg.file ||
            cfg.src ||
            cfg.url,
            "jw-config",
            cfg
          );

          if (Array.isArray(cfg.sources)) {
            for (const sourceObj of cfg.sources) {
              addSourceObject(
                sourceObj,
                "jw-config"
              );
            }
          }
        }
      } catch (_) {}
    }

    function harvestJWInstances() {
      const jw = window.jwplayer;

      if (typeof jw !== "function") {
        return;
      }

      const seen = new Set();

      const inspect = (player) => {
        if (!player || seen.has(player)) {
          return;
        }

        seen.add(player);
        harvestJWPlayer(player);
      };

      // Default JW instance.
      try {
        inspect(jw());
      } catch (_) {}

      // Explicit player IDs.
      const ids = new Set();

      for (
        const elem of document.querySelectorAll(
          ".jwplayer[id], " +
          "[id^='jwplayer'], " +
          "[id*='jwplayer']"
        )
      ) {
        if (elem.id) {
          ids.add(elem.id);
        }
      }

      for (const id of ids) {
        try {
          inspect(jw(id));
        } catch (_) {}
      }
    }

    // ------------------------------------------------------------
    // HTML5 video fallback
    // ------------------------------------------------------------

    function harvestDOM() {
      for (
        const video of
        document.querySelectorAll("video")
      ) {
        addCandidate(
          video.currentSrc,
          "dom-video",
          { type: video.type }
        );

        addCandidate(
          video.src,
          "dom-video",
          { type: video.type }
        );

        for (
          const source of
          video.querySelectorAll("source[src]")
        ) {
          addCandidate(
            source.src,
            "dom-video",
            { type: source.type }
          );
        }
      }
    }

    // ------------------------------------------------------------
    // Network resources already discovered by the page
    // ------------------------------------------------------------

    function harvestPerformance() {
      try {
        for (
          const entry of
          performance.getEntriesByType("resource")
        ) {
          addCandidate(
            entry.name,
            "performance"
          );
        }
      } catch (_) {}
    }

    // ------------------------------------------------------------
    // Inline setup() / JSON fallback
    //
    // yt-dlp normally parses jwplayer(...).setup({...}).
    // Runtime JW extraction above is cleaner, but this catches a
    // direct source embedded in the HTML before JW has initialized.
    // ------------------------------------------------------------

    function harvestInlineScripts() {
      const mediaUrlRe =
        /https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|m3u8|mpd)(?:\?[^"'<>\s]*)?/gi;

      for (const script of document.scripts) {
        const text =
          script.textContent || "";

        if (!text) {
          continue;
        }

        const normalized = text
          .replace(/\\u0026/gi, "&")
          .replace(/\\u002F/gi, "/")
          .replace(/\\\//g, "/");

        for (
          const match of
          normalized.matchAll(mediaUrlRe)
        ) {
          addCandidate(
            match[0],
            "inline-script"
          );
        }
      }
    }

    // ------------------------------------------------------------
    // Ranking
    // ------------------------------------------------------------

    const kindRank = {
      mp4: 300,
      hls: 200,
      dash: 100,
    };

    function rankedCandidates() {
      return [...candidates.values()]
        .sort((a, b) =>
          (b.sourceRank - a.sourceRank) ||
          (
            (kindRank[b.kind] || 0) -
            (kindRank[a.kind] || 0)
          ) ||
          (b.quality - a.quality)
        );
    }

    function bestMp4() {
      return rankedCandidates()
        .filter(c => c.kind === "mp4")[0] || null;
    }

    function hasHighConfidenceMp4() {
      return [...candidates.values()]
        .some(
          c =>
            c.kind === "mp4" &&
            c.sourceRank >=
              sourceRank["dom-video"]
        );
    }

    // ------------------------------------------------------------
    // DISCOVERY
    //
    // No play().
    // No button clicking.
    // No checking aria-label=Pause.
    // No checking JW state=PLAYING.
    //
    // The only thing we wait for is the player configuration to
    // expose its media source.
    // ------------------------------------------------------------

    harvestInlineScripts();

    for (
      let attempt = 1;
      attempt <= 20;
      attempt++
    ) {
      harvestJWInstances();
      harvestDOM();
      harvestPerformance();

      if (hasHighConfidenceMp4()) {
        break;
      }

      await sleep(500);
    }

    ctx.state.candidates =
      candidates.size;

    const ranked = rankedCandidates();

    // Log everything useful for debugging.
    for (const candidate of ranked) {
      yield getState(
        ctx,
        "TV MIDTVEST: candidate " +
        candidate.kind +
        " " +
        (
          candidate.quality
            ? candidate.quality + "p "
            : ""
        ) +
        "[" +
        candidate.source +
        "] " +
        candidate.url
      );
    }

    // ------------------------------------------------------------
    // MP4 IS THE SUCCESS CONDITION
    // ------------------------------------------------------------

    const selected = bestMp4();

    if (!selected) {
      const hls = ranked.find(
        c => c.kind === "hls"
      );

      const dash = ranked.find(
        c => c.kind === "dash"
      );

      if (hls) {
        yield getState(
          ctx,
          "TV MIDTVEST: HLS discovered but no direct MP4: " +
          hls.url
        );
      }

      if (dash) {
        yield getState(
          ctx,
          "TV MIDTVEST: DASH discovered but no direct MP4: " +
          dash.url
        );
      }

      yield getState(
        ctx,
        "TV MIDTVEST: FAILED - no direct MP4 source discovered"
      );

      return;
    }

    yield getState(
      ctx,
      "TV MIDTVEST: selected direct MP4 " +
      (
        selected.quality
          ? selected.quality + "p "
          : ""
      ) +
      selected.url
    );

    // ------------------------------------------------------------
    // DOWNLOAD / ARCHIVE
    //
    // This corresponds conceptually to the point where yt-dlp has
    // finished extraction and downloads the selected format URL.
    // ------------------------------------------------------------

    async function archiveDirect(url) {
      // Best option: Browsertrix crawler-side fetch.
      if (
        typeof doExternalFetch ===
        "function"
      ) {
        try {
          const ok =
            await doExternalFetch(url);

          if (ok) {
            return {
              ok: true,
              method: "doExternalFetch",
            };
          }
        } catch (_) {}
      }

      // Browser-side fallback. Browsertrix recording sees the request.
      try {
        await fetch(url, {
          mode: "no-cors",
          credentials: "include",
          referrerPolicy:
            "origin-when-cross-origin",
          cache: "no-store",
        });

        return {
          ok: true,
          method: "fetch(no-cors)",
        };
      } catch (_) {}

      // Last resort: add resolved media URL to crawl queue.
      if (
        typeof addLink === "function"
      ) {
        try {
          await addLink(url);

          return {
            ok: true,
            method: "addLink",
          };
        } catch (_) {}
      }

      return {
        ok: false,
        method: null,
      };
    }

    const result =
      await archiveDirect(selected.url);

    if (result.ok) {
      ctx.state.fetched = 1;

      yield getState(
        ctx,
        "TV MIDTVEST: SUCCESS - direct MP4 sent to " +
        result.method +
        ": " +
        selected.url
      );
    } else {
      yield getState(
        ctx,
        "TV MIDTVEST: FAILED - MP4 discovered but could not be fetched: " +
        selected.url
      );
    }
  }
}
