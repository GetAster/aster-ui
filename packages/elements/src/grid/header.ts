import { html, nothing } from "lit-html";
import type { View } from "../base/element.ts";
import type { MenuItem } from "../menu/menu.ts";
import { removeSort, sortDirection, type GridView } from "./view.ts";

export interface GridHeaderControlsOptions {
  readonly title: string;
  readonly hint: string;
  readonly refusal?: string | undefined;
  /** One-based priority among effective sort keys. */
  readonly sort?: { readonly descending: boolean; readonly index: number; readonly total: number } | undefined;
  readonly tabIndex?: number;
  readonly onSort?: (event: MouseEvent) => void;
  readonly onPointerDown?: (event: PointerEvent) => void;
  readonly menu?: { readonly label: string; readonly open: (event: MouseEvent) => void } | undefined;
  readonly resize?: { readonly start: (event: PointerEvent) => void; readonly reset: () => void } | undefined;
}

/** The host owns the columnheader wrapper, sort semantics and layout. */
export function gridHeaderControls(options: GridHeaderControlsOptions): View {
  const { title, hint, refusal, sort, tabIndex = -1, onSort, onPointerDown, menu, resize } = options;
  return html`<button type="button" class="aster-grid-sort" tabindex=${tabIndex} title=${hint}
    @pointerdown=${onPointerDown} @click=${onSort}>
    <span>${title}</span>
    ${sort ? html`<svg class="aster-grid-sort-mark" viewBox="0 0 10 10" aria-hidden="true">
      <path d=${sort.descending ? "M2 3.5 5 6.5l3-3" : "M2 6.5 5 3.5l3 3"}/></svg>
      ${sort.total > 1 ? html`<small>${sort.index}</small>` : nothing}` : nothing}
  </button>
  ${refusal ? html`<span class="aster-sr-only">${refusal}</span>` : nothing}
  ${menu ? html`<button type="button" class="aster-grid-header-menu" tabindex=${tabIndex} aria-label=${menu.label} @click=${menu.open}>
    <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8l3-3"/></svg>
  </button>` : nothing}
  ${resize ? html`<span class="aster-grid-resize" aria-hidden="true" @pointerdown=${resize.start} @dblclick=${resize.reset}></span>` : nothing}`;
}

export interface GridSortMenuLabels {
  readonly sort?: string;
  readonly ascending?: string;
  readonly descending?: string;
  readonly notSorted?: string;
  readonly addToSort?: string;
}
export interface GridSortMenuOptions {
  readonly multi: boolean;
  readonly labels?: GridSortMenuLabels;
  readonly change: (view: GridView) => void;
}

/** Actions use the captured view; the host applies policy before offering them. */
export function gridSortMenu(view: GridView, field: string, options: GridSortMenuOptions): Extract<MenuItem, { kind: "group" }> {
  const sorted = view.sort.find((key) => key.field === field);
  const { labels = {}, change } = options;
  return { kind: "group", label: labels.sort ?? "Sort", items: [
    { kind: "radio", label: labels.ascending ?? "Ascending", checked: !!sorted && !sorted.descending, run: () => change(sortDirection(view, field, false, false)) },
    { kind: "radio", label: labels.descending ?? "Descending", checked: !!sorted?.descending, run: () => change(sortDirection(view, field, true, false)) },
    { kind: "radio", label: labels.notSorted ?? "Not sorted", checked: !sorted, run: () => change(removeSort(view, field)) },
    ...(options.multi && view.sort.length > 0 && !sorted ? [{ label: labels.addToSort ?? "Add to sort", run: () => change(sortDirection(view, field, false, true)) }] : []),
  ] };
}
