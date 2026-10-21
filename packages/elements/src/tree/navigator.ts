import { signal } from "@preact/signals-core";
import type { Entity, KeyText, Tree } from "@getaster/data";
import { html, nothing, svg } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";

/**
 * A tree, one level at a time: each row chooses its node, or opens it to
 * show the level under it, sliding in (and back out on the way up). A
 * breadcrumb, back and forward move between levels; the level loads by page
 * as it scrolls. Choosing emits `choose` with the node's key; Escape emits
 * `cancel`.
 *
 * The slide clones the outgoing list as an inert ghost and animates both
 * lists; under reduced motion there's no animation.
 */
export class TreeNavigator extends AsterElement {
  readonly #tree = this.prop<Tree | undefined>(undefined);
  readonly #display = this.prop("");
  readonly #label = this.prop("");
  readonly #chooseLabel = this.prop("Choose");
  readonly #headingLevel = this.prop(2);
  readonly #choosable = this.prop<((entity: Entity) => string | undefined) | undefined>(undefined);
  /** Keys from the top level down to the level shown. */
  readonly #path = signal<readonly KeyText[]>([]);
  readonly #back = signal<readonly (readonly KeyText[])[]>([]);
  readonly #forward = signal<readonly (readonly KeyText[])[]>([]);
  readonly #id = uid("aster-drill");
  #direction = 1;
  #ghost: HTMLElement | undefined;

  get tree(): Tree | undefined {
    return this.#tree.value;
  }
  set tree(v: Tree | undefined) {
    this.#tree.value = v;
  }
  /** The field an entry shows as its name; the type's title field by default. */
  get display(): string {
    return this.#display.value;
  }
  set display(v: string) {
    this.#display.value = v;
  }
  /** Names the navigator, and its top level in the breadcrumb. */
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /**
   * Says why a node can't be chosen (it can still be opened), or
   * `undefined` if it can: moving a task into its own subtree, say.
   */
  get choosable(): ((entity: Entity) => string | undefined) | undefined {
    return this.#choosable.value;
  }
  set choosable(v: ((entity: Entity) => string | undefined) | undefined) {
    this.#choosable.value = v;
  }
  /** The level shown, as keys from the top. */
  get path(): readonly KeyText[] {
    return this.#path.value;
  }

  /** Shows the level under `key` (`undefined`: the top), as if each level were opened in turn. */
  async go(key: KeyText | undefined): Promise<void> {
    const tree = this.#tree.peek();
    if (!tree) return;
    const path = key === undefined ? [] : [...(await tree.ancestors(key)), key];
    this.#move(path, path.length >= this.#path.peek().length ? 1 : -1, true);
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>(".aster-drill-heading")?.focus(options);
  }

