import { batch, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { Criteria, Query } from "../criteria/ast.ts";
import { sameQuery } from "../criteria/compile.ts";
import { relatedOf, resolveRelative } from "../criteria/relative.ts";
import type { Aggregate } from "../criteria/compile.ts";
import type { ODataSource } from "../odata/source.ts";
import type { Value } from "../schema/model.ts";
import { relatedSets } from "./collection.ts";
import type { RecordStore } from "../store/store.ts";

export interface GroupRow {
  /** The group's value; null is a group of its own. */
  readonly value: Value;
  readonly count: number;
  /** Each aggregate by its alias. */
  readonly totals: Readonly<Record<string, Value>>;
}

const RECOUNT_DELAY = 50;

/**
 * The groups of a query by one field, with counts and aggregates, computed
 * by the server (`$apply`) in one request. They follow the query, and any
 * change to the set recounts them, shortly after, once per burst.
 */
export class Groups {
  readonly field: string;
  readonly #source: ODataSource;
  readonly #aggregates: readonly Aggregate[];
  readonly #rows = signal<readonly GroupRow[] | undefined>(undefined);
  readonly #error = signal<unknown>(undefined);
  readonly #status = signal<"loading" | "idle" | "error">("loading");
  readonly #stop: (() => void)[] = [];
  #query: Query;
  #related: ReadonlySet<string>;
  #generation = 0;
  #disposed = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** In the group value's order; `undefined` until the first answer. */
  readonly rows: ReadonlySignal<readonly GroupRow[] | undefined> = this.#rows;
  readonly error: ReadonlySignal<unknown> = this.#error;
  /** The state of the current grouped request. */
  readonly status: ReadonlySignal<"loading" | "idle" | "error"> = this.#status;

  readonly #now: () => number;

  #resolved(filter: Criteria): Criteria {
    const type = this.#source.schema.set(this.#query.set).type;
    return resolveRelative(filter, type, this.#now(), relatedOf(this.#source.schema, type));
  }

  constructor(
    store: RecordStore,
    source: ODataSource,
    query: Query | ReadonlySignal<Query>,
    field: string,
    aggregates: readonly Aggregate[] = [],
    now: () => number = Date.now,
  ) {
    this.#source = source;
    this.#now = now;
    this.field = field;
    this.#aggregates = aggregates;
    const follow = "set" in query ? undefined : query;
    this.#query = follow ? follow.peek() : (query as Query);
    this.#related = relatedSets(this.#query.filter, source.schema.set(this.#query.set).type, source.schema);
    source.schema.set(this.#query.set).type.field(field) ?? fail(`${this.#query.set} has no field ${field}`);
    this.#stop.push(
      store.subscribe((change) => {
        if ((change.set === this.#query.set || this.#related.has(change.set)) && change.origin.kind !== "fetch") this.#soon();
      }),
    );
    if (follow) {
      this.#stop.push(
        effect(() => {
          const q = follow.value;
          untracked(() => {
            if (sameQuery(q, this.#query)) return;
            this.#query = q;
            this.#related = relatedSets(q.filter, source.schema.set(q.set).type, source.schema);
            this.#rows.value = undefined;
            void this.refresh();
          });
        }),
      );
    }
    void this.refresh();
  }

  get query(): Query {
    return this.#query;
  }

  async refresh(): Promise<void> {
    if (this.#disposed) return;
    clearTimeout(this.#timer);
    const generation = ++this.#generation;
    batch(() => { this.#status.value = "loading"; this.#error.value = undefined; });
    try {
      const rows = await this.#source.aggregate(this.#query.set, {
        ...(this.#query.filter ? { filter: this.#resolved(this.#query.filter) } : {}),
        groupBy: [this.field],
        aggregates: this.#aggregates,
        // Groups follow the sort's direction on their field, ascending otherwise.
        orderBy: [{ field: this.field, ...(this.#query.orderBy?.find((k) => k.field === this.field)?.descending ? { descending: true } : {}) }],
      });
      if (generation !== this.#generation) return;
      const previous = this.#rows.peek();
      const byValue = new Map(previous?.map(row => [JSON.stringify(row.value), row]));
      const result = rows.map((r) => {
        const totals: Record<string, Value> = {};
        for (const a of this.#aggregates) totals[a.as] = r[a.as] ?? null;
        const value = r[this.field] ?? null;
        const count = Number(r.count ?? 0);
        const before = byValue.get(JSON.stringify(value));
        return before && before.count === count && JSON.stringify(before.totals) === JSON.stringify(totals)
          ? before : { value, count, totals };
      });
      const unchanged = previous?.length === result.length && result.every((row, i) => row === previous[i]);
      batch(() => { this.#rows.value = unchanged ? previous : result; this.#status.value = "idle"; });
    } catch (e) {
      if (generation === this.#generation) batch(() => { this.#error.value = e; this.#status.value = "error"; });
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation++;
    clearTimeout(this.#timer);
    for (const stop of this.#stop.splice(0)) stop();
  }

  #soon(): void {
    this.#generation++;
    this.#status.value = "loading";
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.refresh(), RECOUNT_DELAY);
  }
}

function fail(message: string): never {
  throw new Error(message);
}
