import { html } from "lit-html";
import type { View } from "../base/element.ts";

/** Shared title/chrome geometry for floating windows and dashboard portlets. */
export function windowBar(id: string, heading: string, actions: View, drag?: (event: PointerEvent) => void): View {
  return html`<div class="aster-window-bar" @pointerdown=${drag}>
    <h2 id=${id}>${heading}</h2>${actions}
  </div>`;
}
