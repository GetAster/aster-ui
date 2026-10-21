import { computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import {
  EditModel,
  Selection,
  editPublication,
  keyFromText,
  keyText,
  type Collection,
  type Entity,
  type FieldState,
  type KeyText,
  type PageScope,
  type Query,
} from "@getaster/data";
import {
  AsterElement,
  define,
  each,
  provideScope,
  relativeTime,
  scopeOf,
  type FormSection,
  type View,
} from "@getaster/elements";
import { html, nothing } from "lit-html";
import type { AppSetup } from "../../setup.ts";

const SECTIONS: readonly FormSection[] = [{ title: "Details", columns: 2, items: [{ field: "name", span: 2 }, "email", "hue"] }];

interface Detail {
  readonly scope: PageScope;
  readonly selection: Selection;
  readonly leads: Collection;
  readonly tasks: Collection;
  /** Save acts while there are changes; pressing it with errors shows them. */
  readonly save: ReadonlySignal<FieldState>;
  readonly dispose: () => void;
}

/**
 * Everyone, beside the selected person's details: a form, the projects they
 * lead and their open tasks. The list publishes `people` to the page scope,
 * and both lists' queries follow `people.selected.id`. Unsaved changes stay
 * with each person while you look at someone else.
 */
export class PeoplePage extends AsterElement {
  #setup!: AppSetup;
  readonly #id = this.prop<number | undefined>(undefined);
  readonly #detail = signal<Detail | undefined>(undefined);
  readonly #drafts = new Map<KeyText, EditModel>();
  readonly #draftsChanged = signal(0);
  readonly #saving = signal(false);

  set setup(v: AppSetup) {
    this.#setup = v;
  }
  get personId(): number | undefined {
    return this.#id.value;
  }
  set personId(v: number | undefined) {
    this.#id.value = v;
    if (v !== undefined) this.#detail.peek()?.selection.select(keyText([v]));
  }

  /** Unsaved changes to anyone. */
  get dirty(): boolean {
    return [...this.#drafts.values()].some((d) => d.dirty.peek());
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#open();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#detail.peek()?.dispose();
    this.#detail.value = undefined;
    for (const d of this.#drafts.values()) d.dispose();
    this.#drafts.clear();
  }

  protected render(): View {
    const detail = this.#detail.value;
    if (!detail) return nothing;
    const narrowDetail = this.#id.value !== undefined;
    this.toggleAttribute("data-detail", narrowDetail);
    return html`<div class="head"><h1>People</h1></div><div></div>
      <aster-split class="people-split" .persist=${"people"} .label=${"Resize the people list"} .min=${220} .max=${520}
        .start=${this.#list(detail)} .end=${this.#person(detail)}></aster-split>`;
  }

  #list(detail: Detail): View {
    this.#draftsChanged.value;
    return html`<aster-listbox class="people-list" .label=${"People"} .selection=${detail.selection} .publish=${"people"}
      .renderRow=${(p: Entity, key: KeyText) => {
        const draft = this.#drafts.get(key);
        return html`<i class="aster-avatar" style=${`--hue:${p.hue}`}></i>
          <span class="person-name">${p.name}${draft?.dirty.value ? html`<span class="unsaved" title="Unsaved changes" aria-hidden="true"></span><span class="aster-sr-only">, unsaved changes</span>` : nothing}</span>
          <span class="person-email">${p.email ?? ""}</span>`;
      }}
      @click=${() => this.#showDetail(detail)}
      @row-open=${() => this.#showDetail(detail)}></aster-listbox>`;
  }

  #person(detail: Detail): View {
    const key = detail.selection.key.value;
    const person = detail.selection.selected.value;
    this.#draftsChanged.value;
    const edit = key ? this.#drafts.get(key) : undefined;
    if (!key || !person || !edit) return html`<p class="quiet people-empty">Choose someone to see their details.</p>`;
    const save = detail.save.value;
    const reason = save.enabled ? undefined : save.reasons.enabled;
    const leads = detail.leads.items.value.filter((p): p is Entity => p !== undefined);
    const tasks = detail.tasks.items.value.filter((t): t is Entity => t !== undefined);
    const { ctx, clock } = this.#setup;
    return html`<div class="person-detail">
      <div class="person-head">
        <a class="back people-back" href="#people">People</a>
        <i class="aster-avatar big" style=${`--hue:${edit.values.value.hue ?? person.hue}`}></i>
        <h2>${person.name}</h2>
        <aster-button .label=${"Revert"} .reason=${edit.dirty.value ? undefined : "No changes to revert."}
          @click=${() => edit.revert()}></aster-button>
        <aster-button class="save" .variant=${"primary"} .label=${"Save"} .busyLabel=${"Saving…"} .confirmLabel=${"Saved"}
          .busy=${this.#saving} .reason=${reason} @click=${() => void this.#save(edit)}></aster-button>
      </div>
      ${edit.formError.value ? html`<p class="aster-error" role="alert">${edit.formError.value}</p>` : nothing}
      <aster-form .model=${edit} .sections=${SECTIONS} .headingLevel=${3}></aster-form>
      <section aria-labelledby="leads-title">
        <h3 class="section-title" id="leads-title">Leads ${detail.leads.count.value ?? ""}</h3>
        ${detail.leads.count.value === 0 ? html`<p class="quiet">${person.name} doesn’t lead any projects.</p>` : nothing}
        ${each(leads, (p) => String(p.id), (p) => html`<a class="person-row" href=${`#project/${p.id}`}>
          <span>${p.name}</span><span class="quiet-text">${stateLabel(p)}</span></a>`)}
      </section>
      <section aria-labelledby="tasks-title">
        <h3 class="section-title" id="tasks-title">Open tasks ${detail.tasks.count.value ?? ""}</h3>
        ${detail.tasks.count.value === 0 ? html`<p class="quiet">Nothing open is assigned to ${person.name}.</p>` : nothing}
        ${each(tasks.slice(0, 12), (t) => String(t.id), (t) => {
          const project = ctx.lookup("Projects", keyText([t.projectId!])).value;
          return html`<div class="person-row"><span>${t.title}</span>
            <span class="quiet-text">${project?.name ?? ""}${t.due ? ` · due ${relativeTime(`${String(t.due)}T12:00:00Z`, clock.tick.value).toLowerCase()}` : ""}</span></div>`;
        })}
        ${tasks.length > 12 ? html`<p class="quiet">${tasks.length - 12} more.</p>` : nothing}
      </section>
    </div>`;
  }

  #open(): void {
    const { ctx, model } = this.#setup;
    const scope = ((this.parentElement && scopeOf(this.parentElement)) ?? model.scope).child();
    provideScope(this, scope);
    const selection = new Selection(ctx.store, model.people);
    if (this.#id.peek() !== undefined) selection.select(keyText([this.#id.peek()!]));
    const personId = scope.value("people.selected.id");
    const follow = (build: (id: number) => Query) => computed(() => build((personId.value as number | undefined) ?? -1));
    const leads = ctx.collection(
      follow((id) => ({ set: "Projects", filter: { op: "eq", field: "leadId", value: id }, orderBy: [{ field: "name" }] })),
      { pageSize: 200 },
    );
    const tasks = ctx.collection(
      follow((id) => ({
        set: "Tasks",
        filter: { op: "and", args: [{ op: "eq", field: "assigneeId", value: id }, { op: "eq", field: "done", value: false }] },
        orderBy: [{ field: "due" }, { field: "id" }],
      })),
      { pageSize: 500 },
    );
    // The selected person's draft is made here, never while rendering, and
    // publishes as `person`; the publication follows the selection.
    const stop = [
      effect(() => {
        const key = selection.key.value;
        if (!key || !selection.selected.value) return undefined;
        return scope.publish("person", editPublication(this.#draft(key)));
      }),
      effect(() => {
        void leads.loadAll();
        void tasks.loadAll();
        personId.value;
      }),
      effect(() => {
        const key = selection.key.value;
        const hash = key ? `#people/${keyFromText(key)[0]}` : "#people";
        const narrow = matchMedia("(max-width: 720px)").matches;
        if (key && location.hash !== hash && (!narrow || this.#id.peek() !== undefined)) history.replaceState(null, "", hash);
      }),
    ];
    const save = scope.state("person.save", { enabled: { when: "person.dirty", reason: "No changes to save." } });
    this.#detail.value = {
      scope,
      selection,
      leads,
      tasks,
      save,
      dispose: () => {
        for (const s of stop) s();
        ctx.release(leads);
        ctx.release(tasks);
      },
    };
  }

  #draft(key: KeyText): EditModel {
    let edit = this.#drafts.get(key);
    if (!edit) {
      edit = new EditModel(this.#setup.ctx, "People", key);
      this.#drafts.set(key, edit);
      untracked(() => this.#draftsChanged.value++);
    }
    return edit;
  }

  /** At phone width the detail replaces the list; the URL says which shows. */
  #showDetail(detail: Detail): void {
    const key = detail.selection.key.peek();
    if (!key || !matchMedia("(max-width: 720px)").matches) return;
    location.hash = `#people/${keyFromText(key)[0]}`;
  }

  async #save(edit: EditModel): Promise<void> {
    if (this.#saving.peek()) return;
    this.#saving.value = true;
    try {
      if (await edit.save()) this.querySelector<HTMLElement & { confirm(): void }>(".person-head aster-button.save")?.confirm();
      else requestAnimationFrame(() => this.querySelector<HTMLElement>(".person-detail [aria-invalid='true']")?.focus());
    } finally {
      this.#saving.value = false;
    }
  }
}

function stateLabel(p: Entity): string {
  if (p.state !== "active") return p.state === "paused" ? "Paused" : "Archived";
  return p.health === "behind" ? `Behind by ${p.behindDays} days` : p.health === "onTrack" ? "On track" : p.health === "needsReview" ? "Needs review" : "Not started";
}

define("aster-people-page", PeoplePage);
