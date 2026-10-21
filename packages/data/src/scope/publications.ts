import { computed, type ReadonlySignal } from "@preact/signals-core";
import type { Collection } from "../collection/collection.ts";
import type { DataContext } from "../context.ts";
import type { EditModel } from "../edit/edit-model.ts";
import type { ListEdit } from "../edit/list-edit.ts";
import type { KeyText } from "../store/keys.ts";
import type { Selection } from "../selection/selection.ts";
import type { Publication } from "./scope.ts";

// Every component of a kind publishes the same names, so rules read
// `<key>.selected.state` whichever list published it.

/** `selected`, `records`, `keys`, `key`, `count`, `any`, `many`. */
export function selectionPublication(selection: Selection): Publication {
  return {
    values: {
      selected: selection.selected,
      records: selection.records,
      keys: selection.keys,
      key: selection.key,
      count: selection.count,
      any: selection.any,
      many: selection.many,
    },
    types: { selected: selection.collection.type },
    hidden: { selected: selection.hidden },
  };
}

/** `values`, `record` (as saved), `dirty`, `valid`, `errors`, `mode`, `busy`, `deleted`. */
export function editPublication(edit: EditModel): Publication {
  return {
    values: {
      values: edit.values,
      record: edit.baseline,
      dirty: edit.dirty,
      valid: edit.valid,
      errors: edit.errors,
      mode: computed(() => (edit.isNew.value ? "create" : "update")),
      busy: edit.busy,
      deleted: edit.deleted,
    },
    types: { values: edit.type, record: edit.type },
    hidden: { values: edit.hidden, record: edit.hidden },
  };
}

/** `total`, `loading`, `complete`, `stale`. */
export function collectionPublication(collection: Collection): Publication {
  return {
    values: {
      total: collection.count,
      loading: computed(() => collection.status.value === "loading"),
      complete: collection.complete,
      stale: collection.stale,
    },
  };
}

/**
 * A repeating group: `rows` (the values of the rows not being removed) and
 * `count`, typed, so rules range over them with `any` and `all`.
 */
export function listPublication(list: ListEdit): Publication {
  const rows = computed(() => list.rows.value.filter((r) => !r.removing).map((r) => r.edit.values.value));
  return { values: { rows, count: computed(() => rows.value.length) }, types: { rows: list.type } };
}

/**
 * A page input: the record a page was opened with, as `record` and its
 * `key`. The input is the key, plain text, so a page opened in another tab
 * or window from the same address gets the same input.
 */
export function inputPublication(ctx: DataContext, set: string, key: KeyText): Publication {
  const record = ctx.lookup(set, key);
  const stored = ctx.store.record(set, key);
  return {
    values: { key: computed(() => key), record },
    types: { record: ctx.schema.set(set).type },
    hidden: { record: computed(() => stored.value?.hidden ?? NONE) },
  };
}

const NONE: ReadonlySet<string> = new Set();

/** App state under names of its choosing. */
export function valuesPublication(values: Readonly<Record<string, ReadonlySignal<unknown>>>): Publication {
  return { values };
}
