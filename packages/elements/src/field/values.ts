import type { Field, Value } from "@getaster/data";

const INTEGER = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32"]);

/**
 * What the user typed, as the field's value. Text that doesn't parse stays
 * text, so validation reports it in words and nothing typed is lost. Empty
 * is null, except on a non-nullable text field.
 */
export function parseInput(field: Field | undefined, text: string): Value {
  if (!field) return text;
  const t = text.trim();
  if (field.type === "Edm.String") return text === "" && field.nullable ? null : text;
  if (t === "") return null;
  if (INTEGER.has(field.type)) return /^-?\d+$/.test(t) ? Number(t) : text;
  if (field.type === "Edm.Single" || field.type === "Edm.Double") {
    const n = Number(t);
    return Number.isFinite(n) ? n : text;
  }
  if (field.type === "Edm.Decimal" || field.type === "Edm.Int64") return t.replaceAll(",", "");
  return t;
}

/** A value as the text a control shows; a Decimal shows its scale's places ("7.50"). */
export function formatValue(field: Field | undefined, value: Value | undefined): string {
  if (value === null || value === undefined) return "";
  const allowed = field?.allowedValues?.find((a) => a.value === value);
  if (allowed?.label) return allowed.label;
  if (field?.type === "Edm.Decimal" && field.scale !== undefined) return padScale(String(value), field.scale);
  return String(value);
}

/** Exact decimal text with at least `scale` places; other text is left as it is. */
function padScale(text: string, scale: number): string {
  const m = /^(-?\d+)(?:\.(\d*))?$/.exec(text);
  if (!m || scale === 0) return text;
  const places = m[2] ?? "";
  return places.length >= scale ? text : `${m[1]}.${places.padEnd(scale, "0")}`;
}

/** The input type and mode that suit a field. */
export function inputKind(field: Field | undefined): { type: string; inputmode?: string } {
  switch (field?.type) {
    case "Edm.Byte":
    case "Edm.SByte":
    case "Edm.Int16":
    case "Edm.Int32":
    case "Edm.Int64":
      return { type: "text", inputmode: "numeric" };
    case "Edm.Decimal":
    case "Edm.Single":
    case "Edm.Double":
      return { type: "text", inputmode: "decimal" };
    default:
      return { type: "text" };
  }
}
