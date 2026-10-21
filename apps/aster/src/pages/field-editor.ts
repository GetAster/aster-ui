import { computed, effect, signal, type ReadonlySignal } from "@preact/signals-core";
import {
  PageScope,
  RecordEdit,
  valuesPublication,
  type ChangeSet,
  type Collection,
  type DataContext,
  type FieldRules,
  type KeyText,
  type RecordDraft,
  type RecordProblems,
  type RecordSave,
  type RecordSnapshot,
  type Rule,
  type Value,
} from "@getaster/data";
import type { ExpansionEditor, FormSection, ListColumn, RuleField, TreeChoices } from "@getaster/elements";
import { html, nothing, type TemplateResult } from "lit-html";
import type { Drafts } from "../drafts.ts";

export type FieldTab = "definition" | "answers" | "visibility" | "messages";
export const FIELD_TABS: readonly FieldTab[] = ["definition", "answers", "visibility", "messages"];
const TAB_LABELS: Record<FieldTab, string> = { definition: "Definition", answers: "Answers", visibility: "Visibility", messages: "Messages" };

const GROUP_OPS = ["and", "or", "not"];
const UNARY = ["set", "unset"];
const LOCKED = "The model is locked. Unlock it to make changes.";

/** What the model's editors share: the fields a rule can name, what each allows, and the drafts. */
export interface ModelContext {
  readonly ctx: DataContext;
  readonly fields: TreeChoices;
  readonly describe: (fieldRef: Value | undefined) => ReadonlySignal<RuleField | undefined>;
  readonly drafts: Drafts;
  readonly locked: ReadonlySignal<boolean>;
}

export interface FieldEditor extends ExpansionEditor {
  readonly record: RecordEdit;
  readonly tab: ReadonlySignal<FieldTab>;
  select(tab: FieldTab): void;
}

/** A condition needs a field, a test and (for most tests) a value. */
const clauseRule: Rule = (v) => {
  const op = v.op === null || v.op === undefined ? "" : String(v.op);
  if (GROUP_OPS.includes(op)) return {};
  return {
    fieldRef: v.fieldRef === null || v.fieldRef === undefined ? "Choose a field." : undefined,
    op: op === "" ? "Choose a test." : undefined,
    value: op !== "" && !UNARY.includes(op) && (v.value === null || v.value === undefined || v.value === "") ? "Give a value." : undefined,
  };
};

export function recordOptions() {
  return { owned: { answers: { positionField: "position" }, clauses: { rules: [clauseRule] } } };
}

/** What each operator a field's kind allows, and its values. */
export function describer(ctx: DataContext): (fieldRef: Value | undefined) => ReadonlySignal<RuleField | undefined> {
  const answers = new Map<number, Collection>();
  const cache = new Map<number, ReadonlySignal<RuleField | undefined>>();
  const none = signal<RuleField | undefined>(undefined);
  return (ref) => {
    if (typeof ref !== "number") return none;
    let out = cache.get(ref);
    if (out) return out;
    const field = ctx.lookup("Fields", `[${ref}]`);
    out = computed((): RuleField | undefined => {
      const f = field.value;
      switch (f?.kind) {
        case undefined:
          return undefined;
        case "choice": {
          let list = answers.get(ref);
          if (!list) {
            list = ctx.collection({ set: "Answers", filter: { op: "eq", field: "fieldId", value: ref }, orderBy: [{ field: "position" }] }, { pageSize: 200 });
            answers.set(ref, list);
            void list.loadAll();
          }
          const options = list.items.value.flatMap((a) => (a ? [{ value: a.key as Value, label: String(a.label) }] : []));
          return { operators: ["eq", "ne", "in", "set", "unset"], input: "text", options };
        }
        case "yesno":
          return { operators: ["eq", "set", "unset"], input: "text", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] };
        case "number":
          return { operators: ["eq", "ne", "gt", "lt", "set", "unset"], input: "number" };
        case "date":
          return { operators: ["eq", "ne", "gt", "lt", "set", "unset"], input: "date" };
        default:
          return { operators: ["eq", "ne", "set", "unset"], input: "text" };
      }
    });
    cache.set(ref, out);
    return out;
  };
}

/** The tabs a field of this kind has. */
export function tabsFor(kind: Value | undefined): FieldTab[] {
  return FIELD_TABS.filter((t) => t !== "answers" || kind === "choice");
}

/**
 * A field's expansion: Definition, Answers (for a choice), Visibility and
 * Messages over one record edit, so the field, its answers and its rules
 * are one change set and one save. Tabs build when first chosen; saving
 * checks every row, built or not, and names what fails. The working state
 * goes to the drafts as it changes, and a draft there is taken up on open.
 */
