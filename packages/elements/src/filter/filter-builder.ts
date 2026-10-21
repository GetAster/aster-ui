import { filterOperators, describeCriteria, type FilterDraft, type FilterNode, type FilterCondition, type EntityType, type Field, type Value, type Criteria } from "@getaster/data";
import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { signal } from "@preact/signals-core";
import { AsterElement, define, each, uid, type View } from "../base/element.ts";
import { ChoiceState, choiceView, type Option } from "../select/choice.ts";
import { filterOperatorLabel } from "../rule/operators.ts";
import { manyView } from "../select/many.ts";
import { inputView } from "../field/input.ts";
import { inputKind } from "../field/values.ts";

const plus = html`<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9"/></svg>`;

const RELATIVE: readonly Option[] = [
  { label: "Today", value: '{"relative":"today"}' }, { label: "Yesterday", value: '{"relative":"today","days":-1}' },
  { label: "Tomorrow", value: '{"relative":"today","days":1}' }, { label: "Start of this week", value: '{"relative":"today","startOf":"week"}' },
  { label: "Start of this month", value: '{"relative":"today","startOf":"month"}' }, { label: "Now", value: '{"relative":"now"}' },
  { label: "Custom relative date", value: "custom" },
];

/** A standalone metadata-driven Criteria editor, with local drafts and cancellable apply/cancel events. */
export class FilterBuilder extends AsterElement {
  readonly #model = this.prop<FilterDraft | undefined>(undefined);
  readonly #label = this.prop("Advanced filter");
  readonly #readOnly = this.prop<string | undefined>(undefined);
  readonly #choices = new Map<string, ChoiceState>();
  readonly #lists = new Map<string, { text: string; encoded: string }>();
  readonly #customRelative = signal<ReadonlySet<string>>(new Set());
  readonly #id = uid("aster-filter");
  #focus: { id: string; action?: string } | undefined;

