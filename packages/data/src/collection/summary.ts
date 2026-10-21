import { batch, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { Query } from "../criteria/ast.ts";
import { toApply, type Aggregate } from "../criteria/compile.ts";
import { relatedOf, resolveRelative } from "../criteria/relative.ts";
import type { ODataSource } from "../odata/source.ts";
import type { Value } from "../schema/model.ts";
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
    this.#related = relatedSets(this.#query.filter, source.schema.set(this.#query.set).type, source.schema);
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
        this.#related = relatedSets(q.filter, source.schema.set(q.set).type, source.schema);
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
      const type = this.#source.schema.set(q.set).type;
      const filter = q.filter ? resolveRelative(q.filter, type, this.#now(), relatedOf(this.#source.schema, type)) : undefined;
      const rows = await this.#source.aggregate(q.set, { ...(filter ? { filter } : {}), aggregates: this.#aggregates });
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

  #validate(): void {
    const set = this.#source.schema.set(this.#query.set);
    const criteria = this.#query.filter;
    const filter = criteria ? resolveRelative(criteria, set.type, this.#now(), relatedOf(this.#source.schema, set.type)) : undefined;
    toApply(set.type, filter, [], this.#aggregates, set, this.#source.schema);
  }
}

/** Ordering and projection cannot change aggregate membership. */
function signature(query: Query): string {
  return JSON.stringify([query.set, query.filter]);
}
