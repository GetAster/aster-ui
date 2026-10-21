import { html, nothing, type TemplateResult } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { openWhen, placeStyle } from "../overlay/anchor.ts";

/** An entry of a menu. Without a `kind` it's an action. */
export type MenuItem =
  | { readonly kind?: "action"; readonly label: string; readonly run: () => void; readonly disabled?: string }
  | { readonly kind: "link"; readonly label: string; readonly href: string; readonly activate?: (event: MouseEvent) => void }
  | { readonly kind: "check" | "radio"; readonly label: string; readonly checked: boolean; readonly run: () => void }
  | { readonly kind: "submenu"; readonly label: string; readonly items: readonly MenuItem[] }
  | { readonly kind: "group"; readonly label: string; readonly items: readonly MenuItem[] }
  | { readonly kind: "separator" };

type Focusable = Exclude<MenuItem, { kind: "separator" } | { kind: "group" }>;

/**
 * A menu in the top layer (Popover API), following the APG menu pattern: it
 * opens at a point (a context menu) or against an element, focuses its
 * first item, and moves with the arrows, Home, End and type-ahead. → opens a
 * submenu and ← closes it; check and radio items toggle in place. Escape
 * closes one level, a press outside or focus leaving closes all, and focus
 * returns to the opener. Disabled items stay focusable and say why.
 *
 * The popovers are manual because an auto popover opened from `contextmenu`
 * is dismissed by the same click's pointer-up in some engines. A menu opened
 * at a point writes only the point; one opened against an element, and every
 * submenu, is placed by CSS anchor positioning and flips at the edges.
 */
export class Menu extends AsterElement {
  readonly #items = this.prop<readonly MenuItem[]>([]);
  readonly #label = this.prop("");
  /** The open submenus: indexes into each level's focusable items. */
  readonly #path = this.prop<readonly number[]>([]);
  readonly #open = this.prop(false);
  readonly #anchor = this.prop<string | undefined>(undefined);
  /** Check and radio marks changed since the menu opened; items keep the state they were given. */
  readonly #marks = this.prop<ReadonlyMap<MenuItem, boolean>>(new Map());
  readonly #id = uid("aster-menu");
  #opener: HTMLElement | null = null;
  /** The item to focus once its menu has rendered and its popover is open. */
  #focusNext: { readonly depth: number; readonly index: number } | undefined;
  #stop: (() => void) | undefined;

  /** Opens at a point, such as a right-click. */
  openAt(point: { x: number; y: number }, items: readonly MenuItem[], label: string, opener: HTMLElement | null): void {
    this.style.setProperty("--menu-x", `${point.x}px`);
    this.style.setProperty("--menu-y", `${point.y}px`);
    this.#show(items, label, opener, undefined);
  }

  /** Opens against `anchor`, below it, flipping at the edges; focus returns to `opener`. */
  openFrom(anchor: HTMLElement, items: readonly MenuItem[], label: string, opener: HTMLElement = anchor): void {
    const name = `${this.#id}-anchor`;
    anchor.style.setProperty("anchor-name", `--${name}`);
    this.#show(items, label, opener, name);
  }

