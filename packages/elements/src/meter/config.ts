/** Which region of the gauge the value is in, by the HTML meter algorithm. */
export type MeterState = "optimum" | "suboptimum" | "poor";

/** A number, or a share of the range as text such as `"80%"`. */
export type MeterThreshold = number | `${number}%`;

export interface MeterBounds {
  readonly min: number;
  readonly max: number;
  readonly low: number;
  readonly high: number;
  readonly optimum: number;
}

/** What shows around the bar. */
export interface MeterChrome {
  /** The label text above the bar. Default `true`; the meter keeps an accessible name either way. */
  readonly label?: boolean;
  /** The figure beside the label: the value, "value of max", the share of the range, or nothing. Default `"value"`. */
  readonly value?: "value" | "ratio" | "percent" | false;
  /** A mark whose shape says the state, so it is never colour alone. Default `true`. */
  readonly state?: boolean;
}

/** The words that end the accessible value text. */
export interface MeterLabels {
  /** Default "Good". */
  readonly optimum?: string;
  /** Default "Caution". */
  readonly suboptimum?: string;
  /** Default "Poor". */
  readonly poor?: string;
}

export const METER_LABEL_DEFAULTS: Readonly<Required<MeterLabels>> = Object.freeze({ optimum: "Good", suboptimum: "Caution", poor: "Poor" });

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v));

export function validateMeterThreshold(value: unknown, what: string): MeterThreshold | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?%$/.test(value)) return value as MeterThreshold;
  throw new TypeError(`${what} must be a number or a percentage such as "80%"`);
}

export function validateMeterChrome(value: unknown): MeterChrome {
  if (!plain(value)) throw new TypeError("chrome must be a plain object");
  for (const key of Object.keys(value)) if (!["label", "value", "state"].includes(key)) throw new TypeError(`Unknown chrome key '${key}'`);
  for (const key of ["label", "state"]) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new TypeError(`chrome.${key} must be a boolean`);
  if (value.value !== undefined && value.value !== false && !["value", "ratio", "percent"].includes(value.value as string)) throw new TypeError('chrome.value must be "value", "ratio", "percent" or false');
  return Object.freeze({ ...value }) as MeterChrome;
}

export function validateMeterLabels(value: unknown): MeterLabels {
  if (!plain(value)) throw new TypeError("labels must be a plain object");
  for (const [key, text] of Object.entries(value)) {
    if (!["optimum", "suboptimum", "poor"].includes(key)) throw new TypeError(`Unknown label '${key}'`);
    if (typeof text !== "string") throw new TypeError(`labels.${key} must be a string`);
  }
  return Object.freeze({ ...value }) as MeterLabels;
}

/** A threshold as a number in the range; a percentage is a share of `max - min`. */
export function resolveThreshold(threshold: MeterThreshold | undefined, min: number, max: number): number | undefined {
  if (threshold === undefined) return undefined;
  return typeof threshold === "number" ? threshold : min + (Number.parseFloat(threshold) / 100) * (max - min);
}

/**
 * The gauge's bounds with the browser's own defaulting and clamping: a
 * maximum below the minimum becomes the minimum; `low` defaults to the
 * minimum and `high` to the maximum, each within the range, `high` no lower
 * than `low`; `optimum` defaults to the middle, within the range.
 */
export function meterBounds(input: { min: number; max: number; low?: number | undefined; high?: number | undefined; optimum?: number | undefined }): MeterBounds {
  const min = input.min;
  const max = Math.max(input.max, min);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const low = clamp(input.low ?? min);
  const high = Math.max(low, clamp(input.high ?? max));
  const optimum = clamp(input.optimum ?? (min + max) / 2);
  return { min, max, low, high, optimum };
}

/**
 * Good, middling or bad: where the optimum point sits decides which region
 * is good (below `low`, between the boundaries, or above `high`); the region
 * next to it is suboptimal and the far one is even less good. The value
 * counts as between the boundaries when it equals one.
 */
export function meterState(value: number, bounds: MeterBounds): MeterState {
  const v = Math.min(bounds.max, Math.max(bounds.min, value));
  const where = (n: number): -1 | 0 | 1 => (n < bounds.low ? -1 : n > bounds.high ? 1 : 0);
  const good = where(bounds.optimum);
  const here = where(v);
  if (here === good) return "optimum";
  return Math.abs(here - good) === 1 ? "suboptimum" : "poor";
}

/** How much of the gauge is filled, 0 to 1. A value past either end fills or empties it. */
export function meterFill(value: number, bounds: MeterBounds): number {
  const span = bounds.max - bounds.min;
  return span === 0 ? 0 : Math.min(1, Math.max(0, (value - bounds.min) / span));
}

/** A position within the gauge, 0 to 1, for drawing a boundary. */
export function meterAt(value: number, bounds: MeterBounds): number {
  return meterFill(value, bounds);
}

/** A model value as a number, or `undefined` when it is empty or not numeric. */
export function toMeterNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}
