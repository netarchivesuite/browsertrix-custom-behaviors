class FacebookHoverAnchors {
  static id = "Facebook Hover Anchors";

  static isMatch() {
    return location.hostname.endsWith("facebook.com");
  }

  static init() {
    return {};
  }

  async* run(ctx) {
    const { sleep, scrollIntoView } = ctx.Lib;

    const anchors = [...document.querySelectorAll(
      'a[href]:has(> span[aria-labelledby])'
    )].filter(isVisible);

    let hovered = 0;

    for (const a of anchors) {
      await scrollIntoView(a);
      await sleep(250);

      const rect = a.getBoundingClientRect();

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // Best possible from inside page context:
      a.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
      }));

      a.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
      }));

      await sleep(1000);

      hovered++;
      yield { msg: "Hovered Facebook anchor", hovered, href: a.href };
    }
  }
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < innerHeight &&
    rect.left < innerWidth &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    style.pointerEvents !== "none"
  );
}
