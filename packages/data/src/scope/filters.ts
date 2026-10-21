import { computed, effect, signal, type ReadonlySignal } from "@preact/signals-core";
import type { Criteria, Query } from "../criteria/ast.ts";
import { toFilter } from "../criteria/compile.ts";
import { isRelative, relatedOf, resolveRelative } from "../criteria/relative.ts";
import { assertLiteral, CriteriaError } from "../criteria/values.ts";
import type { EdmType, EntitySet, EntityType, Navigation, Schema, Value } from "../schema/model.ts";
import { keyFromText } from "../store/keys.ts";
import type { Selection } from "../selection/selection.ts";
import type { Publication } from "./scope.ts";

/**
 * What a contribution is: a `filter` (a slice someone chose), a `selection`
 * of records by identity ("these keys"), or a `value` picked from data ("status
 * is approved", a chart's bar). Only identity selections are ignored by a
 * list on their own set.
 */
export type ContributionKind = "filter" | "selection" | "value";

/** One component's part of the shared filter. */
export interface Contribution {
  /** The contributor. A new contribution under the same name replaces only that one. */
  readonly by: string;
  /** The contribution said in words, for chips and announcements: "Status is approved". */
  readonly label: string;
  readonly criteria: Criteria;
  /**
   * The entity set the criteria are written against. It applies there, and
   * across a unique shortest path of up to three single-valued navigations, unless
   * `related` is false. Without a set, the criteria apply by field name
   * wherever a collection has the fields with compatible types.
   */
  readonly set?: string;
  readonly related?: boolean;
  /** The types of a contribution's fields when it has no `set`; otherwise inferred from its literals. */
  readonly fields?: Readonly<Record<string, EdmType>>;
  /** Applies only to collections on these sets. */
  readonly only?: readonly string[];
  /** `filter` by default. */
  readonly kind?: ContributionKind;
}

/** A contribution as it applies to one collection. */
export interface Applied {
  readonly by: string;
  readonly label: string;
  readonly criteria: Criteria;
  /** The navigation it was followed through, for a contribution on a related set. */
  readonly via?: string;
}

/** A contribution that doesn't apply to one collection, and why. */
export interface SkippedContribution {
  readonly by: string;
  readonly label: string;
  readonly reason: string;
}

export interface Consumed {
  /** Every applied contribution, ANDed; `undefined` when none applies. */
  readonly criteria: Criteria | undefined;
  readonly applied: readonly Applied[];
  readonly skipped: readonly SkippedContribution[];
}

export interface ConsumeOptions {
  /** The consumer's own contributor names. A component never consumes what it contributed. */
  readonly self?: string | readonly string[];
  /** Selections and values only from these contributors; filters always apply. `[]` follows none. */
  readonly from?: readonly string[];
  /**
   * Take an identity selection on the consumer's own set. Off for lists,
   * which would only copy the peer's selection; on for a KPI that totals
   * the selected rows.
   */
  readonly sameSetSelections?: boolean;
}

/** A contribution as a contributor gives it to `share`, without its name. */
export type Shared = Omit<Contribution, "by">;

/** Saved manual slices; live selections and signal owners stay with their contributors. */
export interface FilterSnapshot {
  readonly version: 1;
  readonly contributions: readonly Contribution[];
}

/**
 * The page's shared filter: named contributions that collections opt in to
 * combining with their own query (design/page-rules.md, "Sharing filters").
 * Nothing contributes or consumes by default.
 *
 * Invariants: one entry per contributor; a contribution applies to a
 * collection whole or not at all; relative dates stay symbolic here and are
 * resolved by each collection at its fetch.
 */
export class SharedFilters {
  readonly schema: Schema;
  readonly #entries = signal<readonly Contribution[]>([]);
  /** Contributors that follow a signal through `share`, with how each withdraws when asked. */
  readonly #following = new Map<string, (() => void) | undefined>();

  readonly contributions: ReadonlySignal<readonly Contribution[]> = this.#entries;

  constructor(schema: Schema) {
    this.schema = schema;
  }

