import { html, nothing } from "lit-html";
import { ifDefined } from "lit-html/directives/if-defined.js";
import { AsterElement, define, each, read, uid, type Bindable, type View } from "../base/element.ts";
import "../caret/caret-group.ts";

export interface TabItem {
  readonly value: string;
  readonly label: string;
  readonly closable?: boolean;
  readonly disabled?: boolean;
}

/** Controlled tabs with optional retained lazy panels and owner-managed close requests. */
export class Tabs extends AsterElement {
  readonly #items = this.prop<Bindable<readonly TabItem[]>>([]);
  readonly #value = this.prop<Bindable<string | undefined>>(undefined);
  readonly #label = this.prop("");
  readonly #controls = this.prop<string | undefined>(undefined);
  readonly #id = uid("aster-tab");
  /** The panel last labelled, so a new `controls` or a disconnect clears the old one. */
  #panel: Element | null = null;
  readonly #renderPanel = this.prop<((item: TabItem) => View) | undefined>(undefined);
  readonly #activation = this.prop<"automatic" | "manual">("automatic");
  readonly #overflow = this.prop(false);
  readonly #visited = new Set<string>();
  #observer: ResizeObserver | undefined;
  #resizeFrame = 0;
  #selected: string | undefined;
  #focusAfterClose = false;

