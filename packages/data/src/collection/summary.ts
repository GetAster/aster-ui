import { batch, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { Criteria, Query } from "../criteria/ast.ts";
import { formatLiteral, queryType, toApply, type Aggregate } from "../criteria/compile.ts";
import { relatedOf, resolveRelative } from "../criteria/relative.ts";
import type { ODataSource } from "../odata/source.ts";
import type { Entity, Value } from "../schema/model.ts";
import type { RecordStore } from "../store/store.ts";
import { relatedSets } from "./collection.ts";

/** Exact server totals for a query, independent of loaded collection pages. */
export class Summary {
  readonly #values = signal<Readonly<Record<string, Value>> | undefined>(undefined);
  readonly #status = signal<"loading" | "idle" | "error">("loading");
  readonly #error = signal<unknown>(undefined);
  readonly values: ReadonlySignal<Readonly<Record<string, Value>> | undefined> = this.#values;
  readonly status: ReadonlySignal<"loading" | "idle" | "error"> = this.#status;
  readonly error: ReadonlySignal<unknown> = this.#error;
  readonly #source: ODataSource;
  readonly #aggregates: readonly Aggregate[];
  readonly #now: () => number;
  readonly #stop: (() => void)[] = [];
  #query: Query;
  #signature: string;
  #related: ReadonlySet<string>;
  #generation = 0;
  #disposed = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(store: RecordStore, source: ODataSource, query: Query | ReadonlySignal<Query>, aggregates: readonly Aggregate[] = [], now: () => number = Date.now) {
    this.#source = source;
    this.#aggregates = aggregates.map((a) => ({ ...a }));
    this.#now = now;
    const follow = "set" in query ? undefined : query;
    this.#query = follow ? follow.peek() : query as Query;
    this.#signature = signature(this.#query);
    this.#related = new Set([...(this.#query.relationship ? [this.#query.relationship.set] : []), ...relatedSets(this.#query.filter, source.schema.set(this.#query.set).type, source.schema), ...(this.#query.compute?.length ? [...source.schema.sets.keys()] : [])]);
    this.#validate();
    this.#stop.push(store.subscribe((change) => {
      if (change.origin.kind === "fetch" || (change.set !== this.#query.set && !this.#related.has(change.set))) return;
      this.#invalidate();
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.refresh(), 50);
    }));
    if (follow) this.#stop.push(effect(() => {
      const q = follow.value;
      untracked(() => {
        if (signature(q) === this.#signature) return;
        this.#query = q;
        this.#signature = signature(q);
        this.#related = new Set([...(q.relationship ? [q.relationship.set] : []), ...(q.compute?.length ? source.schema.sets.keys() : relatedSets(q.filter, source.schema.set(q.set).type, source.schema))]);
        void this.refresh();
      });
    }));
    void this.refresh();
  }

  /** Retry or recount. Errors are exposed through `error` and `status`. */
  async refresh(): Promise<void> {
    if (this.#disposed) return;
    clearTimeout(this.#timer);
    const generation = this.#invalidate();
    try {
      this.#validate();
      const q = this.#query;
      const type = queryType(this.#source.schema.set(q.set).type, q.compute);
      const criteria = q.filter ? resolveRelative(q.filter, type, this.#now(), relatedOf(this.#source.schema, type)) : undefined;
      let correlation = this.#correlation(q);
      if (correlation === null && q.relationship) {
        const parent = await this.#source.get(q.relationship.set, q.relationship.key);
        if (generation !== this.#generation || this.#disposed) return;
        const nav = this.#source.schema.set(q.relationship.set).type.navigation(q.relationship.navigation)!;
        if (nav.keys.some(([name]) => parent.hidden?.has(name))) throw new Error("Relationship summary correlation fields are hidden");
        correlation = this.#correlation(q, parent.entity);
      }
      const filter = correlation ? (criteria ? { op: "and" as const, args: [correlation, criteria] } : correlation) : criteria;
      const rows = await this.#source.aggregate(q.set, { ...(filter ? { filter } : {}), aggregates: this.#aggregates, ...(q.compute ? { compute: q.compute } : {}) });
      if (generation !== this.#generation || this.#disposed) return;
      const row = rows[0];
      if (!row || !Number.isSafeInteger(Number(row.count)) || Number(row.count) < 0) throw new Error("Summary response has no exact row count");
      const values: Record<string, Value> = { count: Number(row.count) };
      for (const a of this.#aggregates) values[a.as] = row[a.as] ?? null;
      batch(() => { this.#values.value = values; this.#status.value = "idle"; });
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) return;
      batch(() => { this.#error.value = error; this.#status.value = "error"; });
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation++;
    clearTimeout(this.#timer);
    for (const stop of this.#stop.splice(0)) stop();
  }

  #invalidate(): number {
    this.#generation++;
    batch(() => { this.#values.value = undefined; this.#error.value = undefined; this.#status.value = "loading"; });
    return this.#generation;
  }

  /** Missing non-key parent fields require an authoritative parent read. */
  #correlation(query: Query, parent?: Entity): Criteria | null | undefined {
    const address = query.relationship;
    if (!address) return undefined;
    const type = this.#source.schema.set(address.set).type;
    const nav = type.navigation(address.navigation);
    if (!nav || nav.target !== query.set || !nav.keys.length) throw new Error("Relationship summary requires navigation correlation constraints");
    if (address.key.length !== type.key.length || address.key.some((v) => v === undefined || v === null)) throw new Error("Relationship summary requires a complete parent key");
    type.key.forEach((name, i) => formatLiteral(address.key[i]!, type.field(name)!));
    const values: Entity = { ...Object.fromEntries(type.key.map((name, i) => [name, address.key[i]!])), ...parent };
    const target = this.#source.schema.set(query.set).type;
    for (const [mine, theirs] of nav.keys) if (!type.field(mine) || !target.field(theirs)) throw new Error("Relationship summary has invalid correlation fields");
    if (nav.keys.some(([mine]) => values[mine] === undefined)) {
      if (parent) throw new Error("Relationship summary response lacks correlation fields");
      return null;
    }
    if (nav.keys.some(([mine]) => values[mine] === null)) return { op: "or", args: [] };
    const args: Criteria[] = nav.keys.map(([mine, theirs]) => ({ op: "eq", field: theirs, value: values[mine]! }));
    return args.length === 1 ? args[0]! : { op: "and", args };
  }

  #validate(): void {
    this.#correlation(this.#query);
    const set = this.#source.schema.set(this.#query.set);
    const criteria = this.#query.filter;
    const filter = criteria ? resolveRelative(criteria, queryType(set.type, this.#query.compute), this.#now(), relatedOf(this.#source.schema, set.type)) : undefined;
    toApply(set.type, filter, [], this.#aggregates, set, this.#source.schema, this.#query.compute);
  }
}

/** Ordering and projection cannot change aggregate membership. */
function signature(query: Query): string {
  return JSON.stringify([query.set, query.relationship, query.filter, query.compute]);
}
