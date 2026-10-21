import type { RelativeDate } from "./ast.ts";
import type { Field, Value } from "../schema/model.ts";

/** A criteria problem: unknown field, a value that doesn't fit its field, or a bad stored value. */
export class CriteriaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriteriaError";
  }
}

const INT_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  "Edm.Byte": [0, 255],
  "Edm.SByte": [-128, 127],
  "Edm.Int16": [-32768, 32767],
  "Edm.Int32": [-2147483648, 2147483647],
};

const RE_INT64 = /^-?\d+$/;
const RE_DECIMAL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const RE_DATE = /^(-?\d{4,})-(\d{2})-(\d{2})$/;
const RE_TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,12}))?)?$/;
const RE_DTO =
  /^(-?\d{4,})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,12}))?)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
const RE_GUID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
const RE_DURATION = /^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.(\d{1,12}))?S)?)?$/;

export function isFloatType(field: Field): boolean {
  return field.type === "Edm.Single" || field.type === "Edm.Double";
}

/** Throws `CriteriaError` unless `value` is a legal JS value for `field`'s Edm type. */
export function assertLiteral(value: Value, field: Field): void {
  if (value === null) return;
  const bad = (why: string): never => {
    throw new CriteriaError(`${field.name}: ${why} (${field.type}), got ${JSON.stringify(value)}`);
  };
  const t = field.type;
  switch (t) {
    case "Edm.String":
      if (typeof value !== "string") bad("expected a string");
      return;
    case "Edm.Boolean":
      if (typeof value !== "boolean") bad("expected a boolean");
      return;
    case "Edm.Byte":
    case "Edm.SByte":
    case "Edm.Int16":
    case "Edm.Int32": {
      const [lo, hi] = INT_RANGES[t]!;
      if (typeof value !== "number" || !Number.isInteger(value) || value < lo || value > hi) {
        bad("expected an integer in range");
      }
      return;
    }
    case "Edm.Single":
    case "Edm.Double":
      if (typeof value !== "number") bad("expected a number");
      return;
    case "Edm.Int64":
      if (typeof value !== "string" || !RE_INT64.test(value)) bad("expected an integer string");
      return;
    case "Edm.Decimal":
      if (typeof value !== "string" || !RE_DECIMAL.test(value)) bad("expected a decimal string");
      return;
    case "Edm.Date":
      if (typeof value !== "string" || !RE_DATE.test(value)) bad("expected YYYY-MM-DD");
      return;
    case "Edm.TimeOfDay":
      if (typeof value !== "string" || !RE_TIME.test(value)) bad("expected hh:mm[:ss[.f]]");
      return;
    case "Edm.DateTimeOffset":
      if (typeof value !== "string" || !RE_DTO.test(value)) bad("expected an RFC 3339 timestamp with offset");
      return;
    case "Edm.Guid":
      if (typeof value !== "string" || !RE_GUID.test(value)) bad("expected a GUID");
      return;
    case "Edm.Duration":
      if (typeof value !== "string" || !RE_DURATION.test(value) || value === "P" || value === "-P") {
        bad("expected an ISO 8601 day-time duration");
      }
      return;
    case "Edm.Binary":
      throw new CriteriaError(`${field.name}: Edm.Binary values are not supported in criteria`);
  }
}

// ---- exact decimals ----

/** `m * 10^-e`, `e >= 0`. */
interface Dec {
  readonly m: bigint;
  readonly e: number;
}

const RE_NUM = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function parseDec(v: string | number, field: Field): Dec {
  const s = typeof v === "number" ? String(v) : v;
  const m = RE_NUM.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new CriteriaError(`${field.name}: not a number: ${JSON.stringify(v)}`);
  }
  const frac = m[3] ?? "";
  let mant = BigInt(`${m[2] || "0"}${frac}`);
  if (m[1] === "-") mant = -mant;
  const exp = Number(m[4] ?? 0) - frac.length;
  return exp <= 0 ? { m: mant, e: -exp } : { m: mant * 10n ** BigInt(exp), e: 0 };
}

function cmpDec(a: Dec, b: Dec): number {
  const e = Math.max(a.e, b.e);
  const x = a.m * 10n ** BigInt(e - a.e);
  const y = b.m * 10n ** BigInt(e - b.e);
  return x < y ? -1 : x > y ? 1 : 0;
}

function cmpNum(a: number, b: number): number | undefined {
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return a < b ? -1 : a > b ? 1 : 0;
}

function toNumber(v: Value, field: Field): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && RE_NUM.test(v)) return Number(v);
  throw new CriteriaError(`${field.name}: expected a number, got ${JSON.stringify(v)}`);
}

// ---- temporal parsing, memoised: sorting parses each value many times ----

const memo = new Map<string, unknown>();

function cached<T>(kind: string, s: string, parse: () => T): T {
  const k = `${kind}\0${s}`;
  const hit = memo.get(k);
  if (hit !== undefined) return hit as T;
  const v = parse();
  if (memo.size >= 20000) memo.clear();
  memo.set(k, v);
  return v;
}

function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function nanos(frac: string | undefined): number {
  return frac === undefined ? 0 : Number(frac.padEnd(12, "0").slice(0, 9));
}

