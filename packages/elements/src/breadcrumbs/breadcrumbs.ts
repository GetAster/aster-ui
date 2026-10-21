import { html, nothing } from "lit-html";
import { each } from "../base/element.ts";
import { defineElement, elementProperty } from "../composition/element.ts";
import { compositeTypes as t } from "../composition/contracts.ts";
import { sidebarHref } from "../sidebar/sidebar.ts";
import { Menu, type MenuItem } from "../menu/menu.ts";

export interface BreadcrumbItem {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly activate?: () => void;
}
const items = t.custom("breadcrumbs with unique IDs, labels and safe links", (v): v is readonly BreadcrumbItem[] => {
  if (!Array.isArray(v)) return false;
  const ids = new Set<string>();
  return v.every(i => {
    if (!i || typeof i.id !== "string" || !i.id || ids.has(i.id) || typeof i.label !== "string" || !i.label.trim()) return false;
    ids.add(i.id);
    return (i.href === undefined || typeof i.href === "string" && sidebarHref(i.href)) && (i.activate === undefined || typeof i.activate === "function") && !(i.href && i.activate);
  });
}, { type: "array", items: { type: "object", required: ["id", "label"], properties: { id: { type: "string" }, label: { type: "string" }, href: { type: "string" }, activate: { asterType: "function" } }, additionalProperties: false } });

export const Breadcrumbs = defineElement({
  tag: "aster-breadcrumbs",
  properties: {
    items: elementProperty(items, () => [], "Ancestor locations"),
    label: elementProperty(t.string, () => "Breadcrumb", "Navigation name"),
    maxVisible: elementProperty(t.custom("at least three visible items", (v): v is number => Number.isSafeInteger(v) && (v as number) >= 3, { type: "integer", minimum: 3 }), () => 4, "Visible item budget including overflow"),
  },
  render: (p, element) => {
    const activate = (item: BreadcrumbItem, e?: MouseEvent) => {
      if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return;
      if (!element.dispatchEvent(new CustomEvent("navigate", { detail: item.id, bubbles: true, cancelable: true }))) { e?.preventDefault(); return; }
      item.activate?.();
    };
    const overflow = p.items.length > p.maxVisible;
    const omitted = overflow ? p.items.slice(1, p.items.length - (p.maxVisible - 2)) : [];
    const shown = overflow ? [p.items[0]!, ...p.items.slice(-(p.maxVisible - 2))] : p.items;
    return html`<nav class="aster-breadcrumbs" aria-label=${p.label}><ol>
      ${each(shown, i => i.id, item => html`<li>
        ${item === p.items.at(-1) ? html`<span aria-current="page" title=${item.label}>${item.label}</span>`
          : item.href ? html`<a href=${item.href} title=${item.label} @click=${(e: MouseEvent) => activate(item, e)}>${item.label}</a>`
          : html`<button type="button" title=${item.label} @click=${() => activate(item)}>${item.label}</button>`}
        ${overflow && item === p.items[0] ? html`<span class="aster-breadcrumb-overflow"><button type="button" aria-label="Show ancestors" aria-haspopup="menu" @click=${(e: MouseEvent) => {
          const menu = element.querySelector<Menu>("aster-menu")!;
          const choices: MenuItem[] = omitted.map(i => i.href ? { kind: "link", label: i.label, href: i.href, activate: event => activate(i, event) } : { label: i.label, run: () => activate(i) });
          menu.openFrom(e.currentTarget as HTMLElement, choices, "Ancestors");
        }}>…</button></span>` : nothing}
      </li>`)}
    </ol></nav><aster-menu></aster-menu>`;
  },
});