export function fieldEditor(
  m: ModelContext,
  key: KeyText,
  onTab: (tab: FieldTab) => void,
  onSaved: (result: RecordSave) => Promise<void>,
): FieldEditor {
  const { ctx } = m;
  const record = new RecordEdit(ctx, "Fields", key, recordOptions());
  const tab = signal<FieldTab>("definition");
  const built = signal<ReadonlySet<FieldTab>>(new Set(["definition"]));
  const problems = signal<readonly string[]>([]);
  const failure = signal<string | undefined>(undefined);
  const scope = new PageScope();
  scope.publish("page", valuesPublication({ locked: m.locked }));
  const lock: FieldRules = { readOnly: { when: "page.locked", reason: LOCKED } };
  record.edit.applyRules(scope, "field", { name: lock, label: lock, required: lock, help: lock });
  const draftKey = `Fields/${key}`;
  const stop: (() => void)[] = [];
  void m.drafts.load<RecordDraft>(draftKey).then(async (d) => {
    if (d) await record.resume(d);
    // Every edit from here on is kept, so a reload loses nothing.
    stop.push(
      effect(() => {
        record.edit.values.value;
        for (const list of Object.values(record.owned)) for (const r of list.rows.value) r.edit.values.value;
        if (record.dirty.value) void m.drafts.save(draftKey, record.draft());
        else void m.drafts.remove(draftKey);
      }),
    );
  });
  const select = (t: FieldTab) => {
    tab.value = t;
    if (!built.peek().has(t)) built.value = new Set([...built.peek(), t]);
  };
  const choose = (t: FieldTab) => {
    if (t === tab.peek()) return;
    select(t);
    onTab(t);
  };
  const id = `field-${key.replace(/\W/g, "")}`;
  return {
    record,
    tab,
    select,
    get view() {
      const kind = record.edit.values.value.kind;
      const tabs = tabsFor(kind);
      const current = tabs.includes(tab.value) ? tab.value : "definition";
      const count = (name: "answers" | "clauses", category?: string) =>
        record.owned[name]!.rows.value.filter((r) => !r.removing && (category === undefined || (r.edit.values.value.category === category && GROUP_OPS.includes(String(r.edit.values.value.op)) && r.edit.values.value.parentClauseId === null && !r.links?.parentClauseId))).length;
      const labels: Record<FieldTab, string> = {
        definition: "Definition",
        answers: `Answers ${count("answers")}`,
        visibility: "Visibility",
        messages: `Messages ${count("clauses", "message")}`,
      };
      return html`<div class="field-editor">
        ${problems.value.length
          ? html`<div class="task-editor-problems" role="alert">
              <p>These need fixing before the field can be saved:</p>
              <ul>${problems.value.map((p) => html`<li>${p}</li>`)}</ul>
            </div>`
          : nothing}
        ${failure.value ? html`<p class="aster-error" role="alert">${failure.value}</p>` : nothing}
        ${conflictNote(record)}
        <aster-tabs .label=${"Field sections"} .controls=${`${id}-panel`}
          .items=${tabs.map((t) => ({ value: t, label: labels[t] }))}
          .value=${current} @change=${(e: CustomEvent<FieldTab>) => choose(e.detail)}></aster-tabs>
        <div class="task-editor-panel" id=${`${id}-panel`} role="tabpanel">${panel(m, record, current)}</div>
      </div>`;
    },
    dirty: record.dirty,
    async save() {
      failure.value = undefined;
      const result = await record.save();
      if (!result) {
        if (!record.dirty.peek()) return true;
        problems.value = describeProblems(record, record.problems());
        const p = record.problems();
        select(p.record.length ? "definition" : p.owned.answers ? "answers" : firstRuleTab(record, p));
        return false;
      }
      problems.value = [];
      // The save is all or nothing: a failure saved none of it.
      if (!result.ok) {
        failure.value = record.failure.peek() ?? "Nothing was saved. The changes the server refused are marked.";
        return false;
      }
      await onSaved(result);
      await m.drafts.remove(draftKey);
      return true;
    },
    discard() {
      record.revert();
      problems.value = [];
      void m.drafts.remove(draftKey);
    },
    dispose() {
      for (const s of stop) s();
      record.dispose();
    },
  };
}

function conflictNote(record: RecordEdit): TemplateResult | typeof nothing {
  const conflict = record.edit.conflict.value;
  if (!conflict) return nothing;
  const titles = conflict.fields.map((f) => record.edit.type.field(f)?.title ?? f).join(", ");
  return html`<div class="field-conflict" role="alert">
    <p>Someone else changed ${titles} since you started. Keep yours on top of their version, or take theirs.</p>
    <aster-button .label=${"Keep mine"} @click=${() => record.edit.rebase()}></aster-button>
    <aster-button .label=${"Take theirs"} @click=${() => record.edit.discard()}></aster-button>
  </div>`;
}

