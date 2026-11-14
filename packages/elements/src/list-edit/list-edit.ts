import type { Collection, EditDraft, ListEdit, ListRow, Selection } from "@getaster/data";
import { html, nothing } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import type { PickerOptions } from "../picker/options.ts";
import { AsterElement, define, each, type View } from "../base/element.ts";
import { holds, pressDrag } from "../base/drag.ts";
import { controlFor } from "../form/controls.ts";
import { formatValue } from "../field/values.ts";

export interface ListColumn {
  readonly field: string;
  /** A CSS track size; `1fr` by default. */
  readonly width?: string;
  /** Makes a foreign key a picker over these records. */
  readonly options?: Collection | PickerOptions;
  /** Shows an option's text instead of the key, for read-only rows. */
  readonly display?: (row: ListRow) => string;
}

/** When rows show their controls: always (the default), or only the one row being edited. */
export type ListEditing = "always" | "row";

/** The parts of the list editor it draws. Omitted fields keep their defaults. */
export interface ListEditorChrome {
  /** The built-in Add button. Default `true`. */
  readonly add?: boolean;
}

/** What one render knows about the rows' mode, so each row reads the same state. */
interface RowsView {
  readonly rows: boolean;
  readonly template: ((row: ListRow) => View) | undefined;
  readonly editing: string | undefined;
  readonly selected: string | undefined;
  readonly selectable: boolean;
  readonly active: string | undefined;
}

/**
 * The rows of a list edit as a grid of fields. A new row shows as pending
 * in full. Removing an existing row marks it for deletion: it shows struck
 * through and read-only, with Undo, until the list is saved. Removing a new
 * row discards it. A changed row offers Revert. While `readOnly`, rows show
 * as text, with `readOnlyReason` above them, and nothing can be added.
 *
 * A list with a position field can be reordered: by dragging a row's handle
 * (a touch or pen holds it still first), or with Alt+↑ and Alt+↓ on it, the
 * new place announced.
 *
 * With `editing = "row"` rows read as text, or as the host's `row` template,
 * until one is activated (double-click, or Enter on a focused row): that row
 * alone shows its controls. Enter keeps its changes as pending draft, Escape
 * puts the row back as it was when editing began and discards a new row no
 * Enter has kept. The rows then follow the grid pattern (`role="grid"`,
 * focusable rows, Up and Down between them), and an optional single-select
 * `selection` marks one.
 */
export class ListEditor extends AsterElement {
  readonly #list = this.prop<ListEdit | undefined>(undefined);
  readonly #columns = this.prop<readonly ListColumn[]>([]);
  readonly #label = this.prop("");
  readonly #addLabel = this.prop("Add");
  readonly #empty = this.prop<View>(nothing);
  readonly #readOnly = this.prop<string | undefined>(undefined);
  readonly #mode = this.prop<ListEditing>("always");
  readonly #rowView = this.prop<((row: ListRow) => View) | undefined>(undefined);
  readonly #chrome = this.prop<ListEditorChrome>({});
  readonly #selection = this.prop<Selection | undefined>(undefined);
  /** The row being edited in `"row"` mode. */
  readonly #editingId = this.prop<string | undefined>(undefined);
  /** The row that holds the tab stop in `"row"` mode. */
  readonly #active = this.prop<string | undefined>(undefined);
  /** The row's state when editing began: what Escape puts back. `fresh` is a new row no Enter has kept yet: Escape discards it. */
  #session: { readonly id: string; readonly draft: EditDraft; readonly fresh: boolean } | undefined;
  /** New rows an Enter has kept, so Escape no longer discards them. */
  readonly #kept = new Set<string>();
  /** What to focus once it has rendered: a row's first control, its handle, the row itself, or the Add button. */
  #focus: { readonly id: string; readonly to: "control" | "handle" | "row" | "add" } | undefined;
  readonly #said = this.prop("");
  /** A row being dragged: where its drop line is, whether a touch lifted it, and whether that touch is outside the list. */
  readonly #drag = this.prop<{ readonly id: string; readonly to: number; readonly lifted: boolean; readonly outside: boolean } | undefined>(undefined);

