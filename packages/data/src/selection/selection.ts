import { computed, signal, type ReadonlySignal } from "@preact/signals-core";
import type { Collection } from "../collection/collection.ts";
import type { Query } from "../criteria/ast.ts";
import type { Entity } from "../schema/model.ts";
import type { RecordStore } from "../store/store.ts";
import type { KeyText } from "../store/keys.ts";

export interface SelectionOptions {
  /** Several keys at once. */
  readonly multiple?: boolean;
  /** Pick order is meaningful; enables explicit reordering. Requires multiple. */
  readonly ordered?: boolean;
  /** Optional positive integer limit for ordered selection. */
  readonly maxOrdered?: number;
  /**
   * When nothing chosen is in the collection, select its first loaded row.
   * On by default for single selection, so a detail view always has a record.
   */
  readonly fallback?: boolean;
}

/** Cross-field policy validation shared with declarative configuration contracts. */
export function selectionOptionsError(options: SelectionOptions): string | undefined {
  if (options.ordered && !options.multiple) return "ordered selection requires multiple: true";
  if (options.maxOrdered !== undefined && (!options.ordered || !Number.isSafeInteger(options.maxOrdered) || options.maxOrdered < 1)) return "maxOrdered requires ordered selection and a positive safe integer";
  return undefined;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The keys selected in a collection. `keys` is derived, never written back:
 * chosen keys that have left the collection drop out, and the fallback
 * applies, as soon as the collection changes. A key on a page the collection
 * has unloaded stays selected.
 */
export class Selection {
  readonly #chosen = signal<readonly KeyText[]>([]);
  readonly #collection: ReadonlySignal<Collection>;
  readonly multiple: boolean;
  readonly ordered: boolean;
  readonly maxOrdered: number | undefined;

  readonly keys: ReadonlySignal<readonly KeyText[]>;
  /** The first selected key. */
  readonly key: ReadonlySignal<KeyText | undefined>;
  /** The selected records, live from the store. */
  readonly records: ReadonlySignal<readonly Entity[]>;
  /** The first selected record. */
  readonly selected: ReadonlySignal<Entity | undefined>;
  /** The fields hidden on the first selected record (`StoredRecord.hidden`). */
  readonly hidden: ReadonlySignal<ReadonlySet<string>>;
  readonly count: ReadonlySignal<number>;
  readonly any: ReadonlySignal<boolean>;
  readonly many: ReadonlySignal<boolean>;

  constructor(store: RecordStore, collection: Collection | ReadonlySignal<Collection>, options: SelectionOptions = {}) {
    this.#collection = "query" in collection ? signal(collection) : collection;
    this.multiple = options.multiple ?? false;
    this.ordered = options.ordered ?? false;
    this.maxOrdered = options.maxOrdered;
    const policyError = selectionOptionsError(options);
    if (policyError) throw new Error(policyError);
    const fallback = options.fallback ?? !this.multiple;
    // Seen keys survive eviction and ordering/projection changes. A changed
    // membership query must show a key again before it can survive eviction.
    let seenFor: Query | undefined;
    const seen = new Set<KeyText>();
    this.keys = computed(() => {
      const c = this.#collection.value;
      const chosen = this.#chosen.value;
      if (c.count.value === undefined) return chosen;
      if (seenFor !== c.query) {
        const sameMembership = seenFor?.set === c.query.set && JSON.stringify(seenFor.filter) === JSON.stringify(c.query.filter);
        seenFor = c.query;
        if (!sameMembership) seen.clear();
      }
      const loaded = new Set(c.keys.value);
      const complete = c.complete.value;
      const kept = chosen.filter((k) => {
        if (loaded.has(k)) {
          seen.add(k);
          return true;
        }
        return !complete && seen.has(k) && store.record(c.query.set, k).value !== undefined && c.has(k) !== false;
      });
      if (kept.length > 0 || !fallback) return kept.length === chosen.length ? chosen : kept;
      const first = c.keys.value.find((k) => k !== undefined);
      return first === undefined ? [] : [first];
    });
    this.key = computed(() => this.keys.value[0]);
    this.records = computed(() => {
      const set = this.#collection.value.query.set;
      const out: Entity[] = [];
      for (const k of this.keys.value) {
        const entity = store.record(set, k).value?.entity;
        if (entity) out.push(entity);
      }
      return out;
    });
    this.selected = computed(() => this.records.value[0]);
    this.hidden = computed(() => {
      const k = this.key.value;
      return (k === undefined ? undefined : store.record(this.#collection.value.query.set, k).value?.hidden) ?? NONE;
    });
    this.count = computed(() => this.keys.value.length);
    this.any = computed(() => this.count.value > 0);
    this.many = computed(() => this.count.value > 1);
  }

  /** The collection selected in; a signal read, so views follow a selection whose collection changes. */
  get collection(): Collection {
    return this.#collection.value;
  }

  /** Selects only `key`, or nothing. */
  select(key: KeyText | undefined): void {
    this.#chosen.value = key === undefined ? [] : [key];
  }

  /** Adds or removes `key` (multiple selection), or selects it alone. */
  toggle(key: KeyText): boolean {
    const chosen = this.keys.peek();
    if (!this.multiple) this.#chosen.value = [key];
    else if (chosen.includes(key)) this.#chosen.value = chosen.filter((k) => k !== key);
    else {
      if (this.maxOrdered !== undefined && chosen.length >= this.maxOrdered) return false;
      this.#chosen.value = [...chosen, key];
    }
    return true;
  }

  selectAll(keys: readonly KeyText[]): boolean {
    const unique = [...new Set(keys)];
    const next = this.multiple ? unique : unique.slice(0, 1);
    if (this.maxOrdered !== undefined && next.length > this.maxOrdered) return false;
    this.#chosen.value = next;
    return true;
  }

  /** Moves a selected key to a zero-based position; never changes membership. */
  move(key: KeyText, index: number): boolean {
    const chosen = this.keys.peek();
    if (!this.ordered || !chosen.includes(key) || !Number.isInteger(index) || index < 0 || index >= chosen.length) return false;
    const next = chosen.filter((k) => k !== key);
    next.splice(index, 0, key);
    this.#chosen.value = next;
    return true;
  }

  /** Selects nothing; with the fallback, the first row is selected again. */
  clear(): void {
    this.#chosen.value = [];
  }
}
