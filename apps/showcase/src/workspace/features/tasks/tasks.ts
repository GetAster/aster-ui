import { computed, effect, signal } from "@preact/signals-core";
import { EditModel, keyText, Tree, type Criteria, type Entity, type KeyText } from "@getaster/data";
import type { Dialog, ExpansionEditor, Grid, GridTree, GridView, Lookup, RowControl, RowState, Toaster } from "@getaster/elements";
import { AsterElement, define, PickerOptions, type View } from "@getaster/elements";
import { html, nothing } from "lit-html";
import { icons } from "../../icons.ts";
import type { AppSetup } from "../../setup.ts";
import { TABS, taskEditor, type Tab, type TaskEditor } from "./task-editor.ts";

const VIEW: GridView = {
  columns: [{ field: "title" }, { field: "projectId", width: 170 }, { field: "assigneeId", width: 160 }, { field: "due", width: 140 }, { field: "done", width: 90 }],
  sort: [{ field: "id" }],
  filters: {},
  frozen: 1,
};

const LOOKUPS: Readonly<Record<string, Lookup>> = {
  projectId: { set: "Projects", display: "name" },
  assigneeId: { set: "People", display: "name" },
};

const TREE: GridTree = { parentField: "parentId", draggable: true };

type Asking =
  | { readonly kind: "add"; readonly parent: Entity; readonly edit: EditModel }
  | { readonly kind: "move"; readonly task: Entity; readonly tree: Tree; readonly blocked: ReadonlySet<unknown> | undefined }
  | { readonly kind: "remove"; readonly task: Entity; readonly under: readonly Entity[] | undefined };

/**
 * Every project's tasks as a tree: top-level tasks with their subtasks,
 * levels loading as they open, each row with its controls, and a task
 * expanding in place into its editor. `#tasks/<id>` opens the path to a
 * task.
 */
export class TasksPage extends AsterElement {
  #setup!: AppSetup;
  /** Editing switched off for the page: Edit becomes View, add and remove go. */
  readonly #locked = signal(false);
  readonly #asking = signal<Asking | undefined>(undefined);
  /** At phone width the tree is a navigator, and a chosen task opens its editor under it. */
  readonly #narrow = signal(false);
  #phoneTree: Tree | undefined;
  readonly #phoneEditor = signal<{ readonly key: KeyText; readonly editor: ExpansionEditor } | undefined>(undefined);
  #people: PickerOptions | undefined;

