/**
 * SotweAPI — Browsertrix custom behavior der arkiverer sotwe.com's paginerede API-kæder.
 *
 * Kører på sotwe-sider (f.eks. https://www.sotwe.com/DanJoergensen), ALDRIG på /api/-sider.
 *
 * 1) Detektion (passiv, ændrer ikke siden):
 *    - PerformanceObserver ser hvilke same-origin /api/-kald siden selv laver (fetch/XHR).
 *    - Et endpoint er en kæde, hvis det er set kaldt med ?after=, eller matcher
 *      CFG.knownPagedRe (f.eks. /api/v3/user/<navn>/).
 *    - Intet fundet → scroll til bunden op til 3 gange for at udløse paginering.
 *    - Stadig intet og URL'en ligner en profil → udled /api/v3/user/<navn>/.
 *
 * 2) Gennemløb: page 1 (uden after), derefter ?after=<cursor>&page=N med cursor fra
 *    forrige svars "after" — præcis de URL'er siden selv ville kalde, så replay virker
 *    helt til slutningen. Hentes i sidens kontekst, så crawleren optager svarene.
 *    Ét kald ad gangen med 8–12 s pause (skånsomt over for sotwe).
 *
 * 3) Stop: tom side, ingen after-cursor, gentaget cursor, ingen nye poster,
 *    datoer der springer frem (løkke), HTTP-fejl efter retries, maxPages, tidsloft.
 *    Det sidste svar (slutningen) optages altid, så replay stopper hvor live stopper.
 *
 * 4) URL'er: alle absolutte URL'er i JSON-teksten udtrækkes.
 *    - Billeder (pbs.twimg.com) hentes direkte ind i arkivet (ikke som sider).
 *    - Videoer: til som standard; kun højeste mp4-bitrate pr. video hentes.
 *    - Øvrige URL'er (t.co, x.com, artikler …) og selve API-URL'erne lægges i køen
 *      via addLink. Crawlerens scope afgør, om de faktisk crawles.
 *
 * Alt ligger i én klasse (hjælpere som statiske medlemmer), da Browsertrix
 * indlæser custom behavior-filer som én klasse.
 *
 * Brug:
 *   --customBehaviors /custom-behaviors/
 *   --behaviors autofetch,siteSpecific
 *   --behaviorTimeout 3600                 (skal være > CFG.maxDurationMs)
 */
class SotweAPI {
  static id = "SotweAPI";
  static runInIframe = false;

