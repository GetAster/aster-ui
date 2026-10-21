import type { Criteria, Field, Value } from "@getaster/data";
import { parseDate, today } from "../date/dates.ts";

/**
 * A filter typed into a number or date column: `5`, `>5`, `>=5`, `<5`,
 * `<=5`, or a range `1..3`. Returns undefined for empty text, and an error
 * message for text that isn't one of these.
 */
export function parseRange(field: Field, text: string): { criteria?: Criteria; error?: string } {
  const t = text.trim();
  if (t === "") return {};
  const literal = (s: string): Value | undefined => {
    const v = s.trim();
    if (field.type === "Edm.Date") return parseDate(v, Number(today().slice(0, 4)));
    if (!/^-?\d+(\.\d+)?$/.test(v)) return undefined;
    return field.type === "Edm.Decimal" || field.type === "Edm.Int64" ? v : Number(v);
  };
  const hint = field.type === "Edm.Date" ? "a date like 1 Oct 2026" : "a number";
  const range = /^(.+?)\.\.(.+)$/.exec(t);
  if (range) {
    const from = literal(range[1]!);
    const to = literal(range[2]!);
    if (from === undefined || to === undefined) return { error: `Use ${hint} on both sides of ..` };
    return {
      criteria: {
        op: "and",
        args: [
          { op: "ge", field: field.name, value: from },
          { op: "le", field: field.name, value: to },
        ],
      },
    };
  }
  const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(t)!;
  const value = literal(m[2]!);
  if (value === undefined) return { error: `Use ${hint}, optionally after >, >=, < or <=, or a range a..b` };
  const op = ({ ">=": "ge", "<=": "le", ">": "gt", "<": "lt", "=": "eq" } as const)[m[1] as ">="] ?? "eq";
  return { criteria: { op, field: field.name, value } };
}

/** The text a range filter shows for its criteria, so a restored view shows what was typed. */
export function rangeText(criteria: Criteria | undefined): string {
  if (!criteria) return "";
  if (criteria.op === "and" && criteria.args.length === 2) {
    const [a, b] = criteria.args;
    if (a && b && "value" in a && "value" in b) return `${a.value}..${b.value}`;
  }
  if ("value" in criteria && criteria.op !== "contains") {
    const sign = { eq: "", gt: ">", ge: ">=", lt: "<", le: "<=" }[criteria.op as "eq"] ?? "";
    return `${sign}${criteria.value}`;
  }
  return "";
}

/** Text contains, ignoring case. */
export function containsText(field: string, text: string): Criteria | undefined {
  return text.trim() === "" ? undefined : { op: "contains", field, value: text.trim(), caseInsensitive: true };
}

/** A filter's text with its date replaced by `date`, keeping an operator typed before it. */
export function withDate(text: string, date: string): string {
  const op = /^\s*(>=|<=|>|<|=)/.exec(text)?.[1] ?? "";
  return `${op}${date}`;
}
