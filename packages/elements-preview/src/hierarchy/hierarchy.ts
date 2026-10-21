import { AsterElement, compositeTypes as t, define, each, uid, type View } from "@getaster/elements";
import { html, nothing } from "lit-html";

export interface HierarchyLevel {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly actions?: View;
  readonly content: View;
}

function levelsValid(value: unknown): value is readonly HierarchyLevel[] {
  if (!Array.isArray(value)) return false;
  const view = (v: unknown) => v === nothing || !!v && typeof v === "object" && "_$litType$" in v;
  return new Set(value.map(l => l?.id)).size === value.length && value.every(l => l && typeof l.id === "string" && l.id.length > 0 && typeof l.title === "string" && l.title.trim().length > 0
    && (l.summary === undefined || typeof l.summary === "string") && (l.actions === undefined || view(l.actions)) && view(l.content));
}

/** Controlled navigation; hosts retain or dispose their own keyed sessions. */
export class ContextualHierarchy extends AsterElement {
  static readonly tag = "aster-contextual-hierarchy";
  static readonly contract = Object.freeze({
    levels: t.optional(t.custom("context levels with unique IDs and templates", levelsValid, { type: "array", items: { type: "object", required: ["id", "title", "content"], properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, content: { asterType: "View" }, actions: { asterType: "View" } } } })),
    navigationVisible: t.optional(t.boolean),
    motion: t.optional(t.custom("none or slide", (v): v is "none" | "slide" => v === "none" || v === "slide", { enum: ["none", "slide"] })),
  });
  readonly #levels = this.prop<readonly HierarchyLevel[]>([]);
  readonly #navigationVisible = this.prop(true);
  readonly #motion = this.prop<"none" | "slide">("none");
  readonly #direction = this.prop<"forward" | "back">("forward");
  readonly #id = uid("aster-hierarchy");
  readonly #positions = new Map<string, { top: number; focus: HTMLElement | null }>();
  #opener: HTMLElement | null = null;
  #transition: { back: boolean; id: string } | undefined;

  /** Pointer activation does not focus buttons in every browser; pass the actual opener. */
  navigate(levels: readonly HierarchyLevel[], opener?: HTMLElement): void {
    this.#opener = opener ?? null;
    try { this.levels = levels; } finally { this.#opener = null; }
  }

  get levels() { return this.#levels.value; }
  get navigationVisible() { return this.#navigationVisible.value; }
  set navigationVisible(v: boolean) { this.#navigationVisible.value = v; }
  get motion() { return this.#motion.value; }
  set motion(v: "none" | "slide") {
    if (v !== "none" && v !== "slide") throw new TypeError("Unknown hierarchy motion");
    this.#motion.value = v;
  }
  set levels(v: readonly HierarchyLevel[]) {
    if (!levelsValid(v)) throw new TypeError("Hierarchy levels need unique IDs, titles and content templates");
    const old = this.#levels.peek(), previous = old.at(-1), next = v.at(-1);
    if (previous && previous.id !== next?.id) {
      const pane = this.#pane(previous.id);
      const active = this.#opener ?? document.activeElement;
      this.#positions.set(previous.id, { top: pane?.scrollTop ?? 0, focus: active instanceof HTMLElement && pane?.contains(active) ? active : null });
    }
    if (next && previous && previous.id !== next.id) {
      const back = old.some(l => l.id === next.id);
      this.#direction.value = back ? "back" : "forward";
      this.#transition = { back, id: next.id };
    }
    const ids = new Set(v.map(l => l.id));
    for (const id of this.#positions.keys()) if (!ids.has(id)) this.#positions.delete(id);
    this.#levels.value = [...v];
  }

  #pane(id: string): HTMLElement | undefined {
    return [...this.querySelectorAll<HTMLElement>("[data-hierarchy-level]")].find(el => el.dataset.hierarchyLevel === id && el.closest("aster-contextual-hierarchy") === this);
  }

  protected render(): View {
    const levels = this.#levels.value, current = levels.at(-1);
    return html`<div class="aster-hierarchy" data-motion=${this.#motion.value} data-direction=${this.#direction.value}>
      ${this.#navigationVisible.value && levels.length > 1 ? html`<nav aria-label="Context path"><button type="button" @click=${() => this.emit("back", { id: levels.at(-2)!.id })}>← Back to ${levels.at(-2)!.title}</button>
        <span>${levels.map(l => l.title).join(" / ")}</span></nav>` : nothing}
      ${each(levels, l => l.id, l => html`<section class="aster-hierarchy-level" data-hierarchy-level=${l.id} ?hidden=${l.id !== current?.id} ?inert=${l.id !== current?.id}
        aria-labelledby=${`${this.#id}-${encodeURIComponent(l.id)}`}>
        <header><div><h3 tabindex="-1" id=${`${this.#id}-${encodeURIComponent(l.id)}`}>${l.title}</h3>${l.summary ? html`<p>${l.summary}</p>` : nothing}</div>${l.actions ?? nothing}</header>
        ${l.content}
      </section>`)}
    </div>`;
  }

  protected override updated(): void {
    const transition = this.#transition;
    if (!transition) return;
    this.#transition = undefined;
    const pane = this.#pane(transition.id), position = this.#positions.get(transition.id);
    if (!pane) return;
    pane.scrollTop = transition.back ? position?.top ?? 0 : 0;
    const focus = transition.back && position?.focus?.isConnected && pane.contains(position.focus) ? position.focus : pane.querySelector<HTMLElement>("h3");
    focus?.focus({ preventScroll: true });
  }
}

define("aster-contextual-hierarchy", ContextualHierarchy);
