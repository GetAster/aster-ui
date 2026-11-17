import type { Criteria } from "@getaster/data";

/** Tick marks: one per step, one every so many units, or at exact values. */
export type SliderTicks = boolean | number | readonly number[];

/** What shows around the track. */
export interface SliderChrome {
  /** A number box beside the track (two in range mode) to type a value. Default `false`. */
  readonly input?: boolean;
  /** The formatted value after the track. Default `true`; not drawn when `input` is. */
  readonly value?: boolean;
  /** Numbers under the ticks. Default `false`. */
  readonly tickLabels?: boolean;
}

export interface SliderScale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v));

export const MAX_TICKS = 50;

export function validateSliderChrome(value: unknown): SliderChrome {
  if (!plain(value)) throw new TypeError("chrome must be a plain object");
  for (const key of Object.keys(value)) {
    if (!["input", "value", "tickLabels"].includes(key)) throw new TypeError(`Unknown chrome key '${key}'`);
    if (typeof value[key] !== "boolean") throw new TypeError(`chrome.${key} must be a boolean`);
  }
  return Object.freeze({ ...value }) as SliderChrome;
}

export function validateSliderTicks(value: unknown): SliderTicks {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v))) return Object.freeze([...value]) as readonly number[];
  throw new TypeError("ticks must be a boolean, a positive spacing or a list of numbers");
}

export function validateSliderNumber(value: unknown, what: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : false)) throw new TypeError(`${what} must be ${positive ? "a positive" : "a finite"} number`);
  return value;
}

/** Decimal places a number needs, so a step of 0.05 snaps to two places and 0.1 + 0.2 does not leak. */
export function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const text = String(n);
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent) return Number(exponent[1]) + (text.split("e")[0]!.split(".")[1]?.length ?? 0);
  return text.split(".")[1]?.length ?? 0;
}

const places = (scale: SliderScale) => Math.max(decimalsOf(scale.step), decimalsOf(scale.min));

/** The nearest value on the step grid that starts at `min`, within the range. */
export function snap(value: number, scale: SliderScale): number {
  const clamped = Math.min(scale.max, Math.max(scale.min, value));
  const steps = Math.round((clamped - scale.min) / scale.step);
  const snapped = Number((scale.min + steps * scale.step).toFixed(places(scale)));
  // The last step can fall short of `max`; never past it.
  return snapped > scale.max ? Number((scale.min + Math.floor((scale.max - scale.min) / scale.step) * scale.step).toFixed(places(scale))) : snapped;
}

/** Where a value sits along the track, 0 to 1. */
export function fractionOf(value: number, scale: SliderScale): number {
  const span = scale.max - scale.min;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, (value - scale.min) / span));
}

/** The snapped value at a position along the track, 0 to 1. */
export function valueAt(fraction: number, scale: SliderScale): number {
  return snap(scale.min + Math.min(1, Math.max(0, fraction)) * (scale.max - scale.min), scale);
}

/** What a key does to the thumb at `value`: the new value, or `undefined` when the key is not for sliders. */
export function keyTarget(key: string, value: number, bounds: { readonly lower: number; readonly upper: number }, scale: SliderScale, largeStep: number, rtl: boolean): number | undefined {
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  let next: number;
  switch (key) {
    case forward:
    case "ArrowUp":
      next = value + scale.step;
      break;
    case backward:
    case "ArrowDown":
      next = value - scale.step;
      break;
    case "PageUp":
      next = value + largeStep;
      break;
    case "PageDown":
      next = value - largeStep;
      break;
    case "Home":
      next = bounds.lower;
      break;
    case "End":
      next = bounds.upper;
      break;
    default:
      return undefined;
  }
  return Math.min(bounds.upper, Math.max(bounds.lower, snap(next, scale)));
}

/**
 * The room one thumb has. The lower thumb stops `minGap` below the upper and
 * the upper `minGap` above the lower, so they never cross.
 */
