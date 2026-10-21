import { html, nothing } from "lit-html";
import { AsterElement, define, each, type View } from "../base/element.ts";
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
export class Accordion extends AsterElement {
  readonly #items = this.prop<readonly AccordionItem[]>([]);
  readonly #expanded = this.prop<readonly string[]>([]);
  readonly #multiple = this.prop(false);
  readonly #level = this.prop<2 | 3 | 4>(2);
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
  get multiple() { return this.#multiple.value; }
  set multiple(v: boolean) { this.#multiple.value = v; }
  get headingLevel() { return this.#level.value; }
  set headingLevel(v: 2 | 3 | 4) { this.#level.value = v; }
  protected render(): View {
    const expanded = this.#expanded.value, multiple = this.#multiple.value;
    return html`<div class="aster-accordion" @keydown=${(e: KeyboardEvent) => this.#key(e)}>
      ${each(this.#items.value, i => i.id, item => {
        const open = expanded.includes(item.id);
        if (open && item.create && !this.#created.has(item.id)) this.#created.set(item.id, item.create());
        return html`<div class="aster-accordion-item" data-accordion-id=${item.id}>
          <aster-section .heading=${item.heading} .level=${this.#level.value} .open=${open}
            .summary=${item.summary ?? nothing} .actions=${item.actions ?? nothing} .disabled=${!!item.disabled}
            .body=${item.body ?? this.#created.get(item.id) ?? nothing}
            @section-toggle=${(e: CustomEvent<{ open: boolean; reason: "user" | "error" }>) => {
              if ((e.target as HTMLElement).parentElement?.dataset.accordionId !== item.id) return;
              e.stopPropagation();
              this.#expanded.value = e.detail.open ? [...(multiple || e.detail.reason === "error" ? this.#expanded.peek().filter(id => id !== item.id) : []), item.id] : this.#expanded.peek().filter(id => id !== item.id);
              this.emit("expanded-change", { expanded: this.#expanded.peek(), reason: e.detail.reason });
            }}></aster-section>
        </div>`;
      })}
    </div>`;
  }
  protected override updated(): void {
    if (this.#restoreFocus) { this.#restoreFocus = false; this.#headers()[0]?.focus(); }
  }
  #headers(): HTMLButtonElement[] {
    return [...this.querySelectorAll<HTMLButtonElement>(":scope > .aster-accordion > .aster-accordion-item > aster-section > .aster-section-head > button:not(:disabled)")].filter(el => el.closest("aster-accordion") === this);
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
