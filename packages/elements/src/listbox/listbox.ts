import { effect } from "@preact/signals-core";
import { selectionPublication, type Collection, type Entity, type KeyText, type Selection } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, each, scopeOf, uid, type View } from "../base/element.ts";
import "../caret/caret-group.ts";

export type RowRenderer = (entity: Entity, key: KeyText) => View;

export interface RowMenuDetail {
  readonly key: KeyText;
  /** Where to open a menu: the pointer, or the row's start for the keyboard. */
  readonly x: number;
  readonly y: number;
  readonly opener: HTMLElement;
}

/**
 * A single-select listbox over a selection's collection. The selection is
 * data the owner provides, so other views can follow it; with `publish`, the
 * listbox also publishes it to its page scope under that key. Focus stays on
 * the listbox and the active row is its `aria-activedescendant`.
 *
 * Fires `row-menu` (context menu, Shift+F10 or the Menu key) and `row-open`
 * (Enter, double-click). Keys typed into an editor inside a row are left alone.
 */
export class Listbox extends AsterElement {
  readonly #collection = this.prop<Collection | undefined>(undefined);
  readonly #selection = this.prop<Selection | undefined>(undefined);
  readonly #publish = this.prop("");
  readonly #row = this.prop<RowRenderer>(() => nothing);
  readonly #empty = this.prop<View>(nothing);
  readonly #label = this.prop("");
  readonly #prefix = uid("aster-row") + "-";

  get collection(): Collection | undefined {
    return this.#collection.value;
  }
  set collection(v: Collection | undefined) {
    this.#collection.value = v;
  }
  get selection(): Selection | undefined {
    return this.#selection.value;
  }
  set selection(v: Selection | undefined) {
    this.#selection.value = v;
  }
  /** The page-scope key to publish the selection under. */
  get publish(): string {
    return this.#publish.value;
  }
  set publish(v: string) {
    this.#publish.value = v;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.onDisconnect(
      effect(() => {
        const key = this.#publish.value;
        const selection = this.#selection.value;
        const scope = scopeOf(this);
        if (key && selection && scope) return scope.publish(key, selectionPublication(selection));
        return undefined;
      }),
    );
  }
  get renderRow(): RowRenderer {
    return this.#row.value;
  }
  set renderRow(v: RowRenderer) {
    this.#row.value = v;
  }
  /** Shown when the collection is loaded and has no rows. */
  get empty(): View {
    return this.#empty.value;
  }
  set empty(v: View) {
    this.#empty.value = v;
  }
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }

  /** The row element for a key, if it's rendered. */
  rowFor(key: KeyText): HTMLElement | undefined {
    return this.querySelector<HTMLElement>(`#${CSS.escape(this.#id(key))}`) ?? undefined;
  }

  /** Draws the eye to a row once, after it appears or is revealed. */
  flash(key: KeyText): void {
    requestAnimationFrame(() => {
      const row = this.rowFor(key);
      if (!row) return;
      row.classList.remove("aster-flash");
      void row.offsetWidth;
      row.classList.add("aster-flash");
    });
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>('[role="listbox"]')?.focus(options);
  }

  protected render(): View {
    const collection = this.#collection.value ?? this.#selection.value?.collection;
    if (!collection) return nothing;
    const all = collection.keys.value;
    const items = collection.items.value;
    const selected = this.#selection.value?.key.value;
    const row = this.#row.value;
    const rows = all.flatMap((k, i) => (k === undefined ? [] : [{ key: k, entity: items[i] }]));
    const keys = rows.map((r) => r.key);
    const empty = collection.count.value === 0;
    const active = selected !== undefined && keys.includes(selected) ? this.#id(selected) : undefined;
    return html`<aster-caret-group class="aster-listbox" role="listbox" aria-label=${this.#label.value} aria-busy=${collection.status.value === "loading" ? "true" : "false"}
      tabindex=${empty ? -1 : 0} aria-activedescendant=${active ?? nothing}
      @keydown=${(e: KeyboardEvent) => this.#key(e, keys)}
      @click=${(e: MouseEvent) => this.#click(e)}
      @dblclick=${(e: MouseEvent) => this.#open(e)}
      @contextmenu=${(e: MouseEvent) => this.#menu(e)}>
      ${each(
        rows,
        (r) => r.key,
        ({ key, entity }) => html`<div class="aster-option" role="option" id=${this.#id(key)} data-key=${key}
          aria-selected=${key === selected ? "true" : "false"}>${entity ? row(entity, key) : nothing}</div>`,
      )}
      ${empty ? html`<div class="aster-listbox-empty" role="presentation">${this.#empty.value}</div>` : nothing}
    </aster-caret-group>`;
  }

  select(key: KeyText): void {
    const selection = this.#selection.peek();
    if (!selection) return;
    selection.select(key);
    requestAnimationFrame(() => this.rowFor(key)?.scrollIntoView({ block: "nearest" }));
  }

  #id(key: KeyText): string {
    return this.#prefix + key.replace(/[^\w-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);
  }

  #rowOf(e: Event): HTMLElement | undefined {
    return (e.target as Element).closest<HTMLElement>('[role="option"]') ?? undefined;
  }

  #click(e: MouseEvent): void {
    const row = this.#rowOf(e);
    if (!row) return;
    // Dragging across a name to copy it doesn't change the selection.
    const text = getSelection();
    if (text && !text.isCollapsed && row.contains(text.anchorNode)) return;
    this.select(row.dataset.key!);
  }

  #open(e: MouseEvent): void {
    if (editing(e)) return;
    const row = this.#rowOf(e);
    if (row) this.emit("row-open", { key: row.dataset.key });
  }

  #menu(e: MouseEvent): void {
    const row = this.#rowOf(e);
    if (!row) return;
    e.preventDefault();
    this.select(row.dataset.key!);
    this.emit<RowMenuDetail>("row-menu", { key: row.dataset.key!, x: e.clientX, y: e.clientY, opener: this.#list() });
  }

  #key(e: KeyboardEvent, keys: readonly KeyText[]): void {
    if (editing(e)) return;
    const current = this.#selection.peek()?.key.peek();
    if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      if (current === undefined) return;
      e.preventDefault();
      const rect = this.rowFor(current)?.getBoundingClientRect();
      this.emit<RowMenuDetail>("row-menu", { key: current, x: rect?.left ?? 0, y: rect?.bottom ?? 0, opener: this.#list() });
      return;
    }
    if (e.key === "Enter" && current !== undefined) {
      e.preventDefault();
      this.emit("row-open", { key: current });
      return;
    }
    const i = current === undefined ? -1 : keys.indexOf(current);
    const n =
      e.key === "Home" ? 0
      : e.key === "End" ? keys.length - 1
      : e.key === "ArrowDown" ? Math.min(keys.length - 1, i + 1)
      : e.key === "ArrowUp" ? Math.max(0, i - 1)
      : undefined;
    if (n === undefined || keys[n] === undefined) return;
    e.preventDefault();
    this.select(keys[n]!);
  }

  #list(): HTMLElement {
    return this.querySelector<HTMLElement>('[role="listbox"]') ?? this;
  }
}

/** The event comes from an editor inside a row, which keeps its own keys. */
function editing(e: Event): boolean {
  return (e.target as Element).closest("input, textarea, select, [contenteditable]") !== null;
}

define("aster-listbox", Listbox);