  get list(): ListEdit | undefined {
    return this.#list.value;
  }
  set list(v: ListEdit | undefined) {
    this.#list.value = v;
  }
  get columns(): readonly ListColumn[] {
    return this.#columns.value;
  }
  set columns(v: readonly ListColumn[]) {
    this.#columns.value = v;
  }
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  get addLabel(): string {
    return this.#addLabel.value;
  }
  set addLabel(v: string) {
    this.#addLabel.value = v;
  }
  /** Why the rows can't be edited now; set, even to an empty string, it makes the list read-only. */
  get readOnlyReason(): string | undefined {
    return this.#readOnly.value;
  }
  set readOnlyReason(v: string | undefined) {
    this.#readOnly.value = v;
  }
  /** `"always"` (default) shows every row's controls; `"row"` shows them only on the row being edited. */
  get editing(): ListEditing {
    return this.#mode.value;
  }
  set editing(v: ListEditing) {
    if (v !== "always" && v !== "row") throw new TypeError('editing must be "always" or "row"');
    this.#mode.value = v;
  }
  /** In `"row"` mode, draws a row that isn't being edited, in place of its column values. Default `undefined`: the values as text. */
  get row(): ((row: ListRow) => View) | undefined {
    return this.#rowView.value;
  }
  set row(v: ((row: ListRow) => View) | undefined) {
    this.#rowView.value = v;
  }
  /** The parts of the list drawn, as [[object:ListEditorChrome]]. */
  get chrome(): ListEditorChrome {
    return this.#chrome.value;
  }
  set chrome(v: ListEditorChrome) {
    this.#chrome.value = { ...(v ?? {}) };
  }
  /** A single selection, marked on its row in `"row"` mode. Up and Down move it. */
  get selection(): Selection | undefined {
    return this.#selection.value;
  }
  set selection(v: Selection | undefined) {
    this.#selection.value = v;
  }
  /** Shown when there are no rows. */
  get empty(): View {
    return this.#empty.value;
  }
  set empty(v: View) {
    this.#empty.value = v;
  }

