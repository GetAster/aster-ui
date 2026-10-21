import { signal } from "@preact/signals-core";
import {
  EditModel,
  keyFromText,
  keyText,
  ODataError,
  type DataContext,
  type Entity,
  type KeyText,
  type Saved,
} from "@getaster/data";
import {
  absoluteTime,
  each,
  announce,
  AsterElement,
  compactMoney,
  define,
  provideScope,
  relativeTime,
  setScheme,
  type Dialog,
  type Listbox,
  type Menu,
  type MenuItem,
  type RowMenuDetail,
  type Toaster,
  type View,
} from "@getaster/elements";
import { html, nothing } from "lit-html";
import { debugPanel } from "./debug.ts";
import { chooseTheme, currentTheme, LISTED, THEMES, type Theme } from "./themes.ts";
import { asterMark, icons } from "./icons.ts";
import { isPage, isState, ME, type Page, type Route, type State } from "./model.ts";
import type { AppSetup } from "./setup.ts";
import { Share } from "./share.ts";

const PAGE_TITLES: Record<Page, string> = { home: "Home", projects: "Projects", project: "Project", people: "People", tasks: "Tasks", model: "Information model", time: "Time", reports: "Reports", showcase: "Component showcase" };
const TAB_TITLES: Record<State, string> = { active: "Active", paused: "Paused", archived: "Archived" };

/** Pages in their own chunks, loaded on first visit. */
const LAZY: Partial<Record<Page, () => Promise<unknown>>> = {
  project: () => import("./pages/project.ts"),
  people: () => import("./pages/people.ts"),
  tasks: () => import("./pages/tasks.ts"),
  model: () => import("./pages/infomodel.ts"),
  time: () => import("./pages/time.ts"),
  reports: () => import("./pages/reports.ts"),
  showcase: () => import("./pages/showcase.ts"),
};

interface LeavingPage extends HTMLElement {
  readonly dirty: boolean;
  requestLeave(go: () => void): boolean;
}
const EMPTY: Record<State, string> = {
  active: "No active projects. Press New project to start one; it appears here and counts towards the figures above.",
  paused: "No paused projects. When you pause a project from its menu, it moves here until you resume it.",
  archived: "No archived projects. When you archive a project, it moves here and stops counting towards the figures above.",
};

interface Rename {
  readonly key: KeyText;
  readonly edit: EditModel;
}

/**
 * Lamplight's Projects screen, bound to data. App code decides what to
 * show and which write to make; every count, figure and row follows the
 * store through the model's collections.
 */
export class AsterDemo extends AsterElement {
  #setup!: AppSetup;
  #share!: Share;
  readonly #scheme = signal<"light" | "dark">(storedScheme());
  readonly #density = signal<Density | undefined>(stored<Density>("aster-demo-density", DENSITIES));
  readonly #theme = signal<Theme>(currentTheme());
  readonly #creating = signal(false);
  readonly #rename = signal<Rename | undefined>(undefined);
  /** A failed write's message, shown in the row it concerns. */
  readonly #rowError = signal<{ key: KeyText; message: string } | undefined>(undefined);

  setup(setup: AppSetup): void {
    this.#setup = setup;
    this.#share = new Share(setup.ctx, setup.model);
    provideScope(this, setup.model.scope);
  }