  protected render(): View {
    const tree = this.#tree.value;
    if (!tree) return nothing;
    const path = this.#path.value;
    const parent = path.at(-1);
    const level = tree.level(parent);
    const display = this.#display.value || tree.type.titleField || tree.key;
    const title = (key: KeyText) => {
      const e = this.#entity(key);
      return e ? String(e[display] ?? "") : "…";
    };
    const loaded = level.keys.value.filter((k): k is KeyText => k !== undefined);
    const count = level.count.value;
    if (count === undefined && level.status.peek() !== "loading") queueMicrotask(() => void level.ensure(0, level.pageSize).catch(() => {}));
    const heading = parent === undefined ? this.#label.value || "Top level" : title(parent);
    const arrow = (back: boolean) => html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d=${back ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"}/></svg>`;
    return html`<section class="aster-drill" aria-label=${this.#label.value || "Navigate"} @keydown=${(e: KeyboardEvent) => this.#key(e)}>
      <div class="aster-drill-bar">
        <button type="button" class="aster-drill-step" aria-label="Back" title="Back" ?disabled=${!this.#back.value.length} @click=${() => this.#travel(true)}>${arrow(true)}</button>
        <button type="button" class="aster-drill-step" aria-label="Forward" title="Forward" ?disabled=${!this.#forward.value.length} @click=${() => this.#travel(false)}>${arrow(false)}</button>
        <nav class="aster-drill-crumbs" aria-label="Path">
          <ol>
            <li><button type="button" aria-current=${path.length === 0 ? "location" : nothing} @click=${() => this.#move([], -1)}>${this.#label.value || "Top level"}</button></li>
            ${path.map(
              (k, i) => html`<li><button type="button" aria-current=${i === path.length - 1 ? "location" : nothing}
                @click=${() => this.#move(path.slice(0, i + 1), i + 1 >= path.length ? 1 : -1)}>${title(k)}</button></li>`,
            )}
          </ol>
        </nav>
      </div>
      <div class="aster-drill-heading" role="heading" aria-level=${this.#headingLevel.value} id=${`${this.#id}-heading`} tabindex="-1">${heading}</div>
      <div class="aster-drill-viewport">
        <ul class="aster-drill-list" aria-labelledby=${`${this.#id}-heading`} aria-busy=${count === undefined ? "true" : "false"}
          @scroll=${(e: Event) => {
            const el = e.currentTarget as HTMLElement;
            if (!level.complete.peek() && el.scrollTop + el.clientHeight > el.scrollHeight - 80) void level.ensure(0, loaded.length + level.pageSize);
          }}>
          ${count === undefined ? html`<li class="aster-drill-empty"><span role="status">Loading…</span></li>` : nothing}
          ${count === 0 ? html`<li class="aster-drill-empty">Nothing here.</li>` : nothing}
          ${loaded.map((key) => {
            const entity = this.#entity(key);
            const name = title(key);
            const folder = tree.hasChildren(key, parent);
            const why = entity && this.#choosable.value ? this.#choosable.value(entity) : undefined;
            return html`<li class="aster-drill-row" data-key=${key}>
              <button type="button" class="aster-drill-choose" aria-disabled=${why ? "true" : nothing} title=${why ?? nothing}
                aria-label=${`${this.#chooseLabel.value} ${name}`}
                @click=${() => !why && this.emit("choose", key)}>
                <svg viewBox="0 0 16 16" aria-hidden="true">${folder ? svg`<path d="M2 4.5h4.5l1.5 1.5h6v6.5H2z"/>` : svg`<path d="M4 2.5h5.5l3 3v8H4zM9.5 2.5v3h3"/>`}</svg>
                <span>${name}</span>
              </button>
              ${folder !== false
                ? html`<button type="button" class="aster-drill-open" aria-label=${`Open ${name}`} title=${`Open ${name}`}
                    @click=${() => this.#move([...path, key], 1)}>${arrow(false)}</button>`
                : nothing}
            </li>`;
          })}
          ${count !== undefined && loaded.length < count ? html`<li class="aster-drill-empty"><span role="status">${loaded.length} of ${count}…</span></li>` : nothing}
        </ul>
      </div>
    </section>`;
  }

  /** The level of the heading that names the level shown, to fit the page's outline. */
  get headingLevel(): number {
    return this.#headingLevel.value;
  }
  set headingLevel(v: number) {
    this.#headingLevel.value = v;
  }
  /** Text shown on each row's choose button, before the name ("Move under"). */
  get chooseLabel(): string {
    return this.#chooseLabel.value;
  }
  set chooseLabel(v: string) {
    this.#chooseLabel.value = v;
  }

  #entity(key: KeyText): Entity | undefined {
    return this.#tree.value?.entity(key);
  }

  #move(path: readonly KeyText[], direction: number, replaceHistory = false): void {
    const from = this.#path.peek();
    if (from.join() === path.join()) return;
    if (!replaceHistory) {
      this.#back.value = [...this.#back.peek(), from];
      this.#forward.value = [];
    }
    this.#slide(direction, () => (this.#path.value = path));
  }

  #travel(back: boolean): void {
    const stack = back ? this.#back.peek() : this.#forward.peek();
    const to = stack.at(-1);
    if (!to) return;
    const here = this.#path.peek();
    if (back) {
      this.#back.value = stack.slice(0, -1);
      this.#forward.value = [...this.#forward.peek(), here];
    } else {
      this.#forward.value = stack.slice(0, -1);
      this.#back.value = [...this.#back.peek(), here];
    }
    this.#slide(back ? -1 : 1, () => (this.#path.value = to));
  }

  /** Swaps the level with a slide: the new list from the side it's going to, the old one away. */
  #slide(direction: number, change: () => void): void {
    const list = this.querySelector<HTMLElement>(".aster-drill-list");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (list && !reduce) {
      const ghost = list.cloneNode(true) as HTMLElement;
      ghost.inert = true;
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("aster-drill-ghost");
      ghost.removeAttribute("aria-labelledby");
      ghost.scrollTop = list.scrollTop;
      this.#ghost?.remove();
      this.#ghost = ghost;
    }
    this.#direction = direction;
    change();
    requestAnimationFrame(() => {
      this.querySelector<HTMLElement>(".aster-drill-heading")?.focus();
      const incoming = this.querySelector<HTMLElement>(".aster-drill-list");
      const outgoing = this.#ghost;
      this.#ghost = undefined;
      if (!incoming) return;
      incoming.scrollTop = 0;
      if (!outgoing) return;
      incoming.parentElement?.append(outgoing);
      const back = this.#direction < 0;
      outgoing.style.zIndex = back ? "2" : "0";
      const timing = { duration: 240, easing: "cubic-bezier(.22,.7,.25,1)" };
      const animations = [
        incoming.animate([{ transform: `translateX(${back ? "-24%" : "100%"})`, opacity: 0.65 }, { transform: "none", opacity: 1 }], timing),
        outgoing.animate([{ transform: "none" }, { transform: `translateX(${back ? "100%" : "-24%"})`, opacity: 0.65 }], timing),
      ];
      void Promise.all(animations.map((a) => a.finished.catch(() => {}))).then(() => outgoing.remove());
    });
  }

  #key(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.emit("cancel");
    } else if (e.key === "Backspace" && !(e.target as Element).matches("input, textarea") && this.#path.peek().length) {
      e.preventDefault();
      const path = this.#path.peek();
      this.#move(path.slice(0, -1), -1);
    }
  }
}

define("aster-tree-navigator", TreeNavigator);
