import type { EntityType, Field, Schema } from "../schema/model.ts";
import type { Criteria, RelativeDate } from "./ast.ts";
import { CriteriaError } from "./values.ts";

const DAY = 86_400_000;

export function isRelative(v: unknown): v is RelativeDate {
  return typeof v === "object" && v !== null && "relative" in v;
}

export function hasRelative(c: Criteria | undefined): boolean {
  if (!c) return false;
  switch (c.op) {
    case "and":
    case "or":
      return c.args.some(hasRelative);
    case "not":
      return hasRelative(c.arg);
    case "any":
    case "all":
    case "via":
      return hasRelative(c.where);
    default:
      return "value" in c && isRelative(c.value);
  }
}

/**
 * The type a navigation leads to, for criteria inside `any`, `all` and `via`:
 * from `from` when given (a nested lambda), otherwise from `type`.
 */
export function relatedOf(schema: Schema, type: EntityType): (navigation: string, from?: EntityType) => EntityType | undefined {
  return (navigation, from = type) => {
    const nav = from.navigation(navigation);
    return nav ? schema.set(nav.target).type : undefined;
  };
}

/** `criteria` with each relative date replaced by its value at `now`, typed by its field (UTC). */
export function resolveRelative(
  criteria: Criteria,
  type: EntityType,
  now: number,
  related?: (navigation: string, from: EntityType) => EntityType | undefined,
): Criteria {
  if (!hasRelative(criteria)) return criteria;
  switch (criteria.op) {
    case "and":
    case "or":
      return { ...criteria, args: criteria.args.map((a) => resolveRelative(a, type, now, related)) };
    case "not":
      return { ...criteria, arg: resolveRelative(criteria.arg, type, now, related) };
    case "any":
    case "all":
    case "via": {
      const target = related?.(criteria.field, type);
      if (!target) throw new CriteriaError(`a relative date inside ${criteria.op} over '${criteria.field}' needs the related type`);
      return { ...criteria, where: resolveRelative(criteria.where, target, now, related) };
    }
    default: {
      if (!("value" in criteria) || !isRelative(criteria.value)) return criteria;
      const field = type.field(criteria.field);
      if (!field) throw new CriteriaError(`unknown field '${criteria.field}' on ${type.name}`);
      return { ...criteria, value: relativeValue(criteria.value, field, now) } as Criteria;
    }
  }
}

/** A relative date as a literal for `field`: a date for `Edm.Date`, an instant for `Edm.DateTimeOffset`. */
export function relativeValue(r: RelativeDate, field: Field, now: number): string {
  let d = new Date(r.relative === "today" ? Math.floor(now / DAY) * DAY : now);
  if (r.startOf === "week") d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  if (r.startOf === "month") d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (r.months) {
    // The same day of the target month, or its last day when it's shorter (31 Jan + 1 month is 28 or 29 Feb).
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + r.months + 1, 0)).getUTCDate();
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + r.months, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  }
  d = new Date(d.getTime() + ((r.days ?? 0) + 7 * (r.weeks ?? 0)) * DAY);
  switch (field.type) {
    case "Edm.Date":
      return d.toISOString().slice(0, 10);
    case "Edm.DateTimeOffset":
      return d.toISOString().replace(".000Z", "Z");
    default:
      throw new CriteriaError(`${field.name}: a relative date needs a date field, not ${field.type}`);
  }
}
