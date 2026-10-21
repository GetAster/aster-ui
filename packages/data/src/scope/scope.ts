import { computed, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { DataContext } from "../context.ts";
import type { Criteria } from "../criteria/ast.ts";
import { matches } from "../criteria/evaluate.ts";
import { isRelative, resolveRelative } from "../criteria/relative.ts";
import { CriteriaError } from "../criteria/values.ts";
import type { EdmType, Entity, EntityType, Field, Navigation, Value } from "../schema/model.ts";
import { keyText } from "../store/keys.ts";
import { relatedAggregate } from "./related-aggregate.ts";
import { parseTemplate } from "../template/template.ts";

/**
 * What a component makes visible to its page: named signals, and the entity
 * type behind any that hold a record, so paths into them are typed.
 */
export interface Publication {
  readonly values: Readonly<Record<string, ReadonlySignal<unknown>>>;
  readonly types?: Readonly<Record<string, EntityType>>;
  /** For a name that holds a record: its fields hidden from the caller (`StoredRecord.hidden`). */
  readonly hidden?: Readonly<Record<string, ReadonlySignal<ReadonlySet<string>>>>;
}

/**
 * A condition over the scope. Criteria name paths (`people.selected.name`)
 * where a query names properties; a bare path means "is true", anywhere in
 * the tree.
 */
export type Condition =
  | Criteria
  | string
  | { readonly op: "and" | "or"; readonly args: readonly Condition[] }
  | { readonly op: "not"; readonly arg: Condition };

/** `condition` as plain criteria, bare paths spelled out. */
export function toCriteria(condition: Condition): Criteria {
  if (typeof condition === "string") return { op: "eq", field: condition, value: true };
  switch (condition.op) {
    case "and":
    case "or":
      return { op: condition.op, args: condition.args.map(toCriteria) };
    case "not":
      return { op: "not", arg: toCriteria(condition.arg) };
    default:
      return condition;
  }
}

/** A rule with the reason shown when it applies. */
export interface Ruled {
  readonly when: Condition;
  readonly reason?: string;
}

export interface StateRules {
  /** Visible only while this holds. */
  readonly visible?: Condition | Ruled;
  /** Enabled only while this holds. */
  readonly enabled?: Condition | Ruled;
  /** Read-only while this holds. */
  readonly readOnly?: Condition | Ruled;
  /** Required while this holds. */
  readonly required?: Condition | Ruled;
}

export type Effect = keyof StateRules;

export interface FieldState {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  /** Why each effect isn't at its default, when a reason was given. */
  readonly reasons: Readonly<Partial<Record<Effect, string>>>;
}

export const DEFAULT_STATE: FieldState = Object.freeze({
  visible: true,
  enabled: true,
  readOnly: false,
  required: false,
  reasons: Object.freeze({}),
});

/**
 * One case of a derived value (`scope.select`): when `when` holds (or always,
 * without one), the value is the literal `value`, the value at `path`, or
 * `template` rendered over the scope.
 */
export type Case = { readonly when?: Condition } & (
  | { readonly value: Value }
  | { readonly path: string }
  | { readonly template: string }
  | { readonly aggregate: "min" | "max" | "average"; readonly path: string; readonly field: string }
);

/** A derived signal owns any related-list requests; dispose it when its consumer goes away. */
export interface SelectedValue extends ReadonlySignal<unknown> {
  dispose(): void;
}

/** Navigations a path may follow from a published record: `task.values.project.lead.name` follows two. */
export const MAX_HOPS = 3;

/** A published name: its record type and fields' CSDL types, when the publication gives them. */
export interface ScopeName {
  readonly type?: string;
  readonly fields?: Readonly<Record<string, EdmType>>;
}

/** Every published key's names (`scope.schema()`). Plain data. */
export type ScopeSchema = Readonly<Record<string, Readonly<Record<string, ScopeName>>>>;

/** One step of `explain`: a rule, what it read and what it decided. */
export interface Explanation {
  readonly effect: Effect | "derived";
  readonly rule: Condition;
  readonly reason?: string;
  readonly holds: boolean;
  readonly reads: Readonly<Record<string, unknown>>;
  /** Paths it read as unknown: fields hidden on their record. */
  readonly unknown?: readonly string[];
  /** Derived cases, the selected case (zero-based), and its current result. */
  readonly cases?: readonly Case[];
  readonly matched?: number;
  readonly value?: unknown;
  readonly overridden?: boolean;
  readonly current?: unknown;
  readonly error?: string;
}

interface Registered {
  readonly target: string;
  readonly effect: Effect;
  readonly rule: Condition;
  readonly reason?: string;
  readonly paths: readonly string[];
  readonly holds: ReadonlySignal<boolean>;
  readonly availability: boolean;
}

/**
 * A page's published state, by key. Components publish under a key; rules and
 * other components read by path without a reference to the publisher.
 *
 * Invariants: a key has one publisher per scope; reading an unpublished key
 * gives `undefined` and follows it once it's published; a child scope's keys
 * shadow its parent's.
 */
export class PageScope {
  readonly parent: PageScope | undefined;
  /** The clock relative dates in rules resolve against; a child scope has its parent's. */
  readonly now: () => number;
  readonly #entries = signal<ReadonlyMap<string, Publication>>(new Map());
  /** Where paths through a navigation find the related record; a child scope has its parent's. */
  readonly ctx: DataContext | undefined;
  readonly #rules: Registered[] = [];
  readonly #derivations = new Map<string, () => Explanation>();

  constructor(parent?: PageScope, options: { now?: () => number; ctx?: DataContext } = {}) {
    this.parent = parent;
    this.now = options.now ?? parent?.now ?? Date.now;
    this.ctx = options.ctx ?? parent?.ctx;
  }

  child(): PageScope {
    return new PageScope(this);
  }

  /** Publishes under `key`; returns the function that withdraws it. */
  publish(key: string, publication: Publication): () => void {
    if (key.includes(".")) throw new Error(`a scope key can't contain '.': ${key}`);
    const entries = this.#entries.peek();
    if (entries.has(key)) throw new Error(`'${key}' is already published in this scope`);
    this.#entries.value = new Map(entries).set(key, publication);
    return () => {
      const now = this.#entries.peek();
      if (now.get(key) !== publication) return;
      const next = new Map(now);
      next.delete(key);
      this.#entries.value = next;
    };
  }

  /** The published keys, nearest scope first. */
  keys(): string[] {
    const own = [...this.#entries.peek().keys()];
    return [...own, ...(this.parent?.keys().filter((k) => !own.includes(k)) ?? [])];
  }

  /**
   * What can be read, typed: each published key's names, with the record
   * type and its fields' CSDL types where the publication gives them. For
   * rule builders and tools, to offer and check paths before a rule exists.
   */
  schema(): ScopeSchema {
    const out: Record<string, Record<string, ScopeName>> = {};
    for (const key of this.keys()) {
      const pub = this.#lookup(key)!;
      out[key] = Object.fromEntries(
        Object.keys(pub.values).map((name) => {
          const type = pub.types?.[name];
          return [name, type ? { type: type.name, fields: Object.fromEntries(type.fields.map((f) => [f.name, f.type])) } : {}];
        }),
      );
    }
    return out;
  }

  /**
   * Why a path can't be read, or `undefined` if it can: an unpublished key,
   * an unknown name, a property the record type lacks, a step past a field,
   * or more than `MAX_HOPS` navigations.
   */
  check(path: string): string | undefined {
    const [key, name, ...rest] = path.split(".");
    const pub = this.#lookup(key ?? "");
    if (!pub) return `nothing is published as '${key}'`;
    if (name === undefined || !(name in pub.values)) return `'${key}' has no '${name ?? ""}'`;
    try {
      this.#steps(path, pub.types?.[name], rest);
      return undefined;
    } catch (e) {
      if (e instanceof CriteriaError) return e.message;
      throw e;
    }
  }

  /**
   * A path's value: the key's signal, then properties of the value it holds.
   * From a typed record, a step that names a single-valued navigation reads
   * the related record from the store through `ctx` (fetching it if it isn't
   * loaded), so `task.values.project.name` follows the task's project; it's
   * `undefined` until the record arrives and `null` with no related record.
   */
  value(path: string): ReadonlySignal<unknown> {
    const [key, name, ...rest] = path.split(".");
    const records = new Map<string, ReadonlySignal<Entity | undefined>>();
    return computed(() => {
      const pub = this.#lookup(key!);
      const signal = pub?.values[name ?? ""];
      let v: unknown = signal?.value;
      const steps = signal ? this.#steps(path, pub?.types?.[name ?? ""], rest) : [];
      for (const [i, p] of rest.entries()) {
        // Null after a navigation is "no related record", and so is everything under it.
        if (v === null) return i > 0 && steps[i - 1]?.nav ? null : undefined;
        if (v === undefined) return undefined;
        const step = steps[i];
        if (step?.nav) v = this.#related(step.nav, step.from, v as Entity, records);
        else v = (v as Record<string, unknown>)[p];
      }
      return v;
    });
  }

  /**
   * A derived value: the first case whose rule holds gives it, and a case
   * without a rule is the default. `undefined` when no case applies, and
   * while a path it has to read is `undefined` (an unpublished key, a
   * related record still loading), so nothing is decided on missing data.
   */
  select(cases: readonly Case[], target?: string): SelectedValue {
    const owned: ReturnType<typeof relatedAggregate>[] = [];
    const readPaths = new Set<string>();
    let built: { holds: ReadonlySignal<boolean> | undefined; reads: ReadonlySignal<unknown>[]; value: ReadonlySignal<unknown>; error?: ReadonlySignal<unknown> }[];
    try {
      built = cases.map((c) => {
        const holds = c.when === undefined ? undefined : this.when(c.when);
        const reads = c.when === undefined ? [] : pathsOf(toCriteria(c.when)).map((p) => this.value(p));
        if (c.when) pathsOf(toCriteria(c.when)).forEach((p) => readPaths.add(p));
        if ("aggregate" in c) {
          readPaths.add(c.path.slice(0, c.path.lastIndexOf(".")));
          const aggregate = this.#aggregate(c);
          owned.push(aggregate);
          return { holds, reads, value: aggregate.value, error: aggregate.error };
        }
        if ("path" in c) {
          readPaths.add(c.path);
          return { holds, reads, value: this.value(c.path) };
        }
        if ("template" in c) {
          const template = parseTemplate(c.template);
          template.paths.forEach((p) => readPaths.add(p));
          const paths = new Map(template.paths.map((p) => [p, this.value(p)]));
          // Undefined until every path can be read, so no half-filled text.
          return { holds, reads, value: computed(() => ([...paths.values()].some((r) => r.value === undefined) ? undefined : template.render((p) => paths.get(p)!.value))) };
        }
        const literal = c.value;
        return { holds, reads, value: computed(() => literal) };
      });
    } catch (e) {
      for (const a of owned) a.dispose();
      throw e;
    }
    const matched = computed(() => {
      for (const [i, c] of built.entries()) {
        if (c.reads.some((r) => r.value === undefined)) return undefined;
        if (c.holds === undefined || c.holds.value) return i;
      }
      return undefined;
    });
    const result = computed(() => {
      const i = matched.value;
      return i === undefined ? undefined : built[i]!.value.value;
    });
    const explain = (): Explanation => {
      const i = matched.peek();
      const error = i === undefined ? undefined : built[i]?.error?.peek();
      return {
        effect: "derived", rule: (i === undefined ? undefined : cases[i]?.when) ?? { op: "and", args: [] },
        holds: i !== undefined, cases, ...(i === undefined ? {} : { matched: i }), value: result.peek(),
        reads: Object.fromEntries([...readPaths].map((p) => [p, this.value(p).peek()])),
        ...(error === undefined ? {} : { error: String(error) }),
      };
    };
    if (target) this.#derivations.set(target, explain);
    return Object.assign(result, { dispose: () => {
      for (const a of owned) a.dispose();
      if (target && this.#derivations.get(target) === explain) this.#derivations.delete(target);
    } });
  }

  #aggregate(spec: { readonly aggregate: "min" | "max" | "average"; readonly path: string; readonly field: string }): ReturnType<typeof relatedAggregate> {
    const [key, name, ...rest] = spec.path.split(".");
    const pub = this.#lookup(key!);
    const type = pub?.types?.[name ?? ""];
    if (!type || !this.ctx || !rest.length) throw new CriteriaError(`'${spec.path}' needs a typed record and a data context`);
    const prefix = rest.slice(0, -1);
    const steps = this.#steps(spec.path, type, prefix);
    const last = steps.at(-1);
    if (last && !last.nav) throw new CriteriaError(`'${spec.path}' goes past a field`);
    const from = last?.nav ? this.ctx.schema.set(last.nav.target).type : type;
    const nav = from.navigation(rest.at(-1)!);
    if (!nav?.collection || !nav.keys.length) throw new CriteriaError(`'${spec.path}' must name a related list with foreign keys`);
    if (steps.length + 1 > MAX_HOPS) throw new CriteriaError(`'${spec.path}' follows more than ${MAX_HOPS} navigations`);
    const field = this.ctx.schema.set(nav.target).type.field(spec.field);
    if (!field) throw new CriteriaError(`${nav.target} has no field '${spec.field}'`);
    const numeric = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Decimal", "Edm.Single", "Edm.Double"]).has(field.type);
    const ordered = new Set(["Edm.String", "Edm.Date", "Edm.DateTimeOffset", "Edm.TimeOfDay"]).has(field.type);
    if (!numeric && (spec.aggregate === "average" || !ordered)) {
      throw new CriteriaError(`'${spec.path}.${spec.field}' must be numeric for ${spec.aggregate}`);
    }
    return relatedAggregate(this.ctx, this.value([key, name, ...prefix].join(".")), nav, spec.aggregate, spec.field);
  }

  /**
   * The field a path reads, when its publication gives the record type and
   * the path ends on a property of that record or of a record reached
   * through its navigations. Other paths are untyped. A property the record
   * type doesn't have is an error, not a silent null.
   */
  field(path: string): Field | undefined {
    const [key, name, ...rest] = path.split(".");
    if (rest.length === 0) return undefined;
    const type = this.#lookup(key!)?.types?.[name ?? ""];
    if (!type) return undefined;
    let steps;
    try {
      steps = this.#steps(path, type, rest);
    } catch (e) {
      throw e instanceof CriteriaError && !e.message.includes(path) ? new CriteriaError(`${e.message} (${path})`) : e;
    }
    const last = steps.at(-1);
    return last?.field && steps.length === rest.length ? { ...last.field } : undefined;
  }

  /**
   * Whether `rule` holds, as a signal. A field hidden on its record is
   * unknown to the rule, not null: a test of it is unknown, and a rule holds
   * only when it's true.
   */
  when(rule: Condition): ReadonlySignal<boolean> {
    const criteria = toCriteria(rule);
    const paths = pathsOf(criteria);
    const values = paths.map((p) => this.value(p));
    const lists = new Set(listsOf(criteria));
    return computed(() => {
      const entity: Record<string, Value> = {};
      paths.forEach((p, i) => (entity[p] = lists.has(p) ? (toRows(values[i]!.value, p) as unknown as Value) : toValue(values[i]!.value)));
      const unknown = new Set(paths.filter((p) => this.#hidden(p)));
      const type = this.#ruleType(criteria, paths, entity, lists);
      const rows = (path: string) => this.#rowType(path);
      // Relative dates resolve when the rule is evaluated, which is when what it reads changes.
      const resolved = resolveRelative(criteria, type, this.now(), rows);
      return matches(resolved, entity, type, (from, path) => (from.name === "scope" ? rows(path) : undefined), unknown);
    });
  }

  /** Conservative action availability: every referenced value must be available. */
  available(rule: Condition): ReadonlySignal<boolean> {
    const paths = pathsOf(toCriteria(rule));
    const values = paths.map(path => this.value(path));
    const holds = this.when(rule);
    return computed(() => values.every(value => value.value !== undefined) && holds.value);
  }

  /** Invalid publication/property paths in a rule, without evaluating it. */
  checkRule(rule: Condition): string[] {
    return pathsOf(toCriteria(rule)).flatMap(path => {
      const error = this.check(path);
      return error ? [error] : [];
    });
  }

  /** Whether a path is a field hidden on the record its publication holds. */
  #hidden(path: string): boolean {
    const [key, name, prop, ...more] = path.split(".");
    if (prop === undefined || more.length > 0) return false;
    return this.#lookup(key!)?.hidden?.[name ?? ""]?.value.has(prop) ?? false;
  }

  /** The state of `target` from its rules; registered for `explain` and `readers`. */
  state(target: string, rules: StateRules, options: { availability?: boolean } = {}): ReadonlySignal<FieldState> {
    const parts = (Object.keys(rules) as Effect[]).flatMap((effect) => {
      const spec = rules[effect];
      if (spec === undefined) return [];
      const { when, reason } = typeof spec === "object" && "when" in spec ? spec : { when: spec, reason: undefined };
      const holds = options.availability && effect === "enabled" ? this.available(when) : this.when(when);
      const registered: Registered = {
        target,
        effect,
        rule: when,
        ...(reason !== undefined ? { reason } : {}),
        paths: pathsOf(toCriteria(when)),
        holds,
        availability: options.availability ?? false,
      };
      this.#rules.push(registered);
      return [registered];
    });
    return computed(() => {
      const state = { ...DEFAULT_STATE, reasons: {} as Partial<Record<Effect, string>> };
      for (const r of parts) {
        const value = r.holds.value;
        state[r.effect] = value;
        const atDefault = value === DEFAULT_STATE[r.effect];
        if (!atDefault && r.reason !== undefined) state.reasons[r.effect] = r.reason;
      }
      return Object.freeze({ ...state, reasons: Object.freeze(state.reasons) });
    });
  }

  /** Every rule registered for `target`, with what it read and decided now. */
  explain(target: string): Explanation[] {
    const state = this.#rules
      .filter((r) => r.target === target)
      .map((r) => {
        const unknown = untracked(() => r.paths.filter((p) => this.#hidden(p) || (r.availability && this.value(p).peek() === undefined)));
        return {
          effect: r.effect,
          rule: r.rule,
          ...(r.reason !== undefined ? { reason: r.reason } : {}),
          holds: r.holds.peek(),
          reads: Object.fromEntries(r.paths.map((p) => [p, this.value(p).peek()])),
          ...(unknown.length ? { unknown } : {}),
        };
      });
    const derived = this.#derivations.get(target);
    return derived ? [...state, derived()] : state;
  }

  /** The targets whose rules read `path` or anything under it. */
  readers(path: string): { target: string; effect: Effect }[] {
    return this.#rules
      .filter((r) => r.paths.some((p) => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`)))
      .map((r) => ({ target: r.target, effect: r.effect }));
  }

  /**
   * The typed steps of a path after its key and name: a field ends it, a
   * single-valued navigation moves to the related type. Untyped steps (no
   * record type, or past a field) aren't checked.
   */
  #steps(path: string, type: EntityType | undefined, rest: readonly string[]): { nav?: Navigation; from: EntityType; field?: Field }[] {
    const out: { nav?: Navigation; from: EntityType; field?: Field }[] = [];
    let at = type;
    let hops = 0;
    for (const p of rest) {
      if (!at) break;
      const field = at.field(p);
      if (field) {
        out.push({ from: at, field });
        if (out.length < rest.length) throw new CriteriaError(`'${path}' goes past a field`);
        break;
      }
      const nav = at.navigation(p);
      if (!nav) throw new CriteriaError(`${at.name} has no field '${p}'`);
      if (nav.collection) throw new CriteriaError(`'${p}' on ${at.name} is a list; a path follows single records (${path})`);
      if (++hops > MAX_HOPS) throw new CriteriaError(`'${path}' follows more than ${MAX_HOPS} navigations`);
      if (!this.ctx) throw new CriteriaError(`'${path}' follows '${p}', which needs the scope's data context`);
      out.push({ nav, from: at });
      at = this.ctx.schema.set(nav.target).type;
    }
    return out;
  }

  /** The record `nav` leads to from `record`: null without a foreign key, `undefined` until it's loaded. */
  #related(nav: Navigation, from: EntityType, record: Entity, cache: Map<string, ReadonlySignal<Entity | undefined>>): Entity | null | undefined {
    const ctx = this.ctx!;
    const target = ctx.schema.set(nav.target).type;
    const local = new Map(nav.keys.map(([mine, theirs]) => [theirs, mine]));
    const values = target.key.map((k) => record[local.get(k) ?? ""] ?? null);
    if (values.some((v) => v === null)) {
      if (!target.key.every((k) => local.has(k))) throw new CriteriaError(`${from.name}.${nav.name} has no foreign key to follow`);
      return null;
    }
    const key = keyText(values as (string | number | boolean)[]);
    const id = `${nav.target} ${key}`;
    let found = cache.get(id);
    if (!found) {
      found = ctx.lookup(nav.target, key);
      cache.set(id, found);
    }
    return found.value;
  }

  /** The type of the rows a list path holds, from its publication's `types`. */
  #rowType(path: string): EntityType | undefined {
    const [key, name, ...rest] = path.split(".");
    return rest.length === 0 ? this.#lookup(key!)?.types?.[name ?? ""] : undefined;
  }

  #lookup(key: string): Publication | undefined {
    const own = this.#entries.value.get(key);
    if (own || !this.parent) return own;
    return this.parent.#lookup(key);
  }

  /**
   * A one-off entity type whose fields are the rule's paths. A path is typed
   * by its publication where it says; otherwise by its value, or, while it's
   * null, by what the rule compares it with. Untyped text compares only for
   * equality: ordering it would guess (is it a date?), so that's an error.
   */
  #ruleType(criteria: Criteria, paths: readonly string[], entity: Record<string, Value>, lists: ReadonlySet<string> = new Set()): EntityType {
    const types = new Map<string, EdmType>();
    const fields = new Map<string, Field>();
    for (const p of paths) {
      if (lists.has(p)) continue;
      const typed = this.field(p);
      if (typed) fields.set(p, { ...typed, name: p });
      const known = typed?.type ?? typeOf(entity[p] ?? null);
      if (known) types.set(p, known);
    }
    for (const [p, other] of comparisons(criteria)) {
      if (!types.has(p)) {
        const t = typeof other === "string" ? types.get(other) : typeOf(other.value);
        if (t) types.set(p, t);
      }
    }
    for (const p of paths) {
      if (!fields.has(p) && !lists.has(p)) {
        fields.set(p, { name: p, type: types.get(p) ?? "Edm.String", nullable: true, computed: false, immutable: false, annotations: {} });
      }
    }
    for (const p of ordered(criteria)) {
      if (typeof entity[p] === "string" && !this.field(p)) {
        throw new CriteriaError(`'${p}' has no type, so it can't be ordered; publish its record type`);
      }
    }
    return {
      name: "scope",
      qualifiedName: "scope",
      key: [],
      fields: [...fields.values()],
      navigations: [],
      annotations: {},
      field: (name) => fields.get(name),
      navigation: (name) => (lists.has(name) ? { name, target: name, collection: true, keys: [], owned: false } : undefined),
    };
  }
}

function pathsOf(c: Criteria): string[] {
  switch (c.op) {
    case "and":
    case "or":
      return [...new Set(c.args.flatMap(pathsOf))];
    case "not":
      return pathsOf(c.arg);
    case "any":
    case "all":
    case "via":
      // The list's path; `where` names the rows' own properties.
      return [c.field];
    default:
      return "other" in c ? [c.field, c.other] : [c.field];
  }
}

function typeOf(value: Value): EdmType | undefined {
  if (typeof value === "boolean") return "Edm.Boolean";
  if (typeof value === "number") return "Edm.Double";
  if (typeof value === "string") return "Edm.String";
  return undefined;
}

/** Paths used with gt, ge, lt or le. */
function ordered(c: Criteria): string[] {
  switch (c.op) {
    case "and":
    case "or":
      return c.args.flatMap(ordered);
    case "not":
      return ordered(c.arg);
    case "any":
    case "all":
    case "via":
      return [];
    case "gt":
    case "ge":
    case "lt":
    case "le":
      return "other" in c ? [c.field, c.other] : [c.field];
    default:
      return [];
  }
}

/** Each compared path with what it's compared to: another path, or a literal. */
function comparisons(c: Criteria): [string, string | { value: Value }][] {
  switch (c.op) {
    case "and":
    case "or":
      return c.args.flatMap(comparisons);
    case "not":
      return comparisons(c.arg);
    case "any":
    case "all":
    case "via":
      return [];
    case "in":
      return c.values.map((value) => [c.field, { value }]);
    default:
      if ("other" in c) return [[c.field, c.other], [c.other, c.field]];
      return [[c.field, { value: isRelative(c.value) ? null : c.value }]];
  }
}

/** Paths that `any` or `all` range over. */
function listsOf(c: Criteria): string[] {
  switch (c.op) {
    case "and":
    case "or":
      return c.args.flatMap(listsOf);
    case "not":
      return listsOf(c.arg);
    case "any":
    case "all":
      return [c.field];
    default:
      return [];
  }
}

function toRows(v: unknown, path: string): readonly unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new CriteriaError(`'${path}' isn't a list, so any or all can't range over it`);
  return v;
}

function toValue(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  throw new CriteriaError(`a rule can only compare plain values, not ${Object.prototype.toString.call(v)}`);
}
