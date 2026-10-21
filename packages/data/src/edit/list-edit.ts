import { batch, computed, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import { apply, type ChangeSet } from "../changes/changeset.ts";
import type { Collection } from "../collection/collection.ts";
import type { DataContext } from "../context.ts";
import { ODataError } from "../odata/errors.ts";
import type { Entity, EntityType, Value } from "../schema/model.ts";
import { keyFromText, keyText, keyValues, type KeyText } from "../store/keys.ts";
import { EditModel, type EditDraft, type EditOptions } from "./edit-model.ts";

export interface ListRow {
  /** The record's key, or `new:<n>` until a new row is saved. */
  readonly id: string;
  readonly edit: EditModel;
  readonly isNew: boolean;
  /** Marked for deletion, to happen on save. */
  readonly removing: boolean;
  /** Why the last attempt to delete it failed. */
  readonly removeError?: string;
  /** A new row's fields that take another new row's key on save, by field: that row's id. */
  readonly links?: Readonly<Record<string, string>>;
}

export interface ListEditOptions extends EditOptions {
  /** Values for a new row, such as the parent's key. */
  readonly defaults?: () => Entity;
  /**
   * A field holding each row's place: rows are shown in its order, `move`
   * renumbers it from 1, and a new row goes last.
   */
  readonly positionField?: string;
}

export interface ListSaveResult {
  readonly saved: readonly ChangeSet[];
  /** Rows whose write failed; they stay pending with the error on them. */
  readonly failed: readonly string[];
}

/** A list edit's working state, enough to resume it after a reload. Plain data. */
export interface ListDraft {
  readonly added: readonly { readonly id: string; readonly edit: EditDraft; readonly links: Readonly<Record<string, string>> }[];
  readonly removing: readonly string[];
  readonly edits: Readonly<Record<string, EditDraft>>;
  readonly counter: number;
}

interface Existing {
  readonly key: KeyText;
  readonly entity: Entity;
}

/**
 * Edits the rows of a collection together: changes to existing rows, new
 * rows and rows marked for deletion are all pending until `save()`.
 *
 * Invariants: an existing row keeps one edit model while it's in the
 * collection; removing a new row discards it, removing an existing one only
 * marks it; a new row shows as pending in every writable field. A new row
 * can link a field to another new row (a parent added in the same edit):
 * rows are created in the order added, and the link takes the other row's
 * key once it has one.
 */
export class ListEdit {
  readonly type: EntityType;
  readonly set: string;
  /** Undefined for a replay. */
  readonly collection: Collection | undefined;
  readonly #ctx: DataContext;
  readonly #options: ListEditOptions;
  readonly #existing: ReadonlySignal<readonly Existing[]>;
  readonly #edits = new Map<KeyText, EditModel>();
  readonly #new = signal<readonly { id: string; edit: EditModel; links: Readonly<Record<string, string>> }[]>([]);
  readonly #removing = signal<ReadonlySet<string>>(new Set());
  readonly #removeErrors = signal<ReadonlyMap<string, string>>(new Map());
  readonly #busy = signal(false);
  #replay = false;
  #counter = 0;

  /** Existing rows in the collection's order, then new rows in the order added; by position when there is one. */
  readonly rows: ReadonlySignal<readonly ListRow[]>;
  readonly dirty: ReadonlySignal<boolean>;
  readonly valid: ReadonlySignal<boolean>;
  readonly busy: ReadonlySignal<boolean> = this.#busy;
  /** Rows have a position field: `move` reorders them. */
  get ordered(): boolean {
    return this.#options.positionField !== undefined && !this.#replay;
  }

  constructor(ctx: DataContext, collection: Collection, options?: ListEditOptions);
  /** @internal */
  constructor(ctx: DataContext, source: Collection | { set: string; rows: readonly Existing[] }, options?: ListEditOptions);
  constructor(ctx: DataContext, source: Collection | { set: string; rows: readonly Existing[] }, options: ListEditOptions = {}) {
    this.#ctx = ctx;
    this.#options = options;
    if ("rows" in source) {
      this.set = source.set;
      this.collection = undefined;
      this.#existing = signal(source.rows);
    } else {
      const collection = source;
      this.set = collection.query.set;
      this.collection = collection;
      this.#existing = computed(() => {
        const items = collection.items.value;
        return collection.keys.value.flatMap((key, i) => (key === undefined || items[i] === undefined ? [] : [{ key, entity: items[i]! }]));
      });
    }
    this.type = ctx.schema.set(this.set).type;
    this.rows = computed(() => {
      const removing = this.#removing.value;
      const errors = this.#removeErrors.value;
      const existing = this.#existing.value.map(({ key }) => ({
        id: key,
        edit: untracked(() => this.#editFor(key)),
        isNew: false,
        removing: removing.has(key),
        ...(errors.has(key) ? { removeError: errors.get(key)! } : {}),
      }));
      const added = this.#new.value.map(({ id, edit, links }) => ({ id, edit, isNew: true, removing: false, links }));
      const rows = [...existing, ...added];
      const at = options.positionField;
      if (at === undefined) return rows;
      const place = (r: ListRow) => Number(r.edit.values.value[at] ?? Number.MAX_SAFE_INTEGER);
      return rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => place(a) - place(b) || i - j).map(([r]) => r);
    });
    this.dirty = computed(
      () => this.#new.value.length > 0 || this.#removing.value.size > 0 || this.rows.value.some((r) => r.edit.dirty.value),
    );
    this.valid = computed(() => this.rows.value.every((r) => r.removing || r.edit.valid.value));
  }

  /**
   * A past change to a list, shown over its old rows: updated rows pending in
   * their changed fields, removed rows struck through, added rows pending in
   * full. Read-only; nothing is saved.
   */
  static replay(ctx: DataContext, set: string, before: readonly Entity[], changes: readonly ChangeSet[], options: ListEditOptions = {}): ListEdit {
    const type = ctx.schema.set(set).type;
    const rows = before.map((entity) => ({ key: keyText(keyValues(type, entity)), entity }));
    const list = new ListEdit(ctx, { set, rows }, options);
    list.#replay = true;
    const removing = new Set<string>();
    const added: { id: string; edit: EditModel; links: Record<string, string> }[] = [];
    for (const c of changes) {
      switch (c.kind) {
        case "update": {
          const key = keyText(c.key);
          const old = rows.find((r) => r.key === key)?.entity ?? {};
          list.#edits.set(key, EditModel.replay(ctx, set, old, apply(old, c.changes)));
          break;
        }
        case "delete":
          removing.add(keyText(c.key));
          break;
        case "create": {
          const forced = type.fields.filter((f) => !f.computed).map((f) => f.name);
          added.push({ id: `new:${++list.#counter}`, edit: EditModel.replay(ctx, set, {}, c.values, forced), links: {} });
          break;
        }
      }
    }
    batch(() => {
      list.#removing.value = removing;
      list.#new.value = added;
    });
    return list;
  }

  /** Adds a new row, pending in full. `links` names, by field, the new row whose key that field takes on save. */
  add(values: Entity = {}, links: Readonly<Record<string, string>> = {}): ListRow {
    if (this.#replay) throw new Error("a replay can't be edited");
    const at = this.#options.positionField;
    const position: Entity = at === undefined ? {} : { [at]: Math.max(0, ...this.rows.peek().map((r) => Number(r.edit.values.peek()[at] ?? 0))) + 1 };
    const edit = this.#newEdit({ ...this.#options.defaults?.(), ...position, ...values });
    const id = `new:${++this.#counter}`;
    this.#new.value = [...this.#new.peek(), { id, edit, links }];
    return { id, edit, isNew: true, removing: false, links };
  }

  /** Discards a new row; marks an existing row for deletion. */
  remove(id: string): void {
    if (this.#replay) return;
    const added = this.#new.peek().find((r) => r.id === id);
    if (added) {
      added.edit.dispose();
      this.#new.value = this.#new.peek().filter((r) => r.id !== id);
      return;
    }
    this.#removing.value = new Set(this.#removing.peek()).add(id);
  }

  /** Takes back a pending deletion. */
  restore(id: string): void {
    if (this.#replay) return;
    const next = new Set(this.#removing.peek());
    next.delete(id);
    this.#removing.value = next;
    this.#setRemoveError(id, undefined);
  }

  /** Puts a row at `index` among the rows not being removed, renumbering the position field from 1. */
  move(id: string, index: number): void {
    const at = this.#options.positionField;
    if (this.#replay || at === undefined) return;
    const live = this.rows.peek().filter((r) => !r.removing);
    const row = live.find((r) => r.id === id);
    if (!row) return;
    const order = live.filter((r) => r !== row);
    order.splice(Math.max(0, Math.min(order.length, index)), 0, row);
    batch(() => order.forEach((r, i) => r.edit.values.peek()[at] !== i + 1 && r.edit.set(at, i + 1)));
  }

  /** Every pending change, as change sets in the order `save()` applies them: deletions, updates, creations. */
  changes(): ChangeSet[] {
    const rows = this.rows.peek();
    return [
      ...rows.filter((r) => r.removing).map((r): ChangeSet => ({
        kind: "delete",
        set: this.set,
        key: keyFromText(r.id),
        values: known(r.edit.baseline.peek(), r.edit.hidden.peek()),
      })),
      ...rows.filter((r) => !r.removing && !r.isNew).flatMap((r) => r.edit.changes() ?? []),
      ...this.#new.peek().flatMap(({ edit }) => edit.changes() ?? []),
    ];
  }

  /** Throws away every pending change. */
  revert(): void {
    batch(() => {
      for (const { edit } of this.#new.peek()) edit.dispose();
      this.#new.value = [];
      this.#removing.value = new Set();
      for (const edit of this.#edits.values()) edit.revert();
    });
  }

  /**
   * Applies the changes one write at a time: deletions, then updates, then
   * creations. A failed write leaves its row pending with the error on its
   * edit model, and the rest still go. Not atomic: that needs `$batch`.
   */
  async save(): Promise<ListSaveResult> {
    if (this.#replay || this.#busy.peek()) return { saved: [], failed: [] };
    this.#busy.value = true;
    const saved: ChangeSet[] = [];
    const failed: string[] = [];
    try {
      for (const id of [...this.#removing.peek()]) {
        try {
          saved.push(await this.#ctx.remove(this.set, id));
          this.restore(id);
        } catch (e) {
          if (!(e instanceof ODataError)) throw e;
          failed.push(id);
          this.#setRemoveError(id, `Couldn’t delete it: ${e.message}`);
        }
      }
      for (const row of this.rows.peek()) {
        if (row.removing || !row.edit.dirty.peek() || row.isNew) continue;
        const result = await row.edit.save();
        if (result) saved.push(result.change);
        else failed.push(row.id);
      }
      const created = new Map<string, Value>();
      for (const { id, edit, links } of [...this.#new.peek()]) {
        for (const [field, other] of Object.entries(links)) {
          const key = created.get(other);
          if (key !== undefined) edit.set(field, key);
        }
        const result = await edit.save();
        if (!result) {
          failed.push(id);
          continue;
        }
        saved.push(result.change);
        created.set(id, keyFromText(result.key)[0]!);
        this.#edits.set(result.key, edit);
        this.#new.value = this.#new.peek().filter((r) => r.id !== id);
      }
    } finally {
      this.#busy.value = false;
    }
    return { saved, failed };
  }

  /**
   * Takes the current state as saved elsewhere (a deep update of the
   * parent): changed rows keep their values as their new baseline, new
   * rows and deletions are dropped, as the collection's refresh brings
   * the saved rows.
   */
  accept(): void {
    batch(() => {
      for (const { edit } of this.#new.peek()) edit.dispose();
      this.#new.value = [];
      this.#removing.value = new Set();
      this.#removeErrors.value = new Map();
      for (const edit of this.#edits.values()) if (edit.dirty.peek()) edit.accept();
    });
  }

  /** The working state: new rows, pending deletions and edited rows. */
  draft(): ListDraft {
    const edits: Record<string, EditDraft> = {};
    for (const [key, edit] of this.#edits) if (edit.dirty.peek()) edits[key] = edit.draft();
    return {
      added: this.#new.peek().map(({ id, edit, links }) => ({ id, edit: edit.draft(), links })),
      removing: [...this.#removing.peek()],
      edits,
      counter: this.#counter,
    };
  }

  /** Takes up a draft. Rows it names that are no longer in the list are dropped. */
  resume(draft: ListDraft): void {
    batch(() => {
      this.revert();
      this.#counter = Math.max(this.#counter, draft.counter);
      this.#new.value = draft.added.map(({ id, edit, links }) => {
        const m = this.#newEdit(edit.values);
        m.resume(edit);
        return { id, edit: m, links };
      });
      const present = new Set(this.#existing.peek().map((r) => r.key));
      this.#removing.value = new Set(draft.removing.filter((k) => present.has(k)));
      for (const [key, edit] of Object.entries(draft.edits)) if (present.has(key)) this.#editFor(key).resume(edit);
    });
  }

  dispose(): void {
    for (const edit of this.#edits.values()) edit.dispose();
    for (const { edit } of this.#new.peek()) edit.dispose();
    this.#edits.clear();
  }

  #newEdit(values: Entity): EditModel {
    const edit = new EditModel(this.#ctx, this.set, undefined, values, this.#options);
    for (const field of edit.type.fields) if (!field.computed) edit.forcePending(field.name, true);
    return edit;
  }

  #setRemoveError(id: string, message: string | undefined): void {
    const next = new Map(this.#removeErrors.peek());
    if (message === undefined) next.delete(id);
    else next.set(id, message);
    this.#removeErrors.value = next;
  }

  #editFor(key: KeyText): EditModel {
    let edit = this.#edits.get(key);
    if (!edit) {
      if (this.#replay) {
        const entity = this.#existing.peek().find((r) => r.key === key)?.entity ?? {};
        edit = EditModel.replay(this.#ctx, this.set, entity, entity);
      } else {
        edit = new EditModel(this.#ctx, this.set, key, {}, this.#options);
      }
      this.#edits.set(key, edit);
    }
    return edit;
  }
}

/** A deleted record's values for undo, without the hidden ones: their `null` isn't what was stored. */
function known(entity: Entity, hidden: ReadonlySet<string>): Entity {
  if (hidden.size === 0) return entity;
  return Object.fromEntries(Object.entries(entity).filter(([name]) => !hidden.has(name)));
}
