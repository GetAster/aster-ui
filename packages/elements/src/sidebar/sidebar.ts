import { signal, type Signal } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { each, uid, type View } from "../base/element.ts";
import "../caret/caret-group.ts";
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
  /** More about the destination, such as where a project lives: the tooltip and the accessible description. */
  readonly description?: string;
  readonly children?: readonly SidebarItem[];
  /** For a group: `false` shows it as a labelled section that doesn't fold. Default `true`. */
  readonly collapsible?: boolean;
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
    const keys = ["id", "label", "href", "badge", "icon", "hidden", "disabled", "reason", "description", "children", "collapsible"];
    return Object.keys(item).every(key => keys.includes(key))
      && ["badge", "icon", "reason", "description"].every(key => item[key] === undefined || typeof item[key] === "string")
      && ["hidden", "disabled", "collapsible"].every(key => item[key] === undefined || typeof item[key] === "boolean")
      && (item.collapsible === undefined || item.children !== undefined)
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
    hidden: { type: "boolean" }, disabled: { type: "boolean" }, reason: { type: "string" }, description: { type: "string" }, collapsible: { type: "boolean" },
    children: { type: "array", items: { type: "object" } },
  },
};
export const sidebarItems = t.custom("navigation items with unique IDs and safe URLs", itemsValid, {
  type: "array", items: itemSchema,
});

/** Folded groups, by element: view state the host doesn't control. */
const folded = new WeakMap<HTMLElement, Signal<ReadonlySet<string>>>();
/** Each element's prefix for its description IDs. */
const prefixes = new WeakMap<HTMLElement, string>();

function contains(items: readonly SidebarItem[], id: string | undefined): boolean {
  return id !== undefined && items.some(item => !item.hidden && (item.id === id || (item.children !== undefined && contains(item.children, id))));
}

/**
 * Controlled navigation: hosts own routing, permissions and selection policy.
 * A caret marks the current item; a folded group that hides it carries the
 * caret instead.
 */
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
    let closed = folded.get(element);
    if (!closed) folded.set(element, closed = signal<ReadonlySet<string>>(new Set()));
    const shut = closed.value;
    let prefix = prefixes.get(element);
    if (!prefix) prefixes.set(element, prefix = uid("aster-sidebar"));
    let described = 0;
    // The compact rail's label, why the item is unavailable, then its description.
    const tip = (item: SidebarItem, label = compact) => [label ? item.label : undefined, item.reason, item.description].filter(Boolean).join("\n") || nothing;
    const toggle = (id: string, open: boolean) => {
      if (open === !closed.peek().has(id)) return;
      const next = new Set(closed.peek());
      if (open) next.delete(id); else next.add(id);
      closed.value = next;
    };
    const choose = (event: MouseEvent, item: SidebarItem) => {
      if (item.disabled) { event.preventDefault(); return; }
      // Modified link clicks keep native open-in-new-tab behaviour.
      if (item.href && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
      const allowed = element.dispatchEvent(new CustomEvent("navigate", { detail: item.id, bubbles: true, cancelable: true }));
      if (!allowed) event.preventDefault();
    };
    const list = (entries: readonly SidebarItem[], unavailable = false, name?: string, describedBy?: string): unknown => html`<ul aria-label=${name ?? nothing} aria-describedby=${describedBy ?? nothing}>
      ${each(entries.filter(item => !item.hidden), item => item.id, item => {
        const disabled = unavailable || !!item.disabled;
        const effective = disabled ? { ...item, disabled: true } : item;
        // The compact rail needs a mark for every item, so it falls back to the initial.
        const glyph = renderIcon ? renderIcon(item) : item.icon ?? (compact ? item.label.slice(0, 1) : undefined);
        const content = html`${glyph === undefined ? nothing : html`<span class="aster-sidebar-icon" aria-hidden="true">${glyph}</span>`}
          <span class="aster-sidebar-label">${item.label}</span>${item.badge ? html`<span class="aster-count aster-figure-text aster-sidebar-badge">${item.badge}</span>` : nothing}`;
        // A hidden node still supplies the description it is referenced for.
        const describedBy = item.description ? `${prefix}-d${described++}` : undefined;
        const description = describedBy ? html`<span id=${describedBy} hidden>${item.description}</span>` : nothing;
        if (item.children && item.collapsible === false) {
          return html`<li class="aster-sidebar-section"><div class="aster-nav-label" aria-hidden="true" title=${tip(item, false)}>${item.label}</div>${list(item.children, disabled, item.label, describedBy)}${description}</li>`;
        }
        // A folded group that hides the current item stands in for it.
        const open = !shut.has(item.id);
        return html`<li>${item.children ? html`<details ?open=${open} @toggle=${(event: Event) => toggle(item.id, (event.currentTarget as HTMLDetailsElement).open)}>
            <summary class="aster-nav-item" title=${tip(item)} aria-describedby=${describedBy ?? nothing} aria-current=${!open && contains(item.children, value) ? "true" : nothing}>${content}</summary>${list(item.children, disabled)}</details>${description}`
          : item.href ? html`<a class="aster-nav-item aster-sidebar-item" href=${disabled ? nothing : item.href}
            aria-disabled=${disabled ? "true" : nothing} aria-current=${item.id === value ? "page" : nothing}
            tabindex=${disabled ? "-1" : nothing} title=${tip(item)} aria-describedby=${describedBy ?? nothing}
            @click=${(event: MouseEvent) => choose(event, effective)}>${content}${item.reason ? html`<span class="aster-sr-only"> ${item.reason}</span>` : nothing}</a>${description}`
          : html`<button class="aster-nav-item aster-sidebar-item" type="button" ?disabled=${disabled}
            aria-current=${item.id === value ? "page" : nothing} title=${tip(item)} aria-describedby=${describedBy ?? nothing}
            @click=${(event: MouseEvent) => choose(event, effective)}>${content}${item.reason ? html`<span class="aster-sr-only"> ${item.reason}</span>` : nothing}</button>${description}`}</li>`;
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
      }}><aster-caret-group class="aster-nav">${list(items)}</aster-caret-group></nav>`;
  },
});
