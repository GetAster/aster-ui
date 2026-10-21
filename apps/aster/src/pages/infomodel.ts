import { computed, effect, signal } from "@preact/signals-core";
import {
  EditModel,
  keyText,
  RecordEdit,
  Tree,
  type ChangeSet,
  type DataContext,
  type Entity,
  type KeyText,
  type RecordSave,
  type RecordSnapshot,
} from "@getaster/data";
import type { Dialog, ExpansionEditor, Grid, GridTree, GridView, Lookup, RowControl, RowState, Toaster, Window } from "@getaster/elements";
import { AsterElement, define, TreeChoices, type View } from "@getaster/elements";
import { html, nothing } from "lit-html";
import { indexedDbDrafts, type Drafts } from "../drafts.ts";
import { icons } from "../icons.ts";
import { ME } from "../model.ts";
import type { AppSetup } from "../setup.ts";
import {
  changedTabs,
  describer,
  FIELD_TABS,
  fieldEditor,
  panel,
  recordOptions,
  TAB_LABELS,
  type FieldEditor,
  type FieldTab,
  type LoggedChange,
  type ModelContext,
} from "./field-editor.ts";

const FIELDS_VIEW: GridView = {
  columns: [{ field: "label" }, { field: "name", width: 190 }, { field: "kind", width: 120 }, { field: "required", width: 100 }],
  sort: [{ field: "position" }],
  filters: {},
  frozen: 1,
};
const TREE: GridTree = { parentField: "parentId" };

const CHANGES_VIEW: GridView = {
  columns: [{ field: "at", width: 190 }, { field: "kind", width: 110 }, { field: "fieldLabel" }, { field: "byId", width: 170 }],
  sort: [{ field: "id", descending: true }],
  filters: {},
  frozen: 0,
};
const CHANGES_LOOKUPS: Readonly<Record<string, Lookup>> = { byId: { set: "People", display: "name" } };

type Asking =
  | { readonly kind: "add"; readonly parent: Entity; readonly edit: EditModel }
  | { readonly kind: "move"; readonly field: Entity; readonly tree: Tree; readonly blocked: ReadonlySet<unknown> | undefined }
  | { readonly kind: "remove"; readonly field: Entity; readonly impact: Impact | undefined };

/** What removing a field takes with it: the fields under it, and other fields' conditions that read any of them. */
interface Impact {
  readonly under: readonly Entity[];
  readonly dependents: readonly { readonly field: Entity; readonly clauses: readonly Entity[] }[];
}

/** Who depends on a field: other fields' conditions on it, and on each of its answers. */
interface Dependents {
  readonly field: Entity;
  readonly byField: readonly { readonly field: Entity; readonly categories: readonly string[] }[];
  readonly byAnswer: readonly { readonly answer: Entity; readonly fields: readonly Entity[] }[];
}

/**
 * The information model: a questionnaire's fields as a tree, each
 * expanding into its editor (definition, answers, rules), and the change
 * log, whose entries replay what each save did. `#model/<field>/<tab>`
 * opens a field's editor on a tab.
 */
export class ModelPage extends AsterElement {
  #setup!: AppSetup;
  #m!: ModelContext;
  readonly #locked = signal(false);
  readonly #view = signal<"fields" | "changes">("fields");
  readonly #asking = signal<Asking | undefined>(undefined);
  readonly #dependents = signal<Dependents | undefined>(undefined);
  readonly #editors = new Map<KeyText, FieldEditor>();
  #drafts!: Drafts;

  set setup(v: AppSetup) {
    this.#setup = v;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const ctx = this.#setup.ctx;
    this.#drafts = indexedDbDrafts();
    const fields = new TreeChoices(ctx, {
      set: "Fields",
      parentField: "parentId",
      display: "label",
      searchFields: ["label", "name"],
      orderBy: [{ field: "position" }],
      choosable: (f) => f.kind !== "group",
    });
    this.#m = { ctx, fields, describe: describer(ctx), drafts: this.#drafts, locked: this.#locked };
    this.onDisconnect(
      effect(() => {
        const { page, id, detail } = this.#setup.model.route.value;
        if (page !== "model" || id === undefined) return;
        const tab = FIELD_TABS.includes(detail as FieldTab) ? (detail as FieldTab) : undefined;
        this.#view.value = "fields";
        void this.#reveal(keyText([id]), tab);
      }),
    );
    void this.#reopenDrafts();
  }