  set setup(v: AppSetup) {
    this.#setup = v;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#people = new PickerOptions(this.#setup.ctx, { set: "People" });
    const narrow = matchMedia("(max-width: 720px)");
    this.#narrow.value = narrow.matches;
    const follow = () => (this.#narrow.value = narrow.matches);
    narrow.addEventListener("change", follow);
    this.onDisconnect(() => {
      narrow.removeEventListener("change", follow);
      this.#phoneTree?.dispose();
      this.#phoneEditor.peek()?.editor.dispose?.();
    });
    const all = this.#people.all;
    this.onDisconnect(() => this.#setup.ctx.release(all));
    // A deep link reveals its task once the grid's tree exists.
    this.onDisconnect(
      effect(() => {
        const { page, id, detail } = this.#setup.model.route.value;
        if (page !== "tasks" || id === undefined) return;
        const tab = TABS.includes(detail as Tab) ? (detail as Tab) : undefined;
        void this.#reveal(keyText([id]), tab);
      }),
    );
  }

  /**
   * Reveals a task once the grid has its tree and its top level (before
   * that, applying the saved view would move back to the top).
   */
  async #reveal(key: KeyText, tab: Tab | undefined, frames = 120): Promise<void> {
    const grid = this.#grid();
    if (grid?.treeModel && grid.collection?.count.peek() !== undefined) {
      // Already open on that tab (the history entry its own choice made): nothing to do.
      const open = this.#editors.get(key);
      if (open && open.tab.peek() === (tab ?? "details")) return;
      if (!open) await grid.reveal(key);
      if (tab) {
        grid.expand(key);
        this.#editors.get(key)?.select(tab);
      } else open?.select("details");
      return;
    }
    if (frames > 0) requestAnimationFrame(() => void this.#reveal(key, tab, frames - 1));
  }

  #grid(): Grid | null {
    return this.querySelector<Grid>("aster-grid");
  }

  #controls = (row: RowState): RowControl[] => {
    const grid = () => this.#grid()!;
    if (row.expanded) {
      return this.#locked.value
        ? [{ label: "Close", icon: icons.cancel, run: () => void grid().collapse(row.key) }]
        : [
            { label: "Save", icon: icons.save, run: () => void grid().collapse(row.key, "save") },
            { label: "Cancel", icon: icons.cancel, run: () => void grid().collapse(row.key, "discard") },
          ];
    }
    const open: RowControl = this.#locked.value
      ? { label: "View", icon: icons.view, run: () => grid().expand(row.key) }
      : { label: "Edit", icon: icons.edit, run: () => grid().expand(row.key) };
    if (this.#locked.value) return [open];
    return [
      open,
      { label: "Add subtask", icon: icons.addChild, run: () => this.#askAdd(row.entity) },
      { label: "Move to…", icon: icons.move, run: () => void this.#askMove(row.entity) },
      { label: "Remove", icon: icons.remove, run: () => void this.#askRemove(row.entity) },
    ];
  };

  /** Editors by task, so a deep link can choose an open editor's tab. */
  readonly #editors = new Map<KeyText, TaskEditor>();

  #expansion = {
    noun: "task",
    content: (row: RowState) => {
      const editor = taskEditor(this.#setup.ctx, row.key, row.entity, this.#people!, this.#locked, (tab) => this.#tabChosen(row.key, tab));
      this.#editors.set(row.key, editor);
      const dispose = editor.dispose;
      return { ...editor, get view() { return editor.view; }, dispose: () => (this.#editors.delete(row.key), dispose?.()) };
    },
  };

  /** Choosing a tab is a history entry, `#tasks/<id>/<tab>`; Back returns to the previous tab. */
  #tabChosen(key: KeyText, tab: Tab): void {
    const id = JSON.parse(key)[0] as number;
    const hash = tab === "details" ? `#tasks/${id}` : `#tasks/${id}/${tab}`;
    if (location.hash === hash) return;
    history.pushState(null, "", hash);
    const { tab: projectsTab } = this.#setup.model.route.peek();
    this.#setup.model.route.value = { page: "tasks", tab: projectsTab, id, ...(tab === "details" ? {} : { detail: tab }) };
  }

  #dialog(): Dialog | null {
    return this.querySelector<Dialog>("aster-dialog.tasks-dialog");
  }

  #askAdd(parent: Entity): void {
    const edit = new EditModel(this.#setup.ctx, "Tasks", undefined, {
      projectId: parent.projectId ?? null,
      parentId: parent.id ?? null,
      title: "",
      due: null,
      assigneeId: null,
      done: false,
    });
    this.#asking.value = { kind: "add", parent, edit };
    requestAnimationFrame(() =>
      this.#dialog()?.show(document.activeElement as HTMLElement, () => this.querySelector<HTMLElement>(".tasks-dialog input")),
    );
  }

  async #add(asking: Extract<Asking, { kind: "add" }>): Promise<void> {
    const saved = await asking.edit.save();
    if (!saved) return;
    this.#dialog()?.close();
    const grid = this.#grid();
    await grid?.treeModel?.expand(keyText([asking.parent.id!]));
    await grid?.reveal(saved.key);
    this.#toaster()?.show(`Added ${String(saved.record.entity.title)}`);
  }

  /** Moving a task under another in its project, chosen level by level; not into itself or below. */
  async #askMove(task: Entity): Promise<void> {
    const tree = new Tree(this.#setup.ctx, {
      set: "Tasks",
      parentField: "parentId",
      base: computed((): Criteria => ({ op: "eq", field: "projectId", value: task.projectId ?? null })),
      orderBy: computed(() => [{ field: "id" }]),
    });
    this.#asking.value = { kind: "move", task, tree, blocked: undefined };
    requestAnimationFrame(() => this.#dialog()?.show(document.activeElement as HTMLElement, () => this.querySelector<HTMLElement>(".tasks-dialog aster-tree-navigator .aster-drill-heading")));
    const under = await tree.descendants(keyText([task.id!]));
    const asking = this.#asking.peek();
    if (asking?.kind === "move") this.#asking.value = { ...asking, blocked: new Set([task.id, ...under.map((e) => e.id)]) };
  }