  /** Adds or replaces `contribution.by`'s entry, keeping its place. Criteria on a set are checked against it now. */
  set(contribution: Contribution): void {
    if (this.#following.has(contribution.by)) throw new Error(`'${contribution.by}' follows a signal; it can't also be set by hand`);
    this.#put(contribution);
  }

  /**
   * Withdraws one contributor's entry. A contributor that follows a signal
   * is asked to withdraw (its `clear`), so its own state agrees; one shared
   * without a `clear` can't be removed from outside.
   */
  remove(by: string): void {
    if (this.#following.has(by)) {
      const clear = this.#following.get(by);
      if (!clear) throw new Error(`'${by}' follows a signal and gave no way to clear it`);
      clear();
    }
    this.#drop(by);
  }

  /** Whether `remove(by)` can withdraw that entry. */
  removable(by: string): boolean {
    return !this.#following.has(by) || this.#following.get(by) !== undefined;
  }

  /** Withdraws every entry that can be removed. */
  clear(): void {
    for (const c of this.#entries.peek()) if (this.removable(c.by)) this.remove(c.by);
  }

  /**
   * Contributes whatever `source` holds under `by`, following it; `undefined`
   * withdraws. `clear` is how the contributor withdraws when someone else
   * removes the entry (a chip's remove button): it should make `source`
   * undefined, such as clearing a selection. Returns the function that stops
   * following and withdraws. A name has one follower at a time.
   */
  share(by: string, source: ReadonlySignal<Shared | undefined>, clear?: () => void): () => void {
    if (this.#following.has(by)) throw new Error(`'${by}' is already shared`);
    this.#following.set(by, clear);
    const stop = effect(() => {
      const c = source.value;
      if (c) this.#put({ ...c, by });
      else this.#drop(by);
    });
    return () => {
      stop();
      this.#following.delete(by);
      this.#drop(by);
    };
  }

  /** Serializable slices for saving with a screen; live signal contributions are excluded. */
  snapshot(): FilterSnapshot {
    return structuredClone({ version: 1, contributions: this.#entries.peek().filter((c) => !this.#following.has(c.by) && (c.kind ?? "filter") !== "selection") });
  }

  /** Restores saved slices atomically, preserving live owners. Invalid snapshots leave the channel untouched. */
  restore(snapshot: FilterSnapshot): void {
    if (snapshot.version !== 1 || !Array.isArray(snapshot.contributions)) throw new Error("Unsupported shared-filter snapshot");
    const entries = structuredClone(snapshot.contributions);
    const names = new Set<string>();
    for (const c of entries) {
      if (c?.kind !== undefined && c.kind !== "filter" && c.kind !== "value") throw new Error("Saved slices cannot own identity selections");
      if (!c || typeof c.by !== "string" || typeof c.label !== "string" || !c.criteria || names.has(c.by)) throw new Error("Invalid shared-filter snapshot");
      if (this.#following.has(c.by)) throw new Error(`'${c.by}' follows a signal; restore its contributor instead`);
      names.add(c.by);
      if (c.set !== undefined) check(c.criteria, this.schema.set(c.set), this.schema);
    }
    this.#entries.value = [...this.#entries.peek().filter((c) => this.#following.has(c.by) || (c.kind === "selection" && !names.has(c.by))), ...entries];
  }

  /** How the contributions apply to a collection on `set`. */
  consume(set: string, options: ConsumeOptions = {}): ReadonlySignal<Consumed> {
    const target = this.schema.set(set);
    const self = new Set(typeof options.self === "string" ? [options.self] : (options.self ?? []));
    return computed(() => {
      const applied: Applied[] = [];
      const skipped: SkippedContribution[] = [];
      for (const c of this.#entries.value) {
        if (self.has(c.by)) continue;
        const kind = c.kind ?? "filter";
        if (kind !== "filter" && options.from && !options.from.includes(c.by)) continue;
        const outcome = this.#match(c, target, kind, options.sameSetSelections ?? false);
        if (typeof outcome === "string") skipped.push({ by: c.by, label: c.label, reason: outcome });
        else if (outcome) applied.push({ by: c.by, label: c.label, ...outcome });
      }
      const parts = applied.map((a) => a.criteria);
      const criteria = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and" as const, args: parts };
      return { criteria, applied, skipped };
    });
  }

  /** `base` with the contributions that apply to its set ANDed on; for `ctx.collection` or `ctx.groups`. */
  query(base: Query | ReadonlySignal<Query>, options: ConsumeOptions = {}): ReadonlySignal<Query> {
    const b = "set" in base ? base : base.peek();
    const consumed = this.consume(b.set, options);
    return computed(() => {
      const q = "set" in base ? base : base.value;
      const shared = consumed.value.criteria;
      if (!shared) return q;
      return { ...q, filter: q.filter ? { op: "and", args: [q.filter, shared] } : shared };
    });
  }

  #drop(by: string): void {
    const entries = this.#entries.peek();
    if (entries.some((c) => c.by === by)) this.#entries.value = entries.filter((c) => c.by !== by);
  }

  #put(c: Contribution): void {
    if (c.set !== undefined) {
      const set = this.schema.set(c.set);
      check(c.criteria, set, this.schema);
    }
    const entries = this.#entries.peek();
    const at = entries.findIndex((e) => e.by === c.by);
    if (at >= 0 && JSON.stringify(entries[at]) === JSON.stringify(c)) return;
    this.#entries.value = at >= 0 ? entries.map((e, i) => (i === at ? c : e)) : [...entries, c];
  }

  /**
   * The criteria `c` puts on a collection on `target`, a reason it can't, or
   * `undefined` when it isn't meant for it (scoped elsewhere, or a peer's
   * selection of the same set).
   */
  #match(c: Contribution, target: EntitySet, kind: ContributionKind, sameSetSelections: boolean): { criteria: Criteria; via?: string } | string | undefined {
    if (c.only && !c.only.includes(target.name)) return undefined;
    if (c.set === undefined) {
      try {
        const adapted = byName(c.criteria, c.fields ?? {}, target);
        check(adapted, target, this.schema);
        return { criteria: adapted };
      } catch (e) {
        if (e instanceof CriteriaError) return e.message;
        throw e;
      }
    }
    if (c.set === target.name) {
      if (kind === "selection" && !sameSetSelections) return undefined;
      return { criteria: c.criteria };
    }
    if (c.related === false) return `${c.label} applies to ${c.set} only`;
    const paths = navigationPaths(this.schema, target, c.set);
    if (paths.length === 0) return `${target.name} has no foreign key to ${c.set}`;
    if (paths.length > 1) return `${target.name} reaches ${c.set} through ${paths.map((p) => p.map((n) => n.name).join(".")).join(" and ")}; it's not clear which to follow`;
    const path = paths[0]!;
    let criteria = c.criteria;
    for (const nav of [...path].reverse()) criteria = throughKey(criteria, nav.name, nav.keys, this.schema.set(nav.target).type);
    return { criteria, via: path.map((n) => n.name).join(".") };
  }
}

/** The page's shared filter as a publication: `contributions`, `labels`, `count`, `any`, so rules and labels can read it. */
export function filtersPublication(filters: SharedFilters): Publication {
  const contributions = filters.contributions;
  return {
    values: {
      contributions,
      labels: computed(() => contributions.value.map((c) => c.label)),
      count: computed(() => contributions.value.length),
      any: computed(() => contributions.value.length > 0),
    },
  };
}

/**
 * A selection as a contribution: its keys as "key in these", on the
 * selection's set, said by `label`. Nothing is contributed while nothing is
 * selected, so deselecting, or the selected rows leaving the data, withdraws it.
 */
export function selectionShare(selection: Selection, label: (count: number) => string): ReadonlySignal<Shared | undefined> {
  return computed(() => {
    const keys = selection.keys.value;
    if (keys.length === 0) return undefined;
    const collection = selection.collection;
    const type = collection.type;
    const values = keys.map((k) => keyFromText(k));
    const criteria: Criteria =
      type.key.length === 1
        ? { op: "in", field: type.key[0]!, values: values.map((v) => v[0]!) }
        : { op: "or", args: values.map((v) => ({ op: "and" as const, args: type.key.map((k, i) => ({ op: "eq" as const, field: k, value: v[i]! })) })) };
    return { label: label(keys.length), criteria, set: collection.query.set, kind: "selection" };
  });
}

/** Throws `CriteriaError` unless `criteria` compiles for `set`, relative dates resolved at an arbitrary time. */
function check(criteria: Criteria, set: EntitySet, schema: Schema): void {
  toFilter(resolveRelative(criteria, set.type, 0, relatedOf(schema, set.type)), set.type, set, schema);
}

const INTEGERS = new Set<EdmType>(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64"]);
const NUMBERS = new Set<EdmType>([...INTEGERS, "Edm.Decimal", "Edm.Single", "Edm.Double"]);
const TEXT_NUMBERS = new Set<EdmType>(["Edm.Int64", "Edm.Decimal"]);

/**
 * Whether a value of type `from` can filter a field of type `to`: the same
 * type, or an integer filtering any number. A relative date (`from` is
 * `"relative"`) filters a date or a timestamp.
 */
export function compatible(from: EdmType | "relative", to: EdmType): boolean {
  if (from === "relative") return to === "Edm.Date" || to === "Edm.DateTimeOffset";
  return from === to || (INTEGERS.has(from) && NUMBERS.has(to));
}

function inferred(value: Value): EdmType | undefined {
  switch (typeof value) {
    case "boolean":
      return "Edm.Boolean";
    case "number":
      return Number.isInteger(value) ? "Edm.Int32" : "Edm.Double";
    case "string":
      return "Edm.String";
    default:
      return undefined;
  }
}

/** A number as the JSON form of a numeric field: text for Int64 and Decimal. */
function converted(value: Value, to: EdmType): Value {
  if (value === null || !NUMBERS.has(to)) return value;
  if (TEXT_NUMBERS.has(to)) return typeof value === "number" ? String(value) : value;
  return typeof value === "string" ? Number(value) : value;
}

/**
 * A global contribution's criteria for `target`: each field must exist there
 * with a compatible type, and literals take the field's JSON form. Any
 * mismatch is a `CriteriaError`, which skips the whole contribution.
 */
function byName(c: Criteria, types: Readonly<Record<string, EdmType>>, target: EntitySet): Criteria {
  const field = (name: string) => {
    const f = target.type.field(name);
    if (!f) throw new CriteriaError(`${target.name} has no field '${name}'`);
    return f;
  };
  const fit = (name: string, value: unknown): Value => {
    const f = field(name);
    const from = isRelative(value) ? "relative" : (types[name] ?? inferred(value as Value));
    if (from !== undefined && !compatible(from, f.type)) throw new CriteriaError(`${target.name}.${name} is ${f.type}, not ${from}`);
    if (isRelative(value)) return value as unknown as Value;
    const v = converted(value as Value, f.type);
    assertLiteral(v, f);
    return v;
  };
  switch (c.op) {
    case "and":
    case "or":
      return { op: c.op, args: c.args.map((a) => byName(a, types, target)) };
    case "not":
      return { op: "not", arg: byName(c.arg, types, target) };
    case "any":
    case "all":
    case "via":
      throw new CriteriaError(`a contribution without a set compares fields; ${c.op} over '${c.field}' needs one`);
    case "in":
      return { ...c, values: c.values.map((v) => fit(c.field, v)) };
    case "contains":
    case "startswith":
    case "endswith":
      fit(c.field, c.value);
      return c;
    default: {
      if ("other" in c) {
        const a = field(c.field);
        const b = field(c.other);
        const ta = types[c.field];
        const tb = types[c.other];
        if ((ta && !compatible(ta, a.type)) || (tb && !compatible(tb, b.type)) || a.type !== b.type) {
          throw new CriteriaError(`${target.name}.${c.field} and ${c.other} can't be compared`);
        }
        return c;
      }
      return { ...c, value: fit(c.field, c.value) } as Criteria;
    }
  }
}

/**
 * Criteria on a related set as criteria here, through navigation `nav`. A
 * test of the related record's key alone becomes a test of the foreign key,
 * which a collection can place locally; anything else goes through `via`.
 */
function throughKey(c: Criteria, nav: string, keys: readonly (readonly [string, string])[], related: EntityType): Criteria {
  const local = keys.find(([, theirs]) => related.key.length === 1 && theirs === related.key[0])?.[0];
  if (local !== undefined && (c.op === "in" || c.op === "eq") && c.field === related.key[0] && !("other" in c)) {
    return { ...c, field: local };
  }
  return { op: "via", field: nav, where: c };
}

/** Shortest paths of single-valued navigations, bounded and without revisiting a set. */
function navigationPaths(schema: Schema, from: EntitySet, to: string): Navigation[][] {
  let frontier = [{ set: from, path: [] as Navigation[], seen: new Set([from.name]) }];
  for (let depth = 0; depth < 3; depth++) {
    const next: typeof frontier = [];
    const found: Navigation[][] = [];
    for (const node of frontier) {
      for (const nav of node.set.type.navigations) {
        if (nav.collection || node.seen.has(nav.target)) continue;
        const path = [...node.path, nav];
        if (nav.target === to) found.push(path);
        else next.push({ set: schema.set(nav.target), path, seen: new Set([...node.seen, nav.target]) });
      }
    }
    if (found.length) return found;
    frontier = next;
  }
  return [];
}
