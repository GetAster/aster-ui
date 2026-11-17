import type { FieldSelectionFilter, FieldSelectionOption, FieldSelectionPolicy, FieldSelectionSource } from "./types.ts";
import type { Schema } from "@getaster/data";

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function validateFieldSelectionSource(value: unknown): FieldSelectionSource {
  if (!plain(value)) throw new TypeError("source must be a plain object");
  if ("fields" in value) {
    if (Object.keys(value).some((key) => key !== "fields")) throw new TypeError("A fields source accepts only fields");
    return Object.freeze({ fields: validateFieldSelectionFields(value.fields) });
  }
  if (Object.keys(value).some((key) => key !== "schema" && key !== "entitySet")) throw new TypeError("Unknown schema source key");
  const schema = value.schema as Schema | undefined;
  if (!schema || typeof schema.set !== "function" || !(schema.sets instanceof Map)) throw new TypeError("source.schema must be an Aster Schema reference");
  if (typeof value.entitySet !== "string" || !value.entitySet) throw new TypeError("source.entitySet must name an entity set");
  schema.set(value.entitySet);
  return Object.freeze({ schema, entitySet: value.entitySet });
}

export function validateFieldSelectionValue(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError("value must be an array of field paths");
  const seen = new Set<string>();
  for (const path of value) {
    if (typeof path !== "string" || path.split("/").some((part) => !part || part.trim() !== part)) throw new TypeError("value must contain nonempty slash-separated field paths");
    if (seen.has(path)) throw new TypeError(`Duplicate field path: ${path}`);
    seen.add(path);
  }
  return Object.freeze([...value]);
}

export function validateFieldSelectionFilter(value: unknown): FieldSelectionFilter {
  if (value !== "all" && value !== "direct" && value !== "related") throw new TypeError('filter must be "all", "direct" or "related"');
  return value;
}

export function validateFieldSelectionDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError("maxDepth must be a positive integer");
  return value;
}

export function validateFieldSelectionFields(value: unknown): readonly FieldSelectionOption[] {
  if (!Array.isArray(value)) throw new TypeError("fields must be an array");
  const fields = value.map((field) => {
    if (!plain(field) || typeof field.path !== "string") throw new TypeError("Each field must have a path");
    for (const key of Object.keys(field)) if (!["path", "label"].includes(key)) throw new TypeError(`Unknown field key '${key}'`);
    if (field.label !== undefined && typeof field.label !== "string") throw new TypeError("Field label must be a string");
    return Object.freeze({ path: field.path, ...(field.label !== undefined ? { label: field.label } : {}) });
  });
  validateFieldSelectionValue(fields.map((field) => field.path));
  return Object.freeze(fields);
}

export function validateFieldSelectionPolicy(value: unknown): Readonly<Record<string, FieldSelectionPolicy>> {
  if (!plain(value)) throw new TypeError("policy must be a plain object");
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([path, policy]) => {
    validateFieldSelectionValue([path]);
    if (!plain(policy)) throw new TypeError(`Policy for ${path} must be a plain object`);
    for (const [key, reason] of Object.entries(policy)) {
      if (!["select", "hide", "move"].includes(key)) throw new TypeError(`Unknown field policy key '${key}'`);
      if (typeof reason !== "string" || !reason.trim()) throw new TypeError(`Policy ${key} must give a nonempty reason`);
    }
    return [path, Object.freeze({ ...policy })];
  })));
}

export function validateFieldSelectionChrome(value: unknown): Readonly<{ selected?: boolean }> {
  if (!plain(value) || Object.entries(value).some(([key, flag]) => key !== "selected" || typeof flag !== "boolean")) throw new TypeError("chrome accepts only a selected boolean");
  return Object.freeze({ ...value });
}