  protected render(): View {
    const list = this.#list.value;
    if (!list) return nothing;
    const columns = this.#columns.value;
    const type = list.type;
    const rows = list.rows.value;
    const reason = this.#readOnly.value;
    const readOnly = reason !== undefined;
    const ordered = list.ordered && !readOnly;
    const tracks = styleMap({ "--list-columns": `${ordered ? "24px " : ""}${columns.map((c) => c.width ?? "1fr").join(" ")} auto` });
    const drag = this.#drag.value;
    const view: RowsView = {
      rows: this.#mode.value === "row",
      template: this.#rowView.value,
      editing: this.#editingId.value,
      selected: this.#selection.value?.key.value,
      selectable: this.#selection.value !== undefined,
      active: this.#active.value !== undefined && rows.some((r) => r.id === this.#active.value) ? this.#active.value : rows[0]?.id,
    };
    // Rows that take focus, are selected and activate are a grid, which a table can't be.
    const [grid, cell] = view.rows ? ["grid", "gridcell"] : ["table", "cell"];
    return html`${reason ? html`<p class="aster-hint">${reason}</p>` : nothing}
      <div class="aster-list-edit" role=${grid} aria-label=${this.#label.value} style=${tracks} ?data-rows=${view.rows}
        @click=${(e: MouseEvent) => this.#click(e)} @dblclick=${(e: MouseEvent) => this.#dblclick(e)}
        @focusin=${(e: FocusEvent) => this.#focusin(e)} @keydown=${(e: KeyboardEvent) => this.#key(e)}>
        ${view.rows && view.template ? nothing : html`<div class="aster-list-edit-row aster-list-edit-head" role="row">
          ${ordered ? html`<span role="columnheader"><span class="aster-sr-only">Order</span></span>` : nothing}
          ${columns.map((c) => html`<span role="columnheader">${type.field(c.field)?.title ?? c.field}</span>`)}
          <span role="columnheader"><span class="aster-sr-only">Actions</span></span>
        </div>`}
        ${each(rows, (r) => r.id, (r) => this.#row(r, columns, readOnly, ordered, view, cell))}
        ${drag && !drag.outside ? html`<div class="aster-list-edit-drop" aria-hidden="true" style=${`--at:${drag.to}`}></div>` : nothing}
      </div>
      <span class="aster-sr-only" aria-live="polite">${this.#said.value}</span>
      ${rows.length === 0 ? html`<p class="aster-list-edit-empty">${this.#empty.value}</p>` : nothing}
      ${readOnly || this.#chrome.value.add === false
        ? nothing
        : html`<button type="button" class="aster-list-edit-add" @click=${() => this.#add(list)}>
            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9"/></svg>${this.#addLabel.value}
          </button>`}`;
  }

  #row(row: ListRow, columns: readonly ListColumn[], readOnly: boolean, ordered: boolean, view: RowsView, cell: string): View {
    const list = this.#list.peek()!;
    const { edit } = row;
    const editing = view.rows && view.editing === row.id && !row.removing && !readOnly;
    // In "row" mode a row not being edited reads as text, or as the host's template.
    const reading = (view.rows && !editing) || row.removing || readOnly;
    const first = String(edit.values.value[columns[0]?.field ?? ""] ?? "") || "new row";
    // Struck through or marked new is drawn; the first cell also says it.
    const said = row.removing ? "To be removed: " : row.isNew ? "New: " : "";
    const lead = (i: number) => (i === 0 && said ? html`<span class="aster-sr-only">${said}</span>` : nothing);
    const templated = view.rows && view.template && reading;
    const cells = templated
      ? html`<span role=${cell} class="aster-list-edit-read" style=${`grid-column: span ${columns.length}`}>${lead(0)}${view.template!(row)}</span>`
      : reading
      ? columns.map(
          (c, i) => html`<span role=${cell} class="aster-list-edit-static" ?data-pending=${!row.removing && edit.pending(c.field).value}>${lead(i)}${c.display?.(row) ?? formatValue(edit.type.field(c.field), edit.values.value[c.field])}</span>`,
        )
      : columns.map((c, i) => {
          // A field this row can't change (a key once set) reads as text, its reason on hover, not repeated on every row.
          const state = edit.state(c.field).value;
          return state.readOnly && !row.isNew
            ? html`<span role=${cell} class="aster-list-edit-static" title=${state.reasons.readOnly ?? ""}>${lead(i)}${c.display?.(row) ?? formatValue(edit.type.field(c.field), edit.values.value[c.field])}</span>`
            : html`<span role=${cell}>${lead(i)}${controlFor(edit, c.field, { options: c.options, labelled: false })}</span>`;
        });
    const action = readOnly
      ? nothing
      : row.removing
      ? html`<button type="button" class="aster-list-edit-action" @click=${() => list.restore(row.id)}
          aria-label=${`Undo removing ${first}`}>Undo</button>`
      : html`${edit.dirty.value && !row.isNew
            ? html`<button type="button" class="aster-list-edit-action" @click=${() => edit.revert()}
                aria-label=${`Revert ${first}`}>Revert</button>`
            : nothing}
          <button type="button" class="aster-list-edit-action" @click=${() => list.remove(row.id)}
            aria-label=${`Remove ${first}`}>Remove</button>`;
    const handle = !ordered
      ? nothing
      : row.removing
      ? html`<span role=${cell}></span>`
      : html`<span role=${cell}><button type="button" class="aster-list-edit-handle" aria-label=${`Move ${first}`}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="Drag, or Alt+↑ and Alt+↓"
          @keydown=${(e: KeyboardEvent) => this.#moveKey(e, row, first)}
          @pointerdown=${(e: PointerEvent) => this.#dragStart(e, row, first)}>
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3.5h.01M9 3.5h.01M5 7h.01M9 7h.01M5 10.5h.01M9 10.5h.01"/></svg>
        </button></span>`;
    return html`<div class="aster-list-edit-row" role="row" data-id=${row.id} ?data-new=${row.isNew} ?data-removing=${row.removing}
        ?data-pending=${row.isNew || edit.dirty.value} ?data-dragging=${this.#drag.value?.id === row.id}
        ?data-lifted=${this.#drag.value?.id === row.id && this.#drag.value.lifted} ?data-editing=${editing}
        tabindex=${view.rows ? (view.active === row.id ? "0" : "-1") : nothing}
        aria-selected=${view.rows && view.selectable ? (view.selected === row.id ? "true" : "false") : nothing}>
      ${handle}${cells}
      <span role=${cell} class="aster-list-edit-actions">${action}</span>
      ${row.removeError ? html`<p class="aster-error aster-list-edit-error" role="alert">${row.removeError}</p>` : nothing}
    </div>`;
  }

  /** Where `row` is among the rows not being removed, and how many there are. */
  #place(row: ListRow): [number, number] {
    const live = this.#list.peek()!.rows.peek().filter((r) => !r.removing);
    return [live.findIndex((r) => r.id === row.id), live.length];
  }

  #moveTo(row: ListRow, index: number, name: string): void {
    const [from, count] = this.#place(row);
    const to = Math.max(0, Math.min(count - 1, index));
    if (to === from) return;
    this.#list.peek()!.move(row.id, to);
    this.#said.value = `${name}, moved to ${to + 1} of ${count}`;
    this.#focus = { id: row.id, to: "handle" };
  }

  #moveKey(e: KeyboardEvent, row: ListRow, name: string): void {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    this.#moveTo(row, this.#place(row)[0] + (e.key === "ArrowUp" ? -1 : 1), name);
  }

  /**
   * Dragging by the handle: a mouse lifts the row past a few pixels, a touch
   * or pen by holding still (`pressDrag`), the row then drawn lifted. The
   * drop line follows the pointer between rows; letting go moves the row
   * there. Escape or an interrupted pointer doesn't, and nor does a touch
   * let go outside the list.
   */
  #dragStart(e: PointerEvent, row: ListRow, name: string): void {
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    const touch = holds(e);
    const table = this.querySelector<HTMLElement>(".aster-list-edit")!;
    const rows = () => [...this.querySelectorAll<HTMLElement>(".aster-list-edit-row[data-id]:not([data-removing])")];
    const others = () => rows().filter((el) => el.dataset.id !== row.id);
    const indexAt = (y: number) => others().filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 < y;
    }).length;
    const [from, count] = this.#place(row);
    let target: number | undefined;
    let outside = false;
    pressDrag(e, { distance: 4, vertical: true, capture: handle, escape: true }, {
      lift: () => (this.#said.value = `Picked up ${name}, ${from + 1} of ${count}`),
      move: (x, y) => {
        target = indexAt(y);
        const el = others()[target - 1];
        const box = table.getBoundingClientRect();
        const line = el ? el.getBoundingClientRect().bottom - box.top : (rows()[0]?.offsetTop ?? 0);
        outside = touch && (x < box.left || x > box.right || y < box.top - 24 || y > box.bottom + 24);
        this.#drag.value = { id: row.id, to: Math.round(line), lifted: touch, outside };
      },
      end: (drop) => {
        this.#drag.value = undefined;
        if (drop && !outside && target !== undefined && target !== from) this.#moveTo(row, target, name);
        else this.#said.value = `${name} not moved`;
      },
    });
  }

  protected override updated(): void {
    this.#applyFocus();
    const id = this.#editingId.peek();
    // The row being edited was removed or discarded from outside.
    if (id !== undefined && !this.#list.peek()?.rows.peek().some((r) => r.id === id && !r.removing)) {
      this.#session = undefined;
      this.#editingId.value = undefined;
    }
  }

  /** Focuses what `#focus` names once it exists. */
  #applyFocus(): void {
    const want = this.#focus;
    if (!want) return;
    const row = `[data-id="${CSS.escape(want.id)}"]`;
    const target = this.querySelector<HTMLElement>(
      want.to === "add" ? ".aster-list-edit-add"
      : want.to === "row" ? row
      : `${row} ${want.to === "handle" ? ".aster-list-edit-handle" : ":is(input, select, textarea)"}`,
    );
    if (!target) return;
    this.#focus = undefined;
    target.focus();
  }

  /** Starts editing a row and focuses its first control. In `"always"` mode every row is already editable, so this only focuses. Does nothing for a row that is being removed, or while read-only. */
  edit(id: string): void {
    const list = this.#list.peek();
    const row = list?.rows.peek().find((r) => r.id === id);
    if (!list || !row || row.removing || this.#readOnly.peek() !== undefined) return;
    if (this.#mode.peek() === "row") {
      if (this.#editingId.peek() === id) return this.#toward(id, "control");
      const current = this.#editingId.peek();
      if (current !== undefined) this.#finish(true);
      this.#session = { id, draft: row.edit.draft(), fresh: row.isNew && !this.#kept.has(id) };
      this.#editingId.value = id;
      this.#active.value = id;
      this.#said.value = `Editing ${this.#name(row)}`;
    }
    this.#toward(id, "control");
  }

  #toward(id: string, to: "control" | "handle" | "row" | "add"): void {
    this.#focus = { id, to };
    // Focus now if the row is already there; otherwise after the render this change caused.
    queueMicrotask(() => this.#applyFocus());
  }

  #name(row: ListRow): string {
    return String(row.edit.values.peek()[this.#columns.peek()[0]?.field ?? ""] ?? "") || "new row";
  }

  /** Ends the row being edited: kept as a pending draft, or put back as it was when editing began. */
  #finish(keep: boolean): void {
    const session = this.#session;
    this.#session = undefined;
    this.#editingId.value = undefined;
    const list = this.#list.peek();
    if (!session || !list) return;
    const row = list.rows.peek().find((r) => r.id === session.id);
    if (!row) return;
    const name = this.#name(row);
    if (keep) {
      this.#kept.add(row.id);
      this.#said.value = `Finished editing ${name}`;
      this.#toward(row.id, "row");
      return;
    }
    if (session.fresh) {
      const live = list.rows.peek().filter((r) => !r.removing);
      const at = live.findIndex((r) => r.id === row.id);
      const next = live[at + 1] ?? live[at - 1];
      list.remove(row.id);
      this.#said.value = "New row discarded";
      if (next) this.#toward(next.id, "row");
      else this.#toward(row.id, "add");
      return;
    }
    row.edit.resume(session.draft);
    row.edit.showErrors({});
    this.#said.value = `Editing ${name} cancelled`;
    this.#toward(row.id, "row");
  }

  #rowOf(e: Event): HTMLElement | undefined {
    return (e.target as Element).closest<HTMLElement>(".aster-list-edit-row[data-id]") ?? undefined;
  }

  /** A press on a control or action belongs to it, not to the row. */
  #inside(e: Event): boolean {
    return (e.target as Element).closest("button, input, select, textarea, a, [role=combobox], [contenteditable]") !== null;
  }

  #click(e: MouseEvent): void {
    if (this.#mode.peek() !== "row") return;
    const row = this.#rowOf(e);
    if (!row || this.#inside(e)) return;
    this.#choose(row.dataset.id!);
  }

  #dblclick(e: MouseEvent): void {
    if (this.#mode.peek() !== "row") return;
    const row = this.#rowOf(e);
    if (!row || this.#inside(e) || row.hasAttribute("data-editing")) return;
    this.edit(row.dataset.id!);
  }

  #focusin(e: FocusEvent): void {
    if (this.#mode.peek() !== "row") return;
    const id = this.#rowOf(e)?.dataset.id;
    if (id !== undefined && this.#active.peek() !== id) this.#active.value = id;
  }

  /** Makes a row the tab stop and, when it's a saved row, the selection. */
  #choose(id: string): void {
    this.#active.value = id;
    const row = this.#list.peek()?.rows.peek().find((r) => r.id === id);
    if (row && !row.isNew) this.#selection.peek()?.select(id);
  }

  #key(e: KeyboardEvent): void {
    if (this.#mode.peek() !== "row" || e.altKey || e.ctrlKey || e.metaKey) return;
    const row = this.#rowOf(e);
    if (!row) return;
    const id = row.dataset.id!;
    const target = e.target as HTMLElement;
    if (row.hasAttribute("data-editing")) {
      // A control that handled the key itself, such as an open picker, keeps it.
      if (e.defaultPrevented) return;
      const field = target === row || target.matches("input, select, textarea");
      if (e.key === "Enter" && field && !(e.shiftKey && target.matches("textarea"))) {
        e.preventDefault();
        this.#finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.#finish(false);
      }
      return;
    }
    if (target !== row) return;
    const rows = [...this.querySelectorAll<HTMLElement>(".aster-list-edit-row[data-id]")];
    const at = rows.indexOf(row);
    let to: HTMLElement | undefined;
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        this.edit(id);
        return;
      case " ":
        e.preventDefault();
        this.#choose(id);
        return;
      case "ArrowDown":
        to = rows[at + 1];
        break;
      case "ArrowUp":
        to = rows[at - 1];
        break;
      case "Home":
        to = rows[0];
        break;
      case "End":
        to = rows.at(-1);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (to?.dataset.id !== undefined) {
      this.#choose(to.dataset.id);
      this.#toward(to.dataset.id, "row");
    }
  }

  #add(list: ListEdit): void {
    const row = list.add();
    if (this.#mode.peek() === "row") this.edit(row.id);
    else this.#toward(row.id, "control");
  }
}

define("aster-list-editor", ListEditor);