const SECTIONS: FormSection[] = [{ title: "Field", columns: 2, items: ["name", "label", "kind", "required", { field: "help", span: 2 }] }];
const ANSWER_COLUMNS: ListColumn[] = [
  { field: "key", width: "minmax(7rem, 1fr)" },
  { field: "label", width: "minmax(0, 2fr)" },
];

/** One tab's content; read-only when the model is locked, or for a replay. */
export function panel(m: ModelContext | Pick<ModelContext, "fields" | "describe">, record: RecordEdit, tab: FieldTab, reason?: string): TemplateResult {
  const locked = reason ?? ("locked" in m && m.locked.value ? LOCKED : undefined);
  switch (tab) {
    case "definition":
      return html`<aster-form .model=${record.edit} .sections=${SECTIONS}></aster-form>`;
    case "answers":
      return html`<aster-list-editor .list=${record.owned.answers} .columns=${ANSWER_COLUMNS} .label=${"Answers"} .addLabel=${"Add answer"}
        .readOnlyReason=${locked} .empty=${"No answers yet."}></aster-list-editor>`;
    case "visibility":
      return html`<aster-rule-editor .list=${record.owned.clauses} .category=${"visibility"} .label=${"Shown when"} .empty=${"Always shown."}
        .fields=${m.fields} .describe=${m.describe} .readOnlyReason=${locked}></aster-rule-editor>`;
    case "messages":
      return html`<aster-rule-editor .list=${record.owned.clauses} .category=${"message"} .messages=${true} .label=${"Messages"} .empty=${"No messages."}
        .fields=${m.fields} .describe=${m.describe} .readOnlyReason=${locked}></aster-rule-editor>`;
  }
}

function firstRuleTab(record: RecordEdit, p: RecordProblems): FieldTab {
  const failing = new Set((p.owned.clauses ?? []).map((x) => x.id));
  const row = record.owned.clauses!.rows.peek().find((r) => failing.has(r.id));
  return row?.edit.values.peek().category === "message" ? "messages" : "visibility";
}

function describeProblems(record: RecordEdit, p: RecordProblems): string[] {
  const title = (set: "Fields" | "Answers" | "Clauses", f: string) => record.edit.type.field(f)?.title ?? (set === "Fields" ? f : f);
  const out = p.record.map((f) => `${title("Fields", f)}`);
  (p.owned.answers ?? []).forEach((a) => {
    const n = record.owned.answers!.rows.peek().filter((r) => !r.removing).findIndex((r) => r.id === a.id) + 1;
    out.push(`Answer ${n}: ${a.fields.map((f) => record.owned.answers!.type.field(f)?.title ?? f).join(", ")}`);
  });
  (p.owned.clauses ?? []).forEach((c) => {
    const row = record.owned.clauses!.rows.peek().find((r) => r.id === c.id);
    const where = row?.edit.values.peek().category === "message" ? "A message’s condition" : "A visibility condition";
    out.push(`${where}: ${c.fields.map((f) => record.owned.clauses!.type.field(f)?.title ?? f).join(", ")}`);
  });
  return out;
}

/** What a log entry stores: the change, and the repairs it made to other fields' rules. */
export interface LoggedChange {
  readonly change: ChangeSet;
  readonly repairs?: readonly { readonly fieldId: number; readonly label: string; readonly before: RecordSnapshot; readonly change: ChangeSet }[];
}

/** The tabs a logged change touched, in order; a clause's category comes from the change or, for an update, the row before. */
export function changedTabs(change: ChangeSet, before: RecordSnapshot, kind: Value): FieldTab[] {
  if (change.kind !== "update") return tabsFor(kind);
  const owned = change.owned ?? {};
  const old = new Map((before.owned.clauses ?? []).map((r) => [JSON.stringify([r.id]), r.category]));
  const category = (c: ChangeSet) => (c.kind === "update" ? old.get(JSON.stringify(c.key)) : c.values.category);
  const touches = (cat: string) => (owned.clauses ?? []).some((c) => category(c) === cat);
  return FIELD_TABS.filter((t) => {
    switch (t) {
      case "definition":
        return Object.keys(change.changes).length > 0;
      case "answers":
        return (owned.answers?.length ?? 0) > 0;
      case "visibility":
        return touches("visibility");
      case "messages":
        return touches("message");
    }
  });
}

export { TAB_LABELS };
