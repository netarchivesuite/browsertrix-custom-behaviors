/**
 * SimulatedScroll — forsigtig, menneskelignende autoscroll til Browsertrix Crawler.
 *
 * Forløbet planlægges ved start ud fra ét seed (logges, så planen kan genskabes):
 *  - Scroller nedad i "ryk" (bursts af hjul-tick-lignende spring), i gennemsnit
 *    1 skærmhøjde pr. 4 s. Et stort ryk efterfølges af en længere hvile, et lille
 *    af en kortere, så tempoet holdes uden at rytmen bliver mekanisk.
 *  - Præcis 2 læsepauser (3–8 s) på tilfældige steder, altid før bunden nås.
 *  - Af og til et op-scroll, venter 1–4 s og genoptager nedad.
 *    Et op-scroll er altid ≤ 50 % af strækningen nedad siden forrige op-scroll,
 *    så positionen efter hver cyklus altid ligger længere nede end efter den
 *    forrige: den overordnede bevægelse går altid mod bunden.
 *  - Ved bunden ventes på lazy-load; nyt indhold → fortsæt, ellers stop.
 *
 * Input-events (CFG.inputEvents, FRA som standard):
 *  - Hvert hjul-tick sendes som et WheelEvent på elementet under en virtuel
 *    musemarkør, før siden scrolles. Kalder siden preventDefault() (custom
 *    smooth-scroll-biblioteker), overlades scroll til siden; flytter siden sig
 *    alligevel ikke, scrolles der direkte som fallback.
 *  - Markøren driver let (pointermove + mousemove) før ryk og under pauser.
 *  - Der sendes ALDRIG klik, tastatur, mouseover/mouseenter eller knaptryk.
 *  - Events er syntetiske (isTrusted === false). De aktiverer sidens egne
 *    wheel/mousemove-lyttere (lazy-load, "aktivitets"-gates), men snyder ikke
 *    bot-detektion der tjekker isTrusted.
 *
 * Alt ligger i én klasse (hjælpere som statiske medlemmer), da Browsertrix
 * indlæser custom behavior-filer som én klasse.
 *
 * Brug:
 *   --customBehaviors /custom-behaviors/simulated-scroll.js
 *   --behaviors autofetch,siteSpecific     (fjern indbygget autoscroll)
 *   --behaviorTimeout 1860                 (skal være > CFG.maxDurationMs)
 */
class SimulatedScroll {
  static id = "SimulatedScroll";
  static runInIframe = false;

  static CFG = {
    secondsPerViewport: 4,         // gennemsnitligt nedadgående tempo
    stepVh: [0.35, 0.8],           // størrelse på ét ryk (andel af skærmhøjde)
    tickPx: [80, 120],             // hjul-tick inden for et ryk
    tickGapMs: [14, 38],           // tid mellem ticks i et ryk
    readingPauses: 2,              // antal læsepauser før bunden
    readingPauseMs: [3000, 8000],  // længde på hver læsepause
    pauseZone: [0.12, 0.82],       // hvor læsepauser må ligge (andel af scrollbar strækning)
    pauseMinGap: 0.15,             // minimumsafstand mellem læsepauser
    upEveryVh: [2.5, 5.5],         // op-scroll efter så mange skærmhøjder nedad
    upVh: [0.25, 0.9],             // op-scroll-længde (andel af skærmhøjde)
    upMaxShare: 0.5,               // op-scroll højst denne andel af nedad siden sidst
    upWaitMs: [1000, 4000],        // ventetid efter op-scroll
    bottomSettleMs: [2500, 4500],  // ventetid ved bunden (lazy-load)
    bottomStableChecks: 2,         // antal checks uden nyt indhold før stop
    maxStuckSteps: 3,              // ryk uden bevægelse før stop
    maxDurationMs: 15 * 60 * 1000, // sikkerhedsloft (hold under --behaviorTimeout)
    logEverySteps: 5,              // log hvert N'te ryk (undgår log-spam)
    seed: null,                    // null = tilfældigt; sæt tal for genskabelig plan

    inputEvents: false,            // FRA: syntetiske events (isTrusted=false) kan virke mistænkelige
    pointerZone: [0.3, 0.7],       // markørens startområde (andel af viewport)
    driftPx: 30,                   // maks. markørbevægelse pr. mikrobevægelse
    driftMoves: [1, 4],            // mikrobevægelser før et ryk
    idleChunkMs: [600, 1800],      // under pauser: interval mellem mulige drift
    idleDriftChance: 0.5,          // sandsynlighed for drift i hvert interval
    preventedSettleMs: 150,        // ventetid når siden selv håndterer wheel
    minHandledShare: 0.25          // under denne andel bevægelse → direkte scroll-fallback
  };

