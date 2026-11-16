import { computed } from "@preact/signals-core";
import type { EditModel } from "../edit/edit-model.ts";
import type { Publication } from "./scope.ts";

// Its own module so a ListEdit can publish its rows without importing the other publications.

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
