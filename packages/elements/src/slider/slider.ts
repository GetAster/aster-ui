import type { Field as FieldMeta, Shared, SharedFilters, Value } from "@getaster/data";
import { computed, effect } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "../field/bound-field.ts";
import { canonicalNumeric } from "../field/numeric.ts";
import { formatFigure, validateValueFormat, type ValueFormat, type ValueFormatter } from "../format.ts";
import { toMeterNumber } from "../meter/config.ts";
import "../field/number-field.ts";
import {
  fractionOf, keyTarget, moveThumb, nearestThumb, rangeCriteria, snap, thumbBounds, tickLabelKeep, tickLabelStride, tickValues, validateSliderChrome, validateSliderNumber, validateSliderTicks, valueAt, decimalsOf,
  type SliderChrome, type SliderScale, type SliderTicks,
} from "./config.ts";

export type { SliderChrome, SliderTicks } from "./config.ts";

/** Contributes a range slider's committed range to a page's shared filter, where the slicer shows it as a chip. */
export interface SliderFilter {
  /** The page's shared filter. */
  readonly filters: SharedFilters;
  /** The contributor's name; one slider per name. */
  readonly by: string;
  /** The field the range narrows. */
  readonly field: string;
  /** The entity set the criteria are written against; omit to apply by field name. */
  readonly set?: string;
  /** The chip's text before the range. Default: the slider's label. */
  readonly label?: string;
}

/** What the render last drew, for the pointer and key handlers. */
interface Snapshot {
  readonly scale: SliderScale;
  readonly values: readonly number[];
  readonly largeStep: number;
  readonly readOnly: boolean;
  readonly disabled: boolean;
  readonly meta: FieldMeta | undefined;
}

type Pair = readonly [number, number];

/**
 * A number, or a range between two numbers, chosen by dragging or by keys, as an
 * editor for a field of an edit model or on its own. Each thumb is an ARIA
 * `slider` (WAI-ARIA APG slider and multi-thumb slider patterns): arrows by
 * `step`, Page Up and Down by `largeStep`, Home and End to the ends of its room.
 * In range mode (`range`) the thumbs cannot cross. A number box can sit beside
 * the track to type a value (`chrome.input`). In range mode, `filter` makes the
 * committed range a shared filter that every collection consuming it applies.
 */
export class Slider extends BoundField {
  readonly #range = this.prop(false);
  readonly #value = this.prop<number | string | null>(null);
  readonly #values = this.prop<Pair | undefined>(undefined);
  readonly #endField = this.prop("");
  readonly #min = this.prop<number | undefined>(undefined);
  readonly #max = this.prop<number | undefined>(undefined);
  readonly #step = this.prop<number | undefined>(undefined);
  readonly #largeStep = this.prop<number | undefined>(undefined);
  readonly #minGap = this.prop(0);
  readonly #ticks = this.prop<SliderTicks>(false);
  readonly #format = this.prop<ValueFormat | ValueFormatter | undefined>(undefined);
  readonly #readOnly = this.prop(false);
  readonly #disabled = this.prop(false);
  readonly #chrome = this.prop<SliderChrome>({});
  readonly #filter = this.prop<SliderFilter | undefined>(undefined);
  /** The values being dragged or typed, before they are committed. */
  readonly #draft = this.prop<readonly number[] | undefined>(undefined);
  readonly #active = this.prop<0 | 1 | undefined>(undefined);
  readonly #typed = new Map<number, string>();
  /** The width the tick labels have, read after layout; labels thin out when they would touch. */
  readonly #labelRoom = this.prop(0);
  #snapshot: Snapshot | undefined;
  #stopDrag: (() => void) | undefined;

