class TVMidtvestKalturaYtDlpBehavior {
  static id = "tvmidtvest-kaltura-ytdlp";
  static runInIframes = true;

  static init() {
    return {
      state: {
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
      host === "kaltura.com" ||
      host.endsWith(".kaltura.com") ||
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

    const entries = new Map();

    let packageCandidate = null;

    const frameType =
      window.top === window
        ? "top"
        : "iframe";

    yield getState(
      ctx,
      `TV MIDTVEST/Kaltura (${frameType}): starting yt-dlp-style extraction`
    );


    // ============================================================
    // Context helpers
    // ============================================================

    function isTVMidtvestContext() {
      const host =
        String(
          location.hostname || ""
        ).toLowerCase();

      const ref =
        String(
          document.referrer || ""
        ).toLowerCase();

      return (
        host === "tvmidtvest.dk" ||
        host.endsWith(
          ".tvmidtvest.dk"
        ) ||
        ref.includes(
          "tvmidtvest.dk"
        )
      );
    }


    function cleanPartnerId(value) {
      const s =
        String(value || "")
          .trim()
          .replace(/^_/, "");

      return /^\d+$/.test(s)
        ? s
        : null;
    }


    function cleanEntryId(value) {
      const s =
        String(value || "")
          .trim();

      return /^\d_[A-Za-z0-9]+$/.test(s)
        ? s
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

      if (!entries.has(key)) {
        entries.set(
          key,
          {
            partnerId: p,
            entryId: e,
            source,
          }
        );
      }
    }


    // ============================================================
    // Extract Kaltura partner IDs
    // ============================================================

    function findPartnerIds(text) {
      const s =
        String(text || "");

      const out =
        new Set();

      const patterns = [

        // /p/1953371/
        // /partner_id/1953371/

        /(?:\/|\b)(?:p|partner_id)\/(\d{5,})\b/gi,


        // partnerId: "1953371"
        // partner_id = 1953371

        /["'](?:partnerId|partner_id)["']\s*[:=]\s*["']?_?(\d{5,})/gi,


        // wid: "_1953371"

        /["']wid["']\s*[:=]\s*["']_?(\d{5,})/gi,


        // ?wid=_1953371

        /(?:[?&]|%26)wid=(?:_|%5F)?(\d{5,})/gi,


        // ?partner_id=1953371
        // ?p=1953371

        /(?:[?&]|%26)(?:p|partner_id)=(\d{5,})/gi,
      ];


      for (const re of patterns) {
        let m;

        while (
          (m = re.exec(s)) !== null
        ) {
          const p =
            cleanPartnerId(
              m[1]
            );

          if (p) {
            out.add(p);
          }
        }
      }

      return out;
    }


    // ============================================================
    // Extract Kaltura entry IDs
    // ============================================================

    function findEntryIds(text) {
      const s =
        String(text || "");

      const out =
        new Set();

      const patterns = [

        // /entry_id/0_abcd1234
        // /entryId/0_abcd1234

        /\/entry_?[Ii]d\/(\d_[A-Za-z0-9]+)\b/g,


        // ?entry_id=0_abcd1234
        // ?entryId=0_abcd1234

        /(?:[?&]|%26)entry(?:_|%5F)?id=(\d_[A-Za-z0-9]+)/gi,


        // "entry_id": "0_abcd1234"
        // "entryId": "0_abcd1234"

        /["']entry_?[Ii]d["']\s*[:=]\s*["'](\d_[A-Za-z0-9]+)["']/g,


        // entryId = "0_abcd1234"

        /\bentry_?[Ii]d\s*[:=]\s*["'](\d_[A-Za-z0-9]+)["']/g,
      ];


      for (const re of patterns) {
        let m;

        while (
          (m = re.exec(s)) !== null
        ) {
          const e =
            cleanEntryId(
              m[1]
            );

          if (e) {
            out.add(e);
          }
        }
      }


      // Fallback:
      //
      // If the text clearly looks Kaltura-related,
      // accept raw IDs like:
      //
      // 0_xxxxxxxx
      // 1_xxxxxxxx

      if (
        /kaltura|entry|flavor|uiconf/i.test(
          s
        )
      ) {
        const re =
          /\b(\d_[a-z0-9]{6,})\b/gi;

        let m;

        while (
          (m = re.exec(s)) !== null
        ) {
          const e =
            cleanEntryId(
              m[1]
            );

          if (e) {
            out.add(e);
          }
        }
      }

      return out;
    }


    // ============================================================
    // Scan arbitrary text for partner + entry ID
    // ============================================================

    function scanText(
      text,
      source
    ) {
      const s =
        String(text || "");

      if (!s) {
        return;
      }

      const partners =
        findPartnerIds(s);

      const entryIds =
        findEntryIds(s);


      // TV MIDTVEST fallback:
      //
      // If we find an entry ID but the partner ID
      // is not included nearby, use the known
      // TV MIDTVEST Kaltura tenant.

      if (
        !partners.size &&
        entryIds.size &&
        isTVMidtvestContext()
      ) {
        partners.add(
          DEFAULT_PARTNER_ID
        );
      }


      for (
        const partnerId
        of partners
      ) {
        for (
          const entryId
          of entryIds
        ) {
          addEntry(
            partnerId,
            entryId,
            source
          );
        }
      }
    }


    // ============================================================
    // Scan current browser frame
    // ============================================================

    function scanCurrentFrame() {

      // Current URL

      scanText(
        location.href,
        "location"
      );


      // HTML

      try {
        scanText(
          document.documentElement
            .innerHTML,
          "document-html"
        );
      } catch (_) {}


      // Iframe URLs

      try {
        for (
          const iframe
          of document.querySelectorAll(
            "iframe[src]"
          )
        ) {
          scanText(
            iframe.src,
            "iframe-src"
          );
        }
      } catch (_) {}


      // Already observed network resources

      try {
        for (
          const resource
          of performance.getEntriesByType(
            "resource"
          )
        ) {
          scanText(
            resource.name,
            "performance"
          );
        }
      } catch (_) {}
    }


    // ============================================================
    // Normalize Kaltura API structures
    // ============================================================

    function normalizeInfo(value) {
      if (!value) {
        return null;
      }

      if (
        Array.isArray(
          value.objects
        )
      ) {
        return (
          value.objects[0] ||
          null
        );
      }

      return value;
    }


    function normalizeFlavors(value) {
      if (
        Array.isArray(value)
      ) {
        return value;
      }

      if (
        value &&
        Array.isArray(
          value.objects
        )
      ) {
        return value.objects;
      }

      return [];
    }


    function extractKs(value) {
      if (!value) {
        return null;
      }

      if (
        typeof value.ks ===
          "string" &&
        value.ks
      ) {
        return value.ks;
      }

      if (
        value.result &&
        typeof value.result.ks ===
          "string" &&
        value.result.ks
      ) {
        return (
          value.result.ks
        );
      }

      return null;
    }


    // ============================================================
    // kalturaIframePackageData
    //
    // yt-dlp uses this when an embed starts with
    // referenceId rather than an entry_id.
    // ============================================================

    function inspectIframePackageData() {
      try {

        const pkg =
          window
            .kalturaIframePackageData;

        const result =
          pkg &&
          pkg.entryResult;

        if (!result) {
          return false;
        }


        const info =
          result.meta ||
          null;


        const contextData =
          result.contextData ||
          null;


        const flavors =
          contextData &&
          contextData
            .flavorAssets;


        const entryId =
          info &&
          cleanEntryId(
            info.id
          );


        if (
          !info ||
          !entryId ||
          !Array.isArray(
            flavors
          )
        ) {
          return false;
        }


        const partners =
          new Set(
            findPartnerIds(
              location.href
            )
          );


        try {
          for (
            const p
            of findPartnerIds(
              document
                .documentElement
                .innerHTML
            )
          ) {
            partners.add(p);
          }
        } catch (_) {}


        if (
          !partners.size &&
          isTVMidtvestContext()
        ) {
          partners.add(
            DEFAULT_PARTNER_ID
          );
        }


        const partnerId =
          [...partners][0] ||
          null;


        if (partnerId) {
          addEntry(
            partnerId,
            entryId,
            "kalturaIframePackageData"
          );
        }


        packageCandidate = {
          partnerId,
          entryId,
          info,
          flavors,

          ks:
            extractKs(
              contextData
            ),

          source:
            "kalturaIframePackageData",
        };


        return true;

      } catch (_) {

        return false;
      }
    }


    // ============================================================
    // Normalize dataUrl
    // ============================================================

    function normalizeDataUrl(value) {
      let url =
        String(value || "")
          .trim();

      if (!url) {
        return null;
      }


      // protocol-relative URL

      if (
        url.startsWith("//")
      ) {
        url =
          `${location.protocol}${url}`;
      }


      // Same transformation as yt-dlp

      if (
        url.includes(
          "/flvclipper/"
        )
      ) {
        url =
          url.replace(
            /\/flvclipper\/.*/,
            "/serveFlavor"
          );
      }


      return url.replace(
        /\/$/,
        ""
      );
    }


    // ============================================================
    // Kaltura referrer parameter
    //
    // yt-dlp can attach a base64 encoded source origin.
    // ============================================================

    function getTVMidtvestOrigin() {
      for (
        const value
        of [
          document.referrer,
          location.href,
        ]
      ) {

        if (!value) {
          continue;
        }

        try {

          const u =
            new URL(
              value,
              location.href
            );

          const host =
            u.hostname
              .toLowerCase();


          if (
            host ===
              "tvmidtvest.dk" ||
            host.endsWith(
              ".tvmidtvest.dk"
            )
          ) {
            return u.origin;
          }

        } catch (_) {}
      }

      return null;
    }


    function addKalturaReferrer(url) {
      const origin =
        getTVMidtvestOrigin();

      if (!origin) {
        return url;
      }

      try {

        const referrer =
          btoa(origin);

        const separator =
          url.includes("?")
            ? "&"
            : "?";

        return (
          `${url}` +
          `${separator}` +
          `referrer=` +
          encodeURIComponent(
            referrer
          )
        );

      } catch (_) {

        return url;
      }
    }


    // ============================================================
    // MP4 flavor selection
    // ============================================================

    function isReadyMp4Flavor(
      flavor
    ) {
      if (
        !flavor ||
        !flavor.id ||
        Number(
          flavor.status
        ) !== 2
      ) {
        return false;
      }


      let ext =
        String(
          flavor.fileExt ||
          ""
        ).toLowerCase();


      // yt-dlp skips unavailable
      // and DRM formats.

      if (
        ext === "chun" ||
        ext === "wvm"
      ) {
        return false;
      }


      // yt-dlp assumes MP4 when fileExt
      // is missing unless container is qt.

      if (!ext) {

        if (
          String(
            flavor
              .containerFormat ||
            ""
          ).toLowerCase()
            === "qt"
        ) {
          return false;
        }

        ext = "mp4";
      }


      return ext === "mp4";
    }


    function flavorScore(
      flavor
    ) {
      const height =
        Number(
          flavor.height ||
          0
        );

      const width =
        Number(
          flavor.width ||
          0
        );

      const bitrate =
        Number(
          flavor.bitrate ||
          0
        );

      const size =
        Number(
          flavor.size ||
          0
        );


      return (
        height * 1e15 +
        width * 1e11 +
        bitrate * 1e5 +
        size
      );
    }


    function selectBestMp4(
      flavors
    ) {
      return (
        normalizeFlavors(
          flavors
        )
          .filter(
            isReadyMp4Flavor
          )
          .sort(
            (a, b) =>
              flavorScore(b) -
              flavorScore(a)
          )[0] ||
        null
      );
    }


    // ============================================================
    // Construct direct MP4 URL
    //
    // This is the key yt-dlp Kaltura method:
    //
    // dataUrl + "/flavorId/" + flavor.id
    // ============================================================

    function buildFlavorUrl(
      info,
      flavor,
      ks
    ) {
      const dataUrl =
        normalizeDataUrl(
          info &&
          info.dataUrl
        );

      if (
        !dataUrl ||
        !flavor ||
        !flavor.id
      ) {
        return null;
      }


      let url =
        `${dataUrl}` +
        `/flavorId/` +
        `${flavor.id}`;


      if (ks) {
        url +=
          `/ks/${ks}`;
      }


      return (
        addKalturaReferrer(
          url
        )
      );
    }


    // ============================================================
    // Kaltura API
    //
    // Structurally equivalent to current yt-dlp KalturaIE
    // html5 multirequest.
    // ============================================================

    async function getKalturaVideoInfo(
      partnerId,
      entryId
    ) {

      const payload = {

        apiVersion:
          "3.3.0",

        clientTag:
          "html5:v3.1.0",

        format: 1,

        ks: "",

        partnerId,


        // --------------------------------------------------------
        // Request 1:
        // startWidgetSession
        // --------------------------------------------------------

        1: {

          expiry:
            86400,

          service:
            "session",

          action:
            "startWidgetSession",

          widgetId:
            `_${partnerId}`,
        },


        // --------------------------------------------------------
        // Request 2:
        // baseentry metadata
        // --------------------------------------------------------

        2: {

          action:
            "list",

          filter: {

            redirectFromEntryId:
              entryId,
          },

          service:
            "baseentry",

          ks:
            "{1:result:ks}",

          responseProfile: {

            type: 1,

            fields:
              "createdAt," +
              "dataUrl," +
              "duration," +
              "name," +
              "plays," +
              "thumbnailUrl," +
              "userId",
          },
        },


        // --------------------------------------------------------
        // Request 3:
        // flavor assets
        // --------------------------------------------------------

        3: {

          action:
            "getbyentryid",

          entryId,

          service:
            "flavorAsset",

          ks:
            "{1:result:ks}",
        },
      };


      const endpoints = [

        "https://cdnapi.kaltura.com/api_v3/service/multirequest",

        "https://cdnapisec.kaltura.com/api_v3/service/multirequest",
      ];


      let lastError =
        null;


      for (
        const endpoint
        of endpoints
      ) {

        try {

          const response =
            await fetch(
              endpoint,
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


          if (
            !response.ok
          ) {
            throw new Error(
              `HTTP ${response.status}`
            );
          }


          const data =
            await response.json();


          if (
            !Array.isArray(
              data
            )
          ) {
            throw new Error(
              "Kaltura multirequest returned non-array data"
            );
          }


          // Detect Kaltura API exceptions.

          for (
            let i = 0;
            i < data.length;
            i++
          ) {

            const value =
              data[i];


            if (
              value &&
              typeof value ===
                "object" &&
              value.objectType ===
                "KalturaAPIException"
            ) {

              throw new Error(
                `Kaltura API exception ${i}: ` +
                `${
                  value.message ||
                  "unknown"
                }`
              );
            }
          }


          const info =
            normalizeInfo(
              data[1]
            );


          const flavors =
            normalizeFlavors(
              data[2]
            );


          const ks =
            extractKs(
              data[0]
            );


          if (!info) {
            throw new Error(
              "No baseentry metadata returned"
            );
          }


          if (
            !flavors.length
          ) {
            throw new Error(
              "No flavor assets returned"
            );
          }


          return {
            info,
            flavors,
            ks,
          };

        } catch (e) {

          lastError = e;
        }
      }


      throw (
        lastError ||
        new Error(
          "Kaltura API request failed"
        )
      );
    }


    // ============================================================
    // Archive MP4
    //
    // Primary:
    // doExternalFetch()
    //
    // Fallback:
    // addLink()
    // ============================================================

    async function archiveMp4(
      url
    ) {

      // ----------------------------------------------------------
      // Browsertrix crawler-side direct fetch
      // ----------------------------------------------------------

      if (
        typeof doExternalFetch ===
        "function"
      ) {

        try {

          if (
            await doExternalFetch(
              url
            )
          ) {
            return {

              ok: true,

              method:
                "doExternalFetch",

              url,
            };
          }

        } catch (_) {}


        // If Kaltura returned HTTP,
        // also try HTTPS.

        if (
          /^http:\/\//i.test(
            url
          )
        ) {

          try {

            const httpsUrl =
              url.replace(
                /^http:\/\//i,
                "https://"
              );


            if (
              await doExternalFetch(
                httpsUrl
              )
            ) {

              return {

                ok: true,

                method:
                  "doExternalFetch(https)",

                url:
                  httpsUrl,
              };
            }

          } catch (_) {}
        }
      }


      // ----------------------------------------------------------
      // Last fallback:
      // add direct URL to crawl queue
      // ----------------------------------------------------------

      if (
        typeof addLink ===
        "function"
      ) {

        try {

          await addLink(
            url
          );


          return {

            ok: true,

            method:
              "addLink",

            url,
          };

        } catch (_) {}
      }


      return {

        ok: false,

        method: null,

        url,
      };
    }


    // ============================================================
    // Process Kaltura metadata
    // ============================================================

    async function* processVideo(
      info,
      flavors,
      ks,
      source,
      entryId
    ) {

      const best =
        selectBestMp4(
          flavors
        );


      if (!best) {

        yield getState(
          ctx,

          `TV MIDTVEST/Kaltura: ` +
          `no ready MP4 flavor for ` +
          `${entryId}`
        );

        return false;
      }


      const videoUrl =
        buildFlavorUrl(
          info,
          best,
          ks
        );


      if (!videoUrl) {

        yield getState(
          ctx,

          `TV MIDTVEST/Kaltura: ` +
          `could not construct MP4 URL for ` +
          `${entryId}`
        );

        return false;
      }


      ctx.state.mp4sFound++;


      yield getState(
        ctx,

        `TV MIDTVEST/Kaltura: ` +
        `MP4 discovered ` +
        `${best.height || "?"}p ` +
        `${best.bitrate || "?"}kbps ` +
        `[${source}] ` +
        `${videoUrl}`
      );


      const result =
        await archiveMp4(
          videoUrl
        );


      if (
        result.ok
      ) {

        ctx.state.fetched++;


        yield getState(
          ctx,

          `TV MIDTVEST/Kaltura: SUCCESS - ` +
          `MP4 sent to ` +
          `${result.method}: ` +
          `${result.url}`
        );


        return true;
      }


      yield getState(
        ctx,

        `TV MIDTVEST/Kaltura: ` +
        `MP4 discovered but fetch failed: ` +
        `${videoUrl}`
      );


      return false;
    }


    // ============================================================
    // DISCOVERY
    //
    // IMPORTANT:
    //
    // There is deliberately:
    //
    // - no play()
    // - no click on play button
    // - no aria-label=Pause test
    // - no JW Player PLAYING test
    //
    // We only wait for Kaltura metadata.
    // ============================================================

    for (
      let attempt = 1;
      attempt <= 20;
      attempt++
    ) {

      inspectIframePackageData();

      scanCurrentFrame();


      if (
        packageCandidate ||
        entries.size
      ) {
        break;
      }


      await sleep(
        500
      );
    }


    ctx.state.entriesFound =
      entries.size;


    // ============================================================
    // METHOD 1:
    // kalturaIframePackageData
    //
    // This is particularly useful for referenceId embeds.
    // ============================================================

    if (
      packageCandidate
    ) {

      yield getState(
        ctx,

        `TV MIDTVEST/Kaltura: ` +
        `resolved entry ` +
        `${packageCandidate.entryId} ` +
        `via kalturaIframePackageData`
      );


      const gen =
        processVideo(

          packageCandidate.info,

          packageCandidate.flavors,

          packageCandidate.ks,

          packageCandidate.source,

          packageCandidate.entryId
        );


      let step =
        await gen.next();


      while (
        !step.done
      ) {

        yield step.value;

        step =
          await gen.next();
      }


      if (
        step.value === true
      ) {
        return;
      }
    }


    // ============================================================
    // METHOD 2:
    // Kaltura API
    //
    // partner_id + entry_id
    // ->
    // multirequest
    // ->
    // baseentry
    // ->
    // flavorAsset
    // ->
    // direct MP4
    // ============================================================

    for (
      const item
      of entries.values()
    ) {

      yield getState(
        ctx,

        `TV MIDTVEST/Kaltura: ` +
        `found partner=${item.partnerId}, ` +
        `entry=${item.entryId} ` +
        `via ${item.source}`
      );


      let apiData;


      try {

        apiData =
          await getKalturaVideoInfo(

            item.partnerId,

            item.entryId
          );

      } catch (e) {

        yield getState(
          ctx,

          `TV MIDTVEST/Kaltura: ` +
          `API lookup failed for ` +
          `${item.entryId}: ` +
          `${
            e &&
            e.message
              ? e.message
              : e
          }`
        );


        continue;
      }


      yield getState(
        ctx,

        `TV MIDTVEST/Kaltura: ` +
        `API metadata received for ` +
        `${item.entryId} ` +
        `(${apiData.flavors.length} flavor assets)`
      );


      const gen =
        processVideo(

          apiData.info,

          apiData.flavors,

          apiData.ks,

          "Kaltura API",

          item.entryId
        );


      let step =
        await gen.next();


      while (
        !step.done
      ) {

        yield step.value;

        step =
          await gen.next();
      }


      if (
        step.value === true
      ) {
        return;
      }
    }


    // ============================================================
    // Diagnostics
    // ============================================================

    if (
      !entries.size &&
      !packageCandidate
    ) {

      yield getState(
        ctx,

        "TV MIDTVEST/Kaltura: FAILED - " +
        "no Kaltura entry_id or iframe package data discovered"
      );

      return;
    }


    if (
      ctx.state.mp4sFound ===
      0
    ) {

      yield getState(
        ctx,

        "TV MIDTVEST/Kaltura: FAILED - " +
        "Kaltura entry found, but no ready direct MP4 flavor was discovered"
      );

      return;
    }


    yield getState(
      ctx,

      "TV MIDTVEST/Kaltura: FAILED - " +
      "direct MP4 discovered, but Browsertrix did not fetch it"
    );
  }
}
