import { html, nothing } from "lit-html";
import type { View } from "../base/element.ts";

export interface WindowBarOptions {
  /** The heading's outline level. `2` is the native h2 level and adds no attribute. */
  readonly level?: number;
}

/** Shared title/chrome geometry for floating windows and dashboard portlets. */
export function windowBar(id: string, heading: string | View, actions: View, drag?: (event: PointerEvent) => void, options?: WindowBarOptions): View {
  const level = options?.level === undefined || options.level === 2 ? nothing : options.level;
  return html`<div class="aster-window-bar" @pointerdown=${drag}>
    <h2 id=${id} aria-level=${level}>${heading}</h2>${actions}
  </div>`;
}
