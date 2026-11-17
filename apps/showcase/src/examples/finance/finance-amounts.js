// Exact money arithmetic over the service's Decimal text. Amounts are whole pence (BigInt) so sums,
// products and tax never pass through floating point; the library formats them.
import { formatFigure } from "@getaster/elements";

const TEN = 10n;

/** "1234.5" -> { m: 123450n, s: 2 }; the scale is the number of fraction digits written. */
export function parse(text) {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(String(text ?? "").trim());
  if (!match || (match[2] === "" && !match[3])) return { m: 0n, s: 0 };
  const fraction = match[3] ?? "";
  const m = BigInt(`${match[2] || "0"}${fraction}`);
  return { m: match[1] ? -m : m, s: fraction.length };
}

/** `value` at `scale` places, halves away from zero. */
function at({ m, s }, scale) {
  if (s <= scale) return m * TEN ** BigInt(scale - s);
  const div = TEN ** BigInt(s - scale);
  const q = m / div;
  const twice = (m % div) * 2n;
  const away = twice >= div || -twice >= div;
  return away ? q + (m < 0n ? -1n : 1n) : q;
}

/** Whole pence of a Decimal text. */
export const pence = text => at(parse(text), 2);

/** quantity × rate, in pence, as the service's Product computes it. */
export function lineAmount(quantity, rate) {
  const q = parse(quantity);
  const r = parse(rate);
  return at({ m: q.m * r.m, s: q.s + r.s }, 2);
}

/** `percent` per cent of `amount` pence, in pence. */
export function percentOf(amount, percent) {
  const p = parse(percent);
  return at({ m: amount * p.m, s: p.s + 2 }, 0);
}

/** Pence as the Decimal text the service stores: "1850.50". */
export function decimalText(amount) {
  const sign = amount < 0n ? "-" : "";
  const digits = (amount < 0n ? -amount : amount).toString().padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** How a column of amounts reads; the field's scale gives its places. */
export const GBP = { style: "currency", currency: "GBP" };
const PENCE = { ...GBP, minimumFractionDigits: 2, maximumFractionDigits: 2 };

/** Pence as display text, "£1,850.50", for an amount that has no field. */
export const pounds = amount => formatFigure(decimalText(amount), PENCE);
