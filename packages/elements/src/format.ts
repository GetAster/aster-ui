import type { Field } from "@getaster/data";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A short relative time: "Just now", "18 min ago", "1 h ago", "Yesterday",
 * a weekday within the week, then a date. Always pair it with
 * `absoluteTime` on hover.
 */
export function relativeTime(iso: string, now: number, timeZone?: string): string {
  const t = Date.parse(iso);
  const ago = now - t;
  if (ago < MINUTE) return "Just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  const days = dayNumber(now, timeZone) - dayNumber(t, timeZone);
  if (days === 0) return `${Math.floor(ago / HOUR)} h ago`;
  if (days === 1) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};
  if (days < 7) return new Intl.DateTimeFormat("en-GB", { weekday: "short", ...opts }).format(t);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...opts }).format(t);
}

/** "Wed 7 Oct 2026, 14:57". */
export function absoluteTime(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(Date.parse(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** Whole days since the epoch in the time zone, for "yesterday" and weekday names. */
function dayNumber(t: number, timeZone?: string): number {
  const p = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(t);
  return Math.floor(Date.parse(`${p}T00:00:00Z`) / 86_400_000);
}


/** How a number is written: plain decimal (default), integer, percent or currency. */
export type NumberFormatStyle = "decimal" | "integer" | "percent" | "currency";

/**
 * How a number reads, as plain data so a composition catalog can carry it. A
 * field's metadata fills what this leaves out: a Decimal's scale sets its
 * fraction digits, an integer type shows none, and a currency annotation
 * names the currency.
 */
export interface ValueFormat {
  /** Default `"decimal"`. */
  readonly style?: NumberFormatStyle;
  /** ISO 4217 code for `"currency"`. Default: the field's currency annotation, else `"GBP"`. */
  readonly currency?: string;
  /** Fewest fraction digits shown. */
  readonly minimumFractionDigits?: number;
  /** Most fraction digits shown. */
  readonly maximumFractionDigits?: number;
  /** Preserve up to two significant digits when normal rounding would hide a nonzero value. */
  readonly smallValues?: "significant";
  /** Short forms such as "£41.2k" or "1.2m". */
  readonly compact?: boolean;
  /** Text after the figure, such as "GB". */
  readonly unit?: string;
  /** A BCP 47 tag. Default `"en-GB"`. */
  readonly locale?: string;
}

/** A function that says a value in words; JavaScript only. */
export type ValueFormatter = (value: number, range: { readonly min: number; readonly max: number }) => string;

/** What a figure is read against: the field it came from, or the range a percent is a position in. */
export interface FigureContext {
  /** Metadata for the value: its type, scale and currency. */
  readonly field?: Field | undefined;
  /** With `"percent"`: the value's position in this range, not the value times 100. */
  readonly range?: { readonly min: number; readonly max: number } | undefined;
}

const DEFAULT_LOCALE = "en-GB";
const NUMBER_STYLES: readonly string[] = ["decimal", "integer", "percent", "currency"];
const FORMAT_KEYS: readonly string[] = ["style", "currency", "minimumFractionDigits", "maximumFractionDigits", "compact", "unit", "locale", "smallValues"];
const NUMERIC_TYPES = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Decimal", "Edm.Single", "Edm.Double"]);
const INTEGER_TYPES = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64"]);
const CURRENCY_TERMS = ["Measures.ISOCurrency", "Org.OData.Measures.V1.ISOCurrency"];

/** Whether a field holds a number, so a format applies and the value reads from the end. */
export function isNumericField(field: Field | undefined): boolean {
  return NUMERIC_TYPES.has(field?.type ?? "");
}

/**
 * Checks a format, naming `path` in the message. `extra` lists keys a host
 * type adds, such as a grid column format's `kind`.
 */
export function validateValueFormat(value: unknown, path = "format", extra: readonly string[] = []): ValueFormat {
  const fail = (key: string, message: string): never => { throw new TypeError(`${path}${key} ${message}`); };
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail("", "must be a plain object");
  const f = value as Record<string, unknown>;
  for (const key of Object.keys(f)) if (!FORMAT_KEYS.includes(key) && !extra.includes(key)) fail(`.${key}`, "is not a known option");
  if (f.style !== undefined && (typeof f.style !== "string" || !NUMBER_STYLES.includes(f.style))) fail(".style", `must be one of ${NUMBER_STYLES.join(", ")}`);
  if (f.currency !== undefined && (typeof f.currency !== "string" || !/^[A-Za-z]{3}$/.test(f.currency))) fail(".currency", "must be a three-letter currency code");
  for (const key of ["minimumFractionDigits", "maximumFractionDigits"] as const) {
    const digits = f[key];
    if (digits !== undefined && (typeof digits !== "number" || !Number.isInteger(digits) || digits < 0 || digits > 20)) fail(`.${key}`, "must be a nonnegative integer up to 20");
  }
  const min = f.minimumFractionDigits;
  const max = f.maximumFractionDigits;
  if (typeof min === "number" && typeof max === "number" && min > max) fail(".minimumFractionDigits", "cannot exceed maximumFractionDigits");
  if (f.style === "integer" && typeof min === "number" && min > (typeof max === "number" ? max : 0)) fail(".minimumFractionDigits", "cannot exceed maximumFractionDigits for the integer style");
  if (f.smallValues !== undefined && f.smallValues !== "significant") fail(".smallValues", 'must be "significant"');
  if (f.compact !== undefined && typeof f.compact !== "boolean") fail(".compact", "must be a boolean");
  if (f.unit !== undefined && typeof f.unit !== "string") fail(".unit", "must be a string");
  if (f.locale !== undefined) {
    if (typeof f.locale !== "string") fail(".locale", "must be a string");
    try { Intl.getCanonicalLocales(f.locale as string); } catch { fail(".locale", "must be a BCP 47 tag"); }
  }
  try { new Intl.NumberFormat((f.locale as string | undefined) ?? DEFAULT_LOCALE, intlOptions(f as ValueFormat, undefined, 0)); } catch { fail("", "can’t be formatted on this platform"); }
  return Object.freeze({ ...f }) as ValueFormat;
}

/** The currency a field's metadata names: a literal `Measures.ISOCurrency`. */
function fieldCurrency(field: Field | undefined): string | undefined {
  for (const term of CURRENCY_TERMS) {
    const code = field?.annotations[term];
    if (typeof code === "string" && /^[A-Za-z]{3}$/.test(code)) return code.toUpperCase();
  }
  return undefined;
}

/**
 * The Intl options a format and its field ask for. Explicit digits win, then
 * a Decimal's scale, then integers showing none; with no field a figure shows
 * up to two places, and money none for a whole amount.
 */
function intlOptions(f: ValueFormat, field: Field | undefined, sample: number): Intl.NumberFormatOptions {
  const style = f.style ?? "decimal";
  const o: Intl.NumberFormatOptions = {};
  if (style === "percent") o.style = "percent";
  else if (style === "currency") {
    o.style = "currency";
    o.currency = f.currency ?? fieldCurrency(field) ?? "GBP";
  }
  let min = f.minimumFractionDigits;
  let max = f.maximumFractionDigits;
  if (min === undefined && max === undefined && !f.compact) {
    if (field?.type === "Edm.Decimal" && field.scale !== undefined && (style === "decimal" || style === "currency")) min = max = field.scale;
    else if (style === "integer" || (INTEGER_TYPES.has(field?.type ?? "") && style === "decimal")) max = 0;
    else if (!field && style === "currency") { min = Number.isInteger(sample) ? 0 : 2; max = 2; }
  }
  if (f.compact) {
    o.notation = "compact";
    if (min === undefined && max === undefined && style === "currency") max = 1;
  } else if (!field && style === "decimal" && max === undefined) max = Math.max(2, min ?? 0);
  if (style === "integer" && max === undefined) max = 0;
  if (min !== undefined) o.minimumFractionDigits = min;
  if (max !== undefined) o.maximumFractionDigits = max;
  return o;
}

const WRITERS = new Map<string, Intl.NumberFormat>();
function writer(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let w = WRITERS.get(key);
  if (!w) WRITERS.set(key, (w = new Intl.NumberFormat(locale, options)));
  return w;
}

/** Text of a number with a real minus sign, and `k` and `m` in lower case. */
function say(w: Intl.NumberFormat, value: number): string {
  return w.formatToParts(value).map((p) => {
    if (p.type === "minusSign") return "−";
    if (p.type === "compact" && (p.value === "K" || p.value === "M")) return p.value.toLowerCase();
    return p.value;
  }).join("");
}

const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A value as a figure: "6,200", "£6,200", "62%", "£41.2k", "12 GB". Always
 * with a real minus sign. Decimal and Int64 text keeps every digit; text that
 * is not a number is returned as it is.
 */
export function formatFigure(value: number | string, format: ValueFormat | ValueFormatter | undefined, context: FigureContext = {}): string {
  if (typeof format === "function") return format(Number(value), context.range ?? { min: 0, max: 100 });
  const f = format ?? {};
  const locale = f.locale ?? DEFAULT_LOCALE;
  const range = f.style === "percent" ? context.range : undefined;
  let text: string;
  if (typeof value === "string" && !f.compact && range === undefined) {
    const t = value.trim();
    if (!DECIMAL_TEXT.test(t)) return value;
    text = exactText(t, locale, intlOptions(f, context.field, Number(t)), f.smallValues === "significant");
  } else {
    let n = Number(value);
    if (typeof value === "string" && value.trim() === "" || !Number.isFinite(n)) return String(value);
    if (range) n = range.max === range.min ? 0 : (n - range.min) / (range.max - range.min);
    const options = intlOptions(f, context.field, n);
    if (f.smallValues === "significant" && !f.compact && n !== 0) {
      const max = writer(locale, options).resolvedOptions().maximumFractionDigits ?? 0;
      const magnitude = Math.abs(n) * (options.style === "percent" ? 100 : 1);
      if (magnitude < 0.5 * 10 ** -max) {
        delete options.minimumFractionDigits;
        delete options.maximumFractionDigits;
        options.minimumSignificantDigits = 1;
        options.maximumSignificantDigits = 2;
      }
    }
    text = say(writer(locale, options), n);
  }
  return f.unit ? `${text} ${f.unit}` : text;
}

/** A number as an editor shows it: no grouping, every digit, and a Decimal's scale as the fewest places. */
export function plainFigure(field: Field, value: string): string {
  const t = value.trim();
  if (field.type !== "Edm.Decimal" || !field.scale || !/^-?\d+(?:\.\d*)?$/.test(t)) return value;
  const places = t.split(".")[1]?.length ?? 0;
  if (places > 20) return value;
  return exactText(t, DEFAULT_LOCALE, { useGrouping: false, minimumFractionDigits: field.scale, maximumFractionDigits: Math.max(field.scale, places) }).replace("−", "-");
}

interface Layout {
  readonly parts: readonly Intl.NumberFormatPart[];
  readonly min: number;
  readonly max: number;
  readonly point: string;
  readonly group: Intl.NumberFormat;
}
const LAYOUTS = new Map<string, Layout>();

/** The skeleton Intl builds for a format; exact digits replace its number parts. */
function layoutOf(locale: string, options: Intl.NumberFormatOptions): Layout {
  const key = `${locale}|${JSON.stringify(options)}`;
  let layout = LAYOUTS.get(key);
  if (!layout) {
    const resolved = writer(locale, options).resolvedOptions();
    const min = resolved.minimumFractionDigits ?? 0;
    const max = resolved.maximumFractionDigits ?? 0;
    const parts = writer(locale, { ...options, minimumFractionDigits: min, maximumFractionDigits: max }).formatToParts(0);
    const point = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === "decimal")?.value ?? ".";
    const group = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: options.useGrouping ?? true });
    layout = { parts, min, max, point, group };
    LAYOUTS.set(key, layout);
  }
  return layout;
}

