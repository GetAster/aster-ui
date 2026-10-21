import { batch, computed, signal, type ReadonlySignal } from "@preact/signals-core";
import type { Criteria, Query } from "../criteria/ast.ts";
import { isPath } from "../criteria/compile.ts";
import { matches, sortComparator } from "../criteria/evaluate.ts";
import { hasRelative, relatedOf, resolveRelative } from "../criteria/relative.ts";
import type { Entity, EntityType, Schema } from "../schema/model.ts";
import type { ODataSource } from "../odata/source.ts";
import type { KeyText } from "../store/keys.ts";
import type { RecordStore, StoreChange, StoredRecord } from "../store/store.ts";

export type CollectionStatus = "idle" | "loading" | "error";

export interface CollectionOptions {
  readonly pageSize?: number;
  /** Loaded pages kept as `view` moves; those farthest from view are forgotten. 20 by default. */
  readonly keepPages?: number;
  /** The clock a filter's relative dates resolve against, at each fetch and each local placement. */
  readonly now?: () => number;
  /**
   * Ask for an exact count (`Prefer: aster.count=exact`) where the server
   * would estimate it or leave it out, for a total that matters, such as a
   * figure on a dashboard. It costs the server a full count.
   */
  readonly exactCount?: boolean;
}

/**
 * A query plus the positions of its results that are loaded. `keys[i]` is
 * the record at server position `i`, or `undefined` where nothing is loaded.
 *
 * Invariant: loaded positions are in the query's sort order, and
 * `keys.length` equals the server's count whenever the count is known.
 *
 * A server may leave the count out (a large set, loaded progressively).
 * `count` is then the rows loaded so far plus a page more while the last
 * page came back full, and `counted` is false until a short page shows
 * where the results end.
 *
 * A server may also estimate it (`estimated`). The estimate sizes the
 * layout as the query's first count; later pages' estimates are ignored, so
 * one that drifts never starts the collection over. A short page replaces
 * it with the real end; pages that run past it, or an empty page before
 * it, turn it into a progressive count.
 */
export class Collection {
  readonly type: EntityType;
  readonly pageSize: number;
  readonly keepPages: number;
  readonly #store: RecordStore;
  readonly #source: ODataSource;
  #query: Query;
  readonly #queryVersion = signal(0);
  /** Undefined when the sort follows a path: the related values aren't here to compare. */
  #compare: ((a: Entity, b: Entity) => number) | undefined;
  /** The fields the filter and sort read; a record must have them current to be placed. */
  #reads: readonly string[];
  /** The filter reads related records (`any`, `all`, `via`). */
  #lambda: boolean;
  /** The sets those related records are in; a change there may change membership here. */
  #related: ReadonlySet<string>;
  readonly #now: () => number;
  readonly #exact: boolean;
  #slots: (KeyText | undefined)[] = [];
  /** Bumped by every refresh, so responses to older requests are dropped. */
  #generation = 0;
  readonly #inflight = new Map<number, Promise<void>>();
  #pending = 0;
  /** The range last shown through `view`; refreshes reload only its pages. */
  #viewed: { readonly start: number; readonly end: number; readonly retain: readonly number[] } | undefined;

  readonly #keys = signal<readonly (KeyText | undefined)[]>([]);
  readonly #count = signal<number | undefined>(undefined);
  readonly #counted = signal(false);
  readonly #estimated = signal(false);
  readonly #status = signal<CollectionStatus>("idle");
  readonly #error = signal<unknown>(undefined);
  readonly #stale = signal(false);

