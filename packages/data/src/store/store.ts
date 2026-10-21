import { batch, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import type { Entity, EntityType, Schema, Value } from "../schema/model.ts";
import { keyOf, type KeyText } from "./keys.ts";

export interface StoredRecord {
  readonly entity: Entity;
  /** Absent when the set has no `Core.OptimisticConcurrency`. */
  readonly etag?: string;
  /**
   * The fields known to be current, when the record came from a `$select`
   * and other fields may be missing or from an older version. Absent when
   * every field is current.
   */
  readonly known?: ReadonlySet<string>;
  /**
   * Fields the server hides from this caller on this record
   * (`@AsterData.Hidden`). Their value is `null`, which means "not yours to
   * see", not empty.
   *
   * Invariant: a hidden field is never in `known`, and a record with hidden
   * fields always has `known`. So everything that decides on a field only
   * when it's known (a collection placing a record, page rules) treats a
   * hidden one as unknown, and edit models never offer or send it.
   */
  readonly hidden?: ReadonlySet<string>;
}

/**
 * Where a change came from. Sync treats them alike except that a collection
 * never re-places a record it fetched itself: the server already put it there.
 */
export type Origin =
  | { readonly kind: "fetch"; readonly collection?: object }
  | { readonly kind: "save"; readonly by?: object }
  | { readonly kind: "external" };

export interface StoreChange {
  readonly set: string;
  readonly key: KeyText;
  readonly before: StoredRecord | undefined;
  readonly after: StoredRecord | undefined;
  readonly origin: Origin;
}

export type StoreListener = (change: StoreChange) => void;

/**
 * One normalized copy of every record the client holds, by set and key.
 *
 * Invariant: a record's signal and the listeners hear of a change in one
 * batch, so collections have placed or removed the record before any view
 * reads either.
 */
export class RecordStore {
  readonly #schema: Schema;
  readonly #sets = new Map<string, Map<KeyText, Signal<StoredRecord | undefined>>>();
  readonly #listeners = new Set<StoreListener>();

  constructor(schema: Schema) {
    this.#schema = schema;
  }

  get schema(): Schema {
    return this.#schema;
  }

  /** A signal for the record; `undefined` until it's loaded, and after it's removed. */
  record(set: string, key: KeyText): ReadonlySignal<StoredRecord | undefined> {
    return this.#slot(set, key);
  }

  get(set: string, key: KeyText): StoredRecord | undefined {
    return this.#sets.get(set)?.get(key)?.peek();
  }

  /**
   * Stores the record. With `fields` (a `$select`), the record holds only
   * those fields and is merged into the stored one, never blanking the rest.
   * No change is reported when values, ETag and known fields are unchanged.
   */
  put(set: string, record: StoredRecord, origin: Origin, fields?: readonly string[]): KeyText {
    const type = this.#schema.set(set).type;
    const key = keyOf(type, record.entity);
    const slot = this.#slot(set, key);
    const before = slot.peek();
    const merged: StoredRecord = fields ? partial(type, before, record, fields) : whole(type, record);
    if (
      before &&
      before.etag === merged.etag &&
      sameEntity(before.entity, merged.entity) &&
      sameSet(before.known, merged.known) &&
      sameSet(before.hidden, merged.hidden)
    ) {
      return key;
    }
    const after: StoredRecord = Object.freeze({
      entity: Object.freeze({ ...merged.entity }),
      ...etagOf(merged),
      ...(merged.known ? { known: merged.known } : {}),
      ...(merged.hidden ? { hidden: merged.hidden } : {}),
    });
    batch(() => {
      slot.value = after;
      this.#emit({ set, key, before, after, origin });
    });
    return key;
  }

  /** Stores many records, reporting changes after all are in place. */
  putAll(set: string, records: readonly StoredRecord[], origin: Origin, fields?: readonly string[]): KeyText[] {
    return batch(() => records.map((r) => this.put(set, r, origin, fields)));
  }

  remove(set: string, key: KeyText, origin: Origin): void {
    const slot = this.#sets.get(set)?.get(key);
    const before = slot?.peek();
    if (!slot || !before) return;
    batch(() => {
      slot.value = undefined;
      this.#emit({ set, key, before, after: undefined, origin });
    });
  }

  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #slot(set: string, key: KeyText): Signal<StoredRecord | undefined> {
    let records = this.#sets.get(set);
    if (!records) {
      this.#schema.set(set);
      records = new Map();
      this.#sets.set(set, records);
    }
    let slot = records.get(key);
    if (!slot) {
      slot = signal<StoredRecord | undefined>(undefined);
      records.set(key, slot);
    }
    return slot;
  }

  #emit(change: StoreChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}

/** A whole record: every field current except the hidden ones. */
function whole(type: EntityType, record: StoredRecord): StoredRecord {
  const hidden = record.hidden;
  if (!hidden?.size) return { entity: record.entity, ...etagOf(record) };
  const known = new Set(type.fields.map((f) => f.name).filter((f) => !hidden.has(f)));
  return { entity: blanked(record.entity, hidden), ...etagOf(record), known, hidden };
}

/**
 * A `$select` result merged over the stored record. The stored fields stay;
 * they're current only when the ETag is the same version. Without ETags
 * there are no versions to tell apart, so stored fields count as current.
 * The fields the result carries say whether they're hidden; the others stay
 * as last heard.
 */
function partial(
  type: EntityType,
  before: StoredRecord | undefined,
  record: StoredRecord,
  fields: readonly string[],
): StoredRecord {
  const hidden = new Set([...(before?.hidden ?? [])].filter((f) => !fields.includes(f)));
  for (const f of record.hidden ?? []) hidden.add(f);
  const entity = blanked({ ...before?.entity, ...record.entity }, hidden);
  const sameVersion = before !== undefined && before.etag === record.etag;
  if (sameVersion && !before.known && hidden.size === 0) return { entity, ...etagOf(record) };
  const prior = sameVersion ? (before.known ?? type.fields.map((f) => f.name)) : [];
  const known = new Set([...type.key, ...fields, ...prior]);
  for (const f of hidden) known.delete(f);
  return { entity, ...etagOf(record), known, ...(hidden.size ? { hidden } : {}) };
}

/** A hidden field holds `null`, whatever an older version held. */
function blanked(entity: Entity, hidden: ReadonlySet<string>): Entity {
  if (hidden.size === 0) return entity;
  const out: Record<string, Value> = { ...entity };
  for (const f of hidden) out[f] = null;
  return out;
}

const etagOf = (r: StoredRecord) => (r.etag !== undefined ? { etag: r.etag } : {});

function sameSet(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
  if (!a || !b) return a === b;
  return a.size === b.size && [...a].every((f) => b.has(f));
}

export function sameEntity(a: Entity, b: Entity): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => Object.is(a[k], b[k]));
}
