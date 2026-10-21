import { define } from "../base/element.ts";

const SELECTED = '[aria-current="true"], [aria-current="page"], [aria-selected="true"]';

/**
 * A group with one caret: a bar that slides to the selected or current
 * descendant. `axis="x"` puts it under the item (tabs); the default `y` puts
 * it at the item's left edge (nav, lists).
 *
 * The caret's position is read from the item's offsets after layout and
 * written as CSS variables; CSS draws and animates it. The group is the
 * caret's containing block, so it must stay `position: relative`.
 */
export class CaretGroup extends HTMLElement {
  readonly #caret = document.createElement("span");
  #mutations: MutationObserver | undefined;
  #resize: ResizeObserver | undefined;
  #frame = 0;
  #placed = false;

  connectedCallback(): void {
    this.#caret.className = "aster-caret";
    this.#caret.setAttribute("aria-hidden", "true");
    if (this.#caret.parentNode !== this) this.prepend(this.#caret);
    this.#mutations = new MutationObserver(() => this.#queue());
    this.#mutations.observe(this, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-current", "aria-selected", "hidden"],
    });
    this.#resize = new ResizeObserver(() => this.#queue(false));
    this.#resize.observe(this);
    void document.fonts?.ready.then(() => this.#queue(false));
    this.#queue(false);
  }

  disconnectedCallback(): void {
    this.#mutations?.disconnect();
    this.#resize?.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#placed = false;
  }

  #queue(animate = true): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#place(animate && this.#placed));
  }

  #place(animate: boolean): void {
    const item = [...this.querySelectorAll<HTMLElement>(SELECTED)].find(
      (el) => el.closest("aster-caret-group") === this && el.offsetParent !== null,
    );
    const style = this.#caret.style;
    if (!item) {
      style.setProperty("--caret-opacity", "0");
      return;
    }
    this.#caret.toggleAttribute("data-instant", !animate);
    const { pos, size } = this.#offsets(item);
    style.setProperty("--caret-opacity", "1");
    style.setProperty("--caret-pos", `${pos}px`);
    style.setProperty("--caret-size", `${size}px`);
    this.#placed = true;
  }

  /** The item's position within this group, through any positioned ancestors in between. */
  #offsets(item: HTMLElement): { pos: number; size: number } {
    const x = this.getAttribute("axis") === "x";
    let pos = 0;
    for (let el: HTMLElement | null = item; el && el !== this; el = el.offsetParent as HTMLElement | null) {
      pos += x ? el.offsetLeft : el.offsetTop;
      if (!this.contains(el.offsetParent)) break;
    }
    return { pos, size: x ? item.offsetWidth : item.offsetHeight };
  }
}

define("aster-caret-group", CaretGroup);