  close(): void {
    if (!this.#open.peek()) return;
    this.#open.value = false;
    this.#path.value = [];
    this.#closed();
  }

  protected render(): View {
    if (!this.#open.value) return nothing;
    const path = this.#path.value;
    const levels: { items: readonly MenuItem[]; label: string }[] = [{ items: this.#items.value, label: this.#label.value }];
    for (const index of path) {
      const parent = focusables(levels.at(-1)!.items)[index];
      if (parent?.kind !== "submenu") break;
      levels.push({ items: parent.items, label: parent.label });
    }
    const anchored = this.#anchor.value;
    return html`${levels.map((level, depth) => {
      const place =
        depth > 0 ? placeStyle(this.#itemId(depth - 1, path[depth - 1]!)) : anchored ? placeStyle(anchored) : nothing;
      return html`<div class="aster-menu" popover="manual" role="menu" aria-label=${level.label || nothing}
        data-depth=${depth} ?data-anchored=${depth > 0 || anchored !== undefined} style=${place} ${openWhen(true)}
        @keydown=${(e: KeyboardEvent) => this.#key(e, depth)}>
        ${this.#entries(level.items, depth, { next: 0 })}
      </div>`;
    })}`;
  }

  #entries(items: readonly MenuItem[], depth: number, counter: { next: number }): TemplateResult[] {
    return items.map((item) => {
      if (item.kind === "separator") return html`<div role="separator" class="aster-menu-separator"></div>`;
      if (item.kind === "group") {
        const id = `${this.#id}-g${depth}-${counter.next}`;
        return html`<div role="group" aria-labelledby=${id}>
          <div class="aster-menu-heading" id=${id}>${item.label}</div>
          ${this.#entries(item.items, depth, counter)}
        </div>`;
      }
      const index = counter.next++;
      const id = this.#itemId(depth, index);
      const expanded = this.#path.value[depth] === index;
      const enter = () => this.#hover(depth, index, item);
      switch (item.kind) {
        case "link":
          return html`<a role="menuitem" tabindex="-1" id=${id} href=${item.href} @pointerenter=${enter}
            @click=${(event: MouseEvent) => { this.close(); item.activate?.(event); }}><span class="aster-menu-mark" aria-hidden="true"></span>${item.label}</a>`;
        case "check":
        case "radio":
          {
            const checked = this.#marks.value.get(item) ?? item.checked;
            return html`<button type="button" role=${item.kind === "check" ? "menuitemcheckbox" : "menuitemradio"} tabindex="-1"
              id=${id} aria-checked=${checked ? "true" : "false"} @pointerenter=${enter} @click=${() => this.#choose(item)}>
              <span class="aster-menu-mark" aria-hidden="true">${checked ? (item.kind === "check" ? "✓" : "•") : ""}</span>${item.label}</button>`;
          }
        case "submenu":
          return html`<button type="button" role="menuitem" tabindex="-1" id=${id} aria-haspopup="menu"
            aria-expanded=${expanded ? "true" : "false"} style=${`anchor-name: --${id}`}
            @pointerenter=${enter} @click=${() => this.#openSub(depth, index, true)}>
            <span class="aster-menu-mark" aria-hidden="true"></span>${item.label}<span class="aster-menu-more" aria-hidden="true">›</span></button>`;
        default:
          return html`<button type="button" role="menuitem" tabindex="-1" id=${id}
            aria-disabled=${item.disabled ? "true" : nothing} title=${item.disabled ?? nothing}
            @pointerenter=${enter} @click=${() => this.#choose(item)}>
            <span class="aster-menu-mark" aria-hidden="true"></span>${item.label}</button>`;
      }
    });
  }

  #show(items: readonly MenuItem[], label: string, opener: HTMLElement | null, anchor: string | undefined): void {
    this.#items.value = items;
    this.#label.value = label;
    this.#opener = opener;
    this.#anchor.value = anchor;
    this.#path.value = [];
    this.#marks.value = new Map();
    this.#open.value = true;
    this.#focusNext = { depth: 0, index: 0 };
    this.#watchOutside();
  }

  protected override updated(): void {
    const next = this.#focusNext;
    if (!next) return;
    // After the popovers this render opened (they open in a microtask too).
    queueMicrotask(() => {
      const target = this.#level(next.depth)[next.index];
      if (!target) return;
      this.#focusNext = undefined;
      target.focus();
    });
  }

  #itemId(depth: number, index: number): string {
    return `${this.#id}-${depth}-${index}`;
  }

  #level(depth: number): HTMLElement[] {
    const menu = this.querySelector<HTMLElement>(`.aster-menu[data-depth="${depth}"]`);
    return menu ? [...menu.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"], :scope > [role="group"] > [role^="menuitem"]')] : [];
  }

  #choose(item: Focusable): void {
    if (item.kind === "submenu" || item.kind === "link") return;
    if ((item.kind === undefined || item.kind === "action") && item.disabled) return;
    if (item.kind === "check" || item.kind === "radio") {
      const marks = new Map(this.#marks.peek());
      if (item.kind === "check") marks.set(item, !(marks.get(item) ?? item.checked));
      else for (const other of siblings(this.#items.peek(), item) ?? [item]) if (other.kind === "radio") marks.set(other, other === item);
      this.#marks.value = marks;
      item.run();
      return;
    }
    this.close();
    item.run();
  }

  #openSub(depth: number, index: number, focus: boolean): void {
    this.#path.value = [...this.#path.peek().slice(0, depth), index];
    if (focus) this.#focusNext = { depth: depth + 1, index: 0 };
  }

  /** Pointing at an item opens its submenu, or closes deeper ones. */
  #hover(depth: number, index: number, item: Focusable): void {
    const path = this.#path.peek();
    if (item.kind === "submenu") {
      if (path[depth] !== index) this.#openSub(depth, index, false);
    } else if (path.length > depth) {
      this.#path.value = path.slice(0, depth);
    }
    this.#level(depth)[index]?.focus();
  }

  #key(e: KeyboardEvent, depth: number): void {
    e.stopPropagation();
    const items = this.#level(depth);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return focus(i + 1);
      case "ArrowUp":
        return focus(i - 1);
      case "Home":
        return focus(0);
      case "End":
        return focus(items.length - 1);
      case "ArrowRight":
      case "Enter":
      case " ": {
        const current = items[i];
        if (current?.getAttribute("aria-haspopup") === "menu") {
          e.preventDefault();
          this.#openSub(depth, i, true);
        } else if (e.key !== "ArrowRight") {
          e.preventDefault();
          current?.click();
        }
        return;
      }
      case "ArrowLeft":
      case "Escape":
        e.preventDefault();
        if (depth === 0) {
          if (e.key === "Escape") this.close();
          return;
        }
        {
          const parent = this.#path.peek()[depth - 1]!;
          this.#path.value = this.#path.peek().slice(0, depth - 1);
          this.#focusNext = { depth: depth - 1, index: parent };
        }
        return;
      case "Tab":
        this.close();
        return;
      default: {
        if (e.key.length !== 1 || !/\S/.test(e.key)) return;
        const k = e.key.toLowerCase();
        for (let step = 1; step <= items.length; step++) {
          const n = (i + step) % items.length;
          if ((items[n]?.textContent ?? "").trim().toLowerCase().startsWith(k)) return focus(n);
        }
      }
    }
  }

  #watchOutside(): void {
    this.#stop?.();
    const down = (e: PointerEvent) => {
      if (!this.contains(e.target as Node)) this.close();
    };
    const focus = (e: FocusEvent) => {
      if (!this.contains(e.target as Node)) this.close();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focus, true);
    this.#stop = () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("focusin", focus, true);
      this.#stop = undefined;
    };
  }

  override disconnectedCallback(): void {
    this.#stop?.();
    super.disconnectedCallback();
  }

  #closed(): void {
    this.#stop?.();
    const opener = this.#opener;
    this.#opener = null;
    if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body || this.contains(document.activeElement))) {
      opener.focus();
    }
  }
}

/** The list that holds `item`, searched through groups and submenus. */
function siblings(items: readonly MenuItem[], item: MenuItem): readonly MenuItem[] | undefined {
  if (items.includes(item)) return items;
  for (const i of items) {
    if (i.kind === "group" || i.kind === "submenu") {
      const found = siblings(i.items, item);
      if (found) return found;
    }
  }
  return undefined;
}

function focusables(items: readonly MenuItem[]): Focusable[] {
  return items.flatMap((i): Focusable[] => (i.kind === "separator" ? [] : i.kind === "group" ? focusables(i.items) : [i]));
}

define("aster-menu", Menu);
