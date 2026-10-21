import type { Entity, EntityType, Field, Value } from "../schema/model.ts";
import type { Criteria, SortKey } from "./ast.ts";
import { checkSortable, otherOf, withKeyTieBreakers } from "./compile.ts";
import { assertLiteral, CriteriaError, isNaNValue, ordering, plain } from "./values.ts";

/** SQL-style truth: `null` is unknown. Functions over null produce it, and so does any test of an unknown field. */
type Truth = boolean | null;

function fieldOf(type: EntityType, name: string): Field {
  const f = type.field(name);
  if (!f) throw new CriteriaError(`unknown field '${name}' on ${type.name}`);
  return f;
}

function lower(s: string): string {
  // Matches Rust `str::to_lowercase`: full Unicode mapping with final-sigma handling.
  return s.toLowerCase();
}

/** The type of the records a navigation leads to, for `any`, `all` and `via`. */
export type Related = (from: EntityType, navigation: string) => EntityType | undefined;

function evalNode(c: Criteria, e: Entity, type: EntityType, related?: Related, unknownFields?: ReadonlySet<string>): Truth {
  switch (c.op) {
    case "and": {
      let unknown = false;
      for (const a of c.args) {
        const t = evalNode(a, e, type, related, unknownFields);
        if (t === false) return false;
        if (t === null) unknown = true;
      }
      return unknown ? null : true;
    }
    case "or": {
      let unknown = false;
      for (const a of c.args) {
        const t = evalNode(a, e, type, related, unknownFields);
        if (t === true) return true;
        if (t === null) unknown = true;
      }
      return unknown ? null : false;
    }
    case "not": {
      const t = evalNode(c.arg, e, type, related, unknownFields);
      return t === null ? null : !t;
    }
    case "any":
    case "all": {
      if (unknownFields?.has(c.field)) return null;
      const target = related?.(type, c.field);
      if (!target) throw new CriteriaError(`${c.op} over '${c.field}' needs the related records' type`);
      const rows = (e as Record<string, unknown>)[c.field];
      if (!Array.isArray(rows)) throw new CriteriaError(`'${c.field}' isn't loaded as a list of records`);
      // OData lambdas: a row whose test is unknown counts as not matching.
      return c.op === "any"
        ? rows.some((r) => evalNode(c.where, r as Entity, target, related) === true)
        : rows.every((r) => evalNode(c.where, r as Entity, target, related) === true);
    }
    case "via": {
      const target = related?.(type, c.field);
      if (!target) throw new CriteriaError(`via '${c.field}' needs the related record's type`);
      const record = (e as Record<string, unknown>)[c.field];
      if (record === undefined || (record !== null && typeof record !== "object")) throw new CriteriaError(`'${c.field}' isn't loaded as a record`);
      // No related record: its properties are all null, as on the server.
      return evalNode(c.where, (record ?? {}) as Entity, target, related);
    }
    case "eq":
    case "ne":
    case "gt":
    case "ge":
    case "lt":
    case "le": {
      const f = fieldOf(type, c.field);
      if (unknownFields?.has(c.field) || ("other" in c && unknownFields?.has(c.other))) return null;
      let right: Value;
      if ("other" in c) {
        right = e[otherOf(type, c.other, f).name] ?? null;
      } else {
        right = plain(c.value);
        assertLiteral(right, f);
      }
      const v = e[c.field] ?? null;
      if (c.op === "eq" || c.op === "ne") {
        // P2 5.1.1.1.1-2: null equals only null; `ne` is the exact negation.
        const equal = v === null || right === null ? v === right : ordering(v, right, f) === 0;
        return c.op === "eq" ? equal : !equal;
      }
      // P2 5.1.1.1.3: any null operand gives false, not unknown, so `not` of it is true.
      if (v === null || right === null) return false;
      const o = ordering(v, right, f);
      if (o === undefined) return false;
      return c.op === "gt" ? o > 0 : c.op === "ge" ? o >= 0 : c.op === "lt" ? o < 0 : o <= 0;
    }
    case "in": {
      const f = fieldOf(type, c.field);
      if (unknownFields?.has(c.field)) return null;
      const v = e[c.field] ?? null;
      for (const x of c.values) assertLiteral(x, f);
      // `in` is eq-based: a null needle matches a null member, and the result is never unknown.
      if (v === null) return c.values.includes(null);
      return c.values.some((x) => x !== null && ordering(v, x, f) === 0);
    }
    case "contains":
    case "startswith":
    case "endswith": {
      const f = fieldOf(type, c.field);
      if (f.type !== "Edm.String") throw new CriteriaError(`${c.op} needs a string field, ${f.name} is ${f.type}`);
      if (typeof c.value !== "string") throw new CriteriaError(`${c.op} ${f.name}: expected a string`);
      if (unknownFields?.has(c.field)) return null;
      const v = e[c.field] ?? null;
      // Functions of a null argument are null, and `not` of null stays null (row excluded).
      if (v === null) return null;
      if (typeof v !== "string") throw new CriteriaError(`${f.name}: expected a string, got ${JSON.stringify(v)}`);
      const h = c.caseInsensitive ? lower(v) : v;
      const n = c.caseInsensitive ? lower(c.value) : c.value;
      return c.op === "contains" ? h.includes(n) : c.op === "startswith" ? h.startsWith(n) : h.endsWith(n);
    }
  }
}

/**
 * Whether `entity` satisfies `criteria`, with the server's `$filter`
 * semantics (null and unknown both exclude). `any` and `all` read the
 * related records from the entity, as a list, and `via` the related record,
 * typed by `related`. A test of a field in `unknown` (hidden on the record)
 * is unknown, whatever value the entity holds, so `eq null` and `ne` can't
 * decide on it either.
 */
export function matches(criteria: Criteria, entity: Entity, type: EntityType, related?: Related, unknown?: ReadonlySet<string>): boolean {
  return evalNode(criteria, entity, type, related, unknown) === true;
}

/**
 * Ascending total order for sorting: null first, a NaN after every number and
 * equal to other NaNs. Descending sorts reverse all of it.
 */
export function compareValues(a: Value, b: Value, field: Field): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  const o = ordering(a, b, field);
  if (o !== undefined) return o;
  const an = isNaNValue(a);
  const bn = isNaNValue(b);
  return an === bn ? 0 : an ? 1 : -1;
}

/** Orders entities as `$orderby=<sort>` (key tie-breakers appended) does. */
export function sortComparator(
  sort: readonly SortKey[],
  type: EntityType,
): (a: Entity, b: Entity) => number {
  const keys = withKeyTieBreakers(sort, type).map((k) => ({
    name: k.field,
    field: checkSortable(k, type),
    dir: k.descending ? -1 : 1,
  }));
  return (a, b) => {
    for (const k of keys) {
      const c = compareValues(a[k.name] ?? null, b[k.name] ?? null, k.field);
      if (c !== 0) return c * k.dir;
    }
    return 0;
  };
}
