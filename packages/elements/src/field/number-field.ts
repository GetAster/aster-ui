import type { Field as FieldMeta, Value } from "@getaster/data";
import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "./bound-field.ts";
import { formatValue, parseInput } from "./values.ts";
import { canonicalNumeric, compareNumeric, numericAligned, stepNumeric } from "./numeric.ts";

export type NumericValue = string | number | null;
export type NumericType = "decimal" | "integer" | "float";
const INTEGER = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64"]);

export class NumberField extends BoundField {
  readonly #value = this.prop<NumericValue>(null);
  readonly #type = this.prop<NumericType>("decimal");
  readonly #min = this.prop<string | number | undefined>(undefined);
  readonly #max = this.prop<string | number | undefined>(undefined);
  readonly #step = this.prop<string | number | undefined>(undefined);
  readonly #buttons = this.prop(false);
  readonly #prefix = this.prop("");
  readonly #suffix = this.prop("");
  readonly #placeholder = this.prop("");
  readonly #readOnly = this.prop(false);
  readonly #draft = this.prop<string | undefined>(undefined);
  readonly #focused = this.prop(false);
  readonly #format = this.prop<((value: NumericValue) => string) | undefined>(undefined);
  #last: Value | undefined;

  get value() { return this.#value.value; }
  set value(v: NumericValue) { this.#draft.value = undefined; this.#value.value = v; }
  get numericType() { return this.#type.value; }
  set numericType(v: NumericType) { if (!["decimal", "integer", "float"].includes(v)) throw new TypeError("Unknown numeric type"); this.#type.value = v; }
  get min() { return this.#min.value; }
  set min(v: string | number | undefined) { if (v !== undefined) canonicalNumeric(v); this.#min.value = v; }
  get max() { return this.#max.value; }
  set max(v: string | number | undefined) { if (v !== undefined) canonicalNumeric(v); this.#max.value = v; }
  get step() { return this.#step.value; }
  set step(v: string | number | undefined) { if (v !== undefined && compareNumeric(v, 0) <= 0) throw new TypeError("Step must be positive"); this.#step.value = v; }
  get stepButtons() { return this.#buttons.value; }
  set stepButtons(v: boolean) { this.#buttons.value = v; }
  get prefixText() { return this.#prefix.value; }
  set prefixText(v: string) { this.#prefix.value = v; }
  get suffixText() { return this.#suffix.value; }
  set suffixText(v: string) { this.#suffix.value = v; }
  get placeholder() { return this.#placeholder.value; }
  set placeholder(v: string) { this.#placeholder.value = v; }
  get readOnly() { return this.#readOnly.value; }
  set readOnly(v: boolean) { this.#readOnly.value = v; }
  get format() { return this.#format.value; }
  set format(v: ((value: NumericValue) => string) | undefined) { this.#format.value = v; }

  override focus(options?: FocusOptions): void { this.querySelector("input")?.focus(options); }

  #kind(meta?: FieldMeta): NumericType {
    return meta ? INTEGER.has(meta.type) ? "integer" : meta.type === "Edm.Decimal" ? "decimal" : "float" : this.#type.value;
  }

  #bounds(meta?: FieldMeta): { min?: string | number; max?: string | number } {
    let min = meta?.minimum, max = meta?.maximum;
    if (this.#min.value !== undefined && (min === undefined || compareNumeric(this.#min.value, min) > 0)) min = this.#min.value;
    if (this.#max.value !== undefined && (max === undefined || compareNumeric(this.#max.value, max) < 0)) max = this.#max.value;
    return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
  }

  protected override validation(meta: FieldMeta | undefined, boundValue: Value | undefined): string | undefined {
    const value = this.model ? boundValue : this.#value.value;
    try {
      const { min, max } = this.#bounds(meta);
      if (min !== undefined && max !== undefined && compareNumeric(min, max) > 0) return "Minimum exceeds maximum";
      if (this.#kind(meta) === "integer" && this.#step.value !== undefined && !numericAligned(this.#step.value, 1)) return "Integer fields require an integer step";
      if (value === undefined || value === null || value === "") return undefined;
      if (typeof value === "boolean") return "Enter a number";
      canonicalNumeric(value);
      if (this.#kind(meta) === "integer" && !numericAligned(value, 1)) return "Enter a whole number";
      if (min !== undefined && (compareNumeric(value, min) < 0 || meta?.exclusiveMinimum && compareNumeric(value, meta.minimum!) === 0)) return `Enter a number ${meta?.exclusiveMinimum ? "greater than" : "at least"} ${min}`;
      if (max !== undefined && (compareNumeric(value, max) > 0 || meta?.exclusiveMaximum && compareNumeric(value, meta.maximum!) === 0)) return `Enter a number ${meta?.exclusiveMaximum ? "less than" : "at most"} ${max}`;
      if (this.#step.value !== undefined && !numericAligned(value, this.#step.value, min ?? 0)) return `Use increments of ${this.#step.value}${min === undefined ? "" : ` from ${min}`}`;
      return undefined;
    } catch { return "Enter a number"; }
  }

  #write(text: string, meta?: FieldMeta): void {
    let value: NumericValue;
    if (meta) value = meta.type === "Edm.Decimal" || meta.type === "Edm.Int64" ? text.trim() === "" ? null : text.trim() : parseInput(meta, text) as NumericValue;
    else {
      value = text.trim() === "" ? null : text;
      if (value !== null && this.#type.peek() === "float") {
        try { const number = Number(canonicalNumeric(value)); if (Number.isFinite(number)) value = number; } catch { /* Retain incomplete text. */ }
      }
    }
    this.#last = value;
    this.#draft.value = text;
    if (this.model) this.write(value);
    else this.#value.value = value;
    this.emit("value-change", { value });
  }

  #next(direction: 1 | -1, c: ControlContext): string | undefined {
    try {
      const value = this.model ? c.value : this.#value.value;
      if (value === undefined || typeof value === "boolean") return undefined;
      if (this.#kind(c.meta) === "integer" && this.#step.value !== undefined && !numericAligned(this.#step.value, 1)) return undefined;
      const { min, max } = this.#bounds(c.meta);
      if (min !== undefined && max !== undefined && compareNumeric(min, max) > 0) return undefined;
      let next = stepNumeric(value, direction, (this.#step.value ?? (c.meta?.scale ? `0.${"0".repeat(c.meta.scale - 1)}1` : 1)), min, max);
      if (next !== undefined && (c.meta?.exclusiveMinimum && compareNumeric(next, c.meta.minimum!) === 0 || c.meta?.exclusiveMaximum && compareNumeric(next, c.meta.maximum!) === 0)) {
        next = stepNumeric(next, direction, (this.#step.value ?? (c.meta?.scale ? `0.${"0".repeat(c.meta.scale - 1)}1` : 1)), min, max);
      }
      return next;
    } catch { return undefined; }
  }

  protected control(c: ControlContext): View {
    const current = this.model ? c.value : this.#value.value;
    const draft = this.#draft.value;
    const entered = draft !== undefined && current === this.#last ? draft : current === null || current === undefined ? "" : String(current);
    let display = formatValue(c.meta, current);
    const formatter = this.#format.value;
    if (formatter && current !== undefined && typeof current !== "boolean") {
      try { if (current !== null) canonicalNumeric(current); display = formatter(current); } catch { /* Invalid text stays visible. */ }
    }
    const text = this.#focused.value ? entered : display;
    const readOnly = this.#readOnly.value || c.state.readOnly;
    const step = (direction: 1 | -1) => { if (readOnly) return; const next = this.#next(direction, c); if (next !== undefined) this.#write(next, c.meta); };
    return html`<div class="aster-field aster-number" data-ring-owner>
      ${this.#prefix.value ? html`<span class="aster-number-affix">${this.#prefix.value}</span>` : nothing}
      <input id=${c.id} type="text" inputmode=${this.#kind(c.meta) === "integer" ? "numeric" : "decimal"}
        .value=${live(text)} aria-label=${this.labelled ? nothing : c.label} aria-describedby=${c.describedBy ?? nothing}
        aria-required=${c.state.required ? "true" : nothing} aria-invalid=${c.invalid ? "true" : nothing}
        ?readonly=${readOnly} placeholder=${this.#placeholder.value || nothing} autocomplete="off" spellcheck="false"
        @focus=${(e: FocusEvent) => {
          this.#focused.value = true;
          if (display !== entered) queueMicrotask(() => (e.target as HTMLInputElement).select());
        }} @blur=${() => this.#focused.value = false}
        @input=${(e: InputEvent) => this.#write((e.target as HTMLInputElement).value, c.meta)}
        @keydown=${(e: KeyboardEvent) => {
          if (readOnly || !this.#buttons.peek() || e.altKey || e.ctrlKey || e.metaKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
          e.preventDefault(); step(e.key === "ArrowUp" ? 1 : -1);
        }}>
      ${this.#suffix.value ? html`<span class="aster-number-affix">${this.#suffix.value}</span>` : nothing}
      ${this.#buttons.value ? html`<span class="aster-number-steps">
        ${([-1, 1] as const).map(d => html`<button type="button" aria-label=${`${d === 1 ? "Increase" : "Decrease"} ${c.label}`} ?disabled=${readOnly || this.#next(d, c) === undefined}
          @mousedown=${(e: MouseEvent) => { if (e.button === 0) e.preventDefault(); }} @click=${() => step(d)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d=${d === 1 ? "M3 8h10M8 3v10" : "M3 8h10"}/></svg>
        </button>`)}
      </span>` : nothing}
    </div>`;
  }
}

define("aster-number-field", NumberField);