  static isMatch() { return true; }

  static init() { return { state: { steps: 0, pauses: 0, upScrolls: 0, wheelEvents: 0, pointerEvents: 0 } }; }

  static sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** Seedet PRNG (mulberry32) — gør planen reproducerbar. */
  static Rng = class {
    constructor(seed) { this.s = seed >>> 0; }
    next() {
      let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    int(a, b) { return Math.round(this.range(a, b)); }
    chance(p) { return this.next() < p; }
  };

  /** Det element der faktisk scrolles: dokumentet, eller største scroll-container (SPA'er). */
  static Target = class {
    constructor() {
      this.el = document.scrollingElement || document.documentElement;
      this.isRoot = true;
      this.name = "document";
      if (this.el.scrollHeight - this.el.clientHeight >= 50) return;
      let best = 0;
      for (const el of document.body ? document.body.querySelectorAll("*") : []) {
        const range = el.scrollHeight - el.clientHeight;
        if (range < 50 || range <= best || el.clientHeight < window.innerHeight * 0.4) continue;
        const oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll" || oy === "overlay") {
          best = range;
          this.el = el;
          this.isRoot = false;
          this.name = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}`;
        }
      }
    }
    get top() { return this.el.scrollTop; }
    get vh() { return this.el.clientHeight || window.innerHeight; }
    get max() { return Math.max(0, this.el.scrollHeight - this.vh); }
    get toBottom() { return Math.max(0, this.max - this.top); }
    atBottom() { return this.toBottom <= 2; }
    by(dy) { this.el.scrollBy({ top: dy, left: 0, behavior: "instant" }); }
    // Synligt område i viewport-koordinater (til markørplacering)
    rect() {
      const W = window.innerWidth, H = window.innerHeight;
      if (this.isRoot) return { left: 0, top: 0, right: W, bottom: H };
      const r = this.el.getBoundingClientRect();
      return { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(W, r.right), bottom: Math.min(H, r.bottom) };
    }
  };

  /** Virtuel musemarkør: sender pointer/mouse/wheel-events på elementet under sig. */
  static Pointer = class {
    constructor(rng, tgt, state) {
      const C = SimulatedScroll.CFG, r = tgt.rect();
      this.rng = rng; this.tgt = tgt; this.st = state;
      this.x = r.left + (r.right - r.left) * rng.range(...C.pointerZone);
      this.y = r.top + (r.bottom - r.top) * rng.range(...C.pointerZone);
    }
    // Elementet under markøren; ved inner-scroller skal det ligge inde i containeren
    hit() {
      const el = document.elementFromPoint(this.x, this.y);
      return el && (this.tgt.isRoot || this.tgt.el.contains(el)) ? el : this.tgt.el;
    }
    coords() {
      const sx = window.screenX + this.x, sy = window.screenY + this.y + (window.outerHeight - window.innerHeight);
      return { clientX: this.x, clientY: this.y, screenX: sx, screenY: sy, bubbles: true, cancelable: true, composed: true, view: window };
    }
    move(dx, dy) {
      const r = this.tgt.rect();
      this.x = Math.min(r.right - 5, Math.max(r.left + 5, this.x + dx));
      this.y = Math.min(r.bottom - 5, Math.max(r.top + 5, this.y + dy));
      const el = this.hit(), c = this.coords();
      el.dispatchEvent(new PointerEvent("pointermove", { ...c, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("mousemove", { ...c, buttons: 0 }));
      this.st.pointerEvents++;
    }
    async drift(n) {
      const C = SimulatedScroll.CFG, S = SimulatedScroll;
      for (let i = 0; i < n; i++) {
        this.move(this.rng.range(-C.driftPx, C.driftPx), this.rng.range(-C.driftPx, C.driftPx) * 0.5);
        await S.sleep(this.rng.int(12, 40));
      }
    }
    // true = siden lod standardhandlingen ske (vi scroller selv); false = siden håndterede det
    wheel(dy) {
      this.st.wheelEvents++;
      return this.hit().dispatchEvent(new WheelEvent("wheel", { ...this.coords(), deltaX: 0, deltaY: dy, deltaZ: 0, deltaMode: 0 }));
    }
  };

  /** Planen: læsepausernes placering/længde og intervaller mellem op-scroll. */
  static Plan = class {
    constructor(rng) {
      this.rng = rng;
      this.pauses = this.planPauses(SimulatedScroll.CFG);
    }
    planPauses(C) {
      const [lo, hi] = C.pauseZone;
      for (let tries = 0; ; tries++) {
        const at = Array.from({ length: C.readingPauses }, () => this.rng.range(lo, hi)).sort((a, b) => a - b);
        if (tries >= 100 || at.every((v, i) => i === 0 || v - at[i - 1] >= C.pauseMinGap)) {
          return at.map(v => ({ at: v, ms: this.rng.int(...C.readingPauseMs), done: false }));
        }
      }
    }
    // Næste læsepause der skal holdes nu. finalApproach: næste ryk når bunden → hold resterende pauser først.
    nextPause(progress, finalApproach) {
      return this.pauses.find(p => !p.done && (progress >= p.at || finalApproach));
    }
    upInterval(vh) { return this.rng.range(...SimulatedScroll.CFG.upEveryVh) * vh; }
    describe() { return this.pauses.map(p => `${Math.round(p.at * 100)} %/${(p.ms / 1000).toFixed(1)} s`).join(", "); }
  };

  /** Ét ryk: en hurtig serie hjul-ticks (dist < 0 = opad). */
  static async burst(tgt, rng, ptr, dist) {
    const S = SimulatedScroll, C = S.CFG, dir = Math.sign(dist), total = Math.round(Math.abs(dist)), before = tgt.top;
    let left = total, prevented = 0;
    while (left >= 1) {
      const tick = Math.min(left, Math.round(rng.range(...C.tickPx)));
      if (!ptr || ptr.wheel(dir * tick)) tgt.by(dir * tick); else prevented++;
      left -= tick;
      if (left >= 1) await S.sleep(rng.int(...C.tickGapMs));
    }
    if (!prevented) return;
    // Siden håndterede wheel selv: giv den tid, og scroll direkte hvis den ikke flyttede sig nok
    await S.sleep(C.preventedSettleMs);
    const moved = Math.abs(tgt.top - before);
    if (moved < total * C.minHandledShare) tgt.by(dir * (total - moved));
  }

  /** Ventetid med lejlighedsvis markørdrift (ligner læsning). */
  static async idle(ms, rng, ptr) {
    const S = SimulatedScroll, C = S.CFG, end = Date.now() + ms;
    while (Date.now() < end) {
      await S.sleep(Math.min(rng.int(...C.idleChunkMs), Math.max(0, end - Date.now())));
      if (ptr && Date.now() < end && rng.chance(C.idleDriftChance)) await ptr.drift(rng.int(2, 6));
    }
  }

  async* run(ctx) {
    const S = SimulatedScroll, C = S.CFG, st = ctx.state;
    const report = msg => ctx.Lib.getState(ctx, `SimulatedScroll: ${msg}`);
    const seed = (C.seed ?? Math.random() * 2 ** 32) >>> 0;
    const rng = new S.Rng(seed), tgt = new S.Target(), plan = new S.Plan(rng);
    const ptr = C.inputEvents ? new S.Pointer(rng, tgt, st) : null;
    const t0 = Date.now();
    const pct = () => `${Math.round(100 * tgt.top / Math.max(1, tgt.max))} %`;

    if (tgt.max < 1) { yield report("siden kan ikke scrolles – springer over"); return; }
    yield report(`start seed=${seed} scroller=${tgt.name} højde=${tgt.el.scrollHeight}px input=${!!ptr} læsepauser=[${plan.describe()}]`);

    let downSinceUp = 0, nextUp = plan.upInterval(tgt.vh), stuck = 0, stable = 0, reason = "tidsloft nået";

    while (Date.now() - t0 < C.maxDurationMs) {
      const vh = tgt.vh;
      const step = Math.min(rng.range(...C.stepVh) * vh, tgt.toBottom);
      const finalApproach = tgt.toBottom - step <= 2;

      // 1) Læsepause — holdes altid før bunden nås
      const pause = plan.nextPause(tgt.top / Math.max(1, tgt.max), finalApproach);
      if (pause) {
        pause.done = true;
        st.pauses++;
        yield report(`læsepause ${(pause.ms / 1000).toFixed(1)} s ved ${pct()}`);
        await S.idle(pause.ms, rng, ptr);
        continue;
      }

      // 2) Bunden — vent på lazy-load, fortsæt hvis siden voksede
      if (tgt.atBottom()) {
        await S.idle(rng.int(...C.bottomSettleMs), rng, ptr);
        if (!tgt.atBottom()) {
          stable = 0;
          yield report(`nyt indhold (højde ${tgt.el.scrollHeight}px) – fortsætter`);
          continue;
        }
        if (++stable >= C.bottomStableChecks) { reason = "bunden nået"; break; }
        continue;
      }

      // 3) Op-scroll — begrænset så nettobevægelsen altid er nedad
      if (downSinceUp >= nextUp) {
        const up = Math.min(rng.range(...C.upVh) * vh, downSinceUp * C.upMaxShare, tgt.top);
        downSinceUp = 0;
        nextUp = plan.upInterval(vh);
        if (up >= 40) {
          if (ptr) await ptr.drift(rng.int(...C.driftMoves));
          await S.burst(tgt, rng, ptr, -up);
          const wait = rng.int(...C.upWaitMs);
          st.upScrolls++;
          yield report(`op-scroll ${Math.round(up)}px til ${pct()}, venter ${(wait / 1000).toFixed(1)} s`);
          await S.idle(wait, rng, ptr);
          continue;
        }
      }

      // 4) Nedadgående ryk + hvile der holder tempoet (1 skærmhøjde / 4 s)
      const tStart = Date.now(), before = tgt.top;
      if (ptr) await ptr.drift(rng.int(...C.driftMoves));
      await S.burst(tgt, rng, ptr, step);
      const moved = tgt.top - before;
      downSinceUp += Math.max(0, moved);
      if (moved < 1) {
        if (++stuck >= C.maxStuckSteps) { reason = "scroll bevæger sig ikke"; break; }
      } else stuck = 0;
      if (++st.steps % C.logEverySteps === 0) yield report(`ryk #${st.steps} → ${pct()}`);
      await S.sleep(Math.max(0, (step / vh) * C.secondsPerViewport * 1000 - (Date.now() - tStart)));
    }

    yield report(`færdig (${reason}) efter ${Math.round((Date.now() - t0) / 1000)} s: ${st.steps} ryk, ${st.pauses} læsepauser, ${st.upScrolls} op-scroll, ${st.wheelEvents} wheel- og ${st.pointerEvents} pointer-events`);
  }
}
