import { computed, signal } from "@preact/signals-core";
import {
  EditModel,
  ListEdit,
  editPublication,
  keyFromText,
  keyText,
  subtractExact,
  valuesPublication,
  type Collection,
  type Condition,
  type Criteria,
  type Entity,
  type KeyText,
  type PageScope,
} from "@getaster/data";
import {
  AsterElement,
  compactMoney,
  define,
  PickerOptions,
  provideScope,
  scopeOf,
  type FormSection,
  type ListColumn,
  type Toaster,
  type View,
} from "@getaster/elements";
import { html, nothing } from "lit-html";
import type { AppSetup } from "../../setup.ts";

type Tab = "details" | "tasks";

const BEHIND: Condition = { op: "eq", field: "project.values.health", value: "behind" };
const ARCHIVED: Condition = { op: "eq", field: "project.record.state", value: "archived" };
const LOCKED = { when: ARCHIVED, reason: "Archived projects can't be edited. Set State to Active to restore it." };

interface Open {
  readonly key: KeyText;
  readonly scope: PageScope;
  readonly edit: EditModel;
  readonly tasks: ListEdit;
  readonly taskRows: Collection;
  readonly sections: readonly FormSection[];
  readonly team: PickerOptions;
  /** Save acts while there are changes; pressing it with errors shows them. */
  readonly canSave: () => boolean;
  readonly dispose: () => void;
}

/**
 * One project: its fields in a form laid out from metadata, and its tasks
 * in a list editor. Both publish to the page scope, and rules over it decide
 * what's visible, required and read-only, and when Save is enabled.
 */
export class ProjectPage extends AsterElement {
  #setup!: AppSetup;
  readonly #id = this.prop<number | undefined>(undefined);
  readonly #open = signal<Open | undefined>(undefined);
  readonly #missing = signal(false);
  readonly #tab = signal<Tab>("details");
  readonly #saving = signal(false);
  /** Where the user asked to go while there were unsaved changes. */
  readonly #leaving = signal<(() => void) | undefined>(undefined);
  #started = false;