function bad(field: Field, v: Value): never {
  throw new CriteriaError(`${field.name}: invalid ${field.type} value ${JSON.stringify(v)}`);
}

/** `[days since epoch]` for a Date. */
function dateKey(v: Value, field: Field): number {
  if (typeof v !== "string") return bad(field, v);
  return cached("d", v, () => {
    const m = RE_DATE.exec(v);
    if (!m) return bad(field, v);
    return daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
  });
}

function timeKey(v: Value, field: Field): number {
  if (typeof v !== "string") return bad(field, v);
  return cached("t", v, () => {
    const m = RE_TIME.exec(v);
    if (!m) return bad(field, v);
    // A leap second (:60) sorts after :59 and its fraction, as in the engine.
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) * 1e9 + nanos(m[4]);
  });
}

/** `[UTC seconds, nanoseconds]`: orders by instant, ignoring the offset. */
function instantKey(v: Value, field: Field): readonly [number, number] {
  if (typeof v !== "string") return bad(field, v);
  return cached("i", v, () => {
    const m = RE_DTO.exec(v);
    if (!m) return bad(field, v);
    const offset = m[8] === undefined ? 0 : (m[8] === "-" ? -1 : 1) * (Number(m[9]) * 3600 + Number(m[10]) * 60);
    const secs =
      daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) * 86400 +
      Number(m[4]) * 3600 +
      Number(m[5]) * 60 +
      Number(m[6] ?? 0) -
      offset;
    return [secs, nanos(m[7])] as const;
  });
}

function durationKey(v: Value, field: Field): bigint {
  if (typeof v !== "string") return bad(field, v);
  return cached("u", v, () => {
    const m = RE_DURATION.exec(v);
    if (!m || v === "P" || v === "-P") return bad(field, v);
    let ns =
      BigInt(m[2] ?? 0) * 86_400_000_000_000n +
      BigInt(m[3] ?? 0) * 3_600_000_000_000n +
      BigInt(m[4] ?? 0) * 60_000_000_000n +
      BigInt(m[5] ?? 0) * 1_000_000_000n +
      BigInt(nanos(m[6]));
    if (m[1] === "-") ns = -ns;
    return ns;
  });
}

/** Unicode code point order: what the engine's byte-wise UTF-8 comparison gives. */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // UTF-16 order differs from code point order only when a surrogate meets a
    // BMP unit at or above U+E000: surrogates stand for code points >= U+10000.
    const xs = x >= 0xd800 && x <= 0xdfff;
    const ys = y >= 0xd800 && y <= 0xdfff;
    if (xs !== ys) return xs ? 1 : -1;
    return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function sign(x: number | bigint): number {
  return x < 0 ? -1 : x > 0 ? 1 : 0;
}

/**
 * Orders two non-null values of `field`'s type; `undefined` when unordered
 * (a NaN is involved).
 */
export function ordering(a: Value, b: Value, field: Field): number | undefined {
  switch (field.type) {
    case "Edm.String":
      if (typeof a !== "string" || typeof b !== "string") return bad(field, typeof a !== "string" ? a : b);
      return compareCodePoints(a, b);
    case "Edm.Boolean":
      if (typeof a !== "boolean" || typeof b !== "boolean") return bad(field, typeof a !== "boolean" ? a : b);
      return a === b ? 0 : a ? 1 : -1;
    case "Edm.Byte":
    case "Edm.SByte":
    case "Edm.Int16":
    case "Edm.Int32":
    case "Edm.Single":
    case "Edm.Double":
      return cmpNum(toNumber(a, field), toNumber(b, field));
    case "Edm.Int64":
    case "Edm.Decimal": {
      // A non-integer JS number is a double, which makes the comparison floating point.
      const fa = typeof a === "number" && !Number.isInteger(a);
      const fb = typeof b === "number" && !Number.isInteger(b);
      if (fa || fb) return cmpNum(toNumber(a, field), toNumber(b, field));
      return cmpDec(parseDec(a as string | number, field), parseDec(b as string | number, field));
    }
    case "Edm.Date":
      return sign(dateKey(a, field) - dateKey(b, field));
    case "Edm.TimeOfDay":
      return sign(timeKey(a, field) - timeKey(b, field));
    case "Edm.DateTimeOffset": {
      const [s1, n1] = instantKey(a, field);
      const [s2, n2] = instantKey(b, field);
      return s1 !== s2 ? sign(s1 - s2) : sign(n1 - n2);
    }
    case "Edm.Duration":
      return sign(durationKey(a, field) - durationKey(b, field));
    case "Edm.Guid":
      if (typeof a !== "string" || typeof b !== "string") return bad(field, typeof a !== "string" ? a : b);
      return compareCodePoints(a.toLowerCase(), b.toLowerCase());
    case "Edm.Binary":
      throw new CriteriaError(`${field.name}: Edm.Binary values are not supported in criteria`);
  }
}

/** Whether a number value is NaN (sorts after everything, equal to itself). */
export function isNaNValue(v: Value): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

/** A comparison's value, which must be plain by now: relative dates are resolved before compiling or evaluating. */
export function plain(v: Value | RelativeDate): Value {
  if (typeof v === "object" && v !== null) throw new CriteriaError("a relative date reached a query unresolved; resolve it at fetch time (resolveRelative)");
  return v;
}