  async #move(asking: Extract<Asking, { kind: "move" }>, to: KeyText | undefined): Promise<void> {
    const grid = this.#grid();
    const key = keyText([asking.task.id!]);
    const from = asking.task.parentId === null || asking.task.parentId === undefined ? undefined : keyText([asking.task.parentId]);
    this.#dialog()?.close();
    try {
      await grid?.treeModel?.move(key, to);
    } catch (e) {
      this.#toaster()?.show(e instanceof Error ? e.message : String(e));
      return;
    }
    const where = to === undefined ? "the top level" : String(this.#setup.ctx.store.get("Tasks", to)?.entity.title ?? "its new parent");
    this.#toaster()?.show(`Moved ${String(asking.task.title)} under ${where}`, {
      label: "Undo",
      run: () => void grid?.treeModel?.move(key, from),
    });
    if (to !== undefined) await grid?.treeModel?.expand(to);
    await grid?.reveal(key);
  }

  /** A drag moved a task: say where, with Undo. */
  #moved({ key, from, to }: { key: KeyText; from: KeyText | undefined; to: KeyText | undefined }): void {
    const ctx = this.#setup.ctx;
    const name = (k: KeyText | undefined) => (k === undefined ? "the top level" : String(ctx.store.get("Tasks", k)?.entity.title ?? "its new parent"));
    this.#toaster()?.show(`Moved ${name(key)} under ${name(to)}`, {
      label: "Undo",
      run: () => void this.#grid()?.treeModel?.move(key, from),
    });
  }

  async #askRemove(task: Entity): Promise<void> {
    this.#asking.value = { kind: "remove", task, under: undefined };
    requestAnimationFrame(() => this.#dialog()?.show(document.activeElement as HTMLElement));
    const under = (await this.#grid()?.treeModel?.descendants(keyText([task.id!]))) ?? [];
    if (this.#asking.peek()?.kind === "remove") this.#asking.value = { kind: "remove", task, under };
  }

  /** Removes a task and everything under it, deepest first, so nothing is left without its parent. */
  async #remove(asking: Extract<Asking, { kind: "remove" }>): Promise<void> {
    const { ctx } = this.#setup;
    this.#dialog()?.close();
    for (const e of [...(asking.under ?? [])].reverse()) await ctx.remove("Tasks", keyText([e.id!]));
    await ctx.remove("Tasks", keyText([asking.task.id!]));
    const n = asking.under?.length ?? 0;
    this.#toaster()?.show(`Removed ${String(asking.task.title)}${n ? ` and ${n} ${n === 1 ? "subtask" : "subtasks"}` : ""}`);
  }

  #toaster(): Toaster | null {
    return document.querySelector<Toaster>("aster-toaster");
  }

  #dialogContent(): View {
    const asking = this.#asking.value;
    if (!asking) return nothing;
    if (asking.kind === "move") {
      const blocked = asking.blocked;
      return html`<div class="tasks-dialog-body">
        <h2 id="tasks-dialog-title">Move ${String(asking.task.title)}</h2>
        <aster-tree-navigator .tree=${asking.tree} .label=${"Top level"} .chooseLabel=${"Move under"} .headingLevel=${3}
          .choosable=${(e: Entity) => (!blocked ? "Checking its subtasks…" : blocked.has(e.id) ? "A task can’t move under itself or one of its own subtasks." : undefined)}
          @choose=${(e: CustomEvent<KeyText>) => void this.#move(asking, e.detail)}
          @cancel=${() => this.#dialog()?.close()}></aster-tree-navigator>
        <div class="tasks-dialog-actions">
          <aster-button .label=${"Cancel"} @click=${() => this.#dialog()?.close()}></aster-button>
          <aster-button .label=${"Move to the top level"} .reason=${asking.task.parentId === null ? "It’s already at the top level." : undefined}
            @click=${() => void this.#move(asking, undefined)}></aster-button>
        </div>
      </div>`;
    }
    if (asking.kind === "add") {
      return html`<form class="tasks-dialog-body" @submit=${(e: SubmitEvent) => (e.preventDefault(), void this.#add(asking))}>
        <h2 id="tasks-dialog-title">Add a subtask to ${String(asking.parent.title)}</h2>
        <aster-field .model=${asking.edit} .field=${"title"} .labelled=${true}></aster-field>
        <aster-picker .model=${asking.edit} .field=${"assigneeId"} .options=${this.#people} .labelled=${true}></aster-picker>
        <aster-date .model=${asking.edit} .field=${"due"} .labelled=${true}></aster-date>
        <div class="tasks-dialog-actions">
          <aster-button .label=${"Cancel"} @click=${() => this.#dialog()?.close()}></aster-button>
          <aster-button .label=${"Add subtask"} .variant=${"primary"} .type=${"submit"}></aster-button>
        </div>
      </form>`;
    }
    const under = asking.under;
    return html`<div class="tasks-dialog-body">
      <h2 id="tasks-dialog-title">Remove ${String(asking.task.title)}?</h2>
      ${under === undefined
        ? html`<p role="status">Checking what’s under it…</p>`
        : under.length === 0
          ? html`<p>It has no subtasks.</p>`
          : html`<p>Its ${under.length} ${under.length === 1 ? "subtask goes" : "subtasks go"} too:</p>
              <ul class="tasks-dialog-list">${under.slice(0, 8).map((e) => html`<li>${String(e.title)}</li>`)}${under.length > 8 ? html`<li>and ${under.length - 8} more</li>` : nothing}</ul>`}
      <div class="tasks-dialog-actions">
        <aster-button .label=${"Cancel"} @click=${() => this.#dialog()?.close()}></aster-button>
        <aster-button .label=${"Remove"} .variant=${"primary"} .reason=${under === undefined ? "Checking what’s under it" : undefined}
          @click=${() => void this.#remove(asking)}></aster-button>
      </div>
    </div>`;
  }

  #phone(): View {
    const ctx = this.#setup.ctx;
    this.#phoneTree ??= new Tree(ctx, { set: "Tasks", parentField: "parentId", orderBy: computed(() => [{ field: "id" }]) });
    const open = this.#phoneEditor.value;
    const choose = (key: KeyText) => {
      const entity = ctx.store.get("Tasks", key)?.entity;
      if (!entity) return;
      open?.editor.dispose?.();
      this.#phoneEditor.value = { key, editor: taskEditor(ctx, key, entity, this.#people!, this.#locked) };
      requestAnimationFrame(() => this.querySelector<HTMLElement>(".tasks-phone-editor input")?.focus());
    };
    const close = () => {
      open?.editor.dispose?.();
      this.#phoneEditor.value = undefined;
    };
    return html`<div class="tasks-phone">
      <aster-tree-navigator .tree=${this.#phoneTree} .label=${"All tasks"} .chooseLabel=${"Edit"} @choose=${(e: CustomEvent<KeyText>) => choose(e.detail)}></aster-tree-navigator>
      ${open
        ? html`<section class="tasks-phone-editor" aria-label="Task">
            ${open.editor.view}
            <div class="tasks-dialog-actions">
              <aster-button .label=${"Close"} @click=${() => (open.editor.dirty?.peek() ? open.editor.discard?.() : undefined, close())}></aster-button>
              <aster-button .label=${"Save"} .variant=${"primary"} .reason=${this.#locked.value ? "Editing is locked." : undefined}
                @click=${async () => { if (await open.editor.save?.()) close(); }}></aster-button>
            </div>
          </section>`
        : nothing}
    </div>`;
  }

  protected render(): View {
    const locked = this.#locked.value;
    if (this.#narrow.value) {
      return html`<div class="head"><h1>Tasks</h1></div><div></div>${this.#phone()}`;
    }
    return html`<div class="head"><h1>Tasks</h1>
        <button type="button" class="tasks-lock" aria-pressed=${locked ? "true" : "false"} @click=${() => (this.#locked.value = !locked)}>
          ${icons.lock}<span>${locked ? "Editing locked" : "Lock editing"}</span></button></div><div></div>
      <aster-grid class="tasks-grid" .ctx=${this.#setup.ctx} .set=${"Tasks"} .tree=${TREE} .view=${VIEW} .lookups=${LOOKUPS}
        .label=${"Tasks"} .publish=${"tasks"} .persist=${"tasks"} .editable=${!locked} .empty=${"No tasks match."}
        .rowControls=${this.#controls} .expansion=${this.#expansion}
        @moved=${(e: CustomEvent<{ key: KeyText; from: KeyText | undefined; to: KeyText | undefined }>) => this.#moved(e.detail)}></aster-grid>
      <aster-dialog class="tasks-dialog" .labelledBy=${"tasks-dialog-title"} .content=${this.#dialogContent()}
        @close=${() => {
          const asking = this.#asking.peek();
          if (asking?.kind === "add") asking.edit.dispose();
          if (asking?.kind === "move") asking.tree.dispose();
          this.#asking.value = undefined;
        }}></aster-dialog>`;
  }
}

define("aster-tasks-page", TasksPage);
