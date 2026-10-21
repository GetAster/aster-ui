import { batch, computed, signal, type ReadonlySignal } from "@preact/signals-core";
import { apply, creatable, type ChangeSet, type FieldChange } from "../changes/changeset.ts";
import type { Collection } from "../collection/collection.ts";
import type { DataContext } from "../context.ts";
import type { Criteria } from "../criteria/ast.ts";
import type { Entity, EntityType, Navigation } from "../schema/model.ts";
import { ODataError } from "../odata/errors.ts";
import type { DeltaEntry } from "../odata/source.ts";
import { keyFromText, keyText, keyValues, type KeyText } from "../store/keys.ts";
import { EditModel, type EditDraft, type EditOptions } from "./edit-model.ts";
import { ListEdit, type ListDraft, type ListEditOptions, type ListRow } from "./list-edit.ts";

/** A record and its owned rows as they were: what a replay shows a change over. Plain data. */
export interface RecordSnapshot {
  readonly record: Entity;
  readonly owned: Readonly<Record<string, readonly Entity[]>>;
}

/** A record edit's working state, enough to resume it after a reload. Plain data. */
export interface RecordDraft {
  readonly edit: EditDraft;
  readonly owned: Readonly<Record<string, ListDraft>>;
}

export interface RecordEditOptions extends EditOptions {
  /** Options for each owned collection's list, by navigation name. */
  readonly owned?: Readonly<Record<string, ListEditOptions>>;
}

/** What one save did: `change` is what was sent, with no server-assigned keys. A save is all or nothing. */
export interface RecordSave {
  readonly ok: boolean;
  readonly change: ChangeSet;
  /** The record and its owned rows before the save. */
  readonly before: RecordSnapshot;
  /** `["record"]` when the save was refused, and nothing was saved; otherwise empty. */
  readonly failed: readonly string[];
}

/** What fails validation: the record's fields, and each owned list's rows. */
export interface RecordProblems {
  readonly record: readonly string[];
  readonly owned: Readonly<Record<string, readonly { readonly id: string; readonly fields: readonly string[] }[]>>;
}

/**
 * Edits an existing record together with the collections it owns
 * (`AsterData.Owned`): its fields in one edit model, each owned collection
 * in a list edit whose new rows point at the record. Everything is one
 * change set, one validation and one save; nothing is written per record
 * type.
 *
 * Saving is one deep update (`<navigation>@delta`): the record and every
 * owned change in one request, all or nothing.
 */
export class RecordEdit {
  readonly set: string;
  readonly key: KeyText;
  readonly edit: EditModel;
  readonly owned: Readonly<Record<string, ListEdit>>;
  readonly dirty: ReadonlySignal<boolean>;
  readonly valid: ReadonlySignal<boolean>;
  /** Settles when every owned collection has loaded. */
  readonly ready: Promise<void>;
  readonly #ctx: DataContext;
  readonly #collections: Collection[] = [];
  readonly #replay: boolean;