  override connectedCallback(): void {
    this.#readRoute();
    this.listen(window, "hashchange", () => this.#readRoute());
    this.listen(window, "popstate", () => this.#readRoute());
    // In-app links ask before leaving unsaved changes, without a history entry.
    this.listen(document, "click", (e) => this.#guardLink(e), { capture: true });
    setScheme(this.#scheme.peek(), false);
    applyDensity(this.#density.peek());
    super.connectedCallback();
    void this.#setup.model.load();
  }

  protected render(): View {
    const { model } = this.#setup;
    const { page, tab, id } = model.route.value;
    return html`
      <div class="app">
        ${this.#sidebar(page)}
        <main data-page=${page}>
          ${page === "project"
            ? html`<aster-project-page .setup=${this.#setup} .projectId=${id}></aster-project-page>`
            : page === "people"
              ? html`<aster-people-page .setup=${this.#setup} .personId=${id}></aster-people-page>`
            : page === "tasks"
              ? html`<aster-tasks-page .setup=${this.#setup}></aster-tasks-page>`
            : page === "model"
              ? html`<aster-model-page .setup=${this.#setup}></aster-model-page>`
            : page === "time"
              ? html`<aster-time-page .setup=${this.#setup}></aster-time-page>`
            : page === "reports"
              ? html`<aster-reports-page .setup=${this.#setup}></aster-reports-page>`
            : page === "showcase"
              ? html`<aster-showcase-page .theme=${this.#theme.value} .scheme=${this.#scheme.value}></aster-showcase-page>`
              : html`<div class="head">
                  <h1>${PAGE_TITLES[page]}</h1>
                  ${page === "projects"
                    ? html`<aster-button .icon=${icons.share} .label=${"Share"} @click=${(e: Event) => this.#openShare(e)}></aster-button>
                        <aster-button class="new" .variant=${"primary"} .icon=${icons.plus} .label=${"New project"}
                          .busyLabel=${"Creating…"} .busy=${this.#creating} @click=${() => void this.#newProject()}></aster-button>`
                    : nothing}
                </div>
                ${page === "projects" ? this.#projectsPage(tab) : this.#home()}`}
          <aster-menu></aster-menu>
        </main>
      </div>
      ${this.#tabBar(page)}
      <aster-dialog .labelledBy=${"share-title"} .content=${this.#share.render(() => this.#dialog())}
        @close=${() => this.#share.reset()}></aster-dialog>
      <aster-toaster></aster-toaster>
      ${this.#setup.debug ? debugPanel(this.#setup, () => this.#toaster()) : nothing}`;
  }

  /** The window title agrees with the caret and the page title. */
  protected override updated(): void {
    const { page, tab, id } = this.#setup.model.route.peek();
    const name = page === "project" && id !== undefined ? this.#setup.ctx.store.get("Projects", keyText([id]))?.entity.name : undefined;
    document.title =
      page === "projects" ? `${TAB_TITLES[tab]} projects – Aster`
      : name !== undefined ? `${String(name)} – Aster`
      : `${PAGE_TITLES[page]} – Aster`;
  }

  #sidebar(page: Page): View {
    const { model } = this.#setup;
    const pinned = model.pinned.items.value.filter((p): p is Entity => p !== undefined);
    const item = (to: "home" | "projects" | "people" | "tasks" | "model" | "time" | "reports" | "showcase", label: string, extra: View = nothing) =>
      html`<a class="aster-nav-item" href=${`#${to === "projects" ? `projects/${model.route.value.tab}` : to}`}
        aria-current=${page === to || (to === "projects" && page === "project") ? "page" : nothing}>${icons[to]}${label}${extra}</a>`;
    return html`<aside class="sidebar">
      <div class="brand">${asterMark}Aster</div>
      <nav aria-label="Main">
        <aster-caret-group class="aster-nav">
          ${item("home", "Home")}
          ${item("projects", "Projects", html`<span class="aster-count aster-figure-text">${model.activeCount.value ?? ""}</span>`)}
          ${item("people", "People")}
          ${item("tasks", "Tasks")}
          ${item("model", "Model")}
          ${item("time", "Time")}
          ${item("reports", "Reports")}
          ${item("showcase", "Showcase")}
          <div class="aster-nav-label" id="pinned-label">Pinned</div>
          ${each(
            pinned,
            (p) => String(p.id),
            (p) => html`<button type="button" class="aster-nav-item" title=${`Show ${p.name} in Projects`}
              @click=${() => this.#reveal(keyText([p.id!]))}><i class="aster-dot" style=${`--hue:${p.hue}`}></i>${p.name}</button>`,
          )}
        </aster-caret-group>
      </nav>
      <footer>
        <span>Ada Lovelace</span>
        ${this.#densitySwitch()}
        ${this.#themeSwitch()}
        ${this.#lampSwitch()}
      </footer>
    </aside>`;
  }

  /** The phone's navigation: the main pages along the bottom, the theme and the lamp. */
  #tabBar(page: Page): View {
    const { model } = this.#setup;
    const item = (to: "home" | "projects" | "people" | "tasks" | "model" | "time", label: string, extra: View = nothing) =>
      html`<a class="tabbar-item" href=${`#${to === "projects" ? `projects/${model.route.value.tab}` : to}`}
        aria-current=${page === to || (to === "projects" && page === "project") ? "page" : nothing}>
        ${icons[to]}<span>${label}</span>${extra}</a>`;
    return html`<nav class="tabbar" aria-label="Main">
      <aster-caret-group axis="x" class="tabbar-items">
        ${item("home", "Home")}
        ${item("projects", "Projects", html`<span class="tabbar-count aster-figure-text">${model.activeCount.value ?? ""}</span>`)}
        ${item("people", "People")}
        ${item("tasks", "Tasks")}
        ${item("model", "Model")}
        ${item("time", "Time")}
      </aster-caret-group>
      ${this.#themeSwitch("tabbar-lamp")}
      ${this.#lampSwitch("tabbar-lamp")}
    </nav>`;
  }

  /** Compact, standard or comfortable; until chosen, touch screens get comfortable. */
  #densitySwitch(): View {
    const current = this.#density.value ?? (matchMedia("(pointer: coarse)").matches ? "comfortable" : "standard");
    const next = DENSITIES[(DENSITIES.indexOf(current) + 1) % DENSITIES.length]!;
    return html`<button type="button" class="density-switch" aria-label=${`Density: ${title(current)}. Switch to ${next}`}
      title=${`Density: ${title(current)}`}
      @click=${() => {
        this.#density.value = next;
        applyDensity(next);
        store("aster-demo-density", next);
      }}>${icons.density}<span>${title(current)}</span></button>`;
  }

  /** The theme, from a menu of radio items. */
  /** The theme menu's button: an icon in the sidebar, an icon over its name in the phone's tab bar. */
  #themeSwitch(kind = "theme-switch"): View {
    const current = this.#theme.value;
    const label = THEMES.find((t) => t.id === current)!.label;
    return html`<button type="button" class=${kind} aria-haspopup="menu" aria-label=${`Theme: ${label}`} title=${`Theme: ${label}`}
      @click=${(e: MouseEvent) => {
        const items: MenuItem[] = LISTED.map((t) => ({
          kind: "radio",
          label: t.label,
          checked: t.id === this.#theme.peek(),
          run: () => {
            chooseTheme(t.id);
            this.#theme.value = t.id;
            this.querySelector<Menu>("aster-menu")?.close();
          },
        }));
        this.querySelector<Menu>("aster-menu")?.openFrom(e.currentTarget as HTMLElement, items, "Theme");
      }}>${kind === "theme-switch" ? icons.theme : html`<span class="tabbar-icon">${icons.theme}</span><span>Theme</span>`}</button>`;
  }

  #lampSwitch(kind = "lamp-switch"): View {
    const dim = this.#scheme.value === "dark";
    return html`<button type="button" class=${kind} aria-pressed=${dim ? "true" : "false"}
      title=${dim ? "Turn the lamp up" : "Dim the lamp"}
      @click=${() => {
        const next = dim ? "light" : "dark";
        setScheme(next);
        storeScheme(next);
        this.#scheme.value = next;
      }}>
      <span class="bulb">${icons.bulb}</span><span>${dim ? "Light" : "Dim"}</span>
    </button>`;
  }

  #projectsPage(tab: State): View {
    const { model } = this.#setup;
    return html`
      <aster-tabs class="tabs" .label=${"Filter projects"} .controls=${"projects-list"}
        .items=${(["active", "paused", "archived"] as const).map((v) => ({ value: v, label: TAB_TITLES[v] }))}
        .value=${tab} @change=${(e: CustomEvent<State>) => this.#go("projects", e.detail)}></aster-tabs>
      <div class="content">
        ${this.#ledger()}
        <div class="table">
          <div class="thead" aria-hidden="true"><span>Project</span><span>Lead</span><span>Status</span><span class="r">Open</span><span class="r">Updated</span></div>
          <aster-listbox id="projects-list" class="rows" .label=${`${TAB_TITLES[tab]} projects`}
            .selection=${model.selection} .publish=${"projects"}
            .renderRow=${(e: Entity, key: KeyText) => this.#row(e, key)}
            .empty=${html`<p class="rows-empty">${EMPTY[tab]}</p>`}
            @row-menu=${(e: CustomEvent<RowMenuDetail>) => this.#rowMenu(e.detail)}
            @row-open=${(e: CustomEvent<{ key: KeyText }>) => this.#openProject(e.detail.key)}
            @keydown=${(e: KeyboardEvent) => e.key === "F2" && model.selection.key.peek() && this.#startRename(model.selection.key.peek()!)}>
          </aster-listbox>
        </div>
        <div class="split">
          ${this.#dueThisWeek()}
          ${this.#pinnedNote()}
        </div>
      </div>`;
  }

  #ledger(): View {
    const { model } = this.#setup;
    const change = model.activeChange.value;
    const behind = model.behind.value;
    const left = model.budgetLeft.value;
    const budget = model.budget.value;
    const figure = (label: string, value: string, delta: View) =>
      html`<div class="aster-figure"><dt>${label}</dt><dd><span class="aster-big" data-figure=${label}>${value}</span>${delta}</dd></div>`;
    const delta = (text: string, tone?: "up" | "down") => html`<span class="aster-delta" data-tone=${tone ?? nothing}>${text}</span>`;
    return html`<dl class="aster-ledger ledger">
      ${figure(
        "Active projects",
        fmt(model.activeCount.value),
        change === undefined ? nothing
        : change === 0 ? delta("No change this week")
        : delta(`${change > 0 ? "+" : "−"}${Math.abs(change)} this week`, change > 0 ? "up" : "down"),
      )}
      ${figure("Open tasks", fmt(model.openTasks.count.value), delta(`${fmt(model.dueThisWeek.count.value)} due this week`))}
      ${figure(
        "On schedule",
        model.onSchedule.value === undefined ? "–" : `${model.onSchedule.value}%`,
        behind === undefined ? nothing : behind === 0 ? delta("None behind", "up") : delta(`${behind} behind`, "down"),
      )}
      ${figure(
        "Budget left",
        left === undefined ? "–" : compactMoney(Number(left)),
        budget === undefined ? nothing : delta(`of ${compactMoney(Number(budget))}`),
      )}
    </dl>`;
  }

  #row(p: Entity, key: KeyText): View {
    const { ctx, model, clock } = this.#setup;
    const lead = ctx.lookup("People", keyText([p.leadId!])).value;
    const open = model.openByProject.value?.get(p.id!) ?? 0;
    const updated = String(p.updatedAt);
    const rename = this.#rename.value;
    const error = this.#rowError.value;
    const conflict = rename?.key === key ? rename.edit.conflict.value : undefined;
    return html`
      ${rename?.key === key
        ? html`<aster-field class="name-editor" .model=${rename.edit} .field=${"name"} .label=${"Project name"}
            @keydown=${(e: KeyboardEvent) => this.#renameKey(e)}
            @focusout=${(e: FocusEvent) => this.#renameBlur(e)}></aster-field>`
        : html`<span class="name" data-copyable>${p.name}</span>`}
      <span class="who"><i class="aster-avatar" style=${`--hue:${lead?.hue ?? 0}`}></i>${firstName(lead?.name)}</span>
      ${status(ctx, p)}
      <span class="r open aster-figure-text">${open}</span>
      <span class="r when" title=${absoluteTime(updated)}>${relativeTime(updated, clock.tick.value)}</span>
      ${conflict
        ? html`<p class="row-note" role="alert">Someone else renamed this to “${conflict.theirs.name}” while you were editing.
            <button type="button" @click=${() => this.#keepMine()}>Keep mine</button>
            <button type="button" @click=${() => this.#takeTheirs()}>Take theirs</button></p>`
        : error?.key === key
          ? html`<p class="row-note aster-error" role="alert">${error.message}</p>`
          : nothing}`;
  }

  #dueThisWeek(): View {
    const { ctx, model } = this.#setup;
    const tasks = model.dueThisWeek.items.value.filter((t): t is Entity => t !== undefined);
    const shown = tasks.slice(0, 5);
    return html`<section aria-labelledby="due-title">
      <h2 class="section-title" id="due-title">Due this week</h2>
      ${shown.length === 0 ? html`<p class="quiet">Nothing open is due before Sunday.</p>` : nothing}
      ${each(
        shown,
        (t) => String(t.id),
        (t) => {
          const project = ctx.lookup("Projects", keyText([t.projectId!])).value;
          const who = t.assigneeId === null ? undefined : ctx.lookup("People", keyText([t.assigneeId!])).value;
          const due = String(t.due);
          return html`<div class="due">
            <span class="d aster-figure-text">${Number(due.slice(8))}<small>${weekday(due)}</small></span>
            <div><b>${t.title}</b><span>${project?.name ?? ""}</span></div>
            <span class="tag">${who ? firstName(who.name) : "Unassigned"}</span>
          </div>`;
        },
      )}
      ${tasks.length > shown.length ? html`<p class="quiet">${tasks.length - shown.length} more due this week.</p>` : nothing}
    </section>`;
  }

  #pinnedNote(): View {
    const { ctx, model, clock } = this.#setup;
    const note = model.notes.items.value[0];
    if (!note) return html`<section></section>`;
    const author = ctx.lookup("People", keyText([note.authorId!])).value;
    const paragraphs = String(note.body).split(/\n\s*\n/);
    return html`<section aria-labelledby="note-title">
      <h2 class="section-title" id="note-title">Pinned note</h2>
      <div class="note" data-copyable>
        ${paragraphs.map((text) => html`<p>${text}</p>`)}
        <footer><i class="aster-avatar" style=${`--hue:${author?.hue ?? 0}`}></i>${firstName(author?.name)}, ${partOfDay(String(note.createdAt), clock.tick.value)}</footer>
      </div>
    </section>`;
  }

  /** Home: the pinned projects as cards, one at a time on a phone. */
  #home(): View {
    const { model, ctx } = this.#setup;
    const pinned = model.pinned.items.value.filter((p): p is Entity => p !== undefined);
    const lead = (id: unknown) => model.people.items.value.find((p) => p?.id === id)?.name;
    const slides = pinned.map((p) => ({
      label: String(p.name),
      view: html`<article class="home-card">
        <h3><i class="aster-dot" style=${`--hue:${p.hue}`}></i>${p.name}</h3>
        ${status(ctx, p)}
        <p>${fmt(model.openByProject.value?.get(p.id!) ?? 0)} open tasks · led by ${firstName(lead(p.leadId))}</p>
        <a href=${`#project/${p.id}`}>Open ${p.name}</a>
      </article>`,
    }));
    return html`<section class="home">
      <div class="home-showcase">
        <div><h2>Component showcase</h2><p>Explore tile grids, expression filters, grouped reports and connected charts.</p></div>
        <a href="#showcase">Explore the components <span aria-hidden="true">→</span></a>
      </div>
      <h2>Pinned projects</h2>
      ${slides.length
        ? html`<aster-carousel .label=${"Pinned projects"} .slides=${slides}></aster-carousel>`
        : html`<p class="quiet">Pin a project from its menu to keep it here.</p>`}
    </section>`;
  }

  // ── actions ──

  async #newProject(): Promise<void> {
    if (this.#creating.peek()) return;
    const { ctx, model } = this.#setup;
    if (model.route.peek().tab !== "active" || model.route.peek().page !== "projects") this.#go("projects", "active");
    const previous = model.selection.key.peek();
    this.#creating.value = true;
    try {
      const lead = ctx.store.get("People", keyText([ME]))?.entity;
      const saved = await ctx.create("Projects", {
        name: this.#untitledName(),
        leadId: ME,
        state: "active",
        health: "notStarted",
        behindDays: null,
        budget: "0.00",
        spent: "0.00",
        pinned: false,
        hue: Number(lead?.hue ?? 45),
        archivedAt: null,
      });
      this.#showRow(saved.key);
      this.#toaster()?.show(`Created ${saved.record.entity.name}`, {
        label: "Undo",
        run: () => void this.#undo(saved, previous),
      });
    } catch (e) {
      this.#toaster()?.show(`Couldn’t create a project: ${message(e)}`);
    } finally {
      this.#creating.value = false;
    }
  }

  #untitledName(): string {
    const taken = new Set(
      Object.values(this.#setup.model.projects).flatMap((c) => c.items.peek().map((p) => p?.name)),
    );
    for (let n = 1; ; n++) {
      const name = n === 1 ? "Untitled project" : `Untitled project ${n}`;
      if (!taken.has(name)) return name;
    }
  }

  async #changeState(key: KeyText, to: State): Promise<void> {
    const { ctx, model, clock } = this.#setup;
    const project = ctx.store.get("Projects", key)?.entity;
    if (!project) return;
    const from = project.state as State;
    const list = model.projects[from].keys.peek();
    const at = list.indexOf(key);
    const neighbour = list[at + 1] ?? list[at - 1];
    this.#rowError.value = undefined;
    try {
      const saved = await ctx.update("Projects", key, {
        state: to,
        archivedAt: to === "archived" ? new Date(clock.now()).toISOString() : null,
      });
      if (model.route.peek().tab === from && neighbour !== undefined) model.selection.select(neighbour);
      const verb = to === "archived" ? "Archived" : to === "paused" ? "Paused" : from === "archived" ? "Restored" : "Resumed";
      this.#toaster()?.show(`${verb} ${project.name}`, { label: "Undo", run: () => void this.#undo(saved, key) });
    } catch (e) {
      this.#rowError.value = { key, message: `Couldn’t move ${project.name} to ${TAB_TITLES[to]}: ${message(e)} It’s still ${TAB_TITLES[from].toLowerCase()}.` };
    }
  }

  async #togglePin(key: KeyText): Promise<void> {
    const { ctx } = this.#setup;
    const project = ctx.store.get("Projects", key)?.entity;
    if (!project) return;
    this.#rowError.value = undefined;
    try {
      await ctx.update("Projects", key, { pinned: !project.pinned });
      announce(project.pinned ? `Unpinned ${project.name}` : `Pinned ${project.name}`);
    } catch (e) {
      this.#rowError.value = { key, message: `Couldn’t ${project.pinned ? "unpin" : "pin"} ${project.name}: ${message(e)}` };
    }
  }

  /** Applies the inverse of a save, then shows the row it concerns. */
  async #undo(saved: Saved, select: KeyText | undefined): Promise<void> {
    try {
      await this.#setup.ctx.undo(saved);
      if (select !== undefined && this.#setup.ctx.store.get("Projects", select)) this.#showRow(select);
    } catch (e) {
      this.#toaster()?.show(`Couldn’t undo: ${message(e)}`);
    }
  }

  #rowMenu(detail: RowMenuDetail): void {
    const { ctx } = this.#setup;
    const project = ctx.store.get("Projects", detail.key)?.entity;
    if (!project) return;
    const state = project.state as State;
    const move = (label: string, to: State): MenuItem => ({ label, run: () => void this.#changeState(detail.key, to) });
    const items: MenuItem[] = [
      { label: "Open", run: () => this.#openProject(detail.key) },
      { label: "Rename", run: () => this.#startRename(detail.key) },
      ...(state === "active" ? [move("Pause", "paused"), move("Archive", "archived")]
        : state === "paused" ? [move("Resume", "active"), move("Archive", "archived")]
        : [move("Restore to active", "active")]),
      { label: project.pinned ? "Unpin from sidebar" : "Pin to sidebar", run: () => void this.#togglePin(detail.key) },
    ];
    this.querySelector<Menu>("aster-menu")?.openAt(detail, items, `${project.name} actions`, detail.opener);
  }

  #startRename(key: KeyText): void {
    const { ctx } = this.#setup;
    this.#rename.peek()?.edit.dispose();
    this.#rename.value = { key, edit: new EditModel(ctx, "Projects", key) };
    requestAnimationFrame(() => {
      const input = this.querySelector<HTMLInputElement>(".name-editor input");
      input?.focus();
      input?.select();
    });
  }

  #renameKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void this.#saveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.#endRename();
    }
  }

  #renameBlur(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Element).closest('[role="option"]')?.contains(next)) return;
    const rename = this.#rename.peek();
    if (rename && !rename.edit.dirty.peek() && !rename.edit.conflict.peek()) this.#endRename(false);
    else void this.#saveRename(false);
  }

  async #saveRename(refocus = true): Promise<void> {
    const rename = this.#rename.peek();
    if (!rename || rename.edit.conflict.peek()) return;
    if (!rename.edit.dirty.peek()) return this.#endRename(refocus);
    const saved = await rename.edit.save();
    if (saved) this.#endRename(refocus);
    else if (rename.edit.formError.peek()) this.#rowError.value = { key: rename.key, message: `Couldn’t rename: ${rename.edit.formError.peek()} Your new name is still in the field.` };
  }

  #keepMine(): void {
    this.#rename.peek()?.edit.rebase();
    requestAnimationFrame(() => this.querySelector<HTMLInputElement>(".name-editor input")?.focus());
  }

  #takeTheirs(): void {
    this.#rename.peek()?.edit.discard();
    this.#endRename();
  }

  #endRename(refocus = true): void {
    const rename = this.#rename.peek();
    if (!rename) return;
    rename.edit.dispose();
    this.#rename.value = undefined;
    this.#rowError.value = undefined;
    if (refocus) requestAnimationFrame(() => this.#listbox()?.focus());
  }

  /** A pinned shortcut: go to the project's tab, select its row and flash it. */
  #reveal(key: KeyText): void {
    const { ctx, model } = this.#setup;
    const state = ctx.store.get("Projects", key)?.entity.state;
    if (!isState(String(state))) return;
    this.#go("projects", state as State);
    this.#showRow(key);
  }

  #openProject(key: KeyText): void {
    this.#go("project", this.#setup.model.route.peek().tab, Number(keyFromText(key)[0]));
  }

  #showRow(key: KeyText): void {
    this.#setup.model.selection.select(key);
    requestAnimationFrame(() => {
      const list = this.#listbox();
      list?.select(key);
      list?.flash(key);
    });
  }

  #openShare(e: Event): void {
    this.#dialog()?.show(e.currentTarget as HTMLElement, () => this.querySelector<HTMLElement>("aster-dialog .invite input"));
  }

  // ── location ──

  /**
   * New pages are history entries; changing the filter replaces the current
   * one. A page with unsaved changes can ask first.
   */
  #go(page: Page, tab: State, id?: number): void {
    const { model } = this.#setup;
    const before = model.route.peek();
    const hash = hashOf({ page, tab, ...(id !== undefined ? { id } : {}) });
    const proceed = () => {
      if (location.hash !== hash) history[page !== before.page || id !== before.id ? "pushState" : "replaceState"](null, "", hash);
      this.#route({ page, tab, ...(id !== undefined ? { id } : {}) });
    };
    if (page !== before.page && !this.#leaving()?.requestLeave(proceed) && this.#leaving()) return;
    proceed();
  }

  #readRoute(): void {
    const [page, second, third] = location.hash.slice(1).split("/");
    const model = this.#setup.model;
    const current = model.route.peek();
    const id = Number(second);
    const next: Route = {
      page: isPage(page) ? page : "projects",
      tab: isState(second) ? second : current.tab,
      ...(Number.isInteger(id) && second !== undefined && second !== "" ? { id } : {}),
      ...(third ? { detail: third } : {}),
    };
    if (next.page !== current.page && this.#leaving()?.dirty) {
      // Back or a typed URL left a page with unsaved changes: put it back as
      // the newest entry and ask; leaving then goes back to where they went.
      history.pushState(null, "", hashOf(current));
      this.#leaving()!.requestLeave(() => history.back());
      return;
    }
    this.#route(next);
  }

  #guardLink(e: MouseEvent): void {
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    const leaving = this.#leaving();
    if (!link || !leaving?.dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const target = link.getAttribute("href")!;
    if (target === location.hash) return;
    e.preventDefault();
    leaving.requestLeave(() => (location.hash = target));
  }

  #route(route: Route): void {
    void LAZY[route.page]?.();
    this.#setup.model.route.value = route;
  }

  /** The current page, when it can hold unsaved changes. */
  #leaving(): LeavingPage | null {
    return this.querySelector<LeavingPage>("aster-project-page");
  }

  #listbox(): Listbox | null {
    return this.querySelector("aster-listbox");
  }
  #dialog(): Dialog | null {
    return this.querySelector("aster-dialog");
  }
  #toaster(): Toaster | null {
    return this.querySelector("aster-toaster");
  }
}

define("aster-demo", AsterDemo);

function hashOf(route: Route): string {
  if (route.page === "projects") return `#projects/${route.tab}`;
  if (route.id === undefined) return `#${route.page}`;
  return route.detail ? `#${route.page}/${route.id}/${route.detail}` : `#${route.page}/${route.id}`;
}

function status(ctx: DataContext, p: Entity): View {
  const type = ctx.schema.set("Projects").type;
  if (p.state !== "active") {
    const label = type.field("state")?.allowedValues?.find((a) => a.value === p.state)?.label ?? String(p.state);
    return html`<span class="aster-status">${label}</span>`;
  }
  if (p.health === "behind") {
    const days = Number(p.behindDays ?? 0);
    return html`<span class="aster-status" data-tone="negative">Behind by ${days} ${days === 1 ? "day" : "days"}</span>`;
  }
  const label = type.field("health")?.allowedValues?.find((a) => a.value === p.health)?.label ?? String(p.health);
  const tone = p.health === "onTrack" ? "positive" : p.health === "needsReview" ? "caution" : undefined;
  return html`<span class="aster-status" data-tone=${tone ?? nothing}>${label}</span>`;
}

const fmt = (n: number | undefined) => (n === undefined ? "–" : new Intl.NumberFormat("en-GB").format(n));
const firstName = (name: unknown) => String(name ?? "").split(" ")[0] ?? "";
const weekday = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(Date.parse(`${date}T12:00:00Z`));

function partOfDay(iso: string, now: number): string {
  const t = new Date(iso);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = day(new Date(now));
  if (day(t) === today) return t.getUTCHours() < 12 ? "this morning" : "today";
  return relativeTime(iso, now).toLowerCase();
}

function message(e: unknown): string {
  const text = e instanceof ODataError ? e.message : e instanceof Error ? e.message : String(e);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

const DENSITIES = ["standard", "compact", "comfortable"] as const;
type Density = (typeof DENSITIES)[number];

const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function applyDensity(density: Density | undefined): void {
  if (density) document.documentElement.dataset.density = density;
  else delete document.documentElement.dataset.density;
}

function stored<T extends string>(key: string, allowed: readonly T[]): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : undefined;
  } catch {
    return undefined;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; it still applies now.
  }
}

function storedScheme(): "light" | "dark" {
  const requested = new URLSearchParams(location.search).get("scheme");
  if (requested === "light" || requested === "dark") return requested;
  try {
    const v = localStorage.getItem("aster-demo-scheme");
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage can be unavailable; fall back to the system preference.
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storeScheme(scheme: "light" | "dark"): void {
  try {
    localStorage.setItem("aster-demo-scheme", scheme);
  } catch {
    // Not remembered; the lamp still switches.
  }
}
