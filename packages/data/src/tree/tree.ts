import { batch, computed, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { Collection } from "../collection/collection.ts";
import type { Groups } from "../collection/groups.ts";
import type { DataContext } from "../context.ts";
import type { Criteria, Query, SortKey } from "../criteria/ast.ts";
import type { Entity, EntityType, Value } from "../schema/model.ts";
import { keyFromText, keyText, type KeyText } from "../store/keys.ts";

export type FilterMode = "keepAncestors" | "strict";

export interface TreeOptions {
  readonly set: string;
  /** The field holding a node's parent key. */
  readonly parentField: string;
  /** The parent value of top-level nodes: by default the parent field's `rootValue`, else null. */
  readonly rootValue?: Value;
  /** Limits the whole tree, such as one project's tasks. */
  readonly base?: ReadonlySignal<Criteria | undefined>;
  /** The view's filter, applied as `filterMode` says. */
  readonly filter?: ReadonlySignal<Criteria | undefined>;
  /** Siblings' order within each parent. */
  readonly orderBy?: ReadonlySignal<readonly SortKey[]>;
  /**
   * `keepAncestors` (the default) shows each match with the path to it;
   * `strict` hides a parent that doesn't match, and everything under it.
   */
  readonly filterMode?: FilterMode;
  readonly pageSize?: number;
  /** Matches beyond this make keep-ancestors give up with `tooBroad`. */
  readonly matchLimit?: number;
  /** Folders opened at most to show where matches are. */
  readonly openLimit?: number;
}

/** A line of the tree as shown: a node, or a placeholder for one not loaded yet. */
export interface TreeRow {
  /** Undefined for a placeholder. */
  readonly key: KeyText | undefined;
  /** The parent's key; `undefined` at the top level. */
  readonly parent: KeyText | undefined;
  /** 1 for the top level. */
  readonly level: number;
  /** Position among its siblings, from 1, and how many siblings there are. */
  readonly position: number;
  readonly siblings: number;
  /** `true` with children, `false` known empty, `undefined` not yet known. */
  readonly folder: boolean | undefined;
  readonly open: boolean;
  /** The level's collection and the row's index in it, for loading by page. */
  readonly collection: Collection;
  readonly index: number;
}

const ROOT = "";
const IN_CHUNK = 200;

/**
 * A tree over a self-referencing entity set, as one collection per open
 * level: each is the parent criterion and the view's filter, so levels load
 * by page and follow the store's sync rules like any collection (a node
 * whose parent changes leaves one level and joins another).
 *
 * Open state is a set of keys, separate from the records: it survives
 * reloads and filter changes, and two trees over the same data keep their
 * own. Child counts come from one grouped request per level.
 *
 * With a filter in keep-ancestors mode, the tree finds the matches and walks
 * up to the root, a level of parents per request, then shows each level's
 * matches and the ancestors under it, and opens the paths (up to
 * `openLimit`).
 */
export class Tree {
  readonly type: EntityType;
  readonly key: string;
  readonly options: TreeOptions;
  /** The parent value of top-level nodes. */
  readonly rootValue: Value;
  readonly #ctx: DataContext;
  readonly #levels = new Map<string, Collection>();
  readonly #counts = new Map<string, Groups>();
  readonly #open = signal<ReadonlySet<KeyText>>(new Set());
  readonly #version = signal(0);
  /** Keep-ancestors: the ancestors to show under each parent, by the parent's level key. */
  readonly #ancestors = signal<ReadonlyMap<string, readonly Value[]> | undefined>(undefined);
  readonly #searching = signal(false);
  readonly #tooBroad = signal(false);
  readonly #error = signal<unknown>(undefined);
  #walk = 0;
  readonly #stop: (() => void)[] = [];

  /** Keys of the open folders. */
  readonly open: ReadonlySignal<ReadonlySet<KeyText>> = this.#open;
  /** Keep-ancestors is finding the matches' paths. */
  readonly searching: ReadonlySignal<boolean> = this.#searching;
  /** More matches than `matchLimit`: narrow the filter. */
  readonly tooBroad: ReadonlySignal<boolean> = this.#tooBroad;
  /** Finding the matches' paths failed; the rows shown stay as they were. The next filter clears it. */
  readonly error: ReadonlySignal<unknown> = this.#error;
  /** The lines shown, top to bottom. */
  readonly rows: ReadonlySignal<readonly TreeRow[]>;

  constructor(ctx: DataContext, options: TreeOptions) {
    this.#ctx = ctx;
    this.options = options;
    this.type = ctx.schema.set(options.set).type;
    const key = this.type.key;
    if (key.length !== 1) throw new Error(`a tree needs a single-field key; ${options.set} has ${key.length}`);
    this.key = key[0]!;
    const parentField = this.type.field(options.parentField);
    if (!parentField) throw new Error(`${options.set} has no field ${options.parentField}`);
    this.rootValue = options.rootValue ?? parentField.rootValue ?? null;
    this.rows = computed(() => {
      this.#version.value;
      const out: TreeRow[] = [];
      this.#rowsUnder(ROOT, undefined, 1, out);
      return out;
    });
    const filter = options.filter;
    if (filter && this.#mode() === "keepAncestors") {
      let first = true;
      this.#stop.push(
        computed(() => [filter.value, options.base?.value] as const).subscribe(([f]) => {
          if (first && f === undefined) return void (first = false);
          first = false;
          void this.#findAncestors(f);
        }),
      );
    }
  }

  /** The level of `parent`'s children (the top level for `undefined`), created on first use. */
  level(parent: KeyText | undefined): Collection {
    const id = parent ?? ROOT;
    let level = this.#levels.get(id);
    if (!level) {
      const parentValue = parent === undefined ? this.rootValue : keyFromText(parent)[0]!;
      level = untracked(() => this.#ctx.collection(computed(() => this.#levelQuery(id, parentValue)), { pageSize: this.options.pageSize ?? 100 }));
      this.#levels.set(id, level);
      this.#countsFor(id, level);
      this.#version.value++;
    }
    return level;
  }

  /** A node's record as stored, read so a view follows its changes. */
  entity(key: KeyText): Entity | undefined {
    return this.#ctx.store.record(this.options.set, key).value?.entity;
  }

  isOpen(key: KeyText): boolean {
    return this.#open.peek().has(key);
  }

  /** Opens a folder and loads its first page. */
  async expand(key: KeyText): Promise<void> {
    if (this.#open.peek().has(key)) return;
    this.#open.value = new Set([...this.#open.peek(), key]);
    const level = this.level(key);
    await level.view(0, level.pageSize);
  }

  collapse(key: KeyText): void {
    if (!this.#open.peek().has(key)) return;
    const next = new Set(this.#open.peek());
    next.delete(key);
    this.#open.value = next;
  }

  toggle(key: KeyText): Promise<void> {
    if (this.#open.peek().has(key)) {
      this.collapse(key);
      return Promise.resolve();
    }
    return this.expand(key);
  }

  /** Replaces the open state; folders that no longer exist are simply never shown. */
  setOpen(keys: Iterable<KeyText>): void {
    this.#open.value = new Set(keys);
  }

  /** Whether a node has children: `undefined` until its level's counts arrive. */
  hasChildren(key: KeyText, parent: KeyText | undefined): boolean | undefined {
    const rows = this.#counts.get(parent ?? ROOT)?.rows.value;
    if (!rows) return undefined;
    const value = keyFromText(key)[0];
    return rows.some((r) => r.value === value && r.count > 0);
  }

  /** The keys from the top level down to `key`'s parent, loading records as needed. */
  async ancestors(key: KeyText): Promise<KeyText[]> {
    const path: KeyText[] = [];
    const seen = new Set<KeyText>([key]);
    let current = await this.#record(key);
    while (current) {
      const parent = current[this.options.parentField];
      if (parent === null || parent === undefined || parent === this.rootValue) break;
      const parentKey = keyText([parent]);
      if (seen.has(parentKey)) throw new Error(`${this.options.set} has a cycle at ${parentKey}`);
      seen.add(parentKey);
      path.unshift(parentKey);
      current = await this.#record(parentKey);
    }
    return path;
  }

  /**
   * Opens every folder down to `key` and loads the pages of each level until
   * the node is in it. Resolves to the node's row index, or -1 if it isn't
   * in this tree (filtered out, or elsewhere).
   */
  async reveal(key: KeyText): Promise<number> {
    const path = await this.ancestors(key);
    batch(() => {
      this.#open.value = new Set([...this.#open.peek(), ...path]);
      for (const p of path) this.level(p);
    });
    const chain: (KeyText | undefined)[] = [undefined, ...path];
    await Promise.all(
      chain.map(async (parent, i) => {
        const level = this.level(parent);
        const target = i + 1 < chain.length ? chain[i + 1]! : key;
        const at = await this.#position(level, target);
        if (at !== undefined) return level.view(Math.max(0, at - 1), at + 2);
        // Where the position can't be counted, load page by page until the node is in.
        await level.ensure(0, level.pageSize);
        while (!level.keys.peek().includes(target) && !level.complete.peek()) {
          const loaded = level.keys.peek().filter((k) => k !== undefined).length;
          await level.ensure(loaded, loaded + level.pageSize);
          if (level.keys.peek().filter((k) => k !== undefined).length === loaded) break;
        }
      }),
    );
    return this.rows.peek().findIndex((r) => r.key === key);
  }

  /**
   * Every node under `key`, nearest first: a level of children per request
   * (chunked), so a subtree can be listed before it's removed or moved.
   */
  async descendants(key: KeyText): Promise<Entity[]> {
    const out: Entity[] = [];
    let parents: Value[] = [keyFromText(key)[0]!];
    const seen = new Set<Value>(parents);
    while (parents.length) {
      const next: Value[] = [];
      for (let i = 0; i < parents.length; i += IN_CHUNK) {
        const c = this.#ctx.collection(
          { set: this.options.set, filter: { op: "in", field: this.options.parentField, values: parents.slice(i, i + IN_CHUNK) } },
          { pageSize: 1000 },
        );
        try {
          await c.loadAll();
          for (const e of c.items.peek()) {
            if (!e || seen.has(e[this.key]!)) continue;
            seen.add(e[this.key]!);
            out.push(e);
            next.push(e[this.key]!);
          }
        } finally {
          this.#ctx.release(c);
        }
      }
      parents = next;
    }
    return out;
  }

  /**
   * A node's index in its level, counted by the server: the siblings that
   * sort before it. Undefined where the sort can't be expressed as a filter
   * (a path into a related record, or a null in the node's sort values).
   */
  async #position(level: Collection, key: KeyText): Promise<number | undefined> {
    const node = await this.#record(key);
    if (!node) return undefined;
    const sort = [...(level.query.orderBy ?? [])];
    if (!sort.some((k) => k.field === this.key)) sort.push({ field: this.key });
    if (sort.some((k) => k.field.includes("/") || node[k.field] === null || node[k.field] === undefined)) return undefined;
    // (k1 before v1) or (k1 = v1 and k2 before v2) or …
    const before: Criteria = {
      op: "or",
      args: sort.map((k, i): Criteria => {
        const equal = sort.slice(0, i).map((e): Criteria => ({ op: "eq", field: e.field, value: node[e.field]! }));
        const after: Criteria = { op: k.descending ? "gt" : "lt", field: k.field, value: node[k.field]! };
        return equal.length ? { op: "and", args: [...equal, after] } : after;
      }),
    };
    const counter = this.#ctx.collection(
      { set: this.options.set, filter: level.query.filter ? { op: "and", args: [level.query.filter, before] } : before, select: [this.key] },
      { pageSize: 1, exactCount: true },
    );
    try {
      await counter.ensure(0, 1);
      return counter.counted.peek() ? counter.count.peek() : undefined;
    } finally {
      this.#ctx.release(counter);
    }
  }

  /**
   * Moves a node under a new parent (`undefined`: the top level). Refuses a
   * move into the node itself or its own subtree. The store's sync takes it
   * out of the old level and into the new one; the node keeps its open state.
   */
  async move(key: KeyText, parent: KeyText | undefined): Promise<void> {
    if (parent !== undefined) {
      if (parent === key) throw new Error("A node can't be moved into itself.");
      if ((await this.ancestors(parent)).includes(key)) throw new Error("A node can't be moved into its own subtree.");
    }
    const value = parent === undefined ? this.rootValue : keyFromText(parent)[0]!;
    await this.#ctx.update(this.options.set, key, { [this.options.parentField]: value });
  }

  /** Reloads every level's viewed pages, keeping open state. */
  async refresh(): Promise<void> {
    await Promise.all([...this.#levels.values()].map((l) => l.refresh()));
  }

  dispose(): void {
    for (const stop of this.#stop.splice(0)) stop();
    for (const level of this.#levels.values()) this.#ctx.release(level);
    for (const groups of this.#counts.values()) groups.dispose();
    this.#levels.clear();
    this.#counts.clear();
  }

  #mode(): FilterMode {
    return this.options.filterMode ?? "keepAncestors";
  }

  #levelQuery(id: string, parentValue: Value): Query {
    const parent: Criteria = { op: "eq", field: this.options.parentField, value: parentValue };
    const filter = this.options.filter?.value;
    let shown: Criteria | undefined = filter;
    if (filter && this.#mode() === "keepAncestors") {
      const ancestors = this.#ancestors.value?.get(id) ?? [];
      shown = ancestors.length ? { op: "or", args: [filter, { op: "in", field: this.key, values: ancestors }] } : filter;
    }
    const parts = [this.options.base?.value, parent, shown].filter((c): c is Criteria => c !== undefined);
    return {
      set: this.options.set,
      filter: parts.length === 1 ? parts[0]! : { op: "and", args: parts },
      ...(this.options.orderBy?.value.length ? { orderBy: this.options.orderBy.value } : {}),
    };
  }

  /** Child counts for a level's loaded nodes, under the same filter as their own levels would have. */
  #countsFor(id: string, level: Collection): void {
    const query = computed((): Query => {
      const loaded = level.keys.value.flatMap((k) => (k === undefined ? [] : [keyFromText(k)[0]!]));
      const filter = this.options.filter?.value;
      const ancestors = this.#ancestors.value;
      const all = ancestors ? [...ancestors.values()].flat() : [];
      const shown: Criteria | undefined =
        filter && this.#mode() === "keepAncestors" && all.length ? { op: "or", args: [filter, { op: "in", field: this.key, values: all }] } : filter;
      const parts = [this.options.base?.value, { op: "in", field: this.options.parentField, values: loaded } as Criteria, shown].filter(
        (c): c is Criteria => c !== undefined,
      );
      return { set: this.options.set, filter: { op: "and", args: parts } };
    });
    this.#counts.set(id, untracked(() => this.#ctx.groups(query, this.options.parentField)));
  }

  #rowsUnder(id: string, parent: KeyText | undefined, depth: number, out: TreeRow[]): void {
    const level = id === ROOT ? untracked(() => this.level(undefined)) : this.#levels.get(id);
    if (!level) return;
    // An open level that hasn't answered yet has no lines for a view to ask about: load its first page.
    if (level.count.value === undefined && level.status.peek() !== "loading") {
      queueMicrotask(() => void level.ensure(0, level.pageSize).catch(() => {}));
    }
    const keys = level.keys.value;
    const siblings = level.count.value ?? keys.length;
    const open = this.#open.value;
    const counts = this.#counts.get(id)?.rows.value;
    keys.forEach((key, index) => {
      const value = key === undefined ? undefined : keyFromText(key)[0];
      const folder = key === undefined || !counts ? undefined : counts.some((r) => r.value === value && r.count > 0);
      const isOpen = key !== undefined && open.has(key) && folder !== false;
      out.push({ key, parent, level: depth, position: index + 1, siblings, folder, open: isOpen, collection: level, index });
      if (isOpen) {
        if (!this.#levels.has(key)) untracked(() => this.level(key));
        this.#rowsUnder(key, key, depth + 1, out);
      }
    });
  }

  async #record(key: KeyText): Promise<Entity | undefined> {
    const stored = this.#ctx.store.get(this.options.set, key);
    if (stored && stored.known?.has(this.options.parentField) !== false) return stored.entity;
    return (await this.#ctx.reload(this.options.set, key))?.entity;
  }

  /**
   * Keep-ancestors: the matches' keys and parents, then their parents' and so
   * on up to the root, each round one request per chunk of keys.
   */
  async #findAncestors(filter: Criteria | undefined): Promise<void> {
    const walk = ++this.#walk;
    if (!filter) {
      batch(() => {
        this.#ancestors.value = undefined;
        this.#tooBroad.value = false;
        this.#searching.value = false;
        this.#error.value = undefined;
      });
      return;
    }
    batch(() => {
      this.#searching.value = true;
      this.#error.value = undefined;
    });
    try {
      const limit = this.options.matchLimit ?? 8000;
      const base = this.options.base?.peek();
      const parentField = this.options.parentField;
      const root = this.rootValue;
      const select = [this.key, parentField];
      const fetch = async (criteria: Criteria): Promise<Entity[]> => {
        const c = this.#ctx.collection(
          { set: this.options.set, filter: base ? { op: "and", args: [base, criteria] } : criteria, select },
          { pageSize: 1000 },
        );
        try {
          await c.ensure(0, 1);
          if ((c.count.peek() ?? 0) > limit) return Promise.reject(new TooBroad());
          await c.loadAll();
          return c.items.peek().filter((e): e is Entity => e !== undefined);
        } finally {
          this.#ctx.release(c);
        }
      };
      const matches = await fetch(filter);
      if (walk !== this.#walk) return;
      const parentOf = new Map<Value, Value>();
      const matched = new Set<Value>();
      for (const m of matches) {
        matched.add(m[this.key]!);
        parentOf.set(m[this.key]!, m[parentField] ?? null);
      }
      let wanted = [...new Set([...parentOf.values()])].filter((p) => p !== root && p !== null && !parentOf.has(p));
      while (wanted.length) {
        if (parentOf.size > limit) throw new TooBroad();
        const found: Entity[] = [];
        for (let i = 0; i < wanted.length; i += IN_CHUNK) {
          found.push(...(await fetch({ op: "in", field: this.key, values: wanted.slice(i, i + IN_CHUNK) })));
        }
        if (walk !== this.#walk) return;
        for (const f of found) parentOf.set(f[this.key]!, f[parentField] ?? null);
        wanted = [...new Set(found.map((f) => f[parentField] ?? null))].filter((p) => p !== root && p !== null && !parentOf.has(p));
      }
      // Ancestors that don't match themselves, by their parent's level.
      const byLevel = new Map<string, Value[]>();
      const toOpen = new Set<KeyText>();
      for (const [node, parent] of parentOf) {
        if (matched.has(node)) continue;
        const id = parent === root || parent === null ? ROOT : keyText([parent]);
        byLevel.set(id, [...(byLevel.get(id) ?? []), node]);
      }
      // Open the path to every match: each parent on it, nearest the top first, up to the limit.
      const depth = (v: Value): number => {
        let n = 0;
        for (let p = parentOf.get(v); p !== undefined && p !== null && p !== root; p = parentOf.get(p)) n++;
        return n;
      };
      const parents = [...new Set(parentOf.values())].filter((p) => p !== null && p !== root).sort((a, b) => depth(a) - depth(b));
      for (const v of parents.slice(0, this.options.openLimit ?? 200)) toOpen.add(keyText([v]));
      batch(() => {
        this.#tooBroad.value = false;
        this.#ancestors.value = byLevel;
        this.#open.value = new Set([...this.#open.peek(), ...toOpen]);
      });
    } catch (e) {
      if (walk !== this.#walk) return;
      // Nothing awaits the walk, so a failure is kept, not thrown.
      if (!(e instanceof TooBroad)) return void (this.#error.value = e);
      batch(() => {
        this.#tooBroad.value = true;
        this.#ancestors.value = new Map();
      });
    } finally {
      if (walk === this.#walk) this.#searching.value = false;
    }
  }
}

class TooBroad extends Error {}