  static CFG = {
    apiPrefix: "/api/",
    knownPagedRe: /^\/api\/v\d+\/user\/[^/]+\/?$/,  // accepteres uden observeret after-kald
    reservedPaths: ["api", "search", "login", "signup", "about", "privacy", "terms", "contact",
                    "trending", "explore", "settings", "home", "hashtag", "tag", "i"],
    detectWaitMs: 3000,             // vent på sidens egne API-kald
    nudgeScrolls: 3,                // scroll-til-bund forsøg hvis intet er fundet
    nudgeGapMs: 3000,
    pageGapMs: [8000, 12000],       // pause mellem API-kald (sotwe-serveren)
    fetchTimeoutMs: 30000,
    retries: 3,                     // ved 429/5xx/netværksfejl
    retryBackoffMs: [10000, 30000, 60000],
    maxPages: 1000,
    maxDurationMs: 55 * 60 * 1000,  // hold under --behaviorTimeout
    dateToleranceMs: 24 * 3600 * 1000, // tolerance før "datoer springer frem" = løkke
    queueApiUrls: true,             // læg API-URL'erne selv i køen
    queuePageUrls: true,            // læg øvrige udtrukne URL'er i køen
    fetchImages: true,              // hent pbs.twimg.com direkte
    fetchVideos: true,              // hent bedste mp4 pr. video (kan være store)
    mediaGapMs: [300, 800],         // pause mellem medie-hentninger (CDN)
    imageRe: /^https:\/\/pbs\.twimg\.com\//,
    videoRe: /^https:\/\/video(-s)?\.twimg\.com\//,
    urlRe: /https?:\/\/[^\s"'<>\\]+/g
  };

  static isMatch() {
    return /(^|\.)sotwe\.com$/i.test(location.hostname) && !location.pathname.startsWith(SotweAPI.CFG.apiPrefix);
  }

  static init() {
    return { state: { apiPages: 0, posts: 0, queued: 0, mediaFetched: 0, skipped: 0, errors: 0 } };
  }

  static sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  static rand(a, b) { return Math.round(a + (b - a) * Math.random()); }
  static day(ms) { return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "?"; }

  /** Ét API-endpoint og hvordan dets side-URL'er bygges. */
  static Endpoint = class {
    constructor(key, first, sample, source) {
      this.key = key;                 // origin + pathname
      this.sample = sample;           // observeret URL med after= (skabelon for param-rækkefølge)
      this.first = first || SotweAPI.Endpoint.stripped(sample || key);
      this.source = source;
      this.name = new URL(key).pathname;
    }
    static stripped(href) {
      const u = new URL(href);
      u.searchParams.delete("after");
      u.searchParams.delete("page");
      return u.href;
    }
    pageUrl(n, cursor) {
      if (n === 1) return this.first;
      const u = new URL(this.sample || this.first);
      u.searchParams.set("after", cursor);
      u.searchParams.set("page", String(n));
      return u.href;
    }
  };

  /** Passiv detektion af sidens egne same-origin API-kald. */
  static Detector = class {
    constructor() {
      this.seen = new Map(); // href → initiatorType
      const add = e => this.add(e.name, e.initiatorType);
      try {
        this.obs = new PerformanceObserver(list => list.getEntries().forEach(add));
        this.obs.observe({ type: "resource", buffered: true });
      } catch { this.obs = null; }
      performance.getEntriesByType("resource").forEach(add);
    }
    add(href, type) {
      if (type !== "fetch" && type !== "xmlhttprequest") return;
      try {
        const u = new URL(href, location.href);
        if (u.origin === location.origin && u.pathname.startsWith(SotweAPI.CFG.apiPrefix)) this.seen.set(u.href, type);
      } catch { /* ugyldig URL */ }
    }
    endpoints() {
      const C = SotweAPI.CFG, map = new Map();
      for (const href of this.seen.keys()) {
        const u = new URL(href), key = u.origin + u.pathname;
        const e = map.get(key) || { key, path: u.pathname, first: null, sample: null };
        if (u.searchParams.has("after")) e.sample = e.sample || href; else e.first = e.first || href;
        map.set(key, e);
      }
      return [...map.values()]
        .filter(e => e.sample || C.knownPagedRe.test(e.path))
        .map(e => new SotweAPI.Endpoint(e.key, e.first, e.sample, e.sample ? "observeret med after" : "observeret, kendt mønster"));
    }
    stop() { if (this.obs) this.obs.disconnect(); }
  };

  /** Udled /api/v3/user/<navn>/ fra en profil-URL. */
  static profileEndpoint() {
    const m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (!m || SotweAPI.CFG.reservedPaths.includes(m[1].toLowerCase())) return null;
    const key = `${location.origin}/api/v3/user/${m[1]}/`;
    return new SotweAPI.Endpoint(key, key, null, "udledt af profil-URL");
  }

  /** Hent JSON i sidens kontekst (optages af crawleren), med timeout og retries. */
  static async getJson(url) {
    const C = SotweAPI.CFG;
    let last = { status: null, json: null, error: null };
    for (let attempt = 0; attempt <= C.retries; attempt++) {
      const ac = new AbortController(), timer = setTimeout(() => ac.abort(), C.fetchTimeoutMs);
      let wait = C.retryBackoffMs[Math.min(attempt, C.retryBackoffMs.length - 1)];
      try {
        const r = await fetch(url, { credentials: "include", signal: ac.signal });
        last = { status: r.status, json: null, error: null };
        if (r.ok) {
          const text = await r.text();
          try { return { status: r.status, json: JSON.parse(text), error: null }; }
          catch { return { status: r.status, json: null, error: "ikke JSON" }; }
        }
        if (r.status !== 429 && r.status < 500) return last; // 4xx: ingen retry
        const ra = Number(r.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) wait = Math.min(ra * 1000, 120000);
      } catch (e) {
        last = { status: null, json: null, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
      } finally { clearTimeout(timer); }
      if (attempt < C.retries) await SotweAPI.sleep(wait);
    }
    return last;
  }

  /** Alle absolutte URL'er i alle strengværdier (trailing tegnsætning fjernes, afkortede springes over). */
  static extractUrls(node, out = new Set()) {
    if (typeof node === "string") {
      for (const m of node.matchAll(SotweAPI.CFG.urlRe)) {
        if (m[0].includes("…")) continue; // afkortet URL i RT-tekst: ufuldstændig
        const u = m[0].replace(/[.,;:!?)\]}]+$/, "");
        try { out.add(new URL(u).href); } catch { /* ugyldig */ }
      }
    } else if (Array.isArray(node)) node.forEach(n => SotweAPI.extractUrls(n, out));
    else if (node && typeof node === "object") Object.values(node).forEach(v => SotweAPI.extractUrls(v, out));
    return out;
  }

  /** Højeste-bitrate mp4 pr. videoInfo. */
  static bestVideos(node, out = new Set()) {
    if (Array.isArray(node)) node.forEach(n => SotweAPI.bestVideos(n, out));
    else if (node && typeof node === "object") {
      const v = node.videoInfo && node.videoInfo.variants;
      if (Array.isArray(v)) {
        const best = v.filter(x => x && x.type === "video/mp4" && x.url).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (best) out.add(best.url);
      }
      Object.values(node).forEach(val => { if (val && typeof val === "object") SotweAPI.bestVideos(val, out); });
    }
    return out;
  }

  /** Crawler-funktioner (med fallback når de ikke findes). */
  static tools(ctx) {
    const Lib = ctx.Lib || {};
    const addLink = typeof Lib.addLink === "function" ? u => Lib.addLink(u)
      : typeof self.__bx_addLink === "function" ? u => self.__bx_addLink(u) : null;
    const extFetch = typeof Lib.doExternalFetch === "function" ? u => Lib.doExternalFetch(u)
      : typeof self.__bx_fetch === "function" ? u => self.__bx_fetch(u)
      : u => fetch(u, { mode: "no-cors", credentials: "omit" }); // optages stadig af crawleren
    return { addLink, extFetch };
  }

  /** Kø og medie-hentning for én API-sides URL'er. */
  static async handleUrls(json, seen, tools, st) {
    const S = SotweAPI, C = S.CFG;
    const videos = C.fetchVideos ? S.bestVideos(json) : new Set();
    let queued = 0, media = 0;
    for (const u of S.extractUrls(json)) {
      if (seen.has(u)) continue;
      seen.add(u);
      const isImg = C.imageRe.test(u), isVid = C.videoRe.test(u);
      if ((isImg && C.fetchImages) || (isVid && videos.has(u))) {
        try { await tools.extFetch(u); media++; st.mediaFetched++; } catch { st.errors++; }
        await S.sleep(S.rand(...C.mediaGapMs));
      } else if (isImg || isVid) {
        st.skipped++;
      } else if (C.queuePageUrls && tools.addLink) {
        try { await tools.addLink(u); queued++; st.queued++; } catch { st.errors++; }
      }
    }
    return { queued, media };
  }

  /** Gennemløb én kæde fra page 1 til slutningen. */
  async* walk(ctx, ep, seenUrls, tools, t0) {
    const S = SotweAPI, C = S.CFG, st = ctx.state;
    const say = msg => ctx.Lib.getState(ctx, `SotweAPI: ${msg}`);
    const cursors = new Set(), ids = new Set();
    let n = 1, cursor = null, prevOldest = Infinity, reason = "slut på kæden";

    while (true) {
      if (n > C.maxPages) { reason = `maxPages (${C.maxPages}) nået`; break; }
      if (Date.now() - t0 > C.maxDurationMs) { reason = "tidsloft nået"; break; }

      const url = ep.pageUrl(n, cursor);
      const r = await S.getJson(url);
      if (!r.json) { st.errors++; reason = `fejl på page ${n}: HTTP ${r.status ?? "-"} ${r.error ?? ""}`.trim(); break; }
      if (n === 1 && !("after" in r.json) && !Array.isArray(r.json.data)) { reason = "ikke et pagineret endpoint – springer over"; break; }
      st.apiPages++;

      if (C.queueApiUrls && tools.addLink && !seenUrls.has(url)) {
        seenUrls.add(url);
        try { await tools.addLink(url); st.queued++; } catch { st.errors++; }
      }

      const data = Array.isArray(r.json.data) ? r.json.data : [];
      let fresh = 0, newest = -Infinity, oldest = Infinity;
      for (const p of data) {
        if (p && p.id && !ids.has(p.id)) { ids.add(p.id); fresh++; }
        if (p && !p.pinned && Number.isFinite(p.createdAt)) { newest = Math.max(newest, p.createdAt); oldest = Math.min(oldest, p.createdAt); }
      }
      st.posts += fresh;

      const { queued, media } = await S.handleUrls(r.json, seenUrls, tools, st);
      yield say(`${ep.name} page ${n}: ${data.length} poster (${fresh} nye) ${S.day(newest)} → ${S.day(oldest)}, ${queued} i kø, ${media} medier hentet`);

      const next = typeof r.json.after === "string" ? r.json.after : "";
      if (!data.length) { reason = "tom side (slutningen)"; break; }
      if (!next) { reason = "ingen after-cursor (slutningen)"; break; }
      if (cursors.has(next)) { reason = "cursor gentaget – løkke stoppet"; break; }
      if (n > 1 && fresh === 0) { reason = "ingen nye poster – løkke stoppet"; break; }
      if (Number.isFinite(newest) && newest > prevOldest + C.dateToleranceMs) {
        reason = `datoer springer frem (${S.day(prevOldest)} → ${S.day(newest)}) – løkke stoppet`; break;
      }

      cursors.add(next);
      cursor = next;
      if (Number.isFinite(oldest)) prevOldest = oldest;
      n++;
      await S.sleep(S.rand(...C.pageGapMs));
    }
    yield say(`${ep.name}: stoppede ved page ${n} – ${reason}`);
  }

  async* run(ctx) {
    const S = SotweAPI, C = S.CFG, st = ctx.state, t0 = Date.now();
    const say = msg => ctx.Lib.getState(ctx, `SotweAPI: ${msg}`);
    const tools = S.tools(ctx), det = new S.Detector();

    yield say(`start på ${location.href}${tools.addLink ? "" : " (addLink ikke tilgængelig – intet lægges i kø)"}`);
    await S.sleep(C.detectWaitMs);
    let eps = det.endpoints();

    for (let i = 0; !eps.length && i < C.nudgeScrolls; i++) {
      const el = document.scrollingElement || document.documentElement;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      yield say(`ingen API-kæde endnu – scroller til bunden (${i + 1}/${C.nudgeScrolls})`);
      await S.sleep(C.nudgeGapMs);
      eps = det.endpoints();
    }
    if (!eps.length) { const fb = S.profileEndpoint(); if (fb) eps = [fb]; }
    if (!eps.length) { det.stop(); yield say("ingen paginerede API-kald fundet – stopper"); return; }

    const done = new Set(), seenUrls = new Set();
    while (eps.length && Date.now() - t0 < C.maxDurationMs) {
      const ep = eps.shift();
      if (done.has(ep.key)) continue;
      done.add(ep.key);
      yield say(`kæde fundet: ${ep.name} (${ep.source})`);
      yield* this.walk(ctx, ep, seenUrls, tools, t0);
      for (const e of det.endpoints()) if (!done.has(e.key)) eps.push(e); // nye kæder opdaget undervejs
    }
    det.stop();
    yield say(`færdig efter ${Math.round((Date.now() - t0) / 1000)} s: ${done.size} kæde(r), ${st.apiPages} API-sider, ${st.posts} poster, ${st.queued} i kø, ${st.mediaFetched} medier, ${st.skipped} sprunget over, ${st.errors} fejl`);
  }
}
