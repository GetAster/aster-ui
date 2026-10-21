import { computed, effect, untracked, type ReadonlySignal } from "@preact/signals-core";
import { creatable, invert, writable, type ChangeSet, type FieldChange } from "./changes/changeset.ts";
import { Collection, type CollectionOptions } from "./collection/collection.ts";
import { Summary } from "./collection/summary.ts";
import { Groups } from "./collection/groups.ts";
import { Grouping, type GroupingOptions } from "./collection/grouping.ts";
import { sameQuery, type Aggregate } from "./criteria/compile.ts";
import type { Query } from "./criteria/ast.ts";
import { ODataError } from "./odata/errors.ts";
import { ODataSource, type Deltas } from "./odata/source.ts";
import type { Entity, Schema, Value } from "./schema/model.ts";
import { keyFromText, keyText, keyValues, type KeyText } from "./store/keys.ts";
import { RecordStore, type StoredRecord } from "./store/store.ts";
import type { Transport } from "./transport.ts";

export interface Saved {
  readonly key: KeyText;
  readonly record: StoredRecord;
  /** What the save did, for undo and change logs. */
  readonly change: ChangeSet;
}

/**
 * One client's view of a service: the store, every live collection, and the
 * writes that keep them in step. All writes go through here so sync sees them.
 */
export class DataContext {
  readonly source: ODataSource;
  readonly store: RecordStore;
  readonly #collections = new Set<Collection>();
  /** Stops a collection following its query signal. */
  readonly #following = new Map<Collection, () => void>();
  /** Keys asked for through `lookup` and not yet answered, by set. */
  readonly #wanted = new Map<string, Set<KeyText>>();
  readonly #requested = new Set<string>();

  /** The clock relative dates in queries are resolved against, at each fetch. */
  readonly now: () => number;

  constructor(source: ODataSource, options: { now?: () => number } = {}) {
    this.source = source;
    this.now = options.now ?? Date.now;
    this.store = new RecordStore(source.schema);
    this.store.subscribe((change) => {
      for (const c of this.#collections) c.apply(change);
    });
  }

  static async connect(transport: Transport, options: { now?: () => number } = {}): Promise<DataContext> {
    return new DataContext(await ODataSource.connect(transport), options);
  }

  get schema(): Schema {
    return this.source.schema;
  }

  /**
   * A live collection. Given a signal, the collection follows it: each new
   * query replaces the rows and loads again.
   */
  collection(query: Query | ReadonlySignal<Query>, options?: CollectionOptions): Collection {
    const following = "set" in query ? undefined : query;
    const c = new Collection(this.store, this.source, following ? following.peek() : (query as Query), { now: this.now, ...options });
    this.#collections.add(c);
    if (following) {
      this.#following.set(
        c,
        effect(() => {
          const q = following.value;
          untracked(() => !sameQuery(q, c.query) && c.setQuery(q));
        }),
      );
    }
    return c;
  }

  /** Live group counts and aggregates of a query by one field; `dispose()` them when done. */
  groups(query: Query | ReadonlySignal<Query>, field: string, aggregates: readonly Aggregate[] = []): Groups {
    return new Groups(this.store, this.source, query, field, aggregates, this.now);
  }

  /** A lazy hierarchy of grouped queries and paged leaf records. Dispose when done. */
  grouping(query: Query | ReadonlySignal<Query>, fields: readonly string[], aggregates: readonly Aggregate[] = [], options: GroupingOptions = {}): Grouping {
    return new Grouping(this, query, fields, aggregates, options);
  }

  /** Exact query totals; dispose when the consuming view closes. */
  summary(query: Query | ReadonlySignal<Query>, aggregates: readonly Aggregate[] = []): Summary {
    return new Summary(this.store, this.source, query, aggregates, this.now);
  }

  /** Stops syncing a collection, and following its query. */
  release(collection: Collection): void {
    this.#collections.delete(collection);
    this.#following.get(collection)?.();
    this.#following.delete(collection);
  }