  readonly keys: ReadonlySignal<readonly (KeyText | undefined)[]> = this.#keys;
  /** The server's total for the query; `undefined` until the first page arrives. */
  readonly count: ReadonlySignal<number | undefined> = this.#count;
  /** `count` is the server's total, or the end has been reached; otherwise more may follow. */
  readonly counted: ReadonlySignal<boolean> = this.#counted;
  /** `count` is the server's estimate: right for sizing a scrollbar, not for stating as a fact. */
  readonly estimated: ReadonlySignal<boolean> = this.#estimated;
  readonly status: ReadonlySignal<CollectionStatus> = this.#status;
  readonly error: ReadonlySignal<unknown> = this.#error;
  /** A change arrived whose position couldn't be decided locally; a refresh is running or due. */
  readonly stale: ReadonlySignal<boolean> = this.#stale;
  readonly complete = computed(() => this.#counted.value && this.#keys.value.every((k) => k !== undefined));
  /** Entities by position, reading each record's signal so views follow edits. */
  readonly items: ReadonlySignal<readonly (Entity | undefined)[]>;

  constructor(store: RecordStore, source: ODataSource, query: Query, options: CollectionOptions = {}) {
    this.pageSize = options.pageSize ?? 100;
    this.keepPages = options.keepPages ?? 20;
    this.#now = options.now ?? Date.now;
    this.#exact = options.exactCount ?? false;
    this.#store = store;
    this.#source = source;
    this.type = store.schema.set(query.set).type;
    this.#query = query;
    this.#compare = comparatorFor(query, this.type);
    this.#reads = readsOf(query);
    this.#lambda = hasLambda(query.filter);
    this.#related = relatedSets(query.filter, this.type, store.schema);
    const set = query.set;
    this.items = computed(() =>
      this.#keys.value.map((k) => (k === undefined ? undefined : store.record(set, k).value?.entity)),
    );
  }

  get query(): Query {
    this.#queryVersion.value;
    return this.#query;
  }

  /** A loaded position, including its hidden fields. Reads only that record's signal. */
  recordAt(index: number): StoredRecord | undefined {
    const key = this.#keys.value[index];
    return key === undefined ? undefined : this.#store.record(this.query.set, key).value;
  }

  /** Known membership, or undefined where unloaded/hidden/related fields prevent a local decision. */
  has(key: KeyText): boolean | undefined {
    if (this.#keys.value.includes(key)) return true;
    if (this.#count.value === undefined) return undefined;
    if (this.complete.value) return false;
    const stored = this.#store.record(this.query.set, key).value;
    if (!stored) return false;
    const filter = this.#resolved().filter;
    if (!filter) return true;
    if (this.#lambda || fieldsOf(filter).some((field) => isPath(field) || stored.hidden?.has(field) || (stored.known && !stored.known.has(field)))) return undefined;
    return matches(filter, stored.entity, this.type);
  }

  /**
   * Replaces the query (same entity set). The rows go at once, so nothing
   * from the old query shows as an answer to the new one. Only the first
   * page loads again: a view asks for the rows it shows, and reloading
   * everything that was loaded deep down would cost a request per page.
   */
  setQuery(query: Query): void {
    if (query.set !== this.#query.set) throw new Error(`a collection stays on ${this.#query.set}; got ${query.set}`);
    const wanted = this.#pending > 0 || this.#count.peek() !== undefined;
    this.#query = query;
    this.#compare = comparatorFor(query, this.type);
    this.#reads = readsOf(query);
    this.#lambda = hasLambda(query.filter);
    this.#related = relatedSets(query.filter, this.type, this.#store.schema);
    this.#generation++;
    this.#inflight.clear();
    this.#slots = [];
    this.#viewed = undefined;
    batch(() => {
      this.#count.value = undefined;
      this.#counted.value = false;
      this.#estimated.value = false;
      this.#stale.value = false;
      this.#publish();
      this.#queryVersion.value++;
    });
    if (wanted) this.ensure(0, this.pageSize).catch(() => {});
  }

  /** Loads every page touching `[start, end)`. */
  async ensure(start: number, end: number): Promise<void> {
    const generation = this.#generation;
    if (this.#count.peek() === undefined) await this.#loadPage(0);
    if (generation !== this.#generation) return;
    const count = this.#count.peek() ?? 0;
    const pages = new Set<number>();
    for (let i = Math.max(0, start); i < Math.min(end, count); i++) {
      if (this.#slots[i] === undefined) pages.add(Math.floor(i / this.pageSize));
    }
    const running = [...pages].flatMap((p) => this.#inflight.get(p) ?? []);
    const missing = [...pages].filter((p) => !this.#inflight.has(p));
    await Promise.all([...running, ...runsOf(missing).map(([first, n]) => this.#loadPages(first, n))]);
  }

  /**
   * Shows `[start, end)`: loads its pages, then the next page in the
   * direction of travel without waiting for it, and forgets loaded pages
   * farthest from view beyond `keepPages`. A refresh then reloads only the
   * viewed pages.
   */
  async view(start: number, end: number, retain: readonly number[] = []): Promise<void> {
    const back = this.#viewed !== undefined && start < this.#viewed.start;
    const viewed = { start, end, retain: [...new Set(retain.filter((i) => Number.isSafeInteger(i) && i >= 0))] };
    this.#viewed = viewed;
    await this.ensure(start, end);
    if (this.#viewed !== viewed) return;
    this.#forget(start, end, viewed.retain);
    const ahead = back ? [Math.max(0, start - this.pageSize), start] : [end, end + this.pageSize];
    const count = this.#count.peek() ?? 0;
    const pages = (from: number, to: number): number[] => {
      const first = Math.floor(Math.max(0, from) / this.pageSize);
      const last = Math.floor((Math.min(count, to) - 1) / this.pageSize);
      return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
    };
    const protectedPages = new Set([
      ...pages(start, end),
      ...viewed.retain.filter((i) => i < count).map((i) => Math.floor(i / this.pageSize)),
    ]);
    // Prefetch only pages that can survive eviction; publishing an evicted page
    // otherwise makes a reactive view request that same page indefinitely.
    const extra = pages(ahead[0]!, ahead[1]!).filter((p) => !protectedPages.has(p));
    if (protectedPages.size + extra.length > this.keepPages) return;
    void this.ensure(ahead[0]!, ahead[1]!)
      .then(() => this.#viewed === viewed && this.#forget(start, end, viewed.retain))
      .catch(() => {});
  }

  /** Drops loaded pages beyond `keepPages`, farthest from `[start, end)` first. */
  #forget(start: number, end: number, retain: readonly number[]): void {
    const first = Math.floor(start / this.pageSize);
    const last = Math.floor(Math.max(start, end - 1) / this.pageSize);
    const pinned = new Set(retain.map((i) => Math.floor(i / this.pageSize)));
    const loaded = new Set<number>();
    this.#slots.forEach((k, i) => k !== undefined && loaded.add(Math.floor(i / this.pageSize)));
    if (loaded.size <= this.keepPages) return;
    const distance = (p: number) => pinned.has(p) ? 0 : (p < first ? first - p : p > last ? p - last : 0);
    const drop = [...loaded].sort((a, b) => distance(b) - distance(a)).slice(0, loaded.size - this.keepPages);
    let forgotten = false;
    for (const p of drop) {
      if (distance(p) === 0 || this.#inflight.has(p)) continue;
      for (let i = p * this.pageSize; i < Math.min((p + 1) * this.pageSize, this.#slots.length); i++) this.#slots[i] = undefined;
      forgotten = true;
    }
    if (forgotten) this.#publish();
  }

  /** Loads every page; without a server count, page after page until one comes back short. */
  async loadAll(): Promise<void> {
    do await this.ensure(0, Number.POSITIVE_INFINITY);
    while (!this.#counted.peek());
  }

  /**
   * Refetches what's shown, keeping current rows visible until the answers
   * arrive: the viewed pages if `view` has been used, otherwise every loaded
   * page. Pages it doesn't refetch are forgotten, as they may be stale.
   */
  refresh(): Promise<void> {
    return this.#refreshWindow([]);
  }

  async #refreshWindow(additional: readonly number[]): Promise<void> {
    const loadedPages = new Set<number>(additional);
    const viewed = this.#viewed;
    if (viewed) {
      for (const i of viewed.retain) loadedPages.add(Math.floor(i / this.pageSize));
      const last = Math.max(viewed.start, viewed.end - 1);
      for (let p = Math.floor(viewed.start / this.pageSize); p <= Math.floor(last / this.pageSize); p++) loadedPages.add(p);
    } else {
      this.#slots.forEach((k, i) => k !== undefined && loadedPages.add(Math.floor(i / this.pageSize)));
    }
    if (loadedPages.size === 0) loadedPages.add(0);
    this.#generation++;
    this.#inflight.clear();
    const generation = this.#generation;
    const runs = await Promise.all(runsOf([...loadedPages]).map(([first, n]) => this.#fetchPages(first, n, generation)));
    if (generation !== this.#generation) return;
    const fresh = runs.flatMap((r) => (r ? this.#slices(r) : []));
    if (fresh.length === 0) return;
    const answer = runs.find((r) => r?.count !== undefined);
    // Without an exact count, the end found before stands until a short page moves it.
    const { count, counted, estimated } = this.#settle(fresh, answer?.count, answer?.estimated ?? false);
    this.#slots = [];
    this.#resize(count);
    for (const p of fresh) this.#fill(p.page, p.keys);
    batch(() => {
      this.#count.value = count;
      this.#counted.value = counted;
      this.#estimated.value = estimated;
      this.#stale.value = false;
      this.#publish();
    });
  }

  /**
   * Applies a store change: the record leaves, moves or joins
   * the collection when its new position is certain from loaded neighbours;
   * otherwise the collection goes stale and refreshes.
   */
  apply(change: StoreChange): void {
    batch(() => this.#apply(change));
  }

  #apply(change: StoreChange): void {
    if (change.set !== this.query.set) {
      if (this.#related.has(change.set) && change.origin.kind !== "fetch" && this.#count.peek() !== undefined) this.#goStale();
      return;
    }
    if (change.origin.kind === "fetch" && change.origin.collection === this) return;
    if (this.#count.peek() === undefined) return;
    // A record another query fetched, new to the store, already existed on
    // the server: this collection's count includes it if it belongs, so
    // unless it's a loaded row there is nothing to place.
    if (change.origin.kind === "fetch" && change.before === undefined && !this.#slots.includes(change.key)) return;
    const known = change.after?.known;
    if (known && this.#reads.some((f) => !known.has(f))) {
      this.#goStale();
      return;
    }
    const after = change.after?.entity;
    // A filter over related records can't be decided from this record alone.
    if (this.#lambda) {
      this.#goStale();
      return;
    }
    const filter = this.#resolved().filter;
    const belongs = after !== undefined && (!filter || matches(filter, after, this.type));
    const at = this.#slots.indexOf(change.key);
    if (at < 0 && !belongs) return;
    const count = this.#count.peek();
    if (at >= 0) {
      this.#slots.splice(at, 1);
      if (count !== undefined) this.#count.value = count - 1;
    }
    if (belongs) {
      const place = this.#certainPosition(after);
      if (place === undefined) {
        // Keep the last confirmed position until the server settles a move.
        if (at >= 0) {
          this.#slots.splice(at, 0, change.key);
          this.#count.value = count;
        }
        this.#publish();
        this.#goStale();
        return;
      }
      this.#slots.splice(place, 0, change.key);
      const c = this.#count.peek();
      if (c !== undefined) this.#count.value = c + 1;
    }
    this.#publish();
  }

  /**
   * The position `entity` takes, if loaded neighbours prove it: its loaded
   * successor's predecessor slot is loaded too (or it's first), or it sorts
   * after the loaded last row.
   */
  #certainPosition(entity: Entity): number | undefined {
    if (this.#compare === undefined) return undefined;
    const slots = this.#slots;
    let next = -1;
    for (let i = 0; i < slots.length; i++) {
      const k = slots[i];
      if (k === undefined) continue;
      const other = this.#store.get(this.query.set, k)?.entity;
      if (other && this.#compare(entity, other) < 0) {
        next = i;
        break;
      }
    }
    if (next === 0) return 0;
    if (next > 0) return slots[next - 1] !== undefined ? next : undefined;
    if (slots.length === 0) return this.#count.peek() === undefined ? undefined : 0;
    return slots[slots.length - 1] !== undefined ? slots.length : undefined;
  }

  /**
   * Refreshes to settle a change whose position isn't certain. A failed
   * refresh leaves the collection stale with `error` set.
   */
  #goStale(): void {
    this.#stale.value = true;
    if (this.#refreshing) return;
    // Changes that arrive together share one refresh.
    this.#refreshing = true;
    queueMicrotask(() => {
      this.#refreshing = false;
      this.refresh().catch(() => {});
    });
  }

  #refreshing = false;

  #loadPage(page: number): Promise<void> {
    return this.#inflight.get(page) ?? this.#loadPages(page, 1);
  }

  /** Loads `n` adjacent pages from `first` in one request; each page counts as in flight until it's done. */
  #loadPages(first: number, n: number): Promise<void> {
    const generation = this.#generation;
    const task = this.#fetchPages(first, n, generation)
      .then(async (result) => {
        if (!result || generation !== this.#generation) return;
        // A changed count invalidates offsets; replace the visible window together.
        if (result.count !== undefined && !result.estimated && this.#counted.peek() && result.count !== this.#count.peek()) {
          this.#stale.value = true;
          await this.#refreshWindow(Array.from({ length: n }, (_, i) => first + i));
          return;
        }
        const { count, counted, estimated } = this.#settle(this.#slices(result), result.count, result.estimated);
        this.#resize(count);
        this.#fill(first, result.keys);
        batch(() => {
          this.#count.value = count;
          this.#counted.value = counted;
          this.#estimated.value = estimated;
          this.#publish();
        });
      })
      .finally(() => {
        for (let p = first; p < first + n; p++) if (this.#inflight.get(p) === task) this.#inflight.delete(p);
      });
    for (let p = first; p < first + n; p++) this.#inflight.set(p, task);
    return task;
  }

  /** A run's keys as one entry per page, for the count's extent. */
  #slices(run: { readonly first: number; readonly pages: number; readonly keys: readonly KeyText[] }): Slice[] {
    return Array.from({ length: run.pages }, (_, i) => ({
      page: run.first + i,
      keys: run.keys.slice(i * this.pageSize, (i + 1) * this.pageSize),
    }));
  }

  async #fetchPages(first: number, pages: number, generation: number) {
    this.#pending++;
    this.#status.value = "loading";
    try {
      const result = await this.#source.query(this.#resolved(), {
        skip: first * this.pageSize,
        top: pages * this.pageSize,
        count: true,
        exact: this.#exact,
      });
      if (generation !== this.#generation) return undefined;
      const keys = this.#store.putAll(
        this.query.set,
        result.records,
        { kind: "fetch", collection: this },
        this.query.select,
      );
      this.#error.value = undefined;
      return { first, pages, keys, count: result.count, estimated: result.estimated ?? false };
    } catch (e) {
      if (generation === this.#generation) {
        this.#error.value = e;
      }
      throw e;
    } finally {
      this.#pending--;
      this.#status.value = this.#error.peek() ? "error" : this.#pending ? "loading" : "idle";
    }
  }

  /** The query with relative dates resolved to now. */
  #resolved(): Query {
    const q = this.query;
    return q.filter && hasRelative(q.filter) ? { ...q, filter: resolveRelative(q.filter, this.type, this.#now(), relatedOf(this.#store.schema, this.type)) } : q;
  }

  #fill(page: number, keys: readonly KeyText[]): void {
    const start = page * this.pageSize;
    keys.forEach((k, i) => {
      const elsewhere = this.#slots.indexOf(k);
      if (elsewhere >= 0 && elsewhere !== start + i) this.#slots[elsewhere] = undefined;
      this.#slots[start + i] = k;
    });
  }

  /**
   * The length to lay out after an answer of `pages`. An exact count is it;
   * otherwise a short page that ends the results is. An estimate counts only
   * as the query's first count. Otherwise the length stands while loaded
   * pages stay inside it, and grows a page past the last one that ran past
   * it (progressive loading). An empty page past what's loaded shows only
   * that the end comes before it, so the length shrinks to what's loaded
   * and a page more.
   */
  #settle(pages: readonly Slice[], total: number | undefined, estimate: boolean): { count: number; counted: boolean; estimated: boolean } {
    if (total !== undefined && !estimate) return { count: total, counted: true, estimated: false };
    const size = this.pageSize;
    const short = pages.find((p) => p.keys.length < size);
    const at = short ? short.page * size : 0;
    const follows = (page: number) => page === 0 || this.#slots[page * size - 1] !== undefined || pages.some((p) => p.page === page - 1);
    if (short && (short.keys.length > 0 || follows(short.page))) return { count: at + short.keys.length, counted: true, estimated: false };
    const known = this.#count.peek();
    const first = known === undefined;
    const base = first ? (total ?? 0) : known;
    if (short) {
      // An empty page, but not right after a loaded one: the end is somewhere before it.
      const before = pages.filter((p) => p.page < short.page).map((p) => (p.page + 1) * size);
      const loaded = Math.max(this.#slots.findLastIndex((k) => k !== undefined) + 1, ...before);
      return { count: Math.min(at, loaded + size), counted: false, estimated: false };
    }
    const reach = (Math.max(...pages.map((p) => p.page)) + 1) * size;
    if (!first && reach <= base && this.#counted.peek()) return { count: base, counted: true, estimated: false };
    const estimated = first ? total !== undefined : this.#estimated.peek();
    if (estimated && reach < base) return { count: base, counted: false, estimated: true };
    return { count: Math.max(base, reach + size), counted: false, estimated: false };
  }

  #resize(count: number): void {
    while (this.#slots.length < count) this.#slots.push(undefined);
    this.#slots.length = count;
  }

  #publish(): void {
    const previous = this.#keys.peek();
    if (previous.length === this.#slots.length) {
      let equal = true;
      for (let i = 0; i < previous.length; i++) if (previous[i] !== this.#slots[i]) { equal = false; break; }
      if (equal) return;
    }
    this.#keys.value = Array.from(this.#slots);
  }
}

/** One page of an answer: its index and the keys it held. */
interface Slice {
  readonly page: number;
  readonly keys: readonly KeyText[];
}

/** Adjacent pages as `[first, count]` runs of at most `max`, so a view that straddles pages costs one request. */
function runsOf(pages: readonly number[], max = 5): [number, number][] {
  const runs: [number, number][] = [];
  for (const p of [...pages].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[0] + last[1] === p && last[1] < max) last[1]++;
    else runs.push([p, 1]);
  }
  return runs;
}

function readsOf(query: Query): string[] {
  const own = (query.orderBy ?? []).map((s) => s.field).filter((f) => !isPath(f));
  return [...new Set([...(query.filter ? fieldsOf(query.filter) : []), ...own])];
}

function comparatorFor(query: Query, type: EntityType): ((a: Entity, b: Entity) => number) | undefined {
  const sort = query.orderBy ?? [];
  return sort.some((k) => isPath(k.field)) ? undefined : sortComparator(sort, type);
}

function hasLambda(c: Criteria | undefined): boolean {
  if (!c) return false;
  switch (c.op) {
    case "and":
    case "or":
      return c.args.some(hasLambda);
    case "not":
      return hasLambda(c.arg);
    case "any":
    case "all":
    case "via":
      return true;
    default:
      return false;
  }
}

/** The entity sets a filter reaches through `any`, `all` and `via`, at any depth. */
export function relatedSets(c: Criteria | undefined, type: EntityType, schema: Schema): ReadonlySet<string> {
  const out = new Set<string>();
  const walk = (c: Criteria, type: EntityType): void => {
    switch (c.op) {
      case "and":
      case "or":
        return c.args.forEach((a) => walk(a, type));
      case "not":
        return walk(c.arg, type);
      case "any":
      case "all":
      case "via": {
        const nav = type.navigation(c.field);
        if (!nav) return;
        out.add(nav.target);
        return walk(c.where, schema.set(nav.target).type);
      }
      default:
        return;
    }
  };
  if (c) walk(c, type);
  return out;
}

function fieldsOf(c: Criteria): string[] {
  switch (c.op) {
    case "and":
    case "or":
      return c.args.flatMap(fieldsOf);
    case "not":
      return fieldsOf(c.arg);
    default:
      return "other" in c ? [c.field, c.other] : [c.field];
  }
}
