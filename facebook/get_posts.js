async firePointerAndMouseEvents(ctx, el) {
  if (!this.isVisible(el)) return false;

  // Move the element into a stable viewport position.
  el.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "instant"
  });

  await this.sleep(200);

  if (!this.isVisible(el)) return false;

  const r = el.getBoundingClientRect();
  const x = Math.floor(r.left + r.width / 2);
  const y = Math.floor(r.top + r.height / 2);

  // Confirm the visible point resolves to the target or one of its children.
  const pointTarget = document.elementFromPoint(x, y);

  if (!pointTarget || !(el === pointTarget || el.contains(pointTarget))) {
    ctx.log({
      msg: "Skipping hover target because center point is covered",
      tagName: pointTarget?.tagName,
      className: pointTarget?.className,
      x,
      y
    });

    return false;
  }

  ctx.log({
    msg: "Hovering Facebook target using JavaScript-only synthetic events",
    x,
    y
  });

  // Focus can trigger Facebook/React pre-resolution paths even when hover does not.
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {
      // Ignore focus failures.
    }
  }

  const commonInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 0,
    clientX: x,
    clientY: y,
    screenX: window.screenX + x,
    screenY: window.screenY + y,
    pageX: window.scrollX + x,
    pageY: window.scrollY + y,
    movementX: 0,
    movementY: 0,
    button: 0,
    buttons: 0,
    relatedTarget: null
  };

  const pointerInit = {
    ...commonInit,
    pointerId: 1,
    width: 1,
    height: 1,
    pressure: 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "mouse",
    isPrimary: true
  };

  const dispatch = async (target, type, EventCtor, init, delay = 70) => {
    if (!document.contains(target) || !this.isVisible(target)) return false;

    target.dispatchEvent(new EventCtor(type, init));
    await this.sleep(delay);

    return true;
  };

  /*
   * Dispatch on both the resolved point target and the anchor.
   * Facebook often attaches handlers to nested spans/divs rather than the <a>.
   */
  const targets = [...new Set([pointTarget, el])];

  for (const target of targets) {
    await dispatch(target, "pointerover", PointerEvent, pointerInit);
    await dispatch(target, "mouseover", MouseEvent, commonInit);
    await dispatch(target, "pointerenter", PointerEvent, pointerInit);
    await dispatch(target, "mouseenter", MouseEvent, commonInit);
  }

  // Simulate small in-place mouse movement over the element.
  for (let i = 0; i < 5; i++) {
    const moveInit = {
      ...commonInit,
      clientX: x + i,
      clientY: y + i,
      screenX: window.screenX + x + i,
      screenY: window.screenY + y + i,
      pageX: window.scrollX + x + i,
      pageY: window.scrollY + y + i,
      movementX: i === 0 ? 0 : 1,
      movementY: i === 0 ? 0 : 1
    };

    const pointerMoveInit = {
      ...pointerInit,
      ...moveInit
    };

    for (const target of targets) {
      await dispatch(target, "pointermove", PointerEvent, pointerMoveInit, 60);
      await dispatch(target, "mousemove", MouseEvent, moveInit, 60);
    }
  }

  await this.sleep(this.config.hoverDelay);

  return true;
}
