import { compareValues } from "../criteria/evaluate.ts";
import type { EdmType, Entity, EntityType, Field, Value } from "../schema/model.ts";

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

const INTEGER: ReadonlySet<EdmType> = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32"]);
/** Groups: integer digits, fraction digits, exponent. */
const EXACT = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Client-side validation from metadata, with the same rules the server
 * applies. Messages use the field's title and say how to fix the value;
 * `AsterData.RequiredMessage` and `AsterData.ErrorMessage` override them.
 */
export function validateField(field: Field, value: Value | undefined): string[] {
  const title = field.title ?? field.name;
  const custom = field.annotations["AsterData.ErrorMessage"];
  const fail = (message: string) => [typeof custom === "string" ? custom : message];
  if (value === undefined || value === null) {
    if (field.nullable || field.computed) return [];
    const required = field.annotations["AsterData.RequiredMessage"];
    return [typeof required === "string" ? required : `${title} is required.`];
  }
  const typeError = checkType(field, value);
  if (typeError) return fail(`${title} ${typeError}`);
  if (typeof value === "string") {
    const length = [...value].length;
    if (field.maxLength !== undefined && length > field.maxLength) {
      return fail(`${title} can be at most ${field.maxLength} characters; this is ${length}.`);
    }
    if (field.minLength !== undefined && length < field.minLength) {
      return fail(
        field.minLength === 1
          ? `${title} can't be blank.`
          : `${title} needs at least ${field.minLength} characters; this is ${length}.`,
      );
    }
    if (field.pattern !== undefined && !new RegExp(field.pattern, "u").test(value)) {
      return fail(`“${value}” isn't a valid ${title.toLowerCase()}.`);
    }
  }
  if (field.minimum !== undefined) {
    const c = compareValues(value, field.minimum, field);
    if (c < 0 || (c === 0 && field.exclusiveMinimum)) {
      return fail(`${title} must be ${field.exclusiveMinimum ? "more than" : "at least"} ${field.minimum}.`);
    }
  }
  if (field.maximum !== undefined) {
    const c = compareValues(value, field.maximum, field);
    if (c > 0 || (c === 0 && field.exclusiveMaximum)) {
      return fail(`${title} must be ${field.exclusiveMaximum ? "less than" : "at most"} ${field.maximum}.`);
    }
  }
  if (field.allowedValues && !field.allowedValues.some((a) => sameValue(a.value, value, field))) {
    const labels = field.allowedValues.map((a) => a.label ?? String(a.value)).join(", ");
    return fail(`${title} must be one of: ${labels}.`);
  }
  return [];
}

/** Equal by the field's type, so Decimal `"1.0"` matches `"1"`. */
function sameValue(a: Value, b: Value, field: Field): boolean {
  try {
    return compareValues(a, b, field) === 0;
  } catch {
    return false;
  }
}

/**
 * Errors by field. On update only the fields present in `values` are
 * checked, and an immutable field among them is an error.
 */
export function validateEntity(type: EntityType, values: Entity, mode: "create" | "update"): FieldErrors {
  const out: Record<string, string[]> = {};
  for (const field of type.fields) {
    if (field.computed) continue;
    if (mode === "update" && !(field.name in values)) continue;
    if (mode === "update" && field.immutable) {
      out[field.name] = [`${field.title ?? field.name} can't be changed once it's set.`];
      continue;
    }
    const errors = validateField(field, values[field.name]);
    if (errors.length) out[field.name] = errors;
  }
  return out;
}

function checkType(field: Field, value: Value): string | undefined {
  switch (field.type) {
    case "Edm.Boolean":
      return typeof value === "boolean" ? undefined : "must be yes or no.";
    case "Edm.Single":
    case "Edm.Double":
      return typeof value === "number" && Number.isFinite(value) ? undefined : "must be a number.";
    case "Edm.Int64":
    case "Edm.Decimal": {
      const text = typeof value === "number" ? String(value) : value;
      const m = typeof text === "string" ? EXACT.exec(text) : null;
      if (!m) return "must be a number.";
      if (field.type === "Edm.Int64" && (m[2] !== undefined || m[3] !== undefined)) return "must be a whole number.";
      if (field.type === "Edm.Decimal" && field.scale !== undefined) {
        const decimals = (m[2] ?? "").length - Number(m[3] ?? 0);
        if (decimals > field.scale) return `can have at most ${field.scale} decimal places.`;
      }
      return undefined;
    }
    case "Edm.Date":
      return typeof value === "string" && isDate(value) ? undefined : "must be a date, like 7 Oct 2026.";
    default:
      if (INTEGER.has(field.type)) {
        return typeof value === "number" && Number.isInteger(value) ? undefined : "must be a whole number.";
      }
      return typeof value === "string" ? undefined : "has the wrong kind of value.";
  }
}

/** A real calendar date as `YYYY-MM-DD`. */
function isDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
