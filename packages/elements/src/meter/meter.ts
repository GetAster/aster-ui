import type { EditModel } from "@getaster/data";
import { DEFAULT_STATE } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { formatFigure, validateValueFormat, type ValueFormat, type ValueFormatter } from "../format.ts";
import {
  METER_LABEL_DEFAULTS, meterAt, meterBounds, meterFill, meterState, resolveThreshold, toMeterNumber, validateMeterChrome, validateMeterLabels, validateMeterThreshold,
  type MeterChrome, type MeterLabels, type MeterState, type MeterThreshold,
} from "./config.ts";

export type { MeterChrome, MeterLabels, MeterState, MeterThreshold } from "./config.ts";

const MARKS: Record<MeterState, View> = {
  optimum: html`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.2 2.2 4.8-5"/></svg>`,
  suboptimum: html`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.6l5 8.8H1z"/></svg>`,
  poor: html`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>`,
};

/**
 * A value against a limit: spent against a budget, storage used, a score. It
 * renders a native `<meter>`, so assistive technology reads its role, range and
 * value, and paints the same state from theme tokens: good, caution or poor by
 * where the value falls against `low`, `high` and `optimum`, with the browser's
 * own rules. The state is also a mark shape and the last words of the value
 * text, never colour alone. Bound to a field (and, for the limit, another
 * field), it follows edits.
 */
export class Meter extends AsterElement {
  readonly #model = this.prop<EditModel | undefined>(undefined);
  readonly #field = this.prop("");
  readonly #maxField = this.prop("");
  readonly #value = this.prop<number | string | null>(null);
  readonly #min = this.prop<number | undefined>(undefined);
  readonly #max = this.prop<number | undefined>(undefined);
  readonly #low = this.prop<MeterThreshold | undefined>(undefined);
  readonly #high = this.prop<MeterThreshold | undefined>(undefined);
  readonly #optimum = this.prop<MeterThreshold | undefined>(undefined);
  readonly #label = this.prop("");
  readonly #format = this.prop<ValueFormat | ValueFormatter | undefined>(undefined);
  readonly #labels = this.prop<MeterLabels>({});
  readonly #chrome = this.prop<MeterChrome>({});
  readonly #id = uid("aster-meter");