/** Plain decimal text, formatted without passing through a double. */
function exactText(text: string, locale: string, options: Intl.NumberFormatOptions, smallValues = false): string {
  const negative = text.startsWith("-");
  const body = text.replace(/^[+-]/, "");
  const { parts, point, group, ...digits } = layoutOf(locale, options);
  let { min, max } = digits;
  const scaled = options.style === "percent" ? scalePercent(body) : body;
  const [whole, fractionText = ""] = scaled.split(".");
  let rounded = roundMagnitude(whole || "0", fractionText, max);
  let tiny = false;
  if (smallValues && /[1-9]/.test(scaled) && !/[1-9]/.test(rounded.integer + rounded.fraction)) {
    // Manual fraction assembly supports tiny exact decimals beyond Intl's digit limit.
    tiny = true;
    max = fractionText.search(/[1-9]/) + 2;
    min = 0;
    rounded = roundMagnitude(whole || "0", fractionText, max);
  }
  let fraction = rounded.fraction.padEnd(min, "0");
  while (fraction.length > min && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  if (tiny) fraction = fraction.replace(/\d/g, digit => writer(locale, { useGrouping: false }).format(Number(digit)));
  const grouped = group.format(BigInt(rounded.integer || "0"));
  let out = "";
  for (const part of parts) {
    if (part.type === "integer") {
      out += grouped;
      if (fraction && !parts.some((p) => p.type === "fraction")) out += point + fraction;
    } else if (part.type === "fraction") out += fraction;
    else out += part.value;
  }
  return negative ? `−${out}` : out;
}

/** Rounds magnitude digits half away from zero, as Intl does, without a double in between. */
function roundMagnitude(integer: string, fraction: string, max: number): { integer: string; fraction: string } {
  if (fraction.length <= max) return { integer, fraction };
  const kept = fraction.slice(0, max);
  const carried = fraction[max]! >= "5" ? incrementDigits(integer + kept) : integer + kept;
  // A carry that grows the digits moves the point left: the new leading digit
  // belongs to the integer and every kept fraction digit became zero.
  if (carried.length > integer.length + kept.length) return { integer: carried.slice(0, carried.length - max), fraction: "0".repeat(max) };
  return { integer: carried.slice(0, integer.length), fraction: carried.slice(integer.length) };
}

function incrementDigits(digits: string): string {
  const out = digits.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== "9") { out[i] = String(Number(out[i]) + 1); return out.join(""); }
    out[i] = "0";
  }
  return `1${out.join("")}`;
}

/** Percent style scales by 100, like Intl's percent does. */
function scalePercent(body: string): string {
  const [integer = "", fraction = ""] = body.split(".");
  const shifted = fraction.padEnd(2, "0");
  const whole = `${integer}${shifted.slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  const rest = shifted.slice(2);
  return rest ? `${whole}.${rest}` : whole;
}
