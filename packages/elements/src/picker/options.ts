import { computed, signal, type ReadonlySignal } from "@preact/signals-core";
import {
  keyText,
  matches,
  type Collection,
  type Criteria,
  type DataContext,
  type Entity,
  type EntityType,
  type Query,
  type SortKey,
  type Value,
} from "@getaster/data";

export interface OptionsSpec {
  readonly set: string;
  /** Limits the options. A signal follows the page scope: the project's people, the country's regions. */
  readonly filter?: Criteria | ReadonlySignal<Criteria | undefined>;
  /** By default the display field (after `groupBy`). */
  readonly orderBy?: readonly SortKey[];
  /** The field an option shows as its name; by default the type's title field. */
  readonly display?: string;
  /** Fields typing searches, case-insensitively; by default the display field. */
  readonly searchFields?: readonly string[];
  /** More fields shown as columns beside the name, with a header that sorts by them. */
  readonly columns?: readonly string[];
  /** Column widths as CSS track sizes, by field (the name's too); shared space otherwise. */
  readonly widths?: Readonly<Record<string, string>>;
  /** Options under a heading per value of this field. */
  readonly groupBy?: string;
  readonly pageSize?: number;
  /** Offers "Create …": a small form with these fields, the typed text in the display field. */
  readonly create?: readonly string[];
  /** Said under the field when its value is outside the options: "isn't on this project's team". */
  readonly outside?: string;
}

/**
 * Where a picker's options come from: a query over an entity set, shared by
 * every picker that uses it (a column of a grid, a list of tasks). With
 * more options than one page, typing searches on the server through a
 * collection of its own; with fewer, it filters what's loaded.
 */
export class PickerOptions {
  readonly ctx: DataContext;
  readonly spec: OptionsSpec;
  readonly type: EntityType;
  readonly key: string;
  readonly display: string;
  readonly pageSize: number;
  /** The options with no search typed. */
  readonly all: Collection;
  readonly #filter: ReadonlySignal<Criteria | undefined>;
  /** The sort a person chose from the columns' header; the spec's order until then. */
  readonly sort = signal<readonly SortKey[] | undefined>(undefined);

  constructor(ctx: DataContext, spec: OptionsSpec) {
    this.ctx = ctx;
    this.spec = spec;
    this.type = ctx.schema.set(spec.set).type;
    this.key = this.type.key[0]!;
    this.display = spec.display ?? this.type.titleField ?? this.key;
    this.pageSize = spec.pageSize ?? 50;
    const filter = spec.filter;
    this.#filter = filter === undefined ? computed(() => undefined) : "value" in filter && "peek" in filter ? filter : computed(() => filter as Criteria);
    this.all = ctx.collection(
      computed(() => this.query(this.#filter.value)),
      { pageSize: this.pageSize },
    );
  }

  /** Sorts by a column, or reverses the sort when it's already by that column. */
  sortBy(field: string): void {
    const current = this.sort.peek()?.[0];
    this.sort.value = [{ field, ...(current?.field === field && !current.descending ? { descending: true } : {}) }];
  }

  /** The grid tracks for the name and the columns, after a check column when several can be chosen. */
  tracks(multiple: boolean): string {
    const widths = this.spec.widths ?? {};
    const fields = [this.display, ...(this.spec.columns ?? [])];
    return [...(multiple ? ["12px"] : []), ...fields.map((f, i) => widths[f] ?? (i === 0 ? "minmax(0, 1.4fr)" : "minmax(0, 1fr)"))].join(" ");
  }

  /** Every option is loaded or loads in one page, so typing filters them here. */
  get small(): boolean {
    const n = this.all.count.value;
    return n !== undefined && n <= this.pageSize;
  }

  query(base: Criteria | undefined, search?: string): Query {
    const fields = this.spec.searchFields ?? [this.display];
    const text = search?.trim();
    const searching: Criteria | undefined = text
      ? fields.length === 1
        ? { op: "contains", field: fields[0]!, value: text, caseInsensitive: true }
        : { op: "or", args: fields.map((field): Criteria => ({ op: "contains", field, value: text, caseInsensitive: true })) }
      : undefined;
    const parts = [base, searching].filter((c): c is Criteria => c !== undefined);
    const orderBy = [
      ...(this.spec.groupBy ? [{ field: this.spec.groupBy }] : []),
      ...(this.sort.value ?? this.spec.orderBy ?? [{ field: this.display }]),
    ];
    return {
      set: this.spec.set,
      ...(parts.length === 0 ? {} : { filter: parts.length === 1 ? parts[0]! : { op: "and", args: parts } }),
      orderBy,
    };
  }

  /** A collection over the options matching `search`; `release` it when done. */
  search(search: ReadonlySignal<string>): Collection {
    return this.ctx.collection(
      computed(() => this.query(this.#filter.value, search.value)),
      { pageSize: this.pageSize },
    );
  }

  release(collection: Collection): void {
    this.ctx.release(collection);
  }

  /** The record a value names, fetched if it isn't loaded. */
  record(value: Value | undefined): ReadonlySignal<Entity | undefined> | undefined {
    return value === null || value === undefined ? undefined : this.ctx.lookup(this.spec.set, keyText([value]));
  }

  /** Whether a record is among the options now; undefined if that can't be told here. */
  fits(entity: Entity): boolean | undefined {
    const filter = this.#filter.value;
    if (!filter) return true;
    try {
      return matches(filter, entity, this.type);
    } catch {
      return undefined;
    }
  }

  text(entity: Entity, field = this.display): string {
    const v = entity[field];
    if (v === null || v === undefined) return "";
    const allowed = this.type.field(field)?.allowedValues?.find((a) => a.value === v);
    return allowed?.label ?? String(v);
  }
}
