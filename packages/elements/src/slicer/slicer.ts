import type { Contribution, SharedFilters } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, each, uid, type View } from "../base/element.ts";
import { announce } from "../toast/toast.ts";

const CROSS = html`<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" /></svg>`;

/**
 * The page's shared filter as chips: one per contribution, said in words,
 * each removing its own. It's a toolbar (WAI-ARIA APG): one tab stop; ←, →,
 * Home and End move between chips; Enter, Space, Delete and Backspace remove
 * the focused one; focus then moves to its neighbour, or to the "no
 * filters" text when none is left. "Clear all" is the last item when there
 * are two or more. Every removal is announced.
 *
 * A contribution whose contributor gave no way to withdraw it (`removable`
 * false) shows as a chip that can't be pressed, and says so.
 */
export class Slicer extends AsterElement {
  readonly #filters = this.prop<SharedFilters | undefined>(undefined);
  readonly #label = this.prop("Filters");
  readonly #empty = this.prop("None. Showing everything.");
  /** The roving tab stop, by position among the toolbar's items. */
  readonly #active = this.prop(0);
  readonly #id = uid("aster-slicer");
  /** Where focus goes after the next commit: an item's position, or the empty text. */
  #refocus: number | "empty" | undefined;

  get filters(): SharedFilters | undefined {
    return this.#filters.value;
  }
  set filters(v: SharedFilters | undefined) {
    this.#filters.value = v;
  }
  /** Names the toolbar, and shows before the chips. */
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /** Shown, and focused after the last removal, when there are no contributions. */
  get empty(): string {
    return this.#empty.value;
  }
  set empty(v: string) {
    this.#empty.value = v;
  }

  protected render(): View {
    const filters = this.#filters.value;
    if (!filters) return nothing;
    const items = filters.contributions.value;
    const label = html`<span class="aster-slicer-label" id=${`${this.#id}-label`}>${this.#label.value}</span>`;
    if (items.length === 0) {
      return html`<div class="aster-slicer">${label}<p class="aster-slicer-empty" tabindex="-1" aria-describedby=${`${this.#id}-label`}>${this.#empty.value}</p></div>`;
    }
    const count = items.length + (items.length > 1 ? 1 : 0);
    const active = Math.min(this.#active.value, count - 1);
    return html`<div class="aster-slicer">
      ${label}
      <div class="aster-slicer-chips" role="toolbar" aria-labelledby=${`${this.#id}-label`} @keydown=${(e: KeyboardEvent) => this.#key(e, count)}>
        ${each(
          items,
          (c) => c.by,
          (c) => {
            const i = items.indexOf(c);
            const removable = filters.removable(c.by);
            return html`<button type="button" class="aster-slicer-chip" data-index=${i} tabindex=${i === active ? 0 : -1}
              aria-label=${removable ? `Remove filter: ${c.label}` : `Filter: ${c.label}, set by its source`}
              aria-disabled=${removable ? nothing : "true"}
              @click=${() => this.#remove(c, i)} @focus=${() => (this.#active.value = i)}>
              <span>${c.label}</span>${removable ? CROSS : nothing}
            </button>`;
          },
        )}
        ${items.length > 1
          ? html`<button type="button" class="aster-slicer-clear" data-index=${items.length} tabindex=${active === items.length ? 0 : -1}
              @click=${() => this.#clearAll()} @focus=${() => (this.#active.value = items.length)}>Clear all</button>`
          : nothing}
      </div>
    </div>`;
  }

  protected override updated(): void {
    const to = this.#refocus;
    if (to === undefined) return;
    this.#refocus = undefined;
    const target = to === "empty" ? this.querySelector<HTMLElement>(".aster-slicer-empty") : this.querySelector<HTMLElement>(`[data-index="${to}"]`);
    target?.focus();
  }

  #key(e: KeyboardEvent, count: number): void {
    const at = Number((e.target as HTMLElement).closest("[data-index]")?.getAttribute("data-index") ?? 0);
    let to: number | undefined;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        to = (at + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        to = (at - 1 + count) % count;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = count - 1;
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        (e.target as HTMLElement).closest<HTMLButtonElement>(".aster-slicer-chip")?.click();
        return;
      default:
        return;
    }
    e.preventDefault();
    this.#active.value = to;
    this.querySelector<HTMLElement>(`[data-index="${to}"]`)?.focus();
  }

  #remove(c: Contribution, at: number): void {
    const filters = this.#filters.peek();
    if (!filters?.removable(c.by)) return;
    filters.remove(c.by);
    const left = filters.contributions.peek().length;
    // The neighbour that slid into this place, or the one before it.
    const next = left === 0 ? "empty" : Math.min(at, left - 1);
    this.#active.value = next === "empty" ? 0 : next;
    this.#refocus = next;
    announce(`Removed filter: ${c.label}. ${left === 0 ? "No filters." : left === 1 ? "1 filter left." : `${left} filters left.`}`);
    this.emit("slicer-change", { removed: [c.by] });
  }

  #clearAll(): void {
    const filters = this.#filters.peek();
    if (!filters) return;
    const before = filters.contributions.peek().map((c) => c.by);
    filters.clear();
    const left = filters.contributions.peek().length;
    this.#active.value = 0;
    this.#refocus = left === 0 ? "empty" : 0;
    announce(left === 0 ? "Cleared all filters." : `Cleared the filters that can be removed. ${left === 1 ? "1 filter left." : `${left} filters left.`}`);
    this.emit("slicer-change", { removed: before.filter((b) => !filters.contributions.peek().some((c) => c.by === b)) });
  }
}

define("aster-slicer", Slicer);
