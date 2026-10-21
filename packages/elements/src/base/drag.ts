/**
 * Pointer drags that work on touch screens too.
 *
 * A mouse lifts a drag once it moves `distance` pixels. A touch or pen
 * lifts it by holding still for `HOLD_MS`; moving more than `HOLD_SLOP`
 * first is a scroll, left to the browser, and the press is forgotten.
 * `touch-action` is fixed when a touch starts, so it stays at the default
 * (scrolling works everywhere) and a lifted drag holds the page still by
 * cancelling its `touchmove`s instead. While a drag is lifted, its
 * scroller follows it near the top and bottom edges.
 *
 * Moves are listened for on the document by pointer id, so they keep
 * arriving when the row under the finger is re-rendered away; only a mouse
 * takes pointer capture.
 */

/** How long a touch or pen holds still to lift a drag. */
export const HOLD_MS = 400;
/** How far a held touch or pen may drift and still be holding still. */
export const HOLD_SLOP = 8;
/** The auto-scroll band at a scroller's top and bottom, and the most it scrolls per frame. */
const EDGE = 48;
const SPEED = 16;

export interface DragOptions {
  /** How far a mouse moves before the drag lifts. */
  readonly distance: number;
  /** A mouse's distance counts only up and down. */
  readonly vertical?: boolean;
  /** Takes a mouse's pointer capture once the drag lifts. */
  readonly capture: Element;
  /** Scrolls as a lifted pointer nears its edges; by default the nearest scrolling ancestor of `capture`. */
  readonly scroller?: () => Element | null;
  /** Height at the scroller's top that isn't part of it (a sticky header). */
  readonly inset?: () => number;
  /** Escape during the press cancels it. */
  readonly escape?: boolean;
}

export interface DragHandlers {
  /** The press became a drag; `move` follows straight away with the pointer's place. */
  lift(): void;
  /** Where the pointer is while lifted, including after an auto-scroll moved the content under it. */
  move(x: number, y: number): void;
  /** A lifted drag ended: dropped where the pointer let go, or cancelled. */
  end(drop: boolean): void;
}

/** Whether a press lifts by holding still (touch, pen) rather than by moving (mouse). */
export function holds(e: PointerEvent): boolean {
  return e.pointerType === "touch" || e.pointerType === "pen";
}

/** Follows the press `down` until it lifts a drag and ends, or turns out to be a tap or a scroll. */
export function pressDrag(down: PointerEvent, options: DragOptions, handlers: DragHandlers): void {
  const id = down.pointerId;
  const hold = holds(down);
  const from = { x: down.clientX, y: down.clientY };
  let at = from;
  let lifted = false;
  let frame = 0;
  const scroller = options.scroller?.() ?? scrollerOf(options.capture);

  const lift = () => {
    lifted = true;
    if (!hold) options.capture.setPointerCapture(id);
    handlers.lift();
    handlers.move(at.x, at.y);
    follow();
  };
  const timer = hold ? setTimeout(lift, HOLD_MS) : undefined;

  /** Scrolls while the pointer is in an edge band, re-reporting its place as the content moves. */
  const follow = () => {
    if (frame || !scroller) return;
    const step = () => {
      frame = 0;
      const v = lifted ? speed(scroller, at.y, options.inset?.() ?? 0) : 0;
      if (!v) return;
      const before = scroller.scrollTop;
      scroller.scrollTop += v;
      if (scroller.scrollTop === before) return;
      handlers.move(at.x, at.y);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    at = { x: e.clientX, y: e.clientY };
    if (!lifted) {
      const dx = at.x - from.x;
      const dy = at.y - from.y;
      if (hold) {
        if (Math.hypot(dx, dy) > HOLD_SLOP) stop(false);
      } else if ((options.vertical ? Math.abs(dy) : Math.hypot(dx, dy)) >= options.distance) lift();
      return;
    }
    handlers.move(at.x, at.y);
    follow();
  };
  const up = (e: PointerEvent) => e.pointerId === id && stop(true);
  const cancel = (e: PointerEvent) => e.pointerId === id && stop(false);
  const still = (e: Event) => lifted && e.preventDefault();
  // A held press would otherwise open the context menu or start selecting text.
  const quiet = (e: Event) => e.preventDefault();
  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    stop(false);
  };

  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
    [document, "pointermove", move as EventListener],
    [document, "pointerup", up as EventListener],
    [document, "pointercancel", cancel as EventListener],
  ];
  if (hold) {
    listeners.push([document, "touchmove", still, { passive: false }], [window, "contextmenu", quiet, { capture: true }], [document, "selectstart", quiet, { capture: true }]);
  }
  if (options.escape) listeners.push([document, "keydown", escape as EventListener, { capture: true }]);
  for (const [target, type, fn, o] of listeners) target.addEventListener(type, fn, o);

  function stop(drop: boolean): void {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    frame = 0;
    for (const [target, type, fn, o] of listeners) target.removeEventListener(type, fn, o);
    if (options.capture.hasPointerCapture(id)) options.capture.releasePointerCapture(id);
    if (lifted) handlers.end(drop);
    lifted = false;
  }
}

/** Pixels per frame to scroll `el` with the pointer at `y`: negative up, 0 outside the edge bands. */
function speed(el: Element, y: number, inset: number): number {
  const page = el === document.scrollingElement;
  const top = (page ? 0 : el.getBoundingClientRect().top) + inset;
  const bottom = page ? innerHeight : el.getBoundingClientRect().bottom;
  const band = Math.min(EDGE, (bottom - top) / 4);
  if (band <= 0 || y < top) return 0;
  if (y < top + band) return -Math.ceil((SPEED * (top + band - y)) / band);
  if (y > bottom - band) return Math.ceil((SPEED * Math.min(band, y - (bottom - band))) / band);
  return 0;
}

function scrollerOf(el: Element): Element {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement ?? document.documentElement;
}