  /** The edit model the value comes from, with `field`. Without one, `value` is used. */
  get model(): EditModel | undefined { return this.#model.value; }
  set model(v: EditModel | undefined) { this.#model.value = v; }
  /** The field whose value the meter shows. Its title is the default label. */
  get field(): string { return this.#field.value; }
  set field(v: string) { this.#field.value = v; }
  /** Another field that supplies the maximum, such as a budget. Needs `model`. */
  get maxField(): string { return this.#maxField.value; }
  set maxField(v: string) { this.#maxField.value = v; }
  /** The value when no model is bound. A numeric string is accepted. */
  get value(): number | string | null { return this.#value.value; }
  set value(v: number | string | null) { this.#value.value = v; }
  /** The lowest value. Default: the field's metadata minimum, else 0. */
  get min(): number | undefined { return this.#min.value; }
  set min(v: number | undefined) { this.#min.value = finite(v, "min"); }
  /** The highest value. Default: `maxField`, else the field's metadata maximum, else 1. */
  get max(): number | undefined { return this.#max.value; }
  set max(v: number | undefined) { this.#max.value = finite(v, "max"); }
  /** The boundary of the low region: a number, or a share of the range such as `"60%"`. Default `min`. */
  get low(): MeterThreshold | undefined { return this.#low.value; }
  set low(v: MeterThreshold | undefined) { this.#low.value = validateMeterThreshold(v, "low"); }
  /** The boundary of the high region. Default `max`. */
  get high(): MeterThreshold | undefined { return this.#high.value; }
  set high(v: MeterThreshold | undefined) { this.#high.value = validateMeterThreshold(v, "high"); }
  /** The best value. At `min` for "less is better" (spent against a budget). Default: the middle. */
  get optimum(): MeterThreshold | undefined { return this.#optimum.value; }
  set optimum(v: MeterThreshold | undefined) { this.#optimum.value = validateMeterThreshold(v, "optimum"); }
  /** The label and accessible name. Default: the field's title. */
  get label(): string { return this.#label.value; }
  set label(v: string) { this.#label.value = v; }
  /** How figures read: plain data, or a function (JavaScript only). Default: a number with up to two decimals. */
  get format(): ValueFormat | ValueFormatter | undefined { return this.#format.value; }
  set format(v: ValueFormat | ValueFormatter | undefined) { this.#format.value = v === undefined || typeof v === "function" ? v : validateValueFormat(v); }
  /** The state words that end the accessible value text. */
  get labels(): MeterLabels { return this.#labels.value; }
  set labels(v: MeterLabels) { this.#labels.value = validateMeterLabels(v); }
  /** What shows: `{ label, value, state }`. */
  get chrome(): MeterChrome { return this.#chrome.value; }
  set chrome(v: MeterChrome) { this.#chrome.value = validateMeterChrome(v); }

  protected render(): View {
    const model = this.#model.value;
    const name = this.#field.value;
    const meta = model && name ? model.type.field(name) : undefined;
    const visible = (model && meta ? model.state(name).value : DEFAULT_STATE).visible;
    this.hidden = !visible;
    if (!visible) return nothing;
    const values = model?.values.value;
    const raw = toMeterNumber(model && name ? values?.[name] : this.#value.value);
    const limit = model && this.#maxField.value ? toMeterNumber(values?.[this.#maxField.value]) : undefined;
    const min = this.#min.value ?? toMeterNumber(meta?.minimum) ?? 0;
    const max = this.#max.value ?? limit ?? toMeterNumber(meta?.maximum) ?? 1;
    const span = Math.max(max, min);
    const bounds = meterBounds({
      min, max,
      low: resolveThreshold(this.#low.value, min, span), high: resolveThreshold(this.#high.value, min, span), optimum: resolveThreshold(this.#optimum.value, min, span),
    });
    const chrome = this.#chrome.value;
    const format = this.#format.value;
    const range = { min: bounds.min, max: bounds.max };
    const say = (n: number) => formatFigure(n, format, { range, field: meta });
    const state = raw === undefined ? undefined : meterState(raw, bounds);
    const labels = { ...METER_LABEL_DEFAULTS, ...this.#labels.value };
    const label = this.#label.value || meta?.title || name;
    const mode = chrome.value ?? "value";
    const shown = raw === undefined ? "No value"
      : mode === "ratio" ? `${say(raw)} of ${say(bounds.max)}`
      : mode === "percent" ? formatFigure(raw, { style: "percent" }, { range })
      : say(raw);
    // The accessible text is always the full "value of max, state" so a reader needs no colour or glyph.
    const spoken = raw === undefined ? "No value" : `${say(raw)} of ${say(bounds.max)}${state ? `, ${labels[state]}` : ""}`;
    const labelId = `${this.#id}-label`;
    const showLabel = chrome.label !== false && label !== "";
    return html`<div class="aster-meter" data-state=${state ?? "none"} style=${`--fill:${raw === undefined ? 0 : meterFill(raw, bounds)}`}>
      ${showLabel || mode !== false ? html`<div class="aster-meter-head">
        ${showLabel ? html`<span class="aster-meter-label" id=${labelId}>${label}</span>` : nothing}
        ${mode === false ? nothing : html`<span class="aster-meter-value" aria-hidden="true">${state && chrome.state !== false ? html`<span class="aster-meter-mark">${MARKS[state]}</span>` : nothing}${shown}</span>`}
      </div>` : nothing}
      <meter class="aster-meter-native" min=${bounds.min} max=${bounds.max} low=${bounds.low} high=${bounds.high} optimum=${bounds.optimum}
        .value=${raw === undefined ? bounds.min : Math.min(bounds.max, Math.max(bounds.min, raw))}
        aria-labelledby=${showLabel ? labelId : nothing} aria-label=${showLabel ? nothing : label || nothing}
        aria-valuetext=${spoken}>${spoken}</meter>
      <div class="aster-meter-track" aria-hidden="true">
        <div class="aster-meter-bar"></div>
        ${bounds.low > bounds.min && bounds.low < bounds.max ? html`<i class="aster-meter-edge" style=${`--at:${meterAt(bounds.low, bounds)}`}></i>` : nothing}
        ${bounds.high > bounds.min && bounds.high < bounds.max && bounds.high !== bounds.low ? html`<i class="aster-meter-edge" style=${`--at:${meterAt(bounds.high, bounds)}`}></i>` : nothing}
      </div>
    </div>`;
  }
}

function finite(v: number | undefined, what: string): number | undefined {
  if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) throw new TypeError(`${what} must be a finite number`);
  return v;
}

define("aster-meter", Meter);
