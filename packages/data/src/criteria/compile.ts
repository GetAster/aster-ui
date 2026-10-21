import type { EntitySet, EntityType, Field, Schema, Value } from "../schema/model.ts";
import type { Criteria, Query, SortKey } from "./ast.ts";
import { assertLiteral, CriteriaError, plain } from "./values.ts";

export { CriteriaError };

/** The OData URL literal for `value` as a `field`-typed value. */
export function formatLiteral(value: Value, field: Field): string {
  if (value === null) return "null";
  assertLiteral(value, field);
  switch (field.type) {
    case "Edm.String":
      return `'${(value as string).replaceAll("'", "''")}'`;
    case "Edm.Single":
    case "Edm.Double": {
      const n = value as number;
      if (Number.isNaN(n)) return "NaN";
      if (n === Infinity) return "INF";
      if (n === -Infinity) return "-INF";
      return Object.is(n, -0) ? "0" : String(n);
    }
    case "Edm.Duration":
      return `duration'${value as string}'`;
    default:
      return String(value);
  }
}

function fieldOf(type: EntityType, name: string, set?: EntitySet): Field {
  const f = type.field(name);
  if (!f) throw new CriteriaError(`unknown field '${name}' on ${type.name}`);
  if (set?.nonFilterable.has(name)) throw new CriteriaError(`field '${name}' is not filterable`);
  return f;
}

/** The right-hand property of a property comparison: it must have `left`'s type. */
export function otherOf(type: EntityType, name: string, left: Field, set?: EntitySet): Field {
  const f = fieldOf(type, name, set);
  if (f.type !== left.type) throw new CriteriaError(`can't compare ${left.name} (${left.type}) with ${f.name} (${f.type})`);
  return f;
}

/** Where a node renders: inside `depth` lambdas, its properties prefixed with the innermost variable. */
interface At {
  readonly schema: Schema | undefined;
  readonly prefix: string;
  readonly depth: number;
}

const TOP: At = { schema: undefined, prefix: "", depth: 0 };

// `and` binds tighter than `or`; every other node is atomic or self-delimiting.
function render(c: Criteria, type: EntityType, set: EntitySet | undefined, nested: boolean, at: At = TOP): string {
  const p = at.prefix;
  switch (c.op) {
    case "and":
    case "or": {
      if (c.args.length === 0) return c.op === "and" ? "true" : "false";
      if (c.args.length === 1) return render(c.args[0]!, type, set, nested, at);
      const text = c.args.map((a) => render(a, type, set, true, at)).join(` ${c.op} `);
      return nested ? `(${text})` : text;
    }
    case "not":
      return `not (${render(c.arg, type, set, false, at)})`;
    case "any":
    case "all": {
      const nav = type.navigation(c.field);
      if (!nav) throw new CriteriaError(`unknown navigation '${c.field}' on ${type.name}`);
      if (!nav.collection) throw new CriteriaError(`'${c.field}' on ${type.name} isn't a collection; ${c.op} needs one`);
      if (!at.schema) throw new CriteriaError(`${c.op} over '${c.field}' needs the schema to follow it`);
      const target = at.schema.set(nav.target);
      const v = `x${at.depth}`;
      return `${p}${nav.name}/${c.op}(${v}:${render(c.where, target.type, target, false, { schema: at.schema, prefix: `${v}/`, depth: at.depth + 1 })})`;
    }
    case "via": {
      const nav = type.navigation(c.field);
      if (!nav) throw new CriteriaError(`unknown navigation '${c.field}' on ${type.name}`);
      if (nav.collection) throw new CriteriaError(`'${c.field}' on ${type.name} is a collection; via follows a single record, any and all a collection`);
      if (!at.schema) throw new CriteriaError(`via '${c.field}' needs the schema to follow it`);
      const target = at.schema.set(nav.target);
      return render(c.where, target.type, target, nested, { ...at, prefix: `${p}${nav.name}/` });
    }
    case "eq":
    case "ne":
    case "gt":
    case "ge":
    case "lt":
    case "le": {
      const f = fieldOf(type, c.field, set);
      if ("other" in c) return `${p}${f.name} ${c.op} ${p}${otherOf(type, c.other, f, set).name}`;
      const value = plain(c.value);
      if (c.op === "eq" || c.op === "ne") return `${p}${f.name} ${c.op} ${formatLiteral(value, f)}`;
      if (value === null) throw new CriteriaError(`${c.op} ${f.name}: null is not orderable`);
      return `${p}${f.name} ${c.op} ${formatLiteral(value, f)}`;
    }
    case "in": {
      const f = fieldOf(type, c.field, set);
      if (c.values.length === 0) return "false";
      return `${p}${f.name} in (${c.values.map((v) => formatLiteral(v, f)).join(",")})`;
    }
    case "contains":
    case "startswith":
    case "endswith": {
      const f = fieldOf(type, c.field, set);
      if (f.type !== "Edm.String") throw new CriteriaError(`${c.op} needs a string field, ${f.name} is ${f.type}`);
      if (typeof c.value !== "string") throw new CriteriaError(`${c.op} ${f.name}: expected a string`);
      return c.caseInsensitive
        ? `${c.op}(tolower(${p}${f.name}),${formatLiteral(c.value.toLowerCase(), f)})`
        : `${c.op}(${p}${f.name},${formatLiteral(c.value, f)})`;
    }
  }
}

