import type { Collection, ListEdit, ListRow } from "@getaster/data";
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
 */
export class ListEditor extends AsterElement {
  readonly #list = this.prop<ListEdit | undefined>(undefined);
  readonly #columns = this.prop<readonly ListColumn[]>([]);
  readonly #label = this.prop("");
  readonly #addLabel = this.prop("Add");
  readonly #empty = this.prop<View>(nothing);
  readonly #readOnly = this.prop<string | undefined>(undefined);
  /** A row just added or moved, focused once it has rendered (a moved row on its handle). */
  #focus: string | undefined;
  #focusHandle = false;
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
    return html`${reason ? html`<p class="aster-hint">${reason}</p>` : nothing}
      <div class="aster-list-edit" role="table" aria-label=${this.#label.value} style=${tracks}>
        <div class="aster-list-edit-row aster-list-edit-head" role="row">
          ${ordered ? html`<span role="columnheader"><span class="aster-sr-only">Order</span></span>` : nothing}
          ${columns.map((c) => html`<span role="columnheader">${type.field(c.field)?.title ?? c.field}</span>`)}
          <span role="columnheader"><span class="aster-sr-only">Actions</span></span>
        </div>
        ${each(rows, (r) => r.id, (r) => this.#row(r, columns, readOnly, ordered))}
        ${drag && !drag.outside ? html`<div class="aster-list-edit-drop" aria-hidden="true" style=${`--at:${drag.to}`}></div>` : nothing}
      </div>
      <span class="aster-sr-only" aria-live="polite">${this.#said.value}</span>
      ${rows.length === 0 ? html`<p class="aster-list-edit-empty">${this.#empty.value}</p>` : nothing}
      ${readOnly
        ? nothing
        : html`<button type="button" class="aster-list-edit-add" @click=${() => this.#add(list)}>
            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9"/></svg>${this.#addLabel.value}
          </button>`}`;
  }

  #row(row: ListRow, columns: readonly ListColumn[], readOnly: boolean, ordered: boolean): View {
    const list = this.#list.peek()!;
    const { edit } = row;
    const first = String(edit.values.value[columns[0]?.field ?? ""] ?? "") || "new row";
    // Struck through or marked new is drawn; the first cell also says it.
    const said = row.removing ? "To be removed: " : row.isNew ? "New: " : "";
    const lead = (i: number) => (i === 0 && said ? html`<span class="aster-sr-only">${said}</span>` : nothing);
    const cells = row.removing || readOnly
      ? columns.map(
          (c, i) => html`<span role="cell" class="aster-list-edit-static" ?data-pending=${!row.removing && edit.pending(c.field).value}>${lead(i)}${c.display?.(row) ?? formatValue(edit.type.field(c.field), edit.values.value[c.field])}</span>`,
        )
      : columns.map((c, i) => {
          // A field this row can't change (a key once set) reads as text, its reason on hover, not repeated on every row.
          const state = edit.state(c.field).value;
          return state.readOnly && !row.isNew
            ? html`<span role="cell" class="aster-list-edit-static" title=${state.reasons.readOnly ?? ""}>${lead(i)}${c.display?.(row) ?? formatValue(edit.type.field(c.field), edit.values.value[c.field])}</span>`
            : html`<span role="cell">${lead(i)}${controlFor(edit, c.field, { options: c.options, labelled: false })}</span>`;
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
      ? html`<span role="cell"></span>`
      : html`<span role="cell"><button type="button" class="aster-list-edit-handle" aria-label=${`Move ${first}`}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="Drag, or Alt+↑ and Alt+↓"
          @keydown=${(e: KeyboardEvent) => this.#moveKey(e, row, first)}
          @pointerdown=${(e: PointerEvent) => this.#dragStart(e, row, first)}>
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3.5h.01M9 3.5h.01M5 7h.01M9 7h.01M5 10.5h.01M9 10.5h.01"/></svg>
        </button></span>`;
    return html`<div class="aster-list-edit-row" role="row" data-id=${row.id} ?data-new=${row.isNew} ?data-removing=${row.removing}
        ?data-pending=${row.isNew || edit.dirty.value} ?data-dragging=${this.#drag.value?.id === row.id}
        ?data-lifted=${this.#drag.value?.id === row.id && this.#drag.value.lifted}>
      ${handle}${cells}
      <span role="cell" class="aster-list-edit-actions">${action}</span>
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
    this.#focus = row.id;
    this.#focusHandle = true;
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
    if (this.#focus === undefined) return;
    const target = this.querySelector<HTMLElement>(
      `[data-id="${CSS.escape(this.#focus)}"] ${this.#focusHandle ? ".aster-list-edit-handle" : ":is(input, select)"}`,
    );
    if (!target) return;
    this.#focus = undefined;
    this.#focusHandle = false;
    target.focus();
  }

  #add(list: ListEdit): void {
    this.#focus = list.add().id;
  }
}

define("aster-list-editor", ListEditor);