  constructor(ctx: DataContext, set: string, key: KeyText, options?: RecordEditOptions);
  /** @internal */
  constructor(ctx: DataContext, set: string, key: KeyText, options: RecordEditOptions, replay: { edit: EditModel; owned: Record<string, ListEdit> });
  constructor(
    ctx: DataContext,
    set: string,
    key: KeyText,
    options: RecordEditOptions = {},
    replay?: { edit: EditModel; owned: Record<string, ListEdit> },
  ) {
    this.#ctx = ctx;
    this.set = set;
    this.key = key;
    this.#replay = replay !== undefined;
    if (replay) {
      this.edit = replay.edit;
      this.owned = Object.freeze(replay.owned);
      this.ready = Promise.resolve();
    } else {
      this.edit = new EditModel(ctx, set, key, {}, options);
      const record = this.edit.baseline.peek();
      const owned: Record<string, ListEdit> = {};
      for (const nav of ownedNavigations(ctx, set)) {
        const listOptions = options.owned?.[nav.name] ?? {};
        const collection = ctx.collection(
          { set: nav.target, filter: ownedFilter(nav, record), orderBy: [{ field: listOptions.positionField ?? keyField(ctx, nav.target) }] },
          { pageSize: 1000 },
        );
        this.#collections.push(collection);
        const defaults: Entity = Object.fromEntries(nav.keys.map(([principal, dependent]) => [dependent, record[principal] ?? null]));
        owned[nav.name] = new ListEdit(ctx, collection, { ...listOptions, defaults: () => ({ ...listOptions.defaults?.(), ...defaults }) });
      }
      this.owned = Object.freeze(owned);
      this.ready = Promise.all(this.#collections.map((c) => c.loadAll())).then(() => {});
    }
    const lists = Object.values(this.owned);
    this.dirty = computed(() => this.edit.dirty.value || lists.some((l) => l.dirty.value));
    this.valid = computed(() => this.edit.valid.value && lists.every((l) => l.valid.value));
  }

  /**
   * A past change shown over what the record and its owned rows were: the
   * record's fields and each list as replays, read-only, with pending
   * marking exactly what the change did.
   */
  static replay(ctx: DataContext, before: RecordSnapshot, change: ChangeSet): RecordEdit {
    const set = change.set;
    const changes: Readonly<Record<string, FieldChange>> = change.kind === "update" ? change.changes : {};
    const after = change.kind === "create" ? change.values : apply(before.record, changes);
    const edit = EditModel.replay(ctx, set, change.kind === "create" ? {} : before.record, after);
    const owned: Record<string, ListEdit> = {};
    for (const nav of ownedNavigations(ctx, set)) {
      const rows = before.owned[nav.name] ?? [];
      const ownedChanges: readonly ChangeSet[] =
        change.kind === "update" ? (change.owned?.[nav.name] ?? [])
        : change.kind === "delete" ? rows.map((values): ChangeSet => ({ kind: "delete", set: nav.target, key: keyOfRow(ctx, nav.target, values), values }))
        : [];
      owned[nav.name] = ListEdit.replay(ctx, nav.target, rows, ownedChanges);
    }
    const key = change.kind === "create" ? "" : keyText(change.key);
    return new RecordEdit(ctx, set, key, {}, { edit, owned });
  }

  /** The record and its owned rows as they were when editing began. */
  snapshot(): RecordSnapshot {
    const owned: Record<string, Entity[]> = {};
    for (const [name, list] of Object.entries(this.owned)) {
      owned[name] = list.rows.peek().filter((r) => !r.isNew).map((r) => r.edit.baseline.peek());
    }
    return { record: this.edit.baseline.peek(), owned };
  }

  /** The change a save would make, or `undefined` when nothing changed. */
  changes(): ChangeSet | undefined {
    if (!this.dirty.peek()) return undefined;
    const own = this.edit.changes();
    const owned: Record<string, readonly ChangeSet[]> = {};
    for (const [name, list] of Object.entries(this.owned)) {
      const c = list.changes();
      if (c.length) owned[name] = c;
    }
    return {
      kind: "update",
      set: this.set,
      key: keyFromText(this.key),
      changes: own?.kind === "update" ? own.changes : {},
      ...(Object.keys(owned).length ? { owned } : {}),
    };
  }

  /** Validates every field, shown or not, and says what fails. */
  problems(): RecordProblems {
    this.edit.validate();
    const owned: Record<string, { id: string; fields: string[] }[]> = {};
    for (const [name, list] of Object.entries(this.owned)) {
      const failing = list.rows.peek().filter((r) => !r.removing && !r.edit.validate());
      if (failing.length) owned[name] = failing.map((r) => ({ id: r.id, fields: Object.keys(r.edit.errors.peek()) }));
    }
    return { record: Object.keys(this.edit.errors.peek()), owned };
  }

  /**
   * Validates, then writes the record and every owned change in one deep
   * update (`<navigation>@delta`), all or nothing: new children of a new
   * child go inside its entry. Returns `undefined` when nothing changed or
   * something is invalid (see `problems()`). On a 412 the newer record is
   * taken in: with no overlap the edit is sent once more, otherwise
   * `edit.conflict` says so. Server errors land on the fields and rows they
   * name.
   */
  async save(): Promise<RecordSave | undefined> {
    if (this.#replay || this.#busy || !this.dirty.peek()) return undefined;
    if (this.edit.conflict.peek() || this.edit.deleted.peek()) return undefined;
    const problems = this.problems();
    if (problems.record.length || Object.keys(problems.owned).length) return undefined;
    this.#busy = true;
    this.#failure.value = undefined;
    try {
      const before = this.snapshot();
      const change = this.changes()!;
      const { deltas, paths } = this.#deltas();
      const own = change.kind === "update" ? Object.fromEntries(Object.entries(change.changes).map(([k, c]) => [k, c.to])) : {};
      for (let attempt = 0; ; attempt++) {
        try {
          const saved = await this.#ctx.update(this.set, this.key, own, this.edit, this.edit.etag, deltas);
          batch(() => {
            this.edit.accept(saved.record);
            for (const list of Object.values(this.owned)) list.accept();
          });
          await Promise.all(this.#collections.map((c) => c.refresh()));
          return { ok: true, change, before, failed: [] };
        } catch (e) {
          if (!(e instanceof ODataError)) throw e;
          // A 412 takes in the newer record; with nothing overlapping, the edit goes once more.
          if (e.isConflict && attempt === 0 && !this.edit.conflict.peek()) continue;
          this.#showErrors(e, paths);
          return { ok: false, change, before, failed: ["record"] };
        }
      }
    } finally {
      this.#busy = false;
    }
  }

  #busy = false;

  /**
   * Each owned list's changes as `@delta` entries, and the row behind each
   * entry by its path in the request (`clauses[2]`, `clauses[0]/children[1]`),
   * for placing errors. A new row linked to another new row goes inside that
   * row's entry, under the navigation whose key is the link's field.
   */
  #deltas(): { deltas: Record<string, DeltaEntry[]>; paths: Map<string, ListRow> } {
    const deltas: Record<string, DeltaEntry[]> = {};
    const behind = new Map<DeltaEntry, ListRow>();
    for (const [name, list] of Object.entries(this.owned)) {
      const type = list.type;
      const entries: DeltaEntry[] = [];
      const created = new Map<string, { values: Entity; nested: Record<string, DeltaEntry[]> }>();
      for (const row of list.rows.peek()) {
        if (row.removing) {
          const e = { removed: keyFromText(row.id) };
          entries.push(e);
          behind.set(e, row);
        } else if (row.isNew) {
          const e = { values: creatable(type, row.edit.values.peek()), nested: {} };
          created.set(row.id, e);
          behind.set(e, row);
        } else if (row.edit.dirty.peek()) {
          const c = row.edit.changes();
          if (c?.kind !== "update") continue;
          const changed = Object.fromEntries(Object.entries(c.changes).map(([k, v]) => [k, v.to]));
          const e = { values: { ...keyValuesOf(type, row.edit.baseline.peek()), ...changed } };
          entries.push(e);
          behind.set(e, row);
        }
      }
      for (const row of list.rows.peek()) {
        const entry = created.get(row.id);
        if (!entry) continue;
        const [field, parent] = Object.entries(row.links ?? {})[0] ?? [];
        const host = parent === undefined ? undefined : created.get(parent);
        const nav = field === undefined ? undefined : type.navigations.find((n) => n.collection && n.keys.some(([, d]) => d === field));
        if (host && nav && field) {
          const { [field]: _, ...values } = entry.values;
          entry.values = values;
          (host.nested[nav.name] ??= []).push(entry);
        } else {
          entries.push(entry);
        }
      }
      if (entries.length) deltas[name] = entries;
    }
    const paths = new Map<string, ListRow>();
    const walk = (prefix: string, entries: readonly DeltaEntry[]) =>
      entries.forEach((e, i) => {
        const path = `${prefix}[${i}]`;
        const row = behind.get(e);
        if (row) paths.set(path, row);
        if ("nested" in e) for (const [nav, kids] of Object.entries(e.nested ?? {})) walk(`${path}/${nav}`, kids);
      });
    for (const [name, entries] of Object.entries(deltas)) walk(name, entries);
    return { deltas, paths };
  }

  /**
   * Puts a refused save's errors where they belong: a target naming a row's
   * path and a field (`clauses[0]/children[1]/value`) on that row's field, a
   * bare name on the record's; anything else is the save's `failure`.
   */
  #showErrors(e: ODataError, paths: ReadonlyMap<string, ListRow>): void {
    const byRow = new Map<EditModel, Record<string, string[]>>();
    const own: Record<string, string[]> = {};
    for (const d of e.details) {
      const target = d.target ?? "";
      const at = target.lastIndexOf("/");
      const row = at < 0 ? undefined : paths.get(target.slice(0, at));
      const field = target.slice(at + 1);
      if (row && /^\w+$/.test(field)) {
        const errs = byRow.get(row.edit) ?? {};
        (errs[field] ??= []).push(d.message);
        byRow.set(row.edit, errs);
      } else if (/^\w+$/.test(target)) {
        (own[target] ??= []).push(d.message);
      }
    }
    batch(() => {
      if (Object.keys(own).length) this.edit.showErrors(own);
      for (const [edit, errs] of byRow) edit.showErrors(errs);
    });
    this.#failure.value = byRow.size || Object.keys(own).length ? undefined : e.message;
  }

  /** Why the last save failed, when it isn't about a field. */
  readonly #failure = signal<string | undefined>(undefined);
  readonly failure: ReadonlySignal<string | undefined> = this.#failure;

  revert(): void {
    batch(() => {
      this.edit.revert();
      for (const list of Object.values(this.owned)) list.revert();
    });
  }

  draft(): RecordDraft {
    const owned: Record<string, ListDraft> = {};
    for (const [name, list] of Object.entries(this.owned)) owned[name] = list.draft();
    return { edit: this.edit.draft(), owned };
  }

  /** Takes up a draft once the owned rows are loaded. */
  async resume(draft: RecordDraft): Promise<void> {
    await this.ready;
    batch(() => {
      this.edit.resume(draft.edit);
      for (const [name, list] of Object.entries(this.owned)) {
        const d = draft.owned[name];
        if (d) list.resume(d);
      }
    });
  }

  dispose(): void {
    this.edit.dispose();
    for (const list of Object.values(this.owned)) list.dispose();
    for (const c of this.#collections) this.#ctx.release(c);
  }
}

function ownedNavigations(ctx: DataContext, set: string): Navigation[] {
  return ctx.schema.set(set).type.navigations.filter((n) => n.owned && n.collection);
}

function ownedFilter(nav: Navigation, record: Entity): Criteria {
  const parts: Criteria[] = nav.keys.map(([principal, dependent]) => ({ op: "eq", field: dependent, value: record[principal] ?? null }));
  return parts.length === 1 ? parts[0]! : { op: "and", args: parts };
}

function keyField(ctx: DataContext, set: string): string {
  return ctx.schema.set(set).type.key[0]!;
}

/** A row's key properties by name, for a `@delta` entry. */
function keyValuesOf(type: EntityType, row: Entity): Entity {
  const values = keyValues(type, row);
  return Object.fromEntries(type.key.map((k, i) => [k, values[i] ?? null]));
}

function keyOfRow(ctx: DataContext, set: string, row: Entity) {
  return ctx.schema.set(set).type.key.map((k) => row[k] ?? null);
}
