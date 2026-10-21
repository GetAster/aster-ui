import { html, nothing } from "lit-html";
import { each, type View } from "../base/element.ts";
import { defineElement, elementProperty } from "../composition/element.ts";
import { compositeTypes as t } from "../composition/contracts.ts";

export interface SidebarItem {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly badge?: string;
  readonly icon?: string;
  readonly hidden?: boolean;
  readonly disabled?: boolean;
  readonly reason?: string;
  readonly children?: readonly SidebarItem[];
}

/** Navigation URLs are limited to web, relative and fragment destinations. */
export function sidebarHref(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value, "https://aster.invalid/").protocol); }
  catch { return false; }
}

function itemsValid(value: unknown): value is readonly SidebarItem[] {
  const ids = new Set<string>();
  const visit = (items: unknown, depth: number): boolean => Array.isArray(items) && depth < 16 && items.every(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.label !== "string" || !item.label.trim()) return false;
    ids.add(item.id);
    const keys = ["id", "label", "href", "badge", "icon", "hidden", "disabled", "reason", "children"];
    return Object.keys(item).every(key => keys.includes(key))
      && ["badge", "icon", "reason"].every(key => item[key] === undefined || typeof item[key] === "string")
      && ["hidden", "disabled"].every(key => item[key] === undefined || typeof item[key] === "boolean")
      && (item.href === undefined || typeof item.href === "string" && sidebarHref(item.href))
      && (item.children === undefined || item.href === undefined && visit(item.children, depth + 1));
  });
  return visit(value, 0);
}

const itemSchema = {
  type: "object", additionalProperties: false, required: ["id", "label"],
  properties: {
    id: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 },
    href: { type: "string" }, badge: { type: "string" }, icon: { type: "string" },
    hidden: { type: "boolean" }, disabled: { type: "boolean" }, reason: { type: "string" },
    children: { type: "array", items: { type: "object" } },
  },
};
export const sidebarItems = t.custom("navigation items with unique IDs and safe URLs", itemsValid, {
  type: "array", items: itemSchema,
});

/** Controlled navigation: hosts own routing, permissions and selection policy. */
export const Sidebar = defineElement({
  tag: "aster-sidebar",
  properties: {
    label: elementProperty(t.string, () => "Navigation", "Accessible navigation name"),
    items: elementProperty(sidebarItems, () => [], "Navigation items; derive visibility and availability in the model"),
    value: elementProperty(t.optional(t.string), () => undefined, "Current item ID"),
    renderIcon: elementProperty(t.optional(t.custom("navigation icon renderer", (value): value is (item: SidebarItem) => View => typeof value === "function", { asterType: "function" })), () => undefined, "Trusted icon renderer; labels remain text"),
    compact: elementProperty(t.boolean, () => false, "Use an icon rail with accessible labels"),
  },
  render: ({ label, items, value, compact, renderIcon }, element) => {
    const choose = (event: MouseEvent, item: SidebarItem) => {
      if (item.disabled) { event.preventDefault(); return; }
      // Modified link clicks keep native open-in-new-tab behaviour.
      if (item.href && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
      const allowed = element.dispatchEvent(new CustomEvent("navigate", { detail: item.id, bubbles: true, cancelable: true }));
      if (!allowed) event.preventDefault();
    };
    const list = (entries: readonly SidebarItem[], unavailable = false): unknown => html`<ul>
      ${each(entries.filter(item => !item.hidden), item => item.id, item => {
        const disabled = unavailable || !!item.disabled;
        const effective = disabled ? { ...item, disabled: true } : item;
        const content = html`<span class="aster-sidebar-icon" aria-hidden="true">${renderIcon ? renderIcon(item) : item.icon ?? item.label.slice(0, 1)}</span>
          <span class="aster-sidebar-label">${item.label}</span>${item.badge ? html`<span class="aster-sidebar-badge">${item.badge}</span>` : nothing}`;
        return html`<li>${item.children ? html`<details open><summary title=${compact ? item.label : nothing}>${content}</summary>${list(item.children, disabled)}</details>`
          : item.href ? html`<a class="aster-sidebar-item" href=${disabled ? nothing : item.href}
            aria-disabled=${disabled ? "true" : nothing} aria-current=${item.id === value ? "page" : nothing}
            tabindex=${disabled ? "-1" : nothing} title=${item.reason ?? (compact ? item.label : nothing)}
            @click=${(event: MouseEvent) => choose(event, effective)}>${content}${item.reason ? html`<span class="aster-sr-only"> ${item.reason}</span>` : nothing}</a>`
          : html`<button class="aster-sidebar-item" type="button" ?disabled=${disabled}
            aria-current=${item.id === value ? "page" : nothing} title=${item.reason ?? (compact ? item.label : nothing)}
            @click=${(event: MouseEvent) => choose(event, effective)}>${content}${item.reason ? html`<span class="aster-sr-only"> ${item.reason}</span>` : nothing}</button>`}</li>`;
      })}</ul>`;
    return html`<nav class="aster-sidebar" aria-label=${label} ?data-compact=${compact}
      @keydown=${(event: KeyboardEvent) => {
        if (!(event.target instanceof HTMLElement) || !event.target.matches("a, button, summary")) return;
        const controls = [...element.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),summary")].filter(node => node.getClientRects().length > 0);
        const index = controls.indexOf(event.target);
        let next: number;
        switch (event.key) {
          case "ArrowDown": next = Math.min(index + 1, controls.length - 1); break;
          case "ArrowUp": next = Math.max(0, index - 1); break;
          case "Home": next = 0; break;
          case "End": next = controls.length - 1; break;
          default: return;
        }
        event.preventDefault(); controls[next]?.focus();
      }}>${list(items)}</nav>`;
  },
});