export function thumbBounds(thumb: 0 | 1, values: readonly [number, number] | readonly [number], scale: SliderScale, minGap: number): { readonly lower: number; readonly upper: number } {
  if (values.length === 1) return { lower: scale.min, upper: scale.max };
  const gap = Math.max(0, minGap);
  return thumb === 0 ? { lower: scale.min, upper: Math.max(scale.min, values[1] - gap) } : { lower: Math.min(scale.max, values[0] + gap), upper: scale.max };
}

/** The new values after moving one thumb to `value`, held within its room. */
export function moveThumb(thumb: 0 | 1, value: number, values: readonly [number, number], scale: SliderScale, minGap: number): readonly [number, number] {
  const { lower, upper } = thumbBounds(thumb, values, scale, minGap);
  const next = Math.min(upper, Math.max(lower, snap(value, scale)));
  return thumb === 0 ? [next, values[1]] : [values[0], next];
}

/** The thumb a press at `value` should move: the nearer one, the upper when they are level and the press is above. */
export function nearestThumb(value: number, values: readonly [number, number]): 0 | 1 {
  const toLow = Math.abs(value - values[0]);
  const toHigh = Math.abs(value - values[1]);
  if (toLow === toHigh) return value > values[1] ? 1 : 0;
  return toLow < toHigh ? 0 : 1;
}

/** The values to draw ticks at, within the range, snapped to the grid and in order. */
export function tickValues(ticks: SliderTicks, scale: SliderScale): readonly number[] {
  if (ticks === false) return [];
  let list: number[];
  if (Array.isArray(ticks)) list = ticks.filter((t) => t >= scale.min && t <= scale.max);
  else {
    const spacing = ticks === true ? scale.step : (ticks as number);
    const count = Math.floor((scale.max - scale.min) / spacing + 1e-9) + 1;
    // Too many ticks is noise, not a scale: thin to what fits.
    const every = count > MAX_TICKS ? spacing * Math.ceil(count / MAX_TICKS) : spacing;
    list = [];
    for (let i = 0; scale.min + i * every <= scale.max + 1e-9; i++) list.push(Number((scale.min + i * every).toFixed(places(scale) + decimalsOf(every))));
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
 * The criteria a range contributes to a shared filter: `field >= low` and
 * `field <= high`. A bound at the end of the range is left out, and the full
 * range contributes nothing. An `exact` field (a decimal or 64-bit integer,
 * which OData carries as text) gets its bounds as text.
 */
export function rangeCriteria(field: string, values: readonly [number, number], scale: SliderScale, exact = false): Criteria | undefined {
  const parts: Criteria[] = [];
  const literal = (n: number) => (exact ? n.toFixed(places(scale)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : n);
  if (values[0] > scale.min) parts.push({ op: "ge", field, value: literal(values[0]) });
  if (values[1] < scale.max) parts.push({ op: "le", field, value: literal(values[1]) });
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0]! : { op: "and", args: parts };
}

/**
 * Which tick labels to draw when they cannot all fit: every `stride`-th, and
 * always the last, dropping the one before it when the two would touch. The
 * first is always kept. A stride of 1 keeps all.
 */
export function tickLabelKeep(count: number, stride: number): readonly boolean[] {
  const keep = Array.from({ length: count }, (_, i) => stride <= 1 || i % stride === 0);
  if (count > 1) {
    keep[count - 1] = true;
    for (let i = count - 2; i > 0 && count - 1 - i < stride; i--) keep[i] = false;
  }
  return keep;
}

/** How many labels apart the drawn ones must be so that labels of `labelWidth` fit a track of `trackWidth`. */
export function tickLabelStride(count: number, labelWidth: number, trackWidth: number): number {
  if (count < 2 || trackWidth <= 0) return 1;
  const gap = trackWidth / (count - 1);
  return Math.max(1, Math.ceil(labelWidth / gap));
}
