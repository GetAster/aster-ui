import type { ListEdit, ListRow, Value } from "@getaster/data";
import type { ReadonlySignal } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { controlFor } from "../form/controls.ts";
import { formatValue } from "../field/values.ts";
import type { PickerOptions } from "../picker/options.ts";
import { TreeChoices } from "../picker/tree-choices.ts";
import "../picker/tree-picker.ts";
import type { Option } from "../select/choice.ts";
import { manyView } from "../select/many.ts";
import "../select/select.ts";
import { opLabel } from "./operators.ts";

/** What a condition can test about the field it names. */
export interface RuleField {
  /** The operators that suit the field, from the clause's operator values. */
  readonly operators: readonly string[];
  /** The value's control: typed text, a date, or one of `options`. */
  readonly input: "text" | "number" | "date";
  /** Values to choose from; with `in`, several. */
  readonly options?: readonly Option[];
}

const GROUPS: readonly string[] = ["and", "or", "not"];
/** Operators that need no value. */
const UNARY: readonly string[] = ["set", "unset"];

/**
 * Edits a rule as a tree of clauses: groups (all of, any of, none of)
 * holding conditions (a field, an operator, a value) and further groups.
 * The clauses are rows of a list edit, so every input shows pending, a
 * changed row offers Revert, a removed one is struck through with Undo, and
 * the whole rule saves with its record.
 *
 * Rows have `op`, `parentClauseId`, `position`, `category`, `fieldRef`,
 * `value` and, on a message's top group, `message`. A value for `in` is a
 * JSON array. With `messages`, each top-level group is a message shown when
 * its conditions hold; otherwise there's at most one, and none means
 * "always".
 */
export class RuleEditor extends AsterElement {
  readonly #list = this.prop<ListEdit | undefined>(undefined);
  readonly #category = this.prop("");
  readonly #label = this.prop("");
  readonly #messages = this.prop(false);
  readonly #fields = this.prop<PickerOptions | TreeChoices | undefined>(undefined);
  readonly #describe = this.prop<((fieldRef: Value | undefined) => ReadonlySignal<RuleField | undefined>) | undefined>(undefined);
  readonly #readOnly = this.prop<string | undefined>(undefined);
  readonly #empty = this.prop("Always");
  readonly #id = uid("aster-rule");
  #focus: string | undefined;

  get list(): ListEdit | undefined {
    return this.#list.value;
  }
  set list(v: ListEdit | undefined) {
    this.#list.value = v;
  }
  /** The rows' `category`: this editor shows and adds only these. */
  get category(): string {
    return this.#category.value;
  }
  set category(v: string) {
    this.#category.value = v;
  }
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /** Each top-level group is a message with its own conditions. */
  get messages(): boolean {
    return this.#messages.value;
  }
  set messages(v: boolean) {
    this.#messages.value = v;
  }
  /** The fields a condition can name: a list, or a tree where names repeat across groups. */
  get fields(): PickerOptions | TreeChoices | undefined {
    return this.#fields.value;
  }
  set fields(v: PickerOptions | TreeChoices | undefined) {
    this.#fields.value = v;
  }
  /** What a named field allows: its operators and values. */
  get describe(): ((fieldRef: Value | undefined) => ReadonlySignal<RuleField | undefined>) | undefined {
    return this.#describe.value;
  }
  set describe(v: ((fieldRef: Value | undefined) => ReadonlySignal<RuleField | undefined>) | undefined) {
    this.#describe.value = v;
  }
  /** Why the rule can't be edited now; set, it makes the editor read-only. */
  get readOnlyReason(): string | undefined {
    return this.#readOnly.value;
  }
  set readOnlyReason(v: string | undefined) {
    this.#readOnly.value = v;
  }
  /** Said when there's no rule. */
  get empty(): string {
    return this.#empty.value;
  }
  set empty(v: string) {
    this.#empty.value = v;
  }

