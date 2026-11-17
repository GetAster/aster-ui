import { computed, type ReadonlySignal } from "@preact/signals-core";
import { keyText, Tree, type Criteria, type DataContext, type Entity, type EntityType, type SortKey, type Value } from "@getaster/data";

export interface TreeChoicesSpec {
  readonly set: string;
  /** The field holding a node's parent key. */
  readonly parentField: string;
  /** The field a node shows as its name; by default the type's title field. */
  readonly display?: string;
  /** Fields typing searches, case-insensitively; by default the display field. */
  readonly searchFields?: readonly string[];
  /** Siblings' order. */
  readonly orderBy?: readonly SortKey[];
  /** Whether a node can be chosen; one that can't (a group) only opens. All can by default. */
  readonly choosable?: (entity: Entity) => boolean;
}

/**
 * Where a tree picker's choices come from: a self-referencing set, shown as
 * a tree a level at a time. Each picker that opens gets a `Tree` of its own,
 * so open folders are its own; the records are the store's.
 */
export class TreeChoices {
  static readonly #byContext = new WeakMap<DataContext, Map<string, TreeChoices | null>>();

  /**
   * The default choices for a foreign key into `set`, when metadata makes `set` a tree: a single-valued navigation
   * from its type to its own set, constrained by one field, which is the parent field. `undefined` otherwise.
   * One per context and set, so every picker of a form shares it.
   */
  static of(ctx: DataContext, set: string): TreeChoices | undefined {
    let sets = TreeChoices.#byContext.get(ctx);
    if (!sets) TreeChoices.#byContext.set(ctx, (sets = new Map()));
    let choices = sets.get(set);
    if (choices === undefined) {
      const type = ctx.schema.set(set).type;
      const parent = type.navigations.find((n) => !n.collection && n.target === set && n.keys.length === 1 && n.keys[0]![1] === type.key[0]);
      choices = parent && type.key.length === 1 ? new TreeChoices(ctx, { set, parentField: parent.keys[0]![0] }) : null;
      sets.set(set, choices);
    }
    return choices ?? undefined;
  }

  readonly ctx: DataContext;
  readonly spec: TreeChoicesSpec;
  readonly type: EntityType;
  readonly key: string;
  readonly display: string;
  readonly #root: Value;

  constructor(ctx: DataContext, spec: TreeChoicesSpec) {
    this.ctx = ctx;
    this.spec = spec;
    this.type = ctx.schema.set(spec.set).type;
    this.key = this.type.key[0]!;
    this.display = spec.display ?? this.type.titleField ?? this.key;
    this.#root = this.type.field(spec.parentField)?.rootValue ?? null;
  }

  /** A tree whose filter follows `search`, keeping each match's ancestors; `dispose` it when done. */
  tree(search: ReadonlySignal<string>): Tree {
    const fields = this.spec.searchFields ?? [this.display];
    const orderBy = this.spec.orderBy ?? [];
    return new Tree(this.ctx, {
      set: this.spec.set,
      parentField: this.spec.parentField,
      orderBy: computed(() => orderBy),
      filter: computed((): Criteria | undefined => {
        const text = search.value.trim();
        if (!text) return undefined;
        const each = fields.map((field): Criteria => ({ op: "contains", field, value: text, caseInsensitive: true }));
        return each.length === 1 ? each[0]! : { op: "or", args: each };
      }),
    });
  }

  /** The record a value names, fetched if it isn't loaded. */
  record(value: Value | undefined): ReadonlySignal<Entity | undefined> | undefined {
    return value === null || value === undefined ? undefined : this.ctx.lookup(this.spec.set, keyText([value]));
  }

  text(entity: Entity): string {
    const v = entity[this.display];
    return v === null || v === undefined ? "" : String(v);
  }

  /** The names of a node's ancestors, top first; those still loading are fetched and fill in. */
  trail(entity: Entity): string[] {
    const out: string[] = [];
    const seen = new Set<Value>();
    let parent = entity[this.spec.parentField];
    while (parent !== null && parent !== undefined && parent !== this.#root && !seen.has(parent)) {
      seen.add(parent);
      const record = this.record(parent)?.value;
      if (!record) {
        out.unshift("…");
        break;
      }
      out.unshift(this.text(record));
      parent = record[this.spec.parentField];
    }
    return out;
  }

  canChoose(entity: Entity): boolean {
    return this.spec.choosable?.(entity) ?? true;
  }

  matches(entity: Entity, typed: string): boolean {
    const text = typed.trim().toLowerCase();
    return text !== "" && (this.spec.searchFields ?? [this.display]).some((f) => String(entity[f] ?? "").toLowerCase().includes(text));
  }
}