  /**
   * One record by key, for showing a foreign key's display value. A record
   * that isn't in the store is fetched; lookups made in the same task share
   * one request per set.
   */
  lookup(set: string, key: KeyText): ReadonlySignal<Entity | undefined> {
    const id = `${set} ${key}`;
    if (!this.store.get(set, key) && !this.#requested.has(id)) {
      this.#requested.add(id);
      let keys = this.#wanted.get(set);
      if (!keys) {
        keys = new Set();
        this.#wanted.set(set, keys);
        queueMicrotask(() => void this.#fetchWanted(set));
      }
      keys.add(key);
    }
    const record = this.store.record(set, key);
    return computed(() => record.value?.entity);
  }

  async create(set: string, values: Entity, by?: object): Promise<Saved> {
    const type = this.schema.set(set).type;
    const sent = creatable(type, values);
    const record = await this.source.create(set, sent);
    const key = this.store.put(set, record, save(by));
    return { key, record, change: { kind: "create", set, values: sent } };
  }

  /**
   * Sends only `changes`, with `ifMatch` or else the stored record's ETag.
   * `deltas` changes owned collections in the same request (deep update).
   */
  async update(set: string, key: KeyText, changes: Entity, by?: object, ifMatch?: string, deltas?: Deltas): Promise<Saved> {
    const before = this.#require(set, key);
    const record = await this.#guard(set, key, () =>
      this.source.update(set, keyFromText(key), changes, ifMatch ?? before.etag, deltas),
    );
    this.store.put(set, record, save(by));
    const fieldChanges: Record<string, FieldChange> = {};
    for (const [name, to] of Object.entries(changes)) fieldChanges[name] = { from: before.entity[name] ?? null, to };
    return { key, record, change: { kind: "update", set, key: keyFromText(key), changes: fieldChanges } };
  }

  async remove(set: string, key: KeyText, by?: object, ifMatch?: string): Promise<ChangeSet> {
    const before = this.#require(set, key);
    await this.#guard(set, key, () => this.source.delete(set, keyFromText(key), ifMatch ?? before.etag));
    this.store.remove(set, key, save(by));
    // A hidden field's `null` isn't what was stored, so an undo mustn't write it back.
    const values = before.hidden ? Object.fromEntries(Object.entries(before.entity).filter(([f]) => !before.hidden!.has(f))) : before.entity;
    return { kind: "delete", set, key: keyFromText(key), values };
  }

  /** Reads one record again; a record that's gone is removed. */
  async reload(set: string, key: KeyText, origin: "fetch" | "external" = "fetch"): Promise<StoredRecord | undefined> {
    try {
      const record = await this.source.get(set, keyFromText(key));
      this.store.put(set, record, { kind: origin });
      return record;
    } catch (e) {
      if (e instanceof ODataError && e.status === 404) {
        this.store.remove(set, key, { kind: origin });
        return undefined;
      }
      throw e;
    }
  }

  /**
   * Runs a change set, such as the inverse of an earlier save. `ifMatch`
   * pins an update or delete to that version instead of the stored one.
   */
  async run(change: ChangeSet, by?: object, ifMatch?: string): Promise<Saved | ChangeSet> {
    switch (change.kind) {
      case "create":
        return this.create(change.set, change.values, by);
      case "update": {
        const to: Record<string, Value> = {};
        for (const [name, c] of Object.entries(change.changes)) to[name] = c.to;
        const type = this.schema.set(change.set).type;
        const key = keyText(change.key);
        return this.update(change.set, key, writable(type, to), by, ifMatch);
      }
      case "delete":
        return this.remove(change.set, keyText(change.key), by, ifMatch);
    }
  }

  /**
   * Undoes a save. Given the `Saved`, the inverse is pinned to the version
   * that save produced, so a change someone made since is a 412, not
   * overwritten.
   */
  undo(saved: Saved | ChangeSet, by?: object): Promise<Saved | ChangeSet> {
    const change = "change" in saved ? saved.change : saved;
    const type = this.schema.set(change.set).type;
    const created = "record" in saved ? keyValues(type, saved.record.entity) : undefined;
    return this.run(invert(change, type, created), by, "record" in saved ? saved.record.etag : undefined);
  }

  async #fetchWanted(set: string): Promise<void> {
    const keys = [...(this.#wanted.get(set) ?? [])];
    this.#wanted.delete(set);
    const type = this.schema.set(set).type;
    const [keyField] = type.key;
    try {
      if (type.key.length === 1 && keyField !== undefined) {
        const values = keys.map((k) => keyFromText(k)[0]!);
        const page = await this.source.query({ set, filter: { op: "in", field: keyField, values } }, { top: values.length });
        this.store.putAll(set, page.records, { kind: "fetch" });
      } else {
        await Promise.all(keys.map((k) => this.reload(set, k)));
      }
    } catch {
      // The records stay missing; a later lookup asks again.
      for (const k of keys) this.#requested.delete(`${set} ${k}`);
    }
  }

  #require(set: string, key: KeyText): StoredRecord {
    const record = this.store.get(set, key);
    if (!record) throw new Error(`${set} ${key} isn't loaded`);
    return record;
  }

  /** On 412 the stored record is refreshed, so the caller can show what changed. */
  async #guard<T>(set: string, key: KeyText, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (e) {
      if (e instanceof ODataError && (e.status === 412 || e.status === 404)) await this.reload(set, key, "external");
      throw e;
    }
  }
}

function save(by: object | undefined) {
  return by ? ({ kind: "save", by } as const) : ({ kind: "save" } as const);
}