/** The `$filter` text (not percent-encoded). Throws `CriteriaError`. `any` and `all` need the schema. */
export function toFilter(criteria: Criteria, type: EntityType, set?: EntitySet, schema?: Schema): string {
  return render(criteria, type, set, false, { ...TOP, schema });
}

/** `sort` with the key properties appended ascending, skipping keys already sorted on. */
export function withKeyTieBreakers(sort: readonly SortKey[], type: EntityType): readonly SortKey[] {
  const seen = new Set(sort.map((k) => k.field));
  return [...sort, ...type.key.filter((k) => !seen.has(k)).map((field) => ({ field }))];
}

/**
 * A sort key's field. A key can be a path through single-valued
 * navigations (`person/name`), which needs the schema to follow.
 */
export function checkSortable(key: SortKey, type: EntityType, set?: EntitySet, schema?: Schema): Field {
  if (isPath(key.field)) {
    const nav = key.field.split("/")[0]!;
    if (set?.nonSortable.has(nav)) throw new CriteriaError(`'${key.field}' is not sortable: ${nav} is not`);
    return resolvePath(key.field, type, schema);
  }
  const f = type.field(key.field);
  if (!f) throw new CriteriaError(`unknown field '${key.field}' on ${type.name}`);
  if (f.type === "Edm.Binary") throw new CriteriaError(`field '${key.field}' cannot be sorted`);
  if (set?.nonSortable.has(key.field)) throw new CriteriaError(`field '${key.field}' is not sortable`);
  return f;
}

/** The `$orderby` text, key tie-breakers included. */
export function toOrderBy(sort: readonly SortKey[], type: EntityType, schema?: Schema): string {
  return withKeyTieBreakers(sort, type)
    .map((k) => (checkSortable(k, type, undefined, schema), `${k.field}${k.descending ? " desc" : ""}`))
    .join(",");
}

export function isPath(field: string): boolean {
  return field.includes("/");
}

/** The field at the end of `nav/.../field`, through single-valued navigations only. */
export function resolvePath(path: string, type: EntityType, schema: Schema | undefined): Field {
  if (!schema) throw new CriteriaError(`'${path}' is a path; following it needs the schema`);
  const steps = path.split("/");
  let at = type;
  for (const step of steps.slice(0, -1)) {
    const nav = at.navigation(step);
    if (!nav) throw new CriteriaError(`unknown navigation '${step}' on ${at.name}`);
    if (nav.collection) throw new CriteriaError(`'${step}' on ${at.name} is a collection; a path can only follow single records`);
    at = schema.set(nav.target).type;
  }
  const name = steps.at(-1)!;
  const f = at.field(name);
  if (!f) throw new CriteriaError(`unknown field '${name}' on ${at.name}`);
  if (f.type === "Edm.Binary") throw new CriteriaError(`field '${path}' cannot be sorted`);
  return f;
}

/** `$filter`, `$orderby` and `$select` as `a=b&c=d` with encoded values, no leading `?`. */
export function toQueryString(query: Query, schema: Schema): string {
  const set = schema.set(query.set);
  const type = set.type;
  const parts: string[] = [];
  if (query.filter) parts.push(`$filter=${encodeURIComponent(toFilter(query.filter, type, set, schema))}`);
  const orderBy = query.orderBy ?? [];
  for (const k of orderBy) checkSortable(k, type, set, schema);
  parts.push(`$orderby=${encodeURIComponent(toOrderBy(orderBy, type, schema))}`);
  if (query.select && query.select.length > 0) {
    for (const s of query.select) {
      if (!type.field(s)) throw new CriteriaError(`unknown field '${s}' on ${type.name}`);
    }
    parts.push(`$select=${encodeURIComponent(query.select.join(","))}`);
  }
  return parts.join("&");
}

/** One aggregate over a property (OData Data Aggregation `with`). */
export interface Aggregate {
  readonly field: string;
  readonly method: "sum" | "min" | "max" | "average" | "countdistinct";
  readonly as: string;
}

/**
 * `$apply` text: the filter, then grouping by `groupBy` (or none) with the
 * row count as `count` and each aggregate under its alias.
 */
export function toApply(
  type: EntityType,
  filter: Criteria | undefined,
  groupBy: readonly string[],
  aggregates: readonly Aggregate[],
  set?: EntitySet,
  schema?: Schema,
): string {
  for (const g of groupBy) fieldOf(type, g, set);
  const aliases = new Set(["count", ...groupBy]);
  for (const a of aggregates) {
    const field = fieldOf(type, a.field, set);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a.as) || aliases.has(a.as)) throw new CriteriaError(`Invalid or duplicate aggregate alias ${a.as}`);
    aliases.add(a.as);
    switch (a.method) {
      case "sum":
      case "average":
        if (!["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Single", "Edm.Double", "Edm.Decimal"].includes(field.type)) throw new CriteriaError(`${a.method} requires a numeric field`);
        break;
      case "min":
      case "max":
      case "countdistinct":
        break;
      default:
        throw new CriteriaError(`Unknown aggregate method ${String(a.method)}`);
    }
  }
  const values = ["$count as count", ...aggregates.map((a) => `${a.field} with ${a.method} as ${a.as}`)].join(",");
  const step = groupBy.length ? `groupby((${groupBy.join(",")}),aggregate(${values}))` : `aggregate(${values})`;
  return filter ? `filter(${render(filter, type, set, false, { ...TOP, schema })})/${step}` : step;
}

/** Queries built afresh are equal when they say the same thing. */
export function sameQuery(a: Query, b: Query): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