  /** Fields with unsaved work from before a reload open again, their drafts taken up. */
  async #reopenDrafts(): Promise<void> {
    const keys = (await this.#drafts.keys()).filter((k) => k.startsWith("Fields/")).map((k) => k.slice("Fields/".length));
    for (const key of keys) await this.#reveal(key, undefined, 120, true);
  }

  /** Reveals a field once the grid has its tree and top level, expanding it on a tab if asked. */
  async #reveal(key: KeyText, tab: FieldTab | undefined, frames = 120, expand = false): Promise<void> {
    const grid = this.#grid();
    if (grid?.treeModel && grid.collection?.count.peek() !== undefined) {
      const open = this.#editors.get(key);
      if (open && open.tab.peek() === (tab ?? "definition")) return;
      if (!open) await grid.reveal(key);
      if (tab || expand) {
        grid.expand(key);
        if (tab) this.#editors.get(key)?.select(tab);
      } else open?.select("definition");
      return;
    }
    if (frames > 0) await new Promise((r) => requestAnimationFrame(r)).then(() => this.#reveal(key, tab, frames - 1, expand));
  }

  #grid(): Grid | null {
    return this.querySelector<Grid>("aster-grid.model-grid");
  }

  #toaster(): Toaster | null {
    return document.querySelector<Toaster>("aster-toaster");
  }

  #dialog(): Dialog | null {
    return this.querySelector<Dialog>("aster-dialog.model-dialog");
  }

  // ── rows ──

  #controls = (row: RowState): RowControl[] => {
    const grid = () => this.#grid()!;
    const locked = this.#locked.value;
    if (row.expanded) {
      return locked
        ? [{ label: "Close", icon: icons.cancel, run: () => void grid().collapse(row.key) }]
        : [
            { label: "Save", icon: icons.save, run: () => void grid().collapse(row.key, "save") },
            { label: "Cancel", icon: icons.cancel, run: () => void grid().collapse(row.key, "discard") },
          ];
    }
    const open: RowControl = locked
      ? { label: "View", icon: icons.view, run: () => grid().expand(row.key) }
      : { label: "Edit", icon: icons.edit, run: () => grid().expand(row.key) };
    const deps: RowControl = { label: "Dependencies", icon: icons.links, run: () => void this.#showDependents(row.entity) };
    if (locked) return [open, deps];
    return [
      open,
      ...(row.entity.kind === "group" ? [{ label: "Add field", icon: icons.addChild, run: () => void this.#askAdd(row.entity) }] : []),
      deps,
      { label: "Move to…", icon: icons.move, run: () => void this.#askMove(row.entity) },
      { label: "Remove", icon: icons.remove, run: () => void this.#askRemove(row.entity) },
    ];
  };

  #expansion = {
    noun: "field",
    content: (row: RowState): ExpansionEditor => {
      const editor = fieldEditor(this.#m, row.key, (tab) => this.#tabChosen(row.key, tab), (result) => this.#logSave(result));
      this.#editors.set(row.key, editor);
      const dispose = editor.dispose;
      return {
        ...editor,
        get view() {
          return editor.view;
        },
        dispose: () => (this.#editors.delete(row.key), dispose?.()),
      };
    },
  };

  #tabChosen(key: KeyText, tab: FieldTab): void {
    const id = JSON.parse(key)[0] as number;
    const hash = tab === "definition" ? `#model/${id}` : `#model/${id}/${tab}`;
    if (location.hash === hash) return;
    history.pushState(null, "", hash);
    const { tab: projectsTab } = this.#setup.model.route.peek();
    this.#setup.model.route.value = { page: "model", tab: projectsTab, id, ...(tab === "definition" ? {} : { detail: tab }) };
  }

  // ── the change log ──

  async #log(kind: string, field: Entity, before: RecordSnapshot | null, logged: LoggedChange): Promise<void> {
    await this.#setup.ctx.create("Changes", {
      kind,
      fieldId: field.id ?? null,
      fieldLabel: String(field.label ?? ""),
      before: before === null ? null : JSON.stringify(before),
      changes: JSON.stringify(logged),
      byId: ME,
    });
  }

  async #logSave(result: RecordSave): Promise<void> {
    const changed = result.change.kind === "update" && (Object.keys(result.change.changes).length || result.change.owned);
    if (!changed) return;
    const field = { ...result.before.record, ...(result.change.kind === "update" ? Object.fromEntries(Object.entries(result.change.changes).map(([k, c]) => [k, c.to])) : {}) };
    await this.#log("update", field, result.before, { change: result.change });
    this.#toaster()?.show(`Saved ${String(field.label)}`);
  }

  #changesExpansion = {
    noun: "change",
    canExpand: (entry: Entity) => entry.kind !== "add",
    content: (row: RowState): ExpansionEditor => replay(this.#m, row.entity),
  };

  // ── add, move, remove ──

  async #askAdd(parent: Entity): Promise<void> {
    const ctx = this.#setup.ctx;
    const siblings = ctx.collection({ set: "Fields", filter: { op: "eq", field: "parentId", value: parent.id ?? null } }, { pageSize: 1 });
    await siblings.ensure(0, 1);
    const position = (siblings.count.peek() ?? 0) + 1;
    ctx.release(siblings);
    const edit = new EditModel(ctx, "Fields", undefined, { parentId: parent.id ?? null, name: "", label: "", kind: "text", required: false, help: null, position });
    this.#asking.value = { kind: "add", parent, edit };
    requestAnimationFrame(() => this.#dialog()?.show(document.activeElement as HTMLElement, () => this.querySelector<HTMLElement>(".model-dialog input")));
  }

  async #add(asking: Extract<Asking, { kind: "add" }>): Promise<void> {
    const saved = await asking.edit.save();
    if (!saved) return;
    this.#dialog()?.close();
    await this.#log("add", saved.record.entity, null, { change: saved.change });
    const grid = this.#grid();
    await grid?.treeModel?.expand(keyText([asking.parent.id!]));
    await grid?.reveal(saved.key);
    this.#toaster()?.show(`Added ${String(saved.record.entity.label)}`);
  }

  async #askMove(field: Entity): Promise<void> {
    const tree = new Tree(this.#setup.ctx, {
      set: "Fields",
      parentField: "parentId",
      base: computed(() => ({ op: "eq", field: "kind", value: "group" }) as const),
      orderBy: computed(() => [{ field: "position" }]),
    });
    this.#asking.value = { kind: "move", field, tree, blocked: undefined };
    requestAnimationFrame(() => this.#dialog()?.show(document.activeElement as HTMLElement, () => this.querySelector<HTMLElement>(".model-dialog .aster-drill-heading")));
    const under = await tree.descendants(keyText([field.id!]));
    const asking = this.#asking.peek();
    if (asking?.kind === "move") this.#asking.value = { ...asking, blocked: new Set([field.id, ...under.map((e) => e.id)]) };
  }

  async #move(asking: Extract<Asking, { kind: "move" }>, to: KeyText | undefined): Promise<void> {
    const grid = this.#grid();
    const key = keyText([asking.field.id!]);
    this.#dialog()?.close();
    const from = asking.field.parentId ?? null;
    const target = to === undefined ? null : (JSON.parse(to)[0] as number);
    try {
      await grid?.treeModel?.move(key, to);
    } catch (e) {
      this.#toaster()?.show(e instanceof Error ? e.message : String(e));
      return;
    }
    const change: ChangeSet = { kind: "update", set: "Fields", key: [asking.field.id!], changes: { parentId: { from, to: target } } };
    await this.#log("move", asking.field, { record: asking.field, owned: {} }, { change });
    const where = to === undefined ? "the top level" : String(this.#setup.ctx.store.get("Fields", to)?.entity.label ?? "its new group");
    this.#toaster()?.show(`Moved ${String(asking.field.label)} into ${where}`);
    if (to !== undefined) await grid?.treeModel?.expand(to);
    await grid?.reveal(key);
  }

  async #askRemove(field: Entity): Promise<void> {
    this.#asking.value = { kind: "remove", field, impact: undefined };
    requestAnimationFrame(() => this.#dialog()?.show(document.activeElement as HTMLElement));
    const impact = await this.#impact(field);
    if (this.#asking.peek()?.kind === "remove") this.#asking.value = { kind: "remove", field, impact };
  }

  async #impact(field: Entity): Promise<Impact> {
    const ctx = this.#setup.ctx;
    const under = (await this.#grid()?.treeModel?.descendants(keyText([field.id!]))) ?? [];
    const ids = [field.id!, ...under.map((e) => e.id!)];
    const reading = ctx.collection({ set: "Clauses", filter: { op: "in", field: "fieldRef", values: ids }, orderBy: [{ field: "id" }] }, { pageSize: 500 });
    await reading.loadAll();
    const clauses = reading.items.peek().filter((c): c is Entity => c !== undefined && !ids.includes(c.fieldId!));
    ctx.release(reading);
    const byField = new Map<number, Entity[]>();
    for (const c of clauses) byField.set(c.fieldId as number, [...(byField.get(c.fieldId as number) ?? []), c]);
    const owners = await loadFields(ctx, [...byField.keys()]);
    return { under, dependents: owners.map((f) => ({ field: f, clauses: byField.get(f.id as number)! })) };
  }

  /**
   * Removes a field and everything under it. Other fields' conditions that
   * read any of them go first, with a group left empty going too; each
   * repaired field is one save, kept with the removal in one log entry.
   */
  async #remove(asking: Extract<Asking, { kind: "remove" }>): Promise<void> {
    const ctx = this.#setup.ctx;
    const impact = asking.impact!;
    this.#dialog()?.close();
    const repairs: NonNullable<LoggedChange["repairs"]>[number][] = [];
    for (const { field, clauses } of impact.dependents) {
      const record = new RecordEdit(ctx, "Fields", keyText([field.id!]), recordOptions());
      await record.ready;
      const list = record.owned.clauses!;
      const gone = new Set(clauses.map((c) => keyText([c.id!])));
      for (const id of gone) list.remove(id);
      // A group left with no conditions goes too, up the tree.
      for (let emptied = true; emptied; ) {
        emptied = false;
        const live = list.rows.peek().filter((r) => !r.removing);
        for (const r of live) {
          if (!["and", "or", "not"].includes(String(r.edit.values.peek().op))) continue;
          if (live.some((k) => k.edit.values.peek().parentClauseId === r.edit.values.peek().id)) continue;
          list.remove(r.id);
          emptied = true;
        }
      }
      const result = await record.save();
      if (result) repairs.push({ fieldId: field.id as number, label: String(field.label), before: result.before, change: result.change });
      record.dispose();
    }
    const snapshotOf = new RecordEdit(ctx, "Fields", keyText([asking.field.id!]), recordOptions());
    await snapshotOf.ready;
    const before = snapshotOf.snapshot();
    snapshotOf.dispose();
    for (const f of [...impact.under].reverse().concat(asking.field)) await removeField(ctx, f);
    await this.#log("delete", asking.field, before, {
      change: { kind: "delete", set: "Fields", key: [asking.field.id!], values: asking.field },
      ...(repairs.length ? { repairs } : {}),
    });
    const n = impact.under.length;
    const r = repairs.length;
    this.#toaster()?.show(
      `Removed ${String(asking.field.label)}${n ? ` and ${n} ${n === 1 ? "field" : "fields"} under it` : ""}${r ? `; updated rules in ${r} ${r === 1 ? "field" : "fields"}` : ""}`,
    );
  }

  // ── dependencies ──

  async #showDependents(field: Entity): Promise<void> {
    const ctx = this.#setup.ctx;
    const opener = document.activeElement as HTMLElement;
    const reading = ctx.collection({ set: "Clauses", filter: { op: "eq", field: "fieldRef", value: field.id! }, orderBy: [{ field: "id" }] }, { pageSize: 500 });
    const answers = ctx.collection({ set: "Answers", filter: { op: "eq", field: "fieldId", value: field.id! }, orderBy: [{ field: "position" }] }, { pageSize: 200 });
    await Promise.all([reading.loadAll(), answers.loadAll()]);
    const clauses = reading.items.peek().filter((c): c is Entity => c !== undefined);
    const owners = await loadFields(ctx, [...new Set(clauses.map((c) => c.fieldId as number))]);
    const byOwner = (id: unknown) => owners.find((f) => f.id === id)!;
    const byField = owners.map((f) => ({ field: f, categories: [...new Set(clauses.filter((c) => c.fieldId === f.id).map((c) => String(c.category)))] }));
    const byAnswer = answers.items.peek().flatMap((a) => {
      if (!a) return [];
      const using = clauses.filter((c) => valuesOf(c.value).includes(String(a.key)));
      return [{ answer: a, fields: [...new Set(using.map((c) => c.fieldId))].map(byOwner) }];
    });
    ctx.release(reading);
    ctx.release(answers);
    this.#dependents.value = { field, byField, byAnswer };
    requestAnimationFrame(() => this.querySelector<Window>("aster-window.model-deps")?.show(opener));
  }

  #dependentsView(): View {
    const d = this.#dependents.value;
    if (!d) return nothing;
    const go = (f: Entity, tab: FieldTab) => (location.hash = `#model/${f.id}/${tab}`);
    const tabOf = (cats: readonly string[]): FieldTab => (cats.includes("visibility") ? "visibility" : "messages");
    const item = (f: Entity, cats: readonly string[]) => html`<li>
      <span>${String(f.label)}${this.#where(f)} <span class="quiet">${cats.map((c) => (c === "visibility" ? "visibility" : "messages")).join(", ")}</span></span>
      <button type="button" class="aster-list-edit-action" aria-label=${`Go to ${this.#named(f)}`} @click=${() => go(f, tabOf(cats))}>Go to field</button>
    </li>`;
    return html`<div class="model-deps-body">
      <h3>Rules that read it</h3>
      ${d.byField.length ? html`<ul class="model-deps-list">${d.byField.map((x) => item(x.field, x.categories))}</ul>` : html`<p class="quiet">No other field’s rules read it.</p>`}
      ${d.byAnswer.length
        ? html`<h3>By answer</h3>
            <ul class="model-deps-answers">${d.byAnswer.map(
              (a) => html`<li><span class="model-deps-answer">${String(a.answer.label)}</span>
                ${a.fields.length
                  ? html`<ul class="model-deps-list">${a.fields.map((f) => item(f, d.byField.find((x) => x.field.id === f.id)?.categories ?? []))}</ul>`
                  : html`<span class="quiet">not used by any rule</span>`}</li>`,
            )}</ul>`
        : nothing}
    </div>`;
  }

  /** A field's groups, shown after its name where names repeat across groups. */
  #where(f: Entity): View {
    const trail = this.#m.fields.trail(f);
    return trail.length ? html` <span class="model-where">in ${trail.join(" › ")}</span>` : nothing;
  }

  /** A field's name and groups as words, for labels and messages. */
  #named(f: Entity): string {
    const trail = this.#m.fields.trail(f);
    return trail.length ? `${String(f.label)} in ${trail.join(", ")}` : String(f.label);
  }

  // ── dialog ──

  #dialogContent(): View {
    const asking = this.#asking.value;
    if (!asking) return nothing;
    switch (asking.kind) {
      case "add":
        return html`<form class="tasks-dialog-body" @submit=${(e: SubmitEvent) => (e.preventDefault(), void this.#add(asking))}>
          <h2 id="model-dialog-title">Add a field to ${String(asking.parent.label)}</h2>
          <aster-field .model=${asking.edit} .field=${"label"} .labelled=${true}></aster-field>
          <aster-field .model=${asking.edit} .field=${"name"} .labelled=${true}></aster-field>
          <aster-select .model=${asking.edit} .field=${"kind"} .labelled=${true}></aster-select>
          <div class="tasks-dialog-actions">
            <aster-button .label=${"Cancel"} @click=${() => this.#dialog()?.close()}></aster-button>
            <aster-button .label=${"Add field"} .variant=${"primary"} .type=${"submit"}></aster-button>
          </div>
        </form>`;
      case "move": {
        const blocked = asking.blocked;
        return html`<div class="tasks-dialog-body">
          <h2 id="model-dialog-title">Move ${String(asking.field.label)}</h2>
          <aster-tree-navigator .tree=${asking.tree} .label=${"Top level"} .chooseLabel=${"Move into"} .headingLevel=${3}
            .choosable=${(e: Entity) => (!blocked ? "Checking what’s under it…" : blocked.has(e.id) ? "A field can’t move into itself or a group under it." : undefined)}
            @choose=${(e: CustomEvent<KeyText>) => void this.#move(asking, e.detail)}
            @cancel=${() => this.#dialog()?.close()}></aster-tree-navigator>
          <div class="tasks-dialog-actions">
            <aster-button .label=${"Cancel"} @click=${() => this.#dialog()?.close()}></aster-button>
          </div>
        </div>`;
      }
      case "remove": {
        const impact = asking.impact;
        const n = impact?.under.length ?? 0;
        return html`<div class="tasks-dialog-body">
          <h2 id="model-dialog-title">Remove ${String(asking.field.label)}?</h2>
          ${this.#m.fields.trail(asking.field).length ? html`<p class="model-where">In ${this.#m.fields.trail(asking.field).join(" › ")}</p>` : nothing}
          ${impact === undefined
            ? html`<p role="status">Checking what depends on it…</p>`
            : html`${n ? html`<p>The ${n} ${n === 1 ? "field" : "fields"} under it go too.</p>` : nothing}
                ${impact.dependents.length
                  ? html`<p>These fields’ rules read it, and lose those conditions:</p>
                      <ul class="tasks-dialog-list model-impact">${impact.dependents.map(
                        ({ field, clauses }) => html`<li>${String(field.label)}${this.#where(field)} <span class="quiet">(${clauses.length} ${clauses.length === 1 ? "condition" : "conditions"})</span></li>`,
                      )}</ul>`
                  : html`<p>No other field’s rules read it.</p>`}`}
          <div class="tasks-dialog-actions">
            <aster-button .label=${"Cancel"} @click=${() => this.#dialog()?.close()}></aster-button>
            <aster-button .label=${"Remove"} .variant=${"primary"} .reason=${impact === undefined ? "Checking what depends on it" : undefined}
              @click=${() => void this.#remove(asking)}></aster-button>
          </div>
        </div>`;
      }
    }
  }

  protected render(): View {
    const locked = this.#locked.value;
    const view = this.#view.value;
    return html`<div class="head"><h1>Information model</h1>
        <button type="button" class="tasks-lock" aria-pressed=${locked ? "true" : "false"} @click=${() => (this.#locked.value = !locked)}>
          ${icons.lock}<span>${locked ? "Editing locked" : "Lock editing"}</span></button></div>
      <aster-tabs class="model-views" .label=${"Model views"} .controls=${"model-view"}
        .items=${[{ value: "fields", label: "Fields" }, { value: "changes", label: "Change log" }]}
        .value=${view} @change=${(e: CustomEvent<"fields" | "changes">) => (this.#view.value = e.detail)}></aster-tabs>
      <div id="model-view" role="tabpanel" class="model-view">
        ${view === "fields"
          ? html`<aster-grid class="model-grid" .ctx=${this.#setup.ctx} .set=${"Fields"} .tree=${TREE} .view=${FIELDS_VIEW}
              .label=${"Fields"} .publish=${"fields"} .persist=${"model-fields"} .editable=${false} .empty=${"No fields match."}
              .rowControls=${this.#controls} .expansion=${this.#expansion}></aster-grid>`
          : html`<aster-grid class="model-changes" .ctx=${this.#setup.ctx} .set=${"Changes"} .view=${CHANGES_VIEW} .lookups=${CHANGES_LOOKUPS}
              .label=${"Change log"} .publish=${"changes"} .editable=${false} .empty=${"No changes yet. Saved edits appear here, newest first."}
              .expansion=${this.#changesExpansion}></aster-grid>`}
      </div>
      <aster-dialog class="model-dialog" .labelledBy=${"model-dialog-title"} .content=${this.#dialogContent()}
        @close=${() => {
          const asking = this.#asking.peek();
          if (asking?.kind === "add") asking.edit.dispose();
          if (asking?.kind === "move") asking.tree.dispose();
          this.#asking.value = undefined;
        }}></aster-dialog>
      <aster-window class="model-deps" .heading=${`What depends on ${this.#dependents.value ? this.#named(this.#dependents.value.field) : ""}`}
        .content=${this.#dependentsView()}></aster-window>`;
  }
}

/** A logged change as it was made: the field's editor over its old values, read-only, on only the tabs it touched. */
function replay(m: ModelContext, entry: Entity): ExpansionEditor {
  const logged = JSON.parse(String(entry.changes)) as LoggedChange;
  const before = (entry.before ? JSON.parse(String(entry.before)) : { record: {}, owned: {} }) as RecordSnapshot;
  const record = RecordEdit.replay(m.ctx, before, logged.change);
  const repairs = (logged.repairs ?? []).map((r) => ({ ...r, record: RecordEdit.replay(m.ctx, r.before, r.change) }));
  const tabs: (FieldTab | "repairs")[] = [...changedTabs(logged.change, before, before.record.kind ?? null), ...(repairs.length ? ["repairs" as const] : [])];
  const tab = signal(tabs[0] ?? "definition");
  const id = `change-${String(entry.id)}`;
  const reason = entry.kind === "delete" ? "This field was removed." : "This is a past change.";
  return {
    get view() {
      const current = tab.value;
      return html`<div class="field-editor model-replay">
        <aster-tabs .label=${"What changed"} .controls=${`${id}-panel`}
          .items=${tabs.map((t) => ({ value: t, label: t === "repairs" ? "Dependency updates" : TAB_LABELS[t] }))}
          .value=${current} @change=${(e: CustomEvent<FieldTab | "repairs">) => (tab.value = e.detail)}></aster-tabs>
        <div class="task-editor-panel" id=${`${id}-panel`} role="tabpanel">
          ${current === "repairs"
            ? html`<div class="model-repairs">${repairs.map(
                (r) => html`<section aria-label=${r.label}><h4>${r.label}</h4>
                  ${changedTabs(r.change, r.before, r.before.record.kind ?? null).filter((t) => t === "visibility" || t === "messages").map((t) => panel(m, r.record, t, reason))}
                </section>`,
              )}</div>`
            : panel(m, record, current, reason)}
        </div>
      </div>`;
    },
    dispose() {
      record.dispose();
      for (const r of repairs) r.record.dispose();
    },
  };
}

async function loadFields(ctx: DataContext, ids: readonly number[]): Promise<Entity[]> {
  if (ids.length === 0) return [];
  const c = ctx.collection({ set: "Fields", filter: { op: "in", field: "id", values: [...ids] }, orderBy: [{ field: "id" }] }, { pageSize: 500 });
  await c.loadAll();
  const out = c.items.peek().filter((f): f is Entity => f !== undefined);
  ctx.release(c);
  return out;
}

/** A field's answers and rules, then the field. */
async function removeField(ctx: DataContext, field: Entity): Promise<void> {
  for (const set of ["Clauses", "Answers"]) {
    const owned = ctx.collection({ set, filter: { op: "eq", field: "fieldId", value: field.id! }, orderBy: [{ field: "id", descending: true }] }, { pageSize: 500 });
    await owned.loadAll();
    for (const k of owned.keys.peek()) if (k !== undefined) await ctx.remove(set, k);
    ctx.release(owned);
  }
  await ctx.remove("Fields", keyText([field.id!]));
}

function valuesOf(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [raw];
  } catch {
    return [raw];
  }
}

define("aster-model-page", ModelPage);
