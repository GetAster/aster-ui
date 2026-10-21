import { computed, signal, type ReadonlySignal } from "@preact/signals-core";
import { EditModel, ListEdit, PageScope, valuesPublication, type DataContext, type Entity, type FieldRules, type KeyText } from "@getaster/data";
import type { ExpansionEditor, FormSection, ListColumn, PickerOptions } from "@getaster/elements";
import { html, nothing } from "lit-html";

export type Tab = "details" | "subtasks";
export const TABS: readonly Tab[] = ["details", "subtasks"];

/** The editor, with the tab it shows: deep links choose it, and choosing it is a history entry. */
export interface TaskEditor extends ExpansionEditor {
  select(tab: Tab): void;
  readonly tab: ReadonlySignal<Tab>;
}

const LOCKED = "Editing is locked for this page. Unlock it to make changes.";

/**
 * A task's expansion: Details and Subtasks tabs over one edit model and a
 * list of its children. A tab's form is built when first selected; saving
 * checks every field, built or not, and names the ones that fail.
 */
export function taskEditor(
  ctx: DataContext,
  key: KeyText,
  entity: Entity,
  people: PickerOptions,
  locked: ReadonlySignal<boolean>,
  onTab: (tab: Tab) => void = () => {},
): TaskEditor {
  const tab = signal<Tab>("details");
  const built = signal<ReadonlySet<Tab>>(new Set(["details"]));
  const problems = signal<readonly string[]>([]);
  const edit = new EditModel(ctx, "Tasks", key);
  const scope = new PageScope();
  scope.publish("page", valuesPublication({ locked }));
  const lock: FieldRules = { readOnly: { when: "page.locked", reason: LOCKED } };
  edit.applyRules(scope, "task", { title: lock, assigneeId: lock, due: lock, done: lock });
  const rows = ctx.collection(
    { set: "Tasks", filter: { op: "eq", field: "parentId", value: entity.id ?? null }, orderBy: [{ field: "id" }] },
    { pageSize: 500 },
  );
  void rows.loadAll();
  const subtasks = new ListEdit(ctx, rows, {
    defaults: (): Entity => ({ projectId: entity.projectId ?? null, parentId: entity.id ?? null, title: "", due: null, assigneeId: null, done: false }),
  });
  const dirty = computed(() => edit.dirty.value || subtasks.dirty.value);
  const id = `task-${String(entity.id)}`;
  const sections: FormSection[] = [
    { title: "Task", columns: 2, items: [{ field: "title", span: 2 }, { field: "assigneeId", options: people }, "due", "done"] },
  ];
  const columns: ListColumn[] = [
    { field: "title", width: "minmax(0, 2fr)" },
    { field: "assigneeId", width: "minmax(8rem, 1fr)", options: people },
    { field: "due", width: "minmax(8.5rem, 1fr)" },
    { field: "done", width: "3.5rem" },
  ];
  const select = (t: Tab) => {
    tab.value = t;
    if (!built.peek().has(t)) built.value = new Set([...built.peek(), t]);
  };
  const choose = (t: Tab) => {
    if (t === tab.peek()) return;
    select(t);
    onTab(t);
  };
  const titleOf = (name: string) => edit.type.field(name)?.title ?? name;
  return {
    get view() {
      const current = tab.value;
      const count = subtasks.rows.value.filter((r) => !r.removing).length;
      return html`<div class="task-editor">
        ${problems.value.length
          ? html`<div class="task-editor-problems" role="alert">
              <p>These need fixing before the task can be saved:</p>
              <ul>${problems.value.map((p) => html`<li>${p}</li>`)}</ul>
            </div>`
          : nothing}
        <aster-tabs .label=${"Task sections"} .controls=${`${id}-panel`}
          .items=${[{ value: "details", label: "Details" }, { value: "subtasks", label: `Subtasks ${count}` }]}
          .value=${current} @change=${(e: CustomEvent<Tab>) => choose(e.detail)}></aster-tabs>
        <div class="task-editor-panel" id=${`${id}-panel`} role="tabpanel">
          ${current === "details"
            ? html`<aster-form .model=${edit} .sections=${sections}></aster-form>`
            : html`<aster-list-editor .list=${subtasks} .columns=${columns} .label=${"Subtasks"} .addLabel=${"Add subtask"}
                .readOnlyReason=${locked.value ? LOCKED : undefined} .empty=${"No subtasks yet."}></aster-list-editor>`}
        </div>
      </div>`;
    },
    dirty,
    tab,
    select,
    async save() {
      // Every field, on built tabs and unbuilt ones alike: the values are in the models either way.
      const taskValid = edit.validate();
      const failing = subtasks.rows.peek().filter((r) => !r.removing && !r.edit.validate());
      if (!taskValid || failing.length) {
        problems.value = [
          ...Object.keys(edit.errors.peek()).map(titleOf),
          ...failing.map((r, n) => `Subtask ${n + 1}: ${Object.keys(r.edit.errors.peek()).map(titleOf).join(", ")}`),
        ];
        select(!taskValid ? "details" : "subtasks");
        return false;
      }
      problems.value = [];
      if (edit.dirty.peek() && !(await edit.save())) return false;
      const result = await subtasks.save();
      return result.failed.length === 0;
    },
    discard() {
      edit.revert();
      subtasks.revert();
      problems.value = [];
    },
    dispose() {
      edit.dispose();
      subtasks.dispose();
      ctx.release(rows);
    },
  };
}