  /** Two thumbs and a range between them, instead of one value. Default `false`. */
  get range(): boolean { return this.#range.value; }
  set range(v: boolean) { this.#range.value = v; }
  /** The value without a model; a numeric string is accepted. `null` shows the thumb at the minimum with "No value". */
  get value(): number | string | null { return this.#value.value; }
  set value(v: number | string | null) { this.#value.value = v; }
  /** The range without a model: `[low, high]`. Default: the whole of `min` to `max`. */
  get values(): Pair | undefined { return this.#values.value; }
  set values(v: Pair | undefined) {
    if (v !== undefined && (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== "number" || !Number.isFinite(n)))) throw new TypeError("values must be a [low, high] pair of numbers");
    this.#values.value = v;
  }
  /** In range mode, the field that holds the upper value; `field` holds the lower. */
  get endField(): string { return this.#endField.value; }
  set endField(v: string) { this.#endField.value = v; }
  /** The lowest value. Default: the field's metadata minimum, else 0. */
  get min(): number | undefined { return this.#min.value; }
  set min(v: number | undefined) { this.#min.value = v === undefined ? v : validateSliderNumber(v, "min"); }
  /** The highest value. Default: the field's metadata maximum, else 100. */
  get max(): number | undefined { return this.#max.value; }
  set max(v: number | undefined) { this.#max.value = v === undefined ? v : validateSliderNumber(v, "max"); }
  /** The smallest change, and the grid values snap to from `min`. Default: the field's scale, else 1. */
  get step(): number | undefined { return this.#step.value; }
  set step(v: number | undefined) { this.#step.value = v === undefined ? v : validateSliderNumber(v, "step", true); }
  /** The change for Page Up and Page Down. Default: a tenth of the range, at least one step. */
  get largeStep(): number | undefined { return this.#largeStep.value; }
  set largeStep(v: number | undefined) { this.#largeStep.value = v === undefined ? v : validateSliderNumber(v, "largeStep", true); }
  /** The least distance between the two thumbs. Default `0`: they may meet. */
  get minGap(): number { return this.#minGap.value; }
  set minGap(v: number) { this.#minGap.value = validateSliderNumber(v, "minGap"); }
  /** Tick marks: `true` for one per step, a spacing, or a list of values. Default `false`. */
  get ticks(): SliderTicks { return this.#ticks.value; }
  set ticks(v: SliderTicks) { this.#ticks.value = validateSliderTicks(v); }
  /** How values read in the value text and the accessible value: plain data, or a function (JavaScript only). */
  get format(): ValueFormat | ValueFormatter | undefined { return this.#format.value; }
  set format(v: ValueFormat | ValueFormatter | undefined) { this.#format.value = v === undefined || typeof v === "function" ? v : validateValueFormat(v); }
  /** Keeps the thumbs focusable and announced but stops changes. Default `false`. */
  get readOnly(): boolean { return this.#readOnly.value; }
  set readOnly(v: boolean) { this.#readOnly.value = v; }
  /** Takes the thumbs out of the tab order and stops changes. Default `false`. */
  get disabled(): boolean { return this.#disabled.value; }
  set disabled(v: boolean) { this.#disabled.value = v; }
  /** What shows: `{ input, value, tickLabels }`. */
  get chrome(): SliderChrome { return this.#chrome.value; }
  set chrome(v: SliderChrome) { this.#chrome.value = validateSliderChrome(v); }
  /** In range mode, contributes the committed range to a shared filter. */
  get filter(): SliderFilter | undefined { return this.#filter.value; }
  set filter(v: SliderFilter | undefined) {
    if (v !== undefined && (!v || typeof v !== "object" || typeof v.by !== "string" || v.by === "" || typeof v.field !== "string" || v.field === "" || typeof v.filters?.share !== "function")) {
      throw new TypeError("filter needs filters, by and field");
    }
    this.#filter.value = v;
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>('[role="slider"]')?.focus(options);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The shown label names the first thumb; a label is not a click target for a `div`.
    this.listen(this, "click", (e) => {
      if ((e.target as Element).closest(".aster-field-label")) this.focus();
    });
    const stop = effect(() => {
      const filter = this.#filter.value;
      if (!filter || !this.#range.value) return;
      const source = computed<Shared | undefined>(() => this.#contribution(filter));
      try {
        return filter.filters.share(filter.by, source, () => this.#reset());
      } catch (error) {
        queueMicrotask(() => { throw error; });
        return undefined;
      }
    });
    this.onDisconnect(stop);
    const watch = new ResizeObserver(() => this.#measure());
    watch.observe(this);
    this.onDisconnect(() => watch.disconnect());
    this.onDisconnect(() => this.#stopDrag?.());
  }

  protected override updated(): void {
    this.#measure();
  }

  #measure(): void {
    const width = this.querySelector<HTMLElement>(".aster-slider-ticks")?.clientWidth ?? 0;
    if (Math.abs(width - this.#labelRoom.peek()) >= 1) this.#labelRoom.value = width;
  }

  /** Where the scale and the committed values come from: the model's field metadata and values, or the element's own. */
  #state(): { scale: SliderScale; values: readonly number[]; meta: FieldMeta | undefined; endMeta: FieldMeta | undefined } {
    const model = this.model;
    const name = this.field;
    const meta = model && name ? model.type.field(name) : undefined;
    const end = this.#endField.value;
    const endMeta = model && end ? model.type.field(end) : undefined;
    const min = this.#min.value ?? toMeterNumber(meta?.minimum) ?? 0;
    const max = Math.max(this.#max.value ?? toMeterNumber(meta?.maximum) ?? 100, min);
    const wanted = this.#step.value ?? (meta?.scale ? 10 ** -meta.scale : 1);
    const scale: SliderScale = { min, max, step: max > min ? Math.min(wanted, max - min) : wanted };
    const clamp = (n: number) => Math.min(max, Math.max(min, n));
    if (!this.#range.value) {
      const raw = toMeterNumber(model && name ? model.values.value[name] : this.#value.value);
      return { scale, values: raw === undefined ? [] : [clamp(raw)], meta, endMeta };
    }
    const lo = toMeterNumber(model && name ? model.values.value[name] : this.#values.value?.[0]);
    const hi = toMeterNumber(model && end ? model.values.value[end] : this.#values.value?.[1]);
    const low = clamp(lo ?? min);
    return { scale, values: [low, Math.max(low, clamp(hi ?? max))], meta, endMeta };
  }

  #contribution(filter: SliderFilter): Shared | undefined {
    const { scale, values, meta } = this.#state();
    if (values.length !== 2) return undefined;
    const pair = values as unknown as Pair;
    // A set's criteria are checked against its field types; decimals and 64-bit integers are text.
    const type = filter.set === undefined ? undefined : filter.filters.schema.set(filter.set).type.field(filter.field)?.type;
    const criteria = rangeCriteria(filter.field, pair, scale, type === "Edm.Decimal" || type === "Edm.Int64");
    if (!criteria) return undefined;
    const say = (n: number) => formatFigure(n, this.#format.peek(), { range: scale, field: meta });
    const name = filter.label ?? (this.label || this.model?.type.field(this.field)?.title || this.field);
    const text = pair[0] > scale.min && pair[1] < scale.max ? `${say(pair[0])} to ${say(pair[1])}` : pair[0] > scale.min ? `from ${say(pair[0])}` : `up to ${say(pair[1])}`;
    return { label: `${name} ${text}`.trim(), criteria, ...(filter.set === undefined ? {} : { set: filter.set }) };
  }

  /** Back to the whole range: what removing the shared filter's chip does. */
  #reset(): void {
    const { scale } = this.#state();
    this.#commit([scale.min, scale.max]);
  }

  /** A stored value outside the range is drawn at its end; this says so instead of hiding it. */
  protected override validation(_meta: FieldMeta | undefined, bound: Value | undefined): string | undefined {
    const { scale, meta } = this.#state();
    const end = this.#endField.value;
    const model = this.model;
    const outside = (raw: unknown) => {
      const n = toMeterNumber(raw);
      return n !== undefined && (n < scale.min || n > scale.max)
        ? `Use a value from ${formatFigure(scale.min, this.#format.peek(), { range: scale, field: meta })} to ${formatFigure(scale.max, this.#format.peek(), { range: scale, field: meta })}`
        : undefined;
    };
    if (!this.#range.value) return outside(model ? bound : this.#value.value);
    const upper = model && end ? model.values.value[end] : this.#values.value?.[1];
    return (model && end ? model.errors.value[end]?.[0] : undefined) ?? outside(model ? bound : this.#values.value?.[0]) ?? outside(upper);
  }

  /** A number in the field's own type: exact text for a decimal or 64-bit integer, else a number. */
  #out(n: number, meta: FieldMeta | undefined, scale: SliderScale): Value {
    if (meta?.type === "Edm.Decimal" || meta?.type === "Edm.Int64") return canonicalNumeric(n.toFixed(Math.max(decimalsOf(scale.step), meta.scale ?? 0)));
    return n;
  }

  #detail(values: readonly number[]): { value: number | null } | { values: Pair } {
    return this.#range.peek() ? { values: values as unknown as Pair } : { value: values[0] ?? null };
  }

  #commit(next: readonly number[]): void {
    const { scale, meta, endMeta } = this.#state();
    const model = this.model;
    if (model && this.field) {
      this.write(this.#out(next[0]!, meta, scale));
      const end = this.#endField.peek();
      if (this.#range.peek() && end) {
        model.set(end, this.#out(next[1]!, endMeta, scale));
        if (this.validateOn === "change") model.validateField(end);
      }
    } else if (this.#range.peek()) this.#values.value = next as unknown as Pair;
    else this.#value.value = next[0]!;
    this.#draft.value = undefined;
    this.#typed.clear();
    this.emit("value-change", this.#detail(next), { cancelable: false });
  }

  #input(next: readonly number[]): void {
    this.#draft.value = next;
    this.emit("value-input", this.#detail(next), { cancelable: false });
  }

  #place(thumb: 0 | 1, value: number, current: readonly number[], scale: SliderScale): readonly number[] {
    return this.#range.peek() ? moveThumb(thumb, value, current as unknown as Pair, scale, this.#minGap.peek()) : [snap(value, scale)];
  }

  #fraction(e: PointerEvent, rail: HTMLElement): number {
    const box = rail.getBoundingClientRect();
    const x = box.width > 0 ? (e.clientX - box.left) / box.width : 0;
    return getComputedStyle(this).direction === "rtl" ? 1 - x : x;
  }

  /** A press on a thumb drags it; a press on the track moves the nearer thumb there, then drags it. */
  #begin(e: PointerEvent, requested: 0 | 1 | "track"): void {
    const snap0 = this.#snapshot;
    if (!snap0 || snap0.readOnly || snap0.disabled || e.button !== 0) return;
    const rail = this.querySelector<HTMLElement>(".aster-slider-rail");
    if (!rail) return;
    this.#stopDrag?.();
    e.preventDefault();
    const { scale } = snap0;
    let current = snap0.values.length ? snap0.values : [scale.min];
    let thumb: 0 | 1 = requested === "track" ? 0 : requested;
    const apply = (value: number) => {
      const next = this.#place(thumb, value, current, scale);
      if (next.every((n, i) => n === current[i]) && this.#draft.peek()) return;
      current = next;
      this.#input(next);
    };
    if (requested === "track") {
      const value = valueAt(this.#fraction(e, rail), scale);
      thumb = this.#range.peek() ? nearestThumb(value, current as unknown as Pair) : 0;
      apply(value);
    }
    const el = this.querySelector<HTMLElement>(`[data-thumb="${thumb}"]`);
    if (!el) return;
    el.focus();
    el.setPointerCapture(e.pointerId);
    this.#active.value = thumb;
    const move = (m: PointerEvent) => apply(valueAt(this.#fraction(m, rail), scale));
    const cleanup = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel); el.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", escape, true);
      this.#stopDrag = undefined;
      this.#active.value = undefined;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const cancel = () => { cleanup(); this.#draft.value = undefined; };
    const up = () => { cleanup(); const done = this.#draft.peek(); if (done) this.#commit(done); };
    const escape = (key: KeyboardEvent) => { if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); cancel(); } };
    this.#stopDrag = cancel;
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel); el.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", escape, true);
  }

  #key(e: KeyboardEvent, thumb: 0 | 1): void {
    const s = this.#snapshot;
    if (!s || s.readOnly || s.disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const values = s.values.length ? s.values : [s.scale.min];
    const room = thumbBounds(thumb, values as unknown as Pair, s.scale, this.#minGap.peek());
    const to = keyTarget(e.key, values[thumb] ?? s.scale.min, room, s.scale, s.largeStep, getComputedStyle(this).direction === "rtl");
    if (to === undefined) return;
    e.preventDefault();
    if (to !== values[thumb] || s.values.length === 0) this.#commit(this.#place(thumb, to, values, s.scale));
  }

  /** A number typed in a paired box: it follows the slider while valid, and commits when the box does. */
  #typedInput(thumb: 0 | 1, text: string): void {
    const s = this.#snapshot;
    if (!s || s.readOnly || s.disabled) return;
    this.#typed.set(thumb, text);
    const n = text.trim() === "" ? Number.NaN : Number(text);
    const room = thumbBounds(thumb, (s.values.length ? s.values : [s.scale.min]) as unknown as Pair, s.scale, this.#minGap.peek());
    if (!Number.isFinite(n) || n < room.lower || n > room.upper || snap(n, s.scale) !== n) {
      this.#draft.value = undefined;
      return;
    }
    this.#input(this.#place(thumb, n, s.values.length ? s.values : [s.scale.min], s.scale));
  }

  #typedCommit(): void {
    const draft = this.#draft.peek();
    if (draft) this.#commit(draft);
  }

  protected control(c: ControlContext): View {
    const { scale, values: committed, meta } = this.#state();
    const range = this.#range.value;
    const draft = this.#draft.value;
    const values = draft ?? committed;
    const empty = values.length === 0;
    const readOnly = this.#readOnly.value || c.state.readOnly;
    const disabled = this.#disabled.value || !c.state.enabled;
    const largeStep = this.#largeStep.value ?? Math.max(scale.step, snap((scale.max - scale.min) / 10, scale));
    this.#snapshot = { scale, values: committed, largeStep, readOnly, disabled, meta };
    const format = this.#format.value;
    const say = (n: number) => formatFigure(n, format, { range: scale, field: meta });
    const chrome = this.#chrome.value;
    const lo = range ? values[0] ?? scale.min : scale.min;
    const hi = range ? values[1] ?? scale.max : values[0] ?? scale.min;
    const ticks = tickValues(this.#ticks.value, scale);
    const base = this.labelled ? undefined : c.label;
    const labelId = `${c.id}-label`;
    const thumbs: readonly (0 | 1)[] = range ? [0, 1] : [0];
    // Labels are thinned by intent: JS says which to keep from the track width it read; CSS draws them.
    const tickText = ticks.map(say);
    const labelKeep = tickLabelKeep(ticks.length, tickLabelStride(ticks.length, Math.max(0, ...tickText.map((t) => t.length)) * 7 + 10, this.#labelRoom.value));
    const shownValue = empty ? "No value" : range ? `${say(lo)} – ${say(hi)}` : say(hi);
    // The value text reserves the width of its longest reading, so the track does not resize while it is dragged.
    const longest = [scale.min, scale.max, (scale.min + scale.max) / 2].map(say).reduce((a, b) => (b.length > a.length ? b : a));
    const reserve = range ? `${longest} – ${longest}` : longest;
    const room = (thumb: 0 | 1) => thumbBounds(thumb, (values.length ? values : [scale.min]) as unknown as Pair, scale, this.#minGap.peek());
    const typedBox = chrome.input === true;
    const input = (thumb: 0 | 1) => {
      const typed = this.#typed.get(thumb);
      const n = values[thumb];
      // A stored value off the step grid is the model's to flag, not the box's: it only enforces the step on what is typed.
      const onGrid = n === undefined || snap(n, scale) === n;
      const text: string | number | null = n === undefined ? null : typed !== undefined && Number(typed) === n ? typed : n;
      return html`<aster-number-field class="aster-slider-input" data-thumb-input=${thumb}
        .label=${range ? `${thumb === 0 ? "Minimum" : "Maximum"} ${c.label}` : c.label} .value=${text}
        .min=${scale.min} .max=${scale.max} .step=${onGrid ? scale.step : undefined}
        .numericType=${Number.isInteger(scale.step) && Number.isInteger(scale.min) && (n === undefined || Number.isInteger(n)) ? "integer" : "decimal"}
        .readOnly=${readOnly || disabled} .format=${format ? (v: string | number | null) => (v === null ? "" : say(Number(v))) : undefined}
        @value-change=${(e: CustomEvent<{ value: string | number | null }>) => { e.stopPropagation(); this.#typedInput(thumb, e.detail.value === null ? "" : String(e.detail.value)); }}
        @change=${() => this.#typedCommit()}></aster-number-field>`;
    };
    const thumb = (i: 0 | 1) => {
      const v = values[i] ?? scale.min;
      const bounds = room(i);
      const name = range ? `${i === 0 ? "Minimum" : "Maximum"} ${c.label}` : undefined;
      return html`<div class="aster-slider-thumb" role="slider" data-thumb=${i} ?data-active=${this.#active.value === i}
        id=${i === 0 ? c.id : nothing} tabindex=${disabled ? -1 : 0}
        aria-orientation="horizontal" aria-valuemin=${bounds.lower} aria-valuemax=${bounds.upper} aria-valuenow=${v}
        aria-valuetext=${empty ? "No value" : say(v)}
        aria-label=${name ?? base ?? nothing} aria-labelledby=${name === undefined && this.labelled ? labelId : nothing}
        aria-disabled=${disabled ? "true" : nothing} aria-readonly=${readOnly ? "true" : nothing} aria-invalid=${c.invalid ? "true" : nothing}
        aria-describedby=${c.describedBy ?? nothing} aria-required=${c.state.required && !range ? "true" : nothing}
        style=${`--at:${fractionOf(v, scale)}`}
        @pointerdown=${(e: PointerEvent) => this.#begin(e, i)}
        @keydown=${(e: KeyboardEvent) => this.#key(e, i)}></div>`;
    };
    return html`<div class="aster-slider" ?data-range=${range} ?data-readonly=${readOnly} ?data-disabled=${disabled} ?data-invalid=${c.invalid} ?data-empty=${empty}
      ?data-active=${this.#active.value !== undefined}>
      ${typedBox && range ? input(0) : nothing}
      <div class="aster-slider-body">
        <div class="aster-slider-rail" style=${`--lo:${range ? fractionOf(lo, scale) : 0};--hi:${empty ? 0 : fractionOf(hi, scale)}`}
          @pointerdown=${(e: PointerEvent) => { if (!(e.target as Element).closest("[role=slider]")) this.#begin(e, "track"); }}>
          <div class="aster-slider-fill"></div>
          ${ticks.map((t) => html`<i class="aster-slider-tick" ?data-in=${t >= lo && t <= hi} style=${`--at:${fractionOf(t, scale)}`}></i>`)}
          ${thumbs.map(thumb)}
        </div>
        ${chrome.tickLabels && ticks.length ? html`<div class="aster-slider-ticks" aria-hidden="true">${ticks.map((t, i) => html`<span ?data-thin=${!labelKeep[i]} style=${`--at:${fractionOf(t, scale)}`}>${tickText[i]}</span>`)}</div>` : nothing}
      </div>
      ${typedBox ? input(range ? 1 : 0) : chrome.value === false ? nothing : html`<span class="aster-slider-value" aria-hidden="true"><span class="aster-slider-sizer">${reserve}</span><span class="aster-slider-text">${shownValue}</span></span>`}
    </div>`;
  }
}

define("aster-slider", Slider);
