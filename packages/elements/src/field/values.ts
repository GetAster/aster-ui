import type { Field, Value } from "@getaster/data";
import { plainFigure } from "../format.ts";

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

/** A value as the text a control shows: unformatted, a Decimal showing its scale's places ("7.50"). */
export function formatValue(field: Field | undefined, value: Value | undefined): string {
  if (value === null || value === undefined) return "";
  const allowed = field?.allowedValues?.find((a) => a.value === value);
  if (allowed?.label) return allowed.label;
  if (field?.type === "Edm.Decimal") return plainFigure(field, String(value));
  return String(value);
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