  set setup(v: AppSetup) {
    this.#setup = v;
  }
  get projectId(): number | undefined {
    return this.#id.value;
  }
  set projectId(v: number | undefined) {
    if (v === this.#id.peek()) return;
    this.#id.value = v;
    if (this.#started) void this.#load();
  }

  /** Unsaved changes on the project or its tasks. */
  get dirty(): boolean {
    const open = this.#open.peek();
    return !!open && (open.edit.dirty.peek() || open.tasks.dirty.peek());
  }

  /** Leaves now when nothing is unsaved; otherwise asks in place and returns false. */
  requestLeave(go: () => void): boolean {
    if (!this.dirty) return true;
    this.#leaving.value = go;
    requestAnimationFrame(() => this.querySelector<HTMLElement>(".leave button")?.focus());
    return false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.listen(window, "beforeunload", (e) => this.dirty && e.preventDefault());
    this.#started = true;
    void this.#load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#started = false;
    this.#close();
  }

  protected render(): View {
    const open = this.#open.value;
    if (this.#missing.value) {
      return html`<div class="head"><h1>Project not found</h1></div><div></div>
        <section class="empty"><p class="empty-lead">This project doesn’t exist, or it has been deleted.</p>
          <a class="back" href="#projects/active">Back to Projects</a></section>`;
    }
    if (!open) return html`<div class="head"><h1 class="loading">Loading…</h1></div>`;
    const { edit, tasks } = open;
    const record = edit.baseline.value;
    const tab = this.#tab.value;
    const changes = open.canSave();
    const reason = changes ? undefined : "No changes to save.";
    const taskCount = tasks.rows.value.filter((r) => !r.removing).length;
    return html`
      <div class="head project-head">
        <a class="back" href=${`#projects/${String(record.state ?? "active")}`}>Projects</a>
        <h1>${record.name}</h1>
        ${record.state === "archived" ? html`<span class="aster-status">Archived</span>` : nothing}
        <aster-button .label=${"Revert"} .reason=${changes ? undefined : "No changes to revert."}
          @click=${() => this.#revert()}></aster-button>
        <aster-button class="save" .variant=${"primary"} .label=${"Save"} .busyLabel=${"Saving…"} .confirmLabel=${"Saved"}
          .busy=${this.#saving} .reason=${reason} @click=${() => void this.#save()}></aster-button>
      </div>
      <aster-tabs class="tabs" .label=${"Project sections"} .controls=${"project-panel"}
        .items=${[
          { value: "details", label: "Details" },
          { value: "tasks", label: `Tasks ${taskCount}` },
        ]}
        .value=${tab} @change=${(e: CustomEvent<Tab>) => (this.#tab.value = e.detail)}></aster-tabs>
      <div class="content project" id="project-panel" role="tabpanel">
        ${this.#leaving.value ? this.#leaveBar() : nothing}
        ${edit.formError.value ? html`<p class="aster-error" role="alert">${edit.formError.value}</p>` : nothing}
        ${edit.conflict.value ? this.#conflict(edit) : nothing}
        ${tab === "details"
          ? html`<aster-form .model=${edit} .sections=${open.sections}></aster-form>`
          : this.#tasks(open)}
      </div>`;
  }

  #tasks(open: Open): View {
    const { model } = this.#setup;
    const people = model.people;
    const name = (id: unknown) => people.items.value.find((p) => p?.id === id)?.name;
    const columns: ListColumn[] = [
      { field: "title", width: "minmax(0, 2.4fr)" },
      { field: "due", width: "minmax(8.5rem, 1fr)" },
      { field: "assigneeId", width: "minmax(8rem, 1fr)", options: open.team, display: (r) => String(name(r.edit.values.value.assigneeId) ?? "Unassigned") },
      { field: "done", width: "3.5rem", display: (r) => (r.edit.values.value.done ? "Done" : "") },
    ];
    const archived = open.edit.baseline.value.state === "archived";
    return html`<aster-list-editor .list=${open.tasks} .columns=${columns} .label=${"Tasks"} .addLabel=${"Add task"}
      .readOnlyReason=${archived ? LOCKED.reason : undefined}
      .empty=${"No tasks yet. Add one, then Save to keep it."}></aster-list-editor>`;
  }

  #conflict(edit: EditModel): View {
    const fields = edit.conflict.value?.fields.map((f) => edit.type.field(f)?.title ?? f).join(", ");
    return html`<p class="row-note" role="alert">Someone else changed ${fields} while you were editing.
      <button type="button" @click=${() => edit.rebase()}>Keep mine</button>
      <button type="button" @click=${() => edit.discard()}>Take theirs</button></p>`;
  }

  #leaveBar(): View {
    const go = this.#leaving.peek()!;
    return html`<div class="leave row-note" role="alert">You have unsaved changes.
      <button type="button" @click=${async () => (await this.#save()) && (this.#leaving.value = undefined, go())}>Save and leave</button>
      <button type="button" @click=${() => {
        this.#revert();
        this.#leaving.value = undefined;
        go();
      }}>Discard them</button>
      <button type="button" @click=${() => (this.#leaving.value = undefined)}>Stay</button></div>`;
  }

  async #load(): Promise<void> {
    const id = this.#id.peek();
    if (id === undefined) return;
    this.#close();
    this.#missing.value = false;
    const { ctx } = this.#setup;
    const key = keyText([id]);
    const record = ctx.store.get("Projects", key) ?? (await ctx.reload("Projects", key));
    if (this.#id.peek() !== id || !this.isConnected) return;
    if (!record) {
      this.#missing.value = true;
      return;
    }
    this.#open.value = this.#build(key);
  }

  #build(key: KeyText): Open {
    const { ctx, model } = this.#setup;
    // The parent's scope: this element holds its own child, replaced per project.
    const parent = (this.parentElement && scopeOf(this.parentElement)) ?? model.scope;
    const scope = parent.child();
    provideScope(this, scope);
    const edit = new EditModel(ctx, "Projects", key, {}, {
      rules: [
        (v) => {
          if (v.spent === null || v.spent === undefined || v.budget === null || v.budget === undefined) return {};
          try {
            const over = subtractExact(v.budget, v.spent).startsWith("-");
            return over ? { spent: `Spent can’t be more than the budget (${compactMoney(Number(v.budget))}).` } : {};
          } catch {
            return {};
          }
        },
      ],
    });
    const withdrawProject = scope.publish("project", editPublication(edit));
    const locked = { readOnly: LOCKED };
    edit.applyRules(scope, "project", {
      name: locked,
      leadId: locked,
      health: locked,
      behindDays: { visible: BEHIND, required: BEHIND, readOnly: LOCKED, clearWhenHidden: true },
      budget: locked,
      spent: locked,
    });
    const id = Number(keyFromText(key)[0]);
    const taskRows = ctx.collection(
      {
        set: "Tasks",
        filter: { op: "and", args: [{ op: "eq", field: "projectId", value: id }, { op: "eq", field: "parentId", value: null }] },
        orderBy: [{ field: "done" }, { field: "due" }, { field: "id" }],
      },
      { pageSize: 500 },
    );
    void taskRows.loadAll();
    const tasks = new ListEdit(ctx, taskRows, {
      defaults: (): Entity => ({ projectId: id, parentId: null, title: "", due: null, assigneeId: null, done: false }),
    });
    const withdraw = [withdrawProject, scope.publish("tasks", valuesPublication({ dirty: tasks.dirty, valid: tasks.valid }))];
    const save = scope.state("save", {
      enabled: { when: { op: "or", args: ["project.dirty", "tasks.dirty"] }, reason: "No changes to save." },
    });
    const left = computed(() => {
      const v = edit.values.value;
      try {
        return v.budget === null || v.spent === null ? "" : compactMoney(Number(subtractExact(v.budget!, v.spent!)));
      } catch {
        return "";
      }
    });
    // Clients are too many to load: the picker searches on the server, under a heading per country.
    const clients = new PickerOptions(ctx, {
      set: "Clients",
      columns: ["city", "industry"],
      widths: { city: "minmax(6rem, 0.8fr)", industry: "minmax(7rem, 1fr)" },
      groupBy: "country",
      searchFields: ["name", "city"],
      create: ["city", "country", "industry"],
    });
    // Assignees are the people who've logged time on the project, following the page scope's project
    // and the time entries as they change.
    const logged = ctx.groups(
      computed(() => ({ set: "TimeEntries", filter: { op: "eq", field: "projectId", value: (scope.value("project.record.id").value as number | undefined) ?? id } })),
      "personId",
    );
    const team = new PickerOptions(ctx, {
      set: "People",
      filter: computed((): Criteria => ({ op: "in", field: "id", values: (logged.rows.value ?? []).map((g) => g.value) })),
      outside: "hasn’t logged time on this project.",
    });
    const sections: FormSection[] = [
      { title: "Basics", columns: 2, items: [{ field: "name", span: 2 }, { field: "leadId", options: model.people }, "state", { field: "clientId", options: clients }] },
      { title: "Schedule", columns: 2, items: ["health", "behindDays"] },
      { title: "Budget", columns: 3, items: ["budget", "spent", { title: "Left", value: left }] },
    ];
    return {
      key,
      scope,
      edit,
      tasks,
      taskRows,
      sections,
      team,
      canSave: () => save.value.enabled,
      dispose: () => {
        for (const w of withdraw) w();
        logged.dispose();
        ctx.release(clients.all);
        ctx.release(team.all);
        edit.dispose();
        tasks.dispose();
        ctx.release(taskRows);
      },
    };
  }

  #close(): void {
    this.#open.peek()?.dispose();
    this.#open.value = undefined;
    this.#leaving.value = undefined;
  }

  /** Saves the project, then its tasks. Returns whether everything saved. */
  async #save(): Promise<boolean> {
    const open = this.#open.peek();
    if (!open || this.#saving.peek()) return false;
    const { edit, tasks } = open;
    const projectValid = edit.validate();
    const tasksValid = tasks.rows.peek().every((r) => r.removing || r.edit.validate());
    if (!projectValid || !tasksValid) {
      if (!projectValid) this.#tab.value = "details";
      else this.#tab.value = "tasks";
      requestAnimationFrame(() => this.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return false;
    }
    this.#saving.value = true;
    try {
      if (edit.dirty.peek() && !(await edit.save())) return false;
      const result = await tasks.save();
      if (result.failed.length) {
        this.#tab.value = "tasks";
        this.#toaster()?.show(`${result.failed.length} ${result.failed.length === 1 ? "task" : "tasks"} couldn’t be saved. The rest are saved.`);
        return false;
      }
      this.querySelector<HTMLElement & { confirm(): void }>("aster-button.save")?.confirm();
      return true;
    } finally {
      this.#saving.value = false;
    }
  }

  #revert(): void {
    const open = this.#open.peek();
    if (!open) return;
    open.edit.revert();
    open.tasks.revert();
  }

  #toaster(): Toaster | null {
    return document.querySelector("aster-toaster");
  }
}

define("aster-project-page", ProjectPage);
