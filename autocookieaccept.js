class AutoCookieScrollBehavior {
  static id = "Auto Cookie Accept + Scroll";

  static isMatch() {
    return true;
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async *run(msg) {
    const maxScreens = 15;
    let screensScrolled = 0;

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    // ---- Cookie accept (hover + click) helpers ----
    const TERMS = ["accept", "tillad"];

    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = getComputedStyle(el);
      return (
        st.display !== "none" &&
        st.visibility !== "hidden" &&
        st.pointerEvents !== "none"
      );
    };

    const getCenter = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const dispatchMouse = (el, type, { x, y }) => {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
        })
      );
    };

    const dispatchPointer = (el, type, { x, y }) => {
      if (typeof PointerEvent === "function") {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            isPrimary: true,
            clientX: x,
            clientY: y,
          })
        );
      }
    };

    const hoverThenClick = (el, delayMs = 150) => {
      el.scrollIntoView({ block: "center", inline: "center" });
      const pos = getCenter(el);

      // Hover sequence (simulated events; cannot move OS cursor)
      dispatchPointer(el, "pointerover", pos);
      dispatchPointer(el, "pointerenter", pos);
      dispatchPointer(el, "pointermove", pos);
      dispatchMouse(el, "mouseover", pos);
      dispatchMouse(el, "mouseenter", pos);
      dispatchMouse(el, "mousemove", pos);

      return new Promise((resolve) => {
        setTimeout(() => {
          dispatchPointer(el, "pointerdown", pos);
          dispatchMouse(el, "mousedown", pos);

          dispatchPointer(el, "pointerup", pos);
          dispatchMouse(el, "mouseup", pos);

          dispatchMouse(el, "click", pos);
          el.click(); // fallback

          resolve();
        }, delayMs);
      });
    };

    const acceptCookiesOnce = async () => {
      const matches = Array.from(
        document.querySelectorAll('button, [role="button"]')
      )
        .filter(isVisible)
        .filter((el) => {
          const text = norm(el.innerText || el.textContent);
          return TERMS.some((t) => text.includes(t));
        });

      if (!matches.length) return 0;

      // De-duplicate (sometimes the same element appears via different selectors)
      const unique = Array.from(new Set(matches));

      for (const el of unique) {
        try {
          await hoverThenClick(el, 150);
          await sleep(200);
        } catch (_) {
          // ignore and continue
        }
      }
      return unique.length;
    };

    // Try immediately on load (common cookie banner timing)
    await acceptCookiesOnce();
    await sleep(250);
    await acceptCookiesOnce();

    // ---- Scroll loop ----
    while (screensScrolled < maxScreens) {
      // Try before each scroll (banner may appear late)
      await acceptCookiesOnce();

      const before = window.scrollY;
      const viewportHeight = window.innerHeight;

      window.scrollBy({ top: viewportHeight, behavior: "smooth" });
      await sleep(750);

      // Try after scroll as well (some banners trigger on scroll)
      await acceptCookiesOnce();

      const after = window.scrollY;

      if (after === before) {
        console.log("Reached page end.");
        break;
      }

      screensScrolled++;
    }

    yield { msg: "AutoCookieScrollBehavior: scrolling finished" };
  }
}