  /** Render on first activation; keep the panel mounted until its item is removed. */
  get renderPanel(): ((item: TabItem) => View) | undefined { return this.#renderPanel.value; }
  set renderPanel(v: ((item: TabItem) => View) | undefined) { this.#renderPanel.value = v; }
  get activation(): "automatic" | "manual" { return this.#activation.value; }
  set activation(v: "automatic" | "manual") { this.#activation.value = v; }

  get items(): Bindable<readonly TabItem[]> {
    return this.#items.value;
  }
  set items(v: Bindable<readonly TabItem[]>) {
    this.#items.value = v;
  }
  get value(): Bindable<string | undefined> {
    return this.#value.value;
  }
  set value(v: Bindable<string | undefined>) {
    this.#value.value = v;
  }
  /** The tablist's accessible name. */
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /** The id of the panel the tabs control. */
  get controls(): string | undefined {
    return this.#controls.value;
  }
  set controls(v: string | undefined) {
    this.#controls.value = v;
  }

  protected render(): View {
    const items = read(this.#items.value);
    const active = this.#active(items);
    const renderer = this.#renderPanel.value;
    const separateActions = items.some(t => t.closable);
    for (const value of this.#visited) if (!items.some(t => t.value === value)) this.#visited.delete(value);
    if (renderer && active !== undefined) this.#visited.add(active);
    // Close buttons remain siblings; the tablist owns only tabs in the accessibility tree.
    return html`${separateActions ? html`<span class="aster-sr-only" role="tablist" aria-label=${this.#label.value}
      aria-owns=${items.map(t => this.#tabId(t.value)).join(" ")}></span>` : nothing}
    <div class="aster-tabs-strip">
      <button type="button" class="aster-tabs-scroll" aria-label="Scroll tabs backward" ?hidden=${!this.#overflow.value}
        @click=${() => this.#scroll(-1)}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m10 4-4 4 4 4"/></svg></button>
      <div class="aster-tabs-viewport">
        <aster-caret-group axis="x" class="aster-tabs" role=${separateActions || items.length === 0 ? "presentation" : "tablist"} aria-label=${ifDefined(separateActions || items.length === 0 ? undefined : this.#label.value)}
          @keydown=${(e: KeyboardEvent) => this.#key(e, items)}>
          ${each(items, t => t.value, t => html`<span class="aster-tab-item" role="presentation">
            <button type="button" role="tab" id=${this.#tabId(t.value)} data-value=${t.value} title=${t.label}
              aria-selected=${t.value === active ? "true" : "false"} ?disabled=${t.disabled}
              aria-controls=${ifDefined(renderer ? this.#panelId(t.value) : this.#controls.value)}
              tabindex=${t.value === active ? 0 : -1}
              @click=${() => this.#choose(t.value)}>${t.label}</button>
            ${t.closable ? html`<button type="button" class="aster-tab-close" aria-label=${`Close ${t.label}`}
              ?disabled=${t.disabled} tabindex=${t.value === active ? 0 : -1}
              @click=${() => this.#close(t.value)}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button>` : nothing}
          </span>`)}
        </aster-caret-group>
      </div>
      <button type="button" class="aster-tabs-scroll" aria-label="Scroll tabs forward" ?hidden=${!this.#overflow.value}
        @click=${() => this.#scroll(1)}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 4 4 4-4 4"/></svg></button>
    </div>
    ${renderer ? each(items, t => t.value, t => html`<div role="tabpanel" id=${this.#panelId(t.value)}
      aria-labelledby=${this.#tabId(t.value)} tabindex="0" ?hidden=${t.value !== active}
      >${this.#visited.has(t.value) ? renderer(t) : nothing}</div>`) : nothing}`;
  }

  #active(items: readonly TabItem[]): string | undefined {
    const value = read(this.#value.value);
    return items.find(t => t.value === value && !t.disabled)?.value ?? items.find(t => !t.disabled)?.value;
  }

  #panelId(value: string): string { return `${this.#tabId(value)}-panel`; }

  #scroll(direction: number): void {
    const viewport = this.querySelector<HTMLElement>(".aster-tabs-viewport");
    if (viewport) viewport.scrollBy({ left: direction * viewport.clientWidth * (getComputedStyle(this).direction === "rtl" ? -1 : 1), behavior: "instant" });
  }

  #close(value: string): void {
    this.#focusAfterClose = this.contains(document.activeElement);
    this.emit("close", value);
    queueMicrotask(() => {
      if (this.#focusAfterClose && !read(this.#items.peek()).some(t => t.value === value)) this.#focusSelected();
      this.#focusAfterClose = false;
    });
  }

  #revealSelected(): void {
    this.querySelector(".aster-tabs")?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }

  #focusSelected(): void {
    this.querySelector(".aster-tabs")?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }

  /** Stable for a value while the element lives; encoded so any value is a valid single id token. */
  #tabId(value: string): string {
    return `${this.#id}-${encodeURIComponent(value)}`;
  }

  protected override updated(): void {
    const viewport = this.querySelector<HTMLElement>(".aster-tabs-viewport")!;
    if (!this.#observer) {
      this.#observer = new ResizeObserver(() => {
        if (this.#resizeFrame) return;
        this.#resizeFrame = requestAnimationFrame(() => {
          this.#resizeFrame = 0;
          this.#overflow.value = viewport.scrollWidth > viewport.parentElement!.clientWidth + 1;
          this.#revealSelected();
        });
      });
      this.#observer.observe(viewport);
      this.#observer.observe(this.querySelector(".aster-tabs")!);
    }
    const active = this.#active(read(this.#items.peek()));
    if (active !== this.#selected) {
      this.#selected = active;
      this.#revealSelected();
    }
    const id = this.#renderPanel.peek() ? undefined : this.#controls.peek();
    const panel = id ? (this.getRootNode() as Document | ShadowRoot).getElementById(id) : null;
    if (this.#panel && this.#panel !== panel) this.#panel.removeAttribute("aria-labelledby");
    this.#panel = panel;
    const selected = this.querySelector(".aster-tabs")?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (panel && selected) panel.setAttribute("aria-labelledby", selected.id);
    else panel?.removeAttribute("aria-labelledby");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#panel?.removeAttribute("aria-labelledby");
    this.#panel = null;
    this.#observer?.disconnect();
    this.#observer = undefined;
    cancelAnimationFrame(this.#resizeFrame);
    this.#resizeFrame = 0;
  }

  #choose(value: string): void {
    if (value !== this.#active(read(this.#items.peek()))) this.emit("change", value);
  }

  #key(e: KeyboardEvent, items: readonly TabItem[]): void {
    if (!(e.target instanceof HTMLElement) || e.target.getAttribute("role") !== "tab") return;
    const tabs = [...this.querySelector(".aster-tabs")!.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
    const i = tabs.indexOf(e.target as HTMLButtonElement);
    if (i < 0) return;
    const item = items.find(t => t.value === tabs[i]!.dataset.value)!;
    if (e.key === "Delete" && item.closable) { e.preventDefault(); this.#close(item.value); return; }
    const rtl = getComputedStyle(this).direction === "rtl";
    let n: number;
    switch (e.key) {
      case "Home": n = 0; break;
      case "End": n = tabs.length - 1; break;
      case "ArrowRight": n = (i + (rtl ? -1 : 1) + tabs.length) % tabs.length; break;
      case "ArrowLeft": n = (i + (rtl ? 1 : -1) + tabs.length) % tabs.length; break;
      default: return;
    }
    e.preventDefault();
    tabs.forEach((tab, index) => { tab.tabIndex = index === n ? 0 : -1; });
    tabs[n]!.focus();
    tabs[n]!.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    if (this.#activation.peek() === "automatic") this.#choose(tabs[n]!.dataset.value!);
  }
}

define("aster-tabs", Tabs);
