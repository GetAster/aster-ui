import type { CompositeProperty } from "./registry.ts";

export type Schema = Readonly<Record<string, unknown>>;
export function asSchema(value: unknown): Schema { return value && typeof value === "object" && !Array.isArray(value) ? value as Schema : {}; }
export function schemaProperty(schema: Schema): CompositeProperty { return { schema, validate: value => matchesSchema(value, schema) }; }
export function matchesSchema(value: unknown, schema: Schema): boolean {
  if (Array.isArray(schema.allOf) && !schema.allOf.every(s => matchesSchema(value, asSchema(s)))) return false;
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(s => matchesSchema(value, asSchema(s)))) return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.asterType === "undefined") return value === undefined;
  if (schema.type) {
    switch (schema.type) {
      case "string": if (typeof value !== "string") return false; break;
      case "boolean": if (typeof value !== "boolean") return false; break;
      case "number": if (typeof value !== "number" || !Number.isFinite(value)) return false; break;
      case "integer": if (typeof value !== "number" || !Number.isSafeInteger(value)) return false; break;
      case "null": if (value !== null) return false; break;
      case "array": if (!Array.isArray(value)) return false; break;
      case "object": if (!value || typeof value !== "object" || Array.isArray(value)) return false; break;
    }
  }
  if (typeof value === "number" && (typeof schema.minimum === "number" && value < schema.minimum || typeof schema.maximum === "number" && value > schema.maximum)) return false;
  if (Array.isArray(value) && schema.items && !value.every(item => matchesSchema(item, asSchema(schema.items)))) return false;
  if (schema.type === "object" && value && typeof value === "object") {
    const values = value as Record<string, unknown>; const fields = asSchema(schema.properties);
    if (Array.isArray(schema.required) && !schema.required.every(key => typeof key === "string" && Object.hasOwn(values, key))) return false;
    for (const [key, item] of Object.entries(values)) {
      if (Object.hasOwn(fields, key) && !matchesSchema(item, asSchema(fields[key]))) return false;
      if (!Object.hasOwn(fields, key) && schema.additionalProperties === false) return false;
    }
  }
  return true;
}

/** Unknown/custom refinements are runtime checks; metadata cannot prove their assignability. */
export function compatibility(source: Schema, target: Schema): boolean | undefined {
  if (Array.isArray(source.anyOf)) {
    const results = source.anyOf.map(item => compatibility(asSchema(item), target));
    return results.includes(false) ? false : results.every(item => item === true) ? true : undefined;
  }
  if (Array.isArray(target.anyOf)) {
    const results = target.anyOf.map(item => compatibility(source, asSchema(item)));
    return results.includes(true) ? true : results.every(item => item === false) ? false : undefined;
  }
  if (target.allOf || source.allOf) return undefined;
  if (target.asterType) {
    if (!source.asterType) return source.type ? false : undefined;
    if (source.asterType !== target.asterType) return Array.isArray(source.asterBases) && source.asterBases.includes(target.asterType);
    if (target.asterType === "signal") return compatibility(asSchema(source.value), asSchema(target.value));
    return true;
  }
  if (target.type) {
    if (source.asterType) return false;
    if (!source.type) return undefined;
    if (source.type !== target.type && !(source.type === "integer" && target.type === "number")) return false;
    if (Array.isArray(target.enum)) {
      if (!Array.isArray(source.enum)) return undefined;
      if (!source.enum.every(value => (target.enum as unknown[]).includes(value))) return false;
    }
    if (Object.hasOwn(target, "const")) return Object.hasOwn(source, "const") ? source.const === target.const : undefined;
    if (target.minimum !== undefined || target.maximum !== undefined) return undefined;
    if (target.type === "array") return compatibility(asSchema(source.items), asSchema(target.items));
    if (target.type === "object") {
      const sourceFields = asSchema(source.properties); const targetFields = asSchema(target.properties);
      if (target.additionalProperties === false && Object.keys(sourceFields).some(key => !Object.hasOwn(targetFields, key))) return false;
      const results = Object.entries(targetFields).map(([key, field]) => {
        if (!Object.hasOwn(sourceFields, key)) return Array.isArray(target.required) && target.required.includes(key) ? false : true;
        if (Array.isArray(target.required) && target.required.includes(key) && !(Array.isArray(source.required) && source.required.includes(key))) return false;
        return compatibility(asSchema(sourceFields[key]), asSchema(field));
      });
      if (results.includes(false)) return false;
      if (target.additionalProperties === false && source.additionalProperties !== false) return undefined;
      return results.every(result => result === true) ? true : undefined;
    }
    return true;
  }
  return undefined;
}

/** JSON cannot express instance identity, signals or undefined as literal values. */
export function literalSchema(schema: Schema): Schema {
  if (schema.asterType) return { not: {} };
  const result: Record<string, unknown> = { ...schema };
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(asSchema(schema.properties)).map(([key, field]) => [key, literalSchema(asSchema(field))]));
  if (schema.items) result.items = literalSchema(asSchema(schema.items));
  for (const key of ["anyOf", "allOf", "oneOf"]) if (Array.isArray(schema[key])) result[key] = schema[key].map(item => literalSchema(asSchema(item)));
  return result;
}
