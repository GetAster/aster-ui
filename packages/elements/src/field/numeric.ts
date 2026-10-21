/** Exact canonical decimal arithmetic for numeric editors. */
interface Decimal { coefficient: bigint; scale: number }
const LIMIT = 1000;

function decimal(value: string | number): Decimal {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!match || !(match[2] || match[3])) throw new TypeError("Enter a number");
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > LIMIT || String(value).length > LIMIT) throw new TypeError("Number is too large");
  let scale = (match[3]?.length ?? 0) - exponent;
  let coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2] || "0"}${match[3] ?? ""}`);
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  return { coefficient, scale };
}
function coefficient(d: Decimal, scale: number): bigint { return d.coefficient * 10n ** BigInt(scale - d.scale); }
function text(value: bigint, scale: number): string {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  return scale ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : `${sign}${digits}`;
}
export function compareNumeric(a: string | number, b: string | number): number {
  const x = decimal(a), y = decimal(b), scale = Math.max(x.scale, y.scale);
  const delta = coefficient(x, scale) - coefficient(y, scale);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
export function canonicalNumeric(value: string | number): string { const d = decimal(value); return text(d.coefficient, d.scale); }
export function numericAligned(value: string | number, step: string | number, base: string | number = 0): boolean {
  const v = decimal(value), s = decimal(step), b = decimal(base), scale = Math.max(v.scale, s.scale, b.scale);
  const stride = coefficient(s, scale);
  if (stride <= 0n) throw new TypeError("Step must be positive");
  return (coefficient(v, scale) - coefficient(b, scale)) % stride === 0n;
}
function floor(a: bigint, b: bigint): bigint { const q = a / b; return a < 0n && a % b !== 0n ? q - 1n : q; }

export function stepNumeric(value: string | number | null, direction: 1 | -1, step: string | number, min?: string | number, max?: string | number): string | undefined {
  const v = decimal(value ?? 0), s = decimal(step), b = decimal(min ?? 0);
  const lower = min === undefined ? undefined : decimal(min), upper = max === undefined ? undefined : decimal(max);
  const scale = Math.max(v.scale, s.scale, b.scale, lower?.scale ?? 0, upper?.scale ?? 0);
  const stride = coefficient(s, scale), base = coefficient(b, scale), entered = coefficient(v, scale);
  if (stride <= 0n) throw new TypeError("Step must be positive");
  const offset = entered - base, q = floor(offset, stride), aligned = offset % stride === 0n;
  let next = base + (direction === 1 ? q + 1n : aligned ? q - 1n : q) * stride;
  if (value === null) next = base + (direction === 1 && !aligned ? q + 1n : q) * stride;
  if (lower && next < coefficient(lower, scale)) next = base;
  if (upper && next > coefficient(upper, scale)) next = base + floor(coefficient(upper, scale) - base, stride) * stride;
  if (lower && next < coefficient(lower, scale) || upper && next > coefficient(upper, scale)) return undefined;
  if (value !== null && (direction === 1 && next <= entered || direction === -1 && next >= entered)) return undefined;
  return text(next, scale);
}