  /** A data-layer draft; no record list or database writes are required. */
  get model(): FilterDraft | undefined { return this.#model.value; }
  set model(value: FilterDraft | undefined) {
    if (value !== this.#model.peek()) { this.#choices.clear(); this.#lists.clear(); this.#customRelative.value = new Set(); }
    this.#model.value = value;
  }
  /** Accessible name of the editor and its root condition group. */
  get label(): string { return this.#label.value; }
  set label(value: string) { this.#label.value = value; }
  /** A reason shown instead of editable controls. */
  get readOnlyReason(): string | undefined { return this.#readOnly.value; }
  set readOnlyReason(value: string | undefined) { this.#readOnly.value = value; }

  override focus(options?: FocusOptions): void { this.querySelector<HTMLElement>("[role=combobox], input, button")?.focus(options); }

  protected render(): View {
    const model = this.#model.value;
    if (!model) return nothing;
    const root = model.root.value;
    const result = model.result.value;
    const readOnly = this.#readOnly.value;
    return html`<section class="aster-filter-builder" aria-labelledby=${`${this.#id}-title`}>
      <h3 id=${`${this.#id}-title`}>${this.#label.value}</h3>
      ${readOnly ? html`<p class="aster-hint" role="status">${readOnly}</p>` : nothing}
      <fieldset class="aster-filter-controls" ?disabled=${readOnly !== undefined}>
        <legend class="aster-sr-only">${this.#label.value} conditions</legend>
        ${this.#node(root, this.#label.value, 0, true)}
      </fieldset>
      <p class="aster-filter-preview" aria-label="Expression preview">${result.valid ? describeCriteria(result.criteria, model.schema.set(model.set).type) : "Complete all conditions before applying."}</p>
      ${result.problems.length ? html`<p class="aster-hint" role="status">${result.problems.length} ${result.problems.length === 1 ? "condition needs" : "conditions need"} attention.</p>` : nothing}
      ${readOnly === undefined ? html`<div class="aster-filter-buttons">
        <button type="button" class="aster-button" ?disabled=${!result.valid} @click=${() => this.#apply()}>Apply filter</button>
        <button type="button" class="aster-button" @click=${() => { model.cancel(); this.emit("cancel"); }}>Cancel</button>
        <button type="button" class="aster-grid-tool" @click=${() => { model.clear(); this.#focus = { id: model.root.peek().id, action: "add" }; }}>Clear expression</button>
      </div>` : nothing}
    </section>`;
  }

  #choice(key: string, label: string, value: Value | undefined, options: readonly Option[], choose: (value: string) => void, problem?: string): View {
    let state = this.#choices.get(key);
    if (!state) { state = new ChoiceState(); this.#choices.set(key, state); }
    const known = options.some((o) => o.value === value);
    const offered = !known && value !== undefined && value !== "" ? [{ value, label: `Unavailable: ${String(value)}` }, ...options] : options;
    return choiceView(state, { id: `${this.#id}-${key}`, label, value, options: offered, placeholder: "Choose…", readOnly: this.#readOnly.value !== undefined,
      invalid: problem !== undefined, ...(problem ? { describedBy: problem } : {}), choose: (v) => choose(String(v ?? "")) });
  }

  #node(node: FilterNode, name: string, depth: number, root = false): View {
    const model = this.#model.value!;
    const type = model.typeFor(node.id);
    const incomplete = node.kind === "condition" && (!node.field || (node.mode === "value" && (node.text === "" || (node.op === "in" && node.text === "[]"))));
    const problem = incomplete ? undefined : model.result.value.problems.find((p) => p.id === node.id);
    const errorId = problem ? `${this.#id}-${node.id}-error` : undefined;
    const error = problem ? html`<p class="aster-error" id=${errorId}>${problem.message}</p>` : nothing;
    const remove = !root ? html`<button type="button" class="aster-list-edit-action" aria-label=${`Remove ${name}`} @click=${() => this.#remove(node.id)}>Remove</button>` : nothing;
    if (node.kind === "condition") {
      const field = this.#field(type, node.field);
      const operators = filterOperators(field);
      return html`<div class="aster-filter-condition" role="group" aria-label=${name} data-clause=${node.id}>
        <div class="aster-filter-condition-fields">
          ${this.#choice(`${node.id}-field`, `${name}: field`, node.field, this.#fields(type), (field) => model.change(node.id, { field }), errorId)}
          ${node.field ? this.#choice(`${node.id}-op`, `${name}: test`, operators.includes(node.op) ? node.op : undefined, operators.map((op) => ({ value: op, label: filterOperatorLabel(op) })), (op) => model.change(node.id, { op }), errorId) : nothing}
          ${node.field ? this.#value(node, field, type, name, errorId) : html`<span class="aster-filter-start aster-hint">Choose a field to begin.</span>`}${remove}
        </div>${error}
      </div>`;
    }
    const related = node.kind === "related";
    const nav = related ? type?.navigation(node.field) : undefined;
    const options = related ? nav?.collection === false ? ["via"] : ["any", "all"] : ["and", "or", "not"];
    return html`<div class="aster-rule-group aster-filter-group" role="group" aria-label=${name} data-clause=${node.id} style=${`--depth:${depth}`}>
      <div class="aster-rule-head">
        ${related ? this.#choice(`${node.id}-navigation`, `${name}: relationship`, node.field, (type?.navigations ?? []).map((n) => ({ value: n.name, label: n.name })), (field) => {
          const next = type?.navigation(field); model.change(node.id, { field, op: next?.collection ? "any" : "via" });
        }, errorId) : nothing}
        ${this.#choice(`${node.id}-match`, `${name}: match`, node.op, options.map((op) => ({ value: op, label: filterOperatorLabel(op) })), (op) => model.change(node.id, { op }), errorId)}
        <span>${related ? "matches" : "of these conditions"}</span>${remove}
      </div>
      <div class="aster-rule-body">${each(node.children, (c) => c.id, (c) => this.#node(c, `${name}, ${c.kind === "condition" ? "condition" : "group"} ${node.children.indexOf(c) + 1}`, depth + 1))}
        ${node.children.length === 0 ? html`<p class="aster-hint">${root ? "No expression. Other query constraints still apply." : related && !nav ? "Choose a relationship before adding conditions." : "Add a condition to this group."}</p>` : nothing}
        <div class="aster-rule-adds">
          <button type="button" class="aster-list-edit-add" data-action="add" ?disabled=${related && !nav} aria-label=${`Add condition to ${name}`} @click=${() => this.#add(node.id, "condition")}>${plus}Add condition</button>
          <button type="button" class="aster-list-edit-add" ?disabled=${related && !nav} aria-label=${`Add group to ${name}`} @click=${() => this.#add(node.id, "group")}>${plus}Add group</button>
          ${(related ? nav ? model.schema.set(nav.target).type : undefined : type)?.navigations.length ? html`<button type="button" class="aster-list-edit-add" aria-label=${`Add related condition to ${name}`} @click=${() => this.#add(node.id, "related")}>${plus}Add related condition</button>` : nothing}
        </div>${error}
      </div>
    </div>`;
  }

  #fields(type: EntityType | undefined): Option[] { return (type?.fields ?? []).filter((f) => f.type !== "Edm.Binary").map((f) => ({ value: f.name, label: f.title ?? f.name })); }
  #field(type: EntityType | undefined, name: string): Field | undefined { return type?.field(name); }

  #value(node: FilterCondition, field: Field | undefined, type: EntityType | undefined, name: string, error?: string): View {
    if (node.op === "isnull" || node.op === "notnull") return html`<span></span>`;
    const model = this.#model.value!;
    const comparison = ["eq", "ne", "gt", "ge", "lt", "le"].includes(node.op);
    const modes = [{ value: "value", label: "Value" }, ...(comparison ? [{ value: "field", label: "Another field" }] : []),
      ...(comparison && (field?.type === "Edm.Date" || field?.type === "Edm.DateTimeOffset") ? [{ value: "relative", label: "Relative date" }] : [])];
    const change = (text: string) => model.change(node.id, { text });
    let input: View;
    switch (node.mode) {
      case "field": input = this.#choice(`${node.id}-other`, `${name}: comparison field`, node.other, this.#fields(type).filter((o) => this.#field(type, String(o.value))?.type === field?.type), (other) => model.change(node.id, { other }), error); break;
      case "relative": {
        const preset = !this.#customRelative.value.has(node.id) && RELATIVE.some((o) => o.value === node.text);
        input = html`${this.#choice(`${node.id}-relative`, `${name}: relative date`, preset ? node.text : "custom", RELATIVE, (v) => {
          const custom = new Set(this.#customRelative.peek());
          if (v === "custom") custom.add(node.id); else custom.delete(node.id);
          this.#customRelative.value = custom;
          change(v === "custom" ? '{"relative":"today","days":0}' : v);
        }, error)}
          ${!preset ? this.#relative(node, name, error) : nothing}`;
        break;
      }
      default: {
        if (node.op === "in") input = this.#options(field) ? this.#many(node, field!, name, error) : this.#list(node, field, name, error);
        else if (field?.allowedValues || field?.type === "Edm.Boolean") {
          const options = field.allowedValues ? field.allowedValues.map((a) => ({ value: String(a.value), label: a.label ?? String(a.value) })) : [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
          input = this.#choice(`${node.id}-value`, `${name}: value`, node.text, options, change, error);
        } else input = this.#input(node, name, field?.type === "Edm.Date" && node.op !== "in" ? "date" : "text", error,
          field?.type === "Edm.DateTimeOffset" ? "Timestamp with offset" : "Value", inputKind(field).inputmode ?? "");
      }
    }
    const modeChoice = this.#choice(`${node.id}-mode`, `${name}: compare with`, node.mode, modes, (mode) => {
      model.change(node.id, { mode: mode as FilterCondition["mode"] });
      this.#focus = { id: node.id, action: mode };
    }, error);
    return html`<div class="aster-filter-value" data-mode=${node.mode}>
      ${node.mode !== "value" ? modeChoice : nothing}${input}
      ${node.mode === "value" && modes.length > 1 ? html`<details class="aster-filter-comparison"><summary>Compare with…</summary>${modeChoice}</details>` : nothing}
      ${["contains", "startswith", "endswith"].includes(node.op) ? html`<label><input type="checkbox" .checked=${node.caseInsensitive} @change=${(e: Event) => model.change(node.id, { caseInsensitive: (e.target as HTMLInputElement).checked })}>Ignore case</label>` : nothing}
    </div>`;
  }

  #input(node: FilterCondition, name: string, type: string, error: string | undefined, placeholder: string, keyboard = ""): View {
    return inputView({ id: `${this.#id}-${node.id}-value`, label: `${name}: value`, type, value: node.text, keyboard, placeholder,
      invalid: error !== undefined, ...(error ? { describedBy: error } : {}), input: (text) => this.#model.value!.change(node.id, { text }) });
  }

  #options(field: Field | undefined): readonly Option[] | undefined {
    if (field?.allowedValues) return field.allowedValues.map((o) => ({ value: o.value, label: o.label ?? String(o.value) }));
    return field?.type === "Edm.Boolean" ? [{ value: true, label: "Yes" }, { value: false, label: "No" }] : undefined;
  }

  #many(node: FilterCondition, field: Field, name: string, error?: string): View {
    let values: Value[] = [];
    try { const parsed: unknown = JSON.parse(node.text); if (Array.isArray(parsed)) values = parsed as Value[]; } catch { /* The draft remains invalid until a choice is made. */ }
    const options = this.#options(field) ?? [];
    return html`<div class="aster-filter-choices">${manyView({ label: `${name}: values`, options: [...options, ...(field.nullable ? [{ value: null, label: "Empty (null)" }] : [])], values,
      invalid: error !== undefined, ...(error ? { describedBy: error } : {}), readOnly: this.#readOnly.value !== undefined,
      change: (values) => this.#model.value!.change(node.id, { text: JSON.stringify(values) }) })}
      ${values.length ? nothing : html`<span class="aster-hint">Choose one or more values.</span>`}</div>`;
  }

  #list(node: FilterCondition, field: Field | undefined, name: string, error?: string): View {
    let values: Value[] = [];
    try { const parsed: unknown = JSON.parse(node.text); if (Array.isArray(parsed)) values = parsed as Value[]; } catch { /* Validation retains the malformed draft. */ }
    const cached = this.#lists.get(node.id);
    const text = cached?.encoded === node.text ? cached.text : values.filter((v) => v !== null).join("\n");
    const includeNull = values.includes(null);
    const write = (text: string, nulls: boolean) => {
      const values: Value[] = text === "" ? [] : text.split("\n").map((line) => {
        switch (field?.type) {
          case "Edm.Boolean": return line === "true" ? true : line === "false" ? false : line;
          case "Edm.Byte": case "Edm.SByte": case "Edm.Int16": case "Edm.Int32": case "Edm.Single": case "Edm.Double":
            return line.trim() && Number.isFinite(Number(line)) ? Number(line) : line;
          default: return line;
        }
      });
      if (nulls) values.push(null);
      const encoded = JSON.stringify(values);
      this.#lists.set(node.id, { text, encoded });
      this.#model.value!.change(node.id, { text: encoded });
    };
    return html`<div class="aster-filter-list"><label class="aster-field aster-field-prose" data-ring-owner>
      <span>Values, one per line${field?.type === "Edm.Boolean" ? " (true or false)" : ""}</span>
      <textarea rows="3" aria-label=${`${name}: values, one per line`} .value=${live(text)} aria-invalid=${error ? "true" : nothing} aria-describedby=${error ?? nothing}
        @input=${(e: Event) => write((e.target as HTMLTextAreaElement).value, includeNull)}></textarea></label>
      <label><input type="checkbox" .checked=${includeNull} @change=${(e: Event) => write(text, (e.target as HTMLInputElement).checked)}>Include empty (null) values</label>
    </div>`;
  }

  #relative(node: FilterCondition, name: string, error?: string): View {
    let value: Record<string, unknown> = {};
    try { const parsed: unknown = JSON.parse(node.text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed as Record<string, unknown>; } catch { /* Validation retains the malformed draft. */ }
    const write = (patch: Record<string, unknown>) => {
      this.#customRelative.value = new Set([...this.#customRelative.peek(), node.id]);
      this.#model.value!.change(node.id, { text: JSON.stringify({ relative: "today", ...value, ...patch }) });
    };
    return html`<div class="aster-filter-relative">
      ${this.#choice(`${node.id}-base`, `${name}: relative base`, String(value.relative ?? "today"), [{ value: "today", label: "Today" }, { value: "now", label: "Now" }], (relative) => write({ relative }), error)}
      ${(["days", "weeks", "months"] as const).map((unit) => html`<label class="aster-field" data-ring-owner><span>${unit} (+/−)</span>
        <input type="number" step="1" aria-label=${`${name}: offset ${unit}`} aria-invalid=${error ? "true" : nothing} aria-describedby=${error ?? nothing}
          .value=${live(String(value[unit] ?? 0))} @input=${(e: Event) => { const text = (e.target as HTMLInputElement).value; write({ [unit]: text.trim() ? Number(text) : "" }); }}></label>`)}
      ${this.#choice(`${node.id}-align`, `${name}: align date`, String(value.startOf ?? "none"), [{ value: "none", label: "No alignment" }, { value: "week", label: "Start of week" }, { value: "month", label: "Start of month" }], (startOf) => write({ startOf: startOf === "none" ? undefined : startOf }), error)}
      <span class="aster-hint">Negative offsets go back; positive offsets go forward. Dates use UTC.</span>
    </div>`;
  }

  #add(parent: string, kind: FilterNode["kind"]): void {
    const id = this.#model.value!.add(parent, kind);
    this.#focus = { id };
  }
  #remove(id: string): void {
    const root = this.#model.value!.root.peek();
    const parentOf = (n: FilterNode): string | undefined => n.kind === "condition" ? undefined : n.children.some((c) => c.id === id) ? n.id : n.children.map(parentOf).find((p) => p !== undefined);
    this.#focus = { id: parentOf(root) ?? root.id, action: "add" };
    this.#model.value!.remove(id);
    const ids = new Set<string>();
    const collect = (n: FilterNode): void => { ids.add(n.id); if (n.kind !== "condition") n.children.forEach(collect); };
    collect(this.#model.value!.root.peek());
    for (const key of this.#choices.keys()) if (!ids.has(key.split("-")[0]!)) this.#choices.delete(key);
    for (const key of this.#lists.keys()) if (!ids.has(key)) this.#lists.delete(key);
    this.#customRelative.value = new Set([...this.#customRelative.peek()].filter((id) => ids.has(id)));
  }
  #apply(): void {
    const model = this.#model.value;
    const result = model?.result.peek();
    if (!model || !result?.valid) return;
    if (this.emit<Criteria | undefined>("apply", result.criteria)) model.apply();
  }
  protected override updated(): void {
    const focus = this.#focus;
    if (!focus) return;
    const node = this.querySelector<HTMLElement>(`[data-clause="${CSS.escape(focus.id)}"]`);
    let target: HTMLElement | null | undefined;
    switch (focus.action) {
      case "add": target = node?.querySelector<HTMLElement>("[data-action=add]"); break;
      case "field": case "relative": case "value": {
        const suffix = focus.action === "field" ? "other" : focus.action;
        target = node?.querySelector<HTMLElement>(`#${CSS.escape(`${this.#id}-${focus.id}-${suffix}`)}`)
          ?? node?.querySelector<HTMLElement>(".aster-filter-value input, .aster-filter-value textarea, .aster-filter-value [role=combobox]");
        break;
      }
      default: target = node?.querySelector<HTMLElement>("[role=combobox], input, button");
    }
    target?.focus(); this.#focus = undefined;
  }
}

define("aster-filter-builder", FilterBuilder);
