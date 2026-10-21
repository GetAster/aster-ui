import { computed, type ReadonlySignal } from "@preact/signals-core";
import type { Criteria } from "../criteria/ast.ts";
import { matches } from "../criteria/evaluate.ts";
import type { Entity, Field, Value } from "../schema/model.ts";
import type { Collection } from "./collection.ts";

/**
 * A value computed over every record of a collection. It is `undefined`
 * until the collection is fully loaded, so a figure never shows a partial
 * answer as if it were the whole one.
 */
export function aggregate<T>(collection: Collection, reduce: (items: readonly Entity[]) => T): ReadonlySignal<T | undefined> {
  return computed(() => {
    if (!collection.complete.value) return undefined;
    return reduce(collection.items.value as readonly Entity[]);
  });
}

/** Records matching `criteria`, evaluated locally with OData semantics. */
export function countWhere(collection: Collection, criteria: Criteria): ReadonlySignal<number | undefined> {
  const type = collection.type;
  return aggregate(collection, (items) => items.filter((e) => matches(criteria, e, type)).length);
}

/** Records per value of `field`; null values are counted under `null`. */
export function countBy(collection: Collection, field: string): ReadonlySignal<ReadonlyMap<Value, number> | undefined> {
  requireField(collection, field);
  return aggregate(collection, (items) => {
    const out = new Map<Value, number>();
    for (const e of items) {
      const v = e[field] ?? null;
      out.set(v, (out.get(v) ?? 0) + 1);
    }
    return out;
  });
}

/**
 * The sum of a numeric field, ignoring nulls. Decimal and Int64 sums are
 * exact and returned as text, like the values themselves.
 */
export function sum(collection: Collection, field: string): ReadonlySignal<Value | undefined> {
  const f = requireField(collection, field);
  return aggregate(collection, (items) => sumValues(items.map((e) => e[field] ?? null), f));
}

export function sumValues(values: readonly Value[], field: Field): Value {
  if (field.type === "Edm.Decimal" || field.type === "Edm.Int64") {
    let total = 0n;
    let scale = 0;
    for (const v of values) {
      if (v === null) continue;
      const d = parseExact(v);
      [total, scale] = addScaled(total, scale, d.units, d.scale);
    }
    return formatExact(total, scale);
  }
  let total = 0;
  for (const v of values) if (typeof v === "number") total += v;
  return total;
}

/** `a - b` for exact numeric text, keeping the larger scale. */
export function subtractExact(a: Value, b: Value): string {
  const x = parseExact(a);
  const y = parseExact(b);
  const [total, scale] = addScaled(x.units, x.scale, -y.units, y.scale);
  return formatExact(total, scale);
}

function requireField(collection: Collection, name: string): Field {
  const f = collection.type.field(name);
  if (!f) throw new Error(`${collection.type.name} has no field ${name}`);
  return f;
}

function parseExact(v: Value): { units: bigint; scale: number } {
  const text = String(v);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) throw new Error(`${text} isn't an exact number`);
  const frac = m[3] ?? "";
  let units = BigInt(m[2]! + frac);
  let scale = frac.length - Number(m[4] ?? 0);
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units: m[1] ? -units : units, scale };
}

function addScaled(a: bigint, as: number, b: bigint, bs: number): [bigint, number] {
  const scale = Math.max(as, bs);
  return [a * 10n ** BigInt(scale - as) + b * 10n ** BigInt(scale - bs), scale];
}

function formatExact(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}
