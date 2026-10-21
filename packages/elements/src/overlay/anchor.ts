import { nothing } from "lit-html";
import { ref } from "lit-html/directives/ref.js";

/**
 * Overlays live in the top layer, so no scroll container or section clips
 * them, and are placed against their anchor by CSS anchor positioning,
 * flipping at the viewport's edges (`.aster-popover` in elements.css). JS
 * only names the anchor and opens or closes the popover.
 *
 * Usage: the anchor gets `style=${anchorStyle(id)}`; the overlay gets
 * `popover="manual" class="aster-popover" style=${placeStyle(id)} ${openWhen(open)}`.
 */
export function anchorStyle(id: string): string {
  return `anchor-name: --${id}`;
}

export function placeStyle(id: string): string {
  return `position-anchor: --${id}`;
}

/**
 * Shows or hides the popover it's on to match `open`. A popover rendered
 * fresh isn't in the document yet when this runs, so it syncs once it is.
 */
export function openWhen(open: boolean) {
  return ref((el) => {
    if (!(el instanceof HTMLElement)) return;
    const sync = () => {
      if (!el.isConnected) return;
      const showing = el.matches(":popover-open");
      if (open && !showing) el.showPopover();
      else if (!open && showing) el.hidePopover();
    };
    if (el.isConnected) sync();
    else queueMicrotask(sync);
  });
}

export { nothing };
