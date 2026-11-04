import { html, nothing } from "lit-html";
import { AsterElement, define, each, type View } from "../base/element.ts";
import { reorderIds, visibilityModeFromMultiple, type VisibilityMode } from "./policy.ts";
import "./section.ts";

export interface AccordionItem {
  readonly id: string;
  readonly heading: string;
  readonly summary?: View;
  readonly actions?: View;
  readonly disabled?: boolean;
  readonly body?: View;
  readonly create?: () => View;
}

/** A request to move an item; the host applies `order` to `items`. */
export interface AccordionReorderDetail {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly order: readonly string[];
}

/**
 * Coordinates retained [[class:Section]] panels. Single mode constrains user
 * toggles; errors may still reveal a panel. Close and reorder are requests:
 * the accordion never removes or reorders its host-owned items itself.
 */
export class Accordion extends AsterElement {
  readonly #items = this.prop<readonly AccordionItem[]>([]);
  readonly #expanded = this.prop<readonly string[]>([]);
  readonly #visibilityMode = this.prop<VisibilityMode>("mutex");
  readonly #level = this.prop<2 | 3 | 4>(2);
  readonly #canClose = this.prop(false);
  readonly #canReorder = this.prop(false);
  readonly #canCollapseAll = this.prop(false);
  readonly #created = new Map<string, View>();
  #restoreFocus = false;
  get items() { return this.#items.value; }
  set items(v: readonly AccordionItem[]) {
    if (new Set(v.map(i => i.id)).size !== v.length || v.some(i => !i.id || i.body !== undefined && i.create !== undefined)) throw new TypeError("Accordion items require unique IDs and either body or create");
    const active = document.activeElement?.closest<HTMLElement>("[data-accordion-id]");
    this.#restoreFocus = !!active && active.closest("aster-accordion") === this && !v.some(i => i.id === active.dataset.accordionId);
    const ids = new Set(v.map(i => i.id));
    for (const id of this.#created.keys()) if (!ids.has(id)) this.#created.delete(id);
    this.#expanded.value = this.#expanded.peek().filter(id => ids.has(id));
    this.#items.value = [...v];
  }
  get expanded() { return this.#expanded.value; }
  set expanded(v: readonly string[]) {
    if (new Set(v).size !== v.length || v.some(id => !id)) throw new TypeError("Expanded IDs must be unique");
    this.#expanded.value = [...v];
  }
  /** Sugar for `visibilityMode`: `true` is `"multiple"`, `false` is `"mutex"`. Default `false`. */
  get multiple() { return this.#visibilityMode.value === "multiple"; }
  set multiple(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("multiple must be a boolean");
    this.#visibilityMode.value = visibilityModeFromMultiple(v);
  }
  /** How many sections may be open at once: `"mutex"` (default) or `"multiple"`. */
  get visibilityMode(): VisibilityMode { return this.#visibilityMode.value; }
  set visibilityMode(v: VisibilityMode) {
    if (v !== "multiple" && v !== "mutex") throw new TypeError('visibilityMode must be "multiple" or "mutex"');
    this.#visibilityMode.value = v;
  }
  get headingLevel() { return this.#level.value; }
  set headingLevel(v: 2 | 3 | 4) { this.#level.value = v; }
  /** Whether items get a close control. Default `false`; a close is a cancelable request. */
  get canClose() { return this.#canClose.value; }
  set canClose(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("canClose must be a boolean");
    this.#canClose.value = v;
  }
  /** Whether items get Move up and Move down controls. Default `false`. */
  get canReorder() { return this.#canReorder.value; }
  set canReorder(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("canReorder must be a boolean");
    this.#canReorder.value = v;
  }
  /** Whether a Collapse all control is shown. Default `false`. */
  get canCollapseAll() { return this.#canCollapseAll.value; }
  set canCollapseAll(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("canCollapseAll must be a boolean");
    this.#canCollapseAll.value = v;
  }
  protected render(): View {
    const expanded = this.#expanded.value;
    const mode = this.#visibilityMode.value;
    const items = this.#items.value;
    return html`<div class="aster-accordion" @keydown=${(e: KeyboardEvent) => this.#key(e)}>
      ${this.#canCollapseAll.value ? html`<div class="aster-accordion-tools">
        <button type="button" class="aster-accordion-collapse-all" @click=${() => this.#collapseAll()}>Collapse all</button>
      </div>` : nothing}
      ${each(items, i => i.id, item => {
        const open = expanded.includes(item.id);
        const index = items.findIndex(i => i.id === item.id);
        if (open && item.create && !this.#created.has(item.id)) this.#created.set(item.id, item.create());
        const reorder = this.#canReorder.value && !item.disabled ? this.#reorderControls(item, index, items.length) : nothing;
        const actions = reorder === nothing && item.actions === undefined ? nothing : html`${reorder}${item.actions ?? nothing}`;
        return html`<div class="aster-accordion-item" data-accordion-id=${item.id}>
          <aster-section .heading=${item.heading} .level=${this.#level.value} .open=${open}
            .summary=${item.summary ?? nothing} .actions=${actions} .disabled=${!!item.disabled}
            .canClose=${this.#canClose.value} .chrome=${this.#canClose.value ? { close: true } : undefined}
            .body=${item.body ?? this.#created.get(item.id) ?? nothing}
            @close=${(e: Event) => {
              if ((e.target as HTMLElement).parentElement?.dataset.accordionId !== item.id) return;
              e.stopPropagation();
              this.emit("close", item.id);
            }}
            @section-toggle=${(e: CustomEvent<{ open: boolean; reason: "user" | "error" }>) => {
              if ((e.target as HTMLElement).parentElement?.dataset.accordionId !== item.id) return;
              e.stopPropagation();
              this.#expanded.value = e.detail.open ? [...(mode === "multiple" || e.detail.reason === "error" ? this.#expanded.peek().filter(id => id !== item.id) : []), item.id] : this.#expanded.peek().filter(id => id !== item.id);
              this.emit("expanded-change", { expanded: this.#expanded.peek(), reason: e.detail.reason });
            }}></aster-section>
        </div>`;
      })}
    </div>`;
  }
  protected override updated(): void {
    if (this.#restoreFocus) { this.#restoreFocus = false; this.#headers()[0]?.focus(); }
  }
  #reorderControls(item: AccordionItem, index: number, count: number): View {
    return html`<span class="aster-accordion-reorder">
      <button type="button" aria-label=${`Move ${item.heading} up`} ?disabled=${index <= 0}
        @click=${(e: Event) => { e.stopPropagation(); this.#requestReorder(index, index - 1); }}>↑</button>
      <button type="button" aria-label=${`Move ${item.heading} down`} ?disabled=${index >= count - 1}
        @click=${(e: Event) => { e.stopPropagation(); this.#requestReorder(index, index + 1); }}>↓</button>
    </span>`;
  }
  /** A cancelable request; the host sets `items` to `order` to apply it. */
  #requestReorder(from: number, to: number): void {
    const items = this.#items.peek();
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    this.emit<AccordionReorderDetail>("reorder", { id: items[from]!.id, from, to, order: reorderIds(items.map(i => i.id), from, to) });
  }
  #collapseAll(): void {
    if (!this.#expanded.peek().length) return;
    this.#expanded.value = [];
    this.emit("expanded-change", { expanded: [], reason: "user" });
  }
  #headers(): HTMLButtonElement[] {
    return [...this.querySelectorAll<HTMLButtonElement>(":scope > .aster-accordion > .aster-accordion-item > aster-section > .aster-section-head > button:not(:disabled):not(.aster-section-close)")].filter(el => el.closest("aster-accordion") === this);
  }
  #key(e: KeyboardEvent): void {
    const headers = this.#headers(), index = headers.indexOf(e.target as HTMLButtonElement);
    if (index < 0) return;
    let next: number;
    switch (e.key) {
      case "ArrowDown": next = (index + 1) % headers.length; break;
      case "ArrowUp": next = (index + headers.length - 1) % headers.length; break;
      case "Home": next = 0; break;
      case "End": next = headers.length - 1; break;
      default: return;
    }
    e.preventDefault(); e.stopPropagation(); headers[next]?.focus();
  }
}
define("aster-accordion", Accordion);
