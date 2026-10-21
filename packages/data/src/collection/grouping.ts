import { batch, computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { Query, Criteria } from "../criteria/ast.ts";
import { toApply, type Aggregate } from "../criteria/compile.ts";
import { relatedOf, resolveRelative } from "../criteria/relative.ts";
import type { Schema, Value } from "../schema/model.ts";
import type { KeyText } from "../store/keys.ts";
import type { Collection } from "./collection.ts";
import type { Groups, GroupRow } from "./groups.ts";

export interface GroupingOptions {
  /** Leaf collection page size, default 100. */
  readonly pageSize?: number;
  /** Pages retained per open leaf, default 20. */
  readonly keepPages?: number;
}

/** A group header in the visible hierarchy. IDs are opaque and local to this grouping. */
export interface GroupingHeader {
  readonly kind: "group";
  readonly id: string;
  readonly parent: string | undefined;
  readonly path: readonly Value[];
  readonly field: string;
  readonly level: number;
  readonly position: number;
  readonly siblings: number;
  readonly group: GroupRow;
  readonly expanded: boolean;
  readonly loading: boolean;
  readonly error: unknown;
  readonly totalsAvailable: boolean;
}

/** A record or unloaded record position beneath a final-level group. */
export interface GroupingRecord {
  readonly kind: "row";
  readonly key: KeyText | undefined;
  readonly parent: string;
  readonly level: number;
  readonly position: number;
  readonly siblings: number;
  readonly collection: Collection;
  readonly local: number;
}

export type GroupingRow = GroupingHeader | GroupingRecord;

interface Branch {
  readonly path: readonly Value[];
  groups?: Groups;
  collection?: Collection;
}

interface GroupingContext {
  readonly schema: Schema;
  readonly now: () => number;
  groups(query: ReadonlySignal<Query>, field: string, aggregates: readonly Aggregate[]): Groups;
  collection(query: ReadonlySignal<Query>, options: GroupingOptions): Collection;
  release(collection: Collection): void;
}

/** Lazy server grouping: one grouped query per open intermediate branch, paged records at leaves. */
export class Grouping {
  readonly fields: readonly string[];
  readonly #ctx: GroupingContext;
  readonly #query: ReadonlySignal<Query>;
  readonly #options: GroupingOptions;
  readonly #root = signal<Groups | undefined>(undefined);
  readonly #open = signal<ReadonlySet<string>>(new Set());
  readonly #version = signal(0);
  readonly #branches = new Map<string, Branch>();
  readonly #stop: () => void;
  #aggregates: readonly Aggregate[];
  #disposed = false;

  /** Open headers; collapsing a branch closes and releases its descendants. */
  readonly open: ReadonlySignal<ReadonlySet<string>> = this.#open;
  /** Flattened visible headers and record positions, including unloaded placeholders. */
  readonly rows: ReadonlySignal<readonly GroupingRow[]>;
  /** Exact record count across root groups, undefined until their first answer. */
  readonly total: ReadonlySignal<number | undefined>;

  constructor(ctx: GroupingContext, query: Query | ReadonlySignal<Query>, fields: readonly string[], aggregates: readonly Aggregate[] = [], options: GroupingOptions = {}) {
    if (!fields.length || new Set(fields).size !== fields.length || fields.some((f) => !f)) throw new Error("Grouping needs distinct nonempty fields");
    this.#ctx = ctx;
    this.fields = [...fields];
    this.#query = "set" in query ? signal(query) : query;
    this.#options = { ...options };
    this.#aggregates = aggregates.map((a) => ({ ...a }));
    this.#validate(this.#aggregates);
    this.#root.value = this.#groups([]);
    this.rows = computed(() => {
      this.#version.value;
      const rows: GroupingRow[] = [];
      this.#append(this.root, [], rows);
      return rows;
    });
    this.total = computed(() => this.root.rows.value?.reduce((sum, row) => sum + row.count, 0));
    this.#stop = effect(() => {
      this.#version.value;
      const gone: string[] = [];
      for (const [id, branch] of this.#branches) {
        const parent = branch.path.length === 1 ? this.root : this.#branches.get(idOf(branch.path.slice(0, -1)))?.groups;
        const rows = parent?.rows.value;
        if (!parent || (rows && !rows.some((r) => idOf([...branch.path.slice(0, -1), r.value]) === id))) gone.push(id);
      }
      if (gone.length) untracked(() => batch(() => { for (const id of gone) this.collapse(id); }));
    });
  }

  /** The root grouped query, including loading/error signals and refresh. */
  get root(): Groups { return this.#root.value!; }

  /** Opens a visible group. Only a final-level group requests record pages. */
  async expand(id: string): Promise<void> {
    if (this.#disposed || this.#open.peek().has(id)) return;
    const row = this.rows.peek().find((r): r is GroupingHeader => r.kind === "group" && r.id === id);
    if (!row) return;
    const branch: Branch = { path: row.path };
    if (row.path.length < this.fields.length) branch.groups = this.#groups(row.path);
    else branch.collection = this.#ctx.collection(computed(() => this.#scoped(row.path)), this.#options);
    batch(() => {
      this.#branches.set(id, branch);
      this.#open.value = new Set([...this.#open.peek(), id]);
      this.#version.value++;
    });
    if (branch.collection) await branch.collection.ensure(0, 1);
  }

  /** Releases this branch and all open descendants, including their query subscriptions. */
  collapse(id: string): void {
    const branch = this.#branches.get(id);
    if (!branch) return;
    const next = new Set(this.#open.peek());
    for (const [key, child] of this.#branches) {
      if (!isWithin(child.path, branch.path)) continue;
      child.groups?.dispose();
      if (child.collection) this.#ctx.release(child.collection);
      this.#branches.delete(key);
      next.delete(key);
    }
    batch(() => { this.#open.value = next; this.#version.value++; });
  }

  /** Opens or collapses a visible group. */
  async toggle(id: string): Promise<void> {
    if (this.#open.peek().has(id)) this.collapse(id);
    else await this.expand(id);
  }

  /** Retries a branch's group list or visible leaf pages; omit the ID to retry root groups. */
  async retry(id?: string): Promise<void> {
    if (this.#disposed) return;
    if (id === undefined) return this.root.refresh();
    const branch = this.#branches.get(id);
    if (branch?.groups) await branch.groups.refresh();
    else if (branch?.collection) await branch.collection.refresh();
  }

  /** Recounts changed aggregate specifications without closing open paths or leaf collections. */
  setAggregates(aggregates: readonly Aggregate[]): void {
    if (this.#disposed || JSON.stringify(aggregates) === JSON.stringify(this.#aggregates)) return;
    this.#validate(aggregates);
    this.#aggregates = aggregates.map((a) => ({ ...a }));
    batch(() => {
      this.root.dispose();
      this.#root.value = this.#groups([]);
      for (const branch of this.#branches.values()) {
        if (!branch.groups) continue;
        branch.groups.dispose();
        branch.groups = this.#groups(branch.path);
      }
      this.#version.value++;
    });
  }

  /** Stops all grouped queries and releases open leaf collections. */
  dispose(): void {
    this.#disposed = true;
    this.#stop();
    this.root.dispose();
    for (const branch of this.#branches.values()) {
      branch.groups?.dispose();
      if (branch.collection) this.#ctx.release(branch.collection);
    }
    this.#branches.clear();
  }

  #validate(aggregates: readonly Aggregate[]): void {
    const q = this.#query.peek();
    const set = this.#ctx.schema.set(q.set);
    const filter = q.filter ? resolveRelative(q.filter, set.type, this.#ctx.now(), relatedOf(this.#ctx.schema, set.type)) : undefined;
    toApply(set.type, filter, this.fields, aggregates, set, this.#ctx.schema);
  }

  #scoped(path: readonly Value[]): Query {
    const q = this.#query.value;
    const criteria: Criteria[] = path.map((value, i) => ({ op: "eq", field: this.fields[i]!, value }));
    if (q.filter) criteria.unshift(q.filter);
    return { ...q, ...(criteria.length ? { filter: { op: "and", args: criteria } as Criteria } : {}) };
  }

  #groups(path: readonly Value[]): Groups {
    return this.#ctx.groups(computed(() => this.#scoped(path)), this.fields[path.length]!, this.#aggregates);
  }

  #append(groups: Groups, path: readonly Value[], out: GroupingRow[]): void {
    const rows = groups.rows.value;
    if (!rows) return;
    const expanded = this.#open.value;
    for (const [index, group] of rows.entries()) {
      const childPath = [...path, group.value];
      const id = idOf(childPath);
      const branch = this.#branches.get(id);
      const collection = branch?.collection;
      const loading = branch?.groups?.status.value === "loading" || collection?.status.value === "loading";
      out.push({ kind: "group", id, parent: path.length ? idOf(path) : undefined, path: childPath,
        field: this.fields[path.length]!, level: childPath.length, position: index + 1, siblings: rows.length,
        group, expanded: expanded.has(id), loading, error: branch?.groups?.error.value ?? collection?.error.value,
        totalsAvailable: groups.status.value === "idle" });
      if (!expanded.has(id)) continue;
      if (branch?.groups) this.#append(branch.groups, childPath, out);
      else if (collection) {
        const keys = collection.keys.value;
        const count = collection.counted.value ? collection.count.value ?? group.count : group.count;
        for (let i = 0; i < count; i++) out.push({ kind: "row", key: keys[i], parent: id, level: childPath.length + 1,
          position: i + 1, siblings: count, collection, local: i });
      }
    }
  }
}

function idOf(path: readonly Value[]): string { return `g:${JSON.stringify(path)}`; }
function isWithin(path: readonly Value[], prefix: readonly Value[]): boolean {
  return path.length >= prefix.length && idOf(path.slice(0, prefix.length)) === idOf(prefix);
}