  protected render(): View {
    const list = this.#list.value;
    if (!list) return nothing;
    const rows = list.rows.value.filter((r) => r.edit.values.value.category === this.#category.value);
    const readOnly = this.#readOnly.value !== undefined;
    const roots = this.#children(rows, null);
    const live = roots.filter((r) => !r.removing);
    const canAdd = !readOnly && (this.#messages.value || live.length === 0);
    return html`<section class="aster-rule" aria-labelledby=${`${this.#id}-label`}>
      <div class="aster-rule-label" id=${`${this.#id}-label`}>${this.#label.value}</div>
      ${this.#readOnly.value ? html`<p class="aster-hint">${this.#readOnly.value}</p>` : nothing}
      ${roots.length === 0 ? html`<p class="aster-rule-empty">${this.#empty.value}</p>` : nothing}
      ${roots.map((r, i) => this.#group(rows, r, readOnly, 0, this.#messages.value ? `Message ${i + 1}` : this.#label.value))}
      ${canAdd
        ? html`<button type="button" class="aster-list-edit-add" @click=${() => this.#addRoot(list)}>
            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9"/></svg>${this.#messages.value ? "Add a message" : "Add a condition"}
          </button>`
        : nothing}
    </section>`;
  }

  #group(rows: readonly ListRow[], row: ListRow, readOnly: boolean, depth: number, name: string): View {
    const list = this.#list.peek()!;
    const { edit } = row;
    const kids = this.#children(rows, row);
    const locked = readOnly || row.removing;
    const headId = `${this.#id}-${row.id}`;
    const isMessage = this.#messages.value && depth === 0;
    const ops: Option[] = GROUPS.map((value) => ({ value, label: opLabel(edit.type.field("op")?.allowedValues, value) }));
    return html`<div class="aster-rule-group" role="group" aria-labelledby=${headId} data-id=${row.id}
        ?data-new=${row.isNew} ?data-removing=${row.removing} ?data-pending=${row.isNew || edit.dirty.value} style=${`--depth:${depth}`}>
      <div class="aster-rule-head" id=${headId}>
        ${row.removing || row.isNew ? html`<span class="aster-sr-only">${row.removing ? "To be removed:" : "New:"}</span>` : nothing}
        ${isMessage
          ? locked
            ? html`<span class="aster-rule-static">${String(edit.values.value.message ?? "")}</span>`
            : controlFor(edit, "message", { labelled: false })
          : nothing}
        <span class="aster-rule-when">${isMessage ? "when" : depth === 0 ? "When" : ""}</span>
        ${locked
          ? html`<span class="aster-rule-static">${opLabel(edit.type.field("op")?.allowedValues, edit.values.value.op)}</span>`
          : html`<aster-select .model=${edit} .field=${"op"} .label=${`${name}: match`} .choices=${ops}></aster-select>`}
        <span class="aster-rule-of">of these</span>
        ${this.#actions(row, readOnly, name, rows)}
      </div>
      <div class="aster-rule-body">
        ${kids.map((k, i) => (GROUPS.includes(String(k.edit.values.value.op)) ? this.#group(rows, k, locked, depth + 1, `${name}, group ${i + 1}`) : this.#leaf(k, locked, `${name}, condition ${i + 1}`, rows)))}
        ${locked
          ? nothing
          : html`<div class="aster-rule-adds">
              <button type="button" class="aster-list-edit-add" @click=${() => this.#addLeaf(list, row, rows)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9"/></svg>Add condition</button>
              <button type="button" class="aster-list-edit-add" @click=${() => this.#addGroup(list, row, rows)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9"/></svg>Add group</button>
            </div>`}
      </div>
    </div>`;
  }

  #leaf(row: ListRow, readOnly: boolean, name: string, rows: readonly ListRow[]): View {
    const { edit } = row;
    const values = edit.values.value;
    const field = this.#describe.value?.(values.fieldRef).value;
    const op = String(values.op ?? "");
    const opMeta = edit.type.field("op")?.allowedValues;
    const ops: Option[] = (field?.operators ?? []).map((value) => ({ value, label: opLabel(opMeta, value) }));
    const locked = readOnly || row.removing;
    const fieldsOptions = this.#fields.value;
    const fieldControl = locked || !fieldsOptions
      ? html`<span class="aster-rule-static">${this.#fieldText(row)}</span>`
      : fieldsOptions instanceof TreeChoices
        ? html`<aster-tree-picker .model=${edit} .field=${"fieldRef"} .label=${`${name}: field`} .options=${fieldsOptions}></aster-tree-picker>`
        : html`<aster-picker .model=${edit} .field=${"fieldRef"} .label=${`${name}: field`} .options=${fieldsOptions}></aster-picker>`;
    const opControl = locked || !field
      ? html`<span class="aster-rule-static">${op ? opLabel(opMeta, op) : ""}</span>`
      : html`<aster-select .model=${edit} .field=${"op"} .label=${`${name}: test`} .choices=${ops}></aster-select>`;
    return html`<div class="aster-rule-leaf" role="group" aria-label=${row.removing ? `${name}, to be removed` : row.isNew ? `${name}, new` : name} data-id=${row.id}
        ?data-new=${row.isNew} ?data-removing=${row.removing} ?data-pending=${row.isNew || edit.dirty.value}>
      ${fieldControl}${opControl}
      ${UNARY.includes(op) || !field ? html`<span></span>` : this.#value(row, field, op, locked, name)}
      ${this.#actions(row, readOnly, name, rows)}
      ${row.removeError ? html`<p class="aster-error" role="alert">${row.removeError}</p>` : nothing}
    </div>`;
  }

  #value(row: ListRow, field: RuleField, op: string, locked: boolean, name: string): View {
    const { edit } = row;
    const raw = edit.values.value.value;
    const options = field.options;
    if (locked) {
      const shown = options
        ? (op === "in" ? parseList(raw) : [String(raw ?? "")]).map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ")
        : formatValue(edit.type.field("value"), raw);
      return html`<span class="aster-rule-static">${shown}</span>`;
    }
    if (options && op === "in") {
      return manyView({ label: `${name}: values`, options: options.map((o) => ({ ...o, value: String(o.value) })), values: parseList(raw),
        pending: edit.pending("value").value, change: (values) => edit.set("value", values.length ? JSON.stringify(values) : null) });
    }
    if (options) return html`<aster-select .model=${edit} .field=${"value"} .label=${`${name}: value`} .choices=${options}></aster-select>`;
    return html`<aster-field .model=${edit} .field=${"value"} .label=${`${name}: value`}
      .keyboard=${field.input === "number" ? "decimal" : ""} .placeholder=${field.input === "date" ? "YYYY-MM-DD" : ""}></aster-field>`;
  }

  #actions(row: ListRow, readOnly: boolean, name: string, rows: readonly ListRow[]): View {
    if (readOnly) return nothing;
    const list = this.#list.peek()!;
    if (row.removing) {
      return html`<button type="button" class="aster-list-edit-action" aria-label=${`Undo removing ${name}`}
        @click=${() => [row, ...this.#descendants(rows, row)].forEach((r) => r.removing && list.restore(r.id))}>Undo</button>`;
    }
    return html`<span class="aster-rule-actions">
      ${row.edit.dirty.value && !row.isNew
        ? html`<button type="button" class="aster-list-edit-action" aria-label=${`Revert ${name}`} @click=${() => row.edit.revert()}>Revert</button>`
        : nothing}
      <button type="button" class="aster-list-edit-action" aria-label=${`Remove ${name}`}
        @click=${() => [...this.#descendants(rows, row).reverse(), row].forEach((r) => list.remove(r.id))}>Remove</button>
    </span>`;
  }

  #fieldText(row: ListRow): View {
    const options = this.#fields.value;
    const ref = row.edit.values.value.fieldRef;
    if (!options || ref === null || ref === undefined) return nothing;
    const record = options.record(ref)?.value;
    if (!record) return html`${String(ref)}`;
    const trail = options instanceof TreeChoices ? options.trail(record) : [];
    return trail.length
      ? html`${options.text(record)} <span class="aster-rule-trail">(in ${trail.join(" › ")})</span>`
      : html`${options.text(record)}`;
  }

  /** A group's rows, in position order; a new row's parent is its link until saved. */
  #children(rows: readonly ListRow[], parent: ListRow | null): ListRow[] {
    const key = parent === null ? null : parent.isNew ? parent.id : JSON.parse(parent.id)[0];
    return rows
      .filter((r) => {
        const link = r.links?.parentClauseId;
        if (link !== undefined) return parent !== null && link === parent.id;
        return (r.edit.values.value.parentClauseId ?? null) === key;
      })
      .sort((a, b) => Number(a.edit.values.value.position ?? 0) - Number(b.edit.values.value.position ?? 0));
  }

  #descendants(rows: readonly ListRow[], row: ListRow): ListRow[] {
    return this.#children(rows, row).flatMap((k) => [k, ...this.#descendants(rows, k)]);
  }

  #nextPosition(rows: readonly ListRow[], parent: ListRow | null): number {
    return Math.max(0, ...this.#children(rows, parent).map((r) => Number(r.edit.values.value.position ?? 0))) + 1;
  }

  #add(list: ListEdit, parent: ListRow | null, values: Record<string, Value>, rows: readonly ListRow[]): string {
    const base = { category: this.#category.peek(), position: this.#nextPosition(rows, parent), fieldRef: null, value: null, message: null };
    if (parent === null) return list.add({ ...base, parentClauseId: null, ...values }).id;
    if (!parent.isNew) return list.add({ ...base, parentClauseId: JSON.parse(parent.id)[0], ...values }).id;
    return list.add({ ...base, parentClauseId: null, ...values }, { parentClauseId: parent.id }).id;
  }

  #addRoot(list: ListEdit): void {
    const rows = list.rows.peek().filter((r) => r.edit.values.peek().category === this.#category.peek());
    const root = this.#add(list, null, { op: "and" }, rows);
    const group = list.rows.peek().find((r) => r.id === root)!;
    this.#focus = this.#add(list, group, { op: null }, list.rows.peek());
  }

  #addLeaf(list: ListEdit, parent: ListRow, rows: readonly ListRow[]): void {
    this.#focus = this.#add(list, parent, { op: null }, rows);
  }

  #addGroup(list: ListEdit, parent: ListRow, rows: readonly ListRow[]): void {
    const group = this.#add(list, parent, { op: "or" }, rows);
    const row = list.rows.peek().find((r) => r.id === group)!;
    this.#focus = this.#add(list, row, { op: null }, list.rows.peek());
  }

  protected override updated(): void {
    if (this.#focus !== undefined) this.#focusAdded(this.#focus);
  }

  /** Focuses an added row's first control; a picker in it renders its input a frame or so later. */
  #focusAdded(id: string, frames = 10): void {
    const target = this.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] :is(input, [role=combobox])`);
    if (target) {
      if (this.#focus === id) this.#focus = undefined;
      target.focus();
    } else if (frames > 0 && this.#focus === id) {
      requestAnimationFrame(() => this.#focusAdded(id, frames - 1));
    }
  }
}

function parseList(raw: Value | undefined): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [raw];
  } catch {
    return [raw];
  }
}

define("aster-rule-editor", RuleEditor);
