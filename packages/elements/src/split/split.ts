import { computed } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import { AsterElement, define, uid, type View } from "../base/element.ts";

const STEP = 16;

/**
 * Two panes side by side with a resize bar between them. The bar is an ARIA
 * `separator`: drag it, or focus it and use ←/→ (Home and End for the
 * limits). The width is clamped to `min` and `max` and written as
 * `--split-start`; CSS lays out the panes and stacks horizontal splits in narrow containers. ← and → follow the text direction.
 * With `persist`, the width is kept per viewer under that name. The width
 * asked for is kept apart from the width shown, which is always inside
 * `min` and `max`, so changing any of them in any order re-clamps it.
 */
export class Split extends AsterElement {
  readonly #wanted = this.prop(320);
  readonly #min = this.prop(220);
  readonly #max = this.prop(560);
  readonly #start = computed(() => Math.round(Math.min(this.#max.value, Math.max(this.#min.value, this.#wanted.value))));
  readonly #label = this.prop("Resize");
  #persist = "";
  readonly #startView = this.prop<View>(nothing);
  readonly #endView = this.prop<View>(nothing);
  readonly #id = uid("aster-split");
  readonly #orientation = this.prop<"horizontal" | "vertical">("horizontal");
  readonly #collapsible = this.prop(false);
  readonly #collapsed = this.prop(false);
  readonly #responsive = this.prop(true);
  readonly #actual = this.prop<number | undefined>(undefined);
  #resize: ResizeObserver | undefined;
  #stopDrag: (() => void) | undefined;

  get size(): number { return this.width; }
  set size(v: number) { this.width = v; }
  get orientation() { return this.#orientation.value; }
  set orientation(v: "horizontal" | "vertical") { if (!["horizontal", "vertical"].includes(v)) throw new TypeError("Unknown split orientation"); this.#orientation.value = v; }
  get collapsible() { return this.#collapsible.value; }
  set collapsible(v: boolean) { this.#collapsible.value = v; }
  get collapsed() { return this.#collapsed.value; }
  set collapsed(v: boolean) {
    if (v && this.querySelector("[data-pane=start]")?.contains(document.activeElement)) {
      const bar = this.querySelector<HTMLElement>(":scope > .aster-split-layout > [role=separator]");
      (bar?.getClientRects().length ? bar : this.querySelector<HTMLElement>(":scope > .aster-split-tools button, :scope > .aster-split-layout > [data-pane=end]"))?.focus();
    }
    if (v !== this.#collapsed.peek()) this.#actual.value = undefined;
    this.#collapsed.value = v;
  }
  get responsive() { return this.#responsive.value; }
  set responsive(v: boolean) { this.#responsive.value = v; }

  override disconnectedCallback(): void {
    this.#resize?.disconnect(); this.#resize = undefined;
    this.#stopDrag?.();
    super.disconnectedCallback();
  }
  protected override updated(): void {
    if (this.#resize) return;
    const pane = this.querySelector<HTMLElement>("[data-pane=start]");
    if (!pane) return;
    this.#resize = new ResizeObserver(() => {
      const box = pane.getBoundingClientRect();
      this.#actual.value = Math.round(this.#orientation.peek() === "horizontal" ? box.width : box.height);
    });
    this.#resize.observe(pane);
  }

  get start(): View {
    return this.#startView.value;
  }
  set start(v: View) {
    this.#startView.value = v;
  }
  get end(): View {
    return this.#endView.value;
  }
  set end(v: View) {
    this.#endView.value = v;
  }
  get width(): number {
    return this.#start.value;
  }
  set width(v: number) {
    if (!Number.isFinite(v) || v < 0) throw new TypeError("Split size must be a finite nonnegative number");
    this.#wanted.value = v;
  }
  get min(): number {
    return this.#min.value;
  }
  set min(v: number) {
    if (!Number.isFinite(v) || v < 0) throw new TypeError("Split minimum must be nonnegative");
    this.#min.value = v;
  }
  get max(): number {
    return this.#max.value;
  }
  set max(v: number) {
    if (!Number.isFinite(v) || v < 0) throw new TypeError("Split maximum must be nonnegative");
    this.#max.value = v;
  }
  /** The separator's accessible name. */
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  get persist(): string {
    return this.#persist;
  }
  set persist(v: string) {
    this.#persist = v;
    try {
      const saved = Number(localStorage.getItem(`aster-split:${v}`));
      if (saved) this.#wanted.value = saved;
    } catch {
      // Storage can be unavailable; the default width stands.
    }
  }

  protected render(): View {
    const width = this.#start.value, vertical = this.#orientation.value === "vertical", collapsed = this.#collapsed.value;
    this.style.setProperty("--split-start", `${width}px`);
    return html`${this.#collapsible.value ? html`<div class="aster-split-tools"><button type="button" aria-expanded=${!collapsed} aria-controls=${`${this.#id}-start`} @click=${() => this.collapsed = !collapsed}>${collapsed ? "Restore pane" : "Collapse pane"}</button></div>` : nothing}
      <div class="aster-split-layout" data-orientation=${this.#orientation.value} ?data-responsive=${this.#responsive.value} ?data-collapsed=${collapsed}
        style=${styleMap({ "--split-start": `${width}px` })}>
      <div class="aster-split-pane" tabindex="0" data-pane="start" id=${`${this.#id}-start`} ?inert=${collapsed} aria-hidden=${collapsed ? "true" : nothing}>${this.#startView.value}</div>
      <div class="aster-split-bar" role="separator" tabindex="0" aria-orientation=${vertical ? "horizontal" : "vertical"}
        aria-label=${this.#label.value} aria-controls=${`${this.#id}-start`}
        aria-valuenow=${collapsed ? 0 : Math.min(this.#max.value, this.#actual.value ?? width)} aria-valuemin=${this.#collapsible.value || collapsed ? 0 : Math.min(this.#min.value, this.#actual.value ?? width)} aria-valuemax=${this.#max.value}
        aria-valuetext=${collapsed ? "Collapsed" : `${this.#actual.value ?? width} pixels`}
        @pointerdown=${(e: PointerEvent) => this.#drag(e)}
        @keydown=${(e: KeyboardEvent) => this.#key(e)}></div>
      <div class="aster-split-pane" tabindex="0" data-pane="end">${this.#endView.value}</div></div>`;
  }

  #drag(e: PointerEvent): void {
    if (e.button !== 0 || this.#collapsed.peek()) return;
    this.#stopDrag?.();
    const bar = e.currentTarget as HTMLElement;
    bar.focus(); e.preventDefault(); bar.setPointerCapture(e.pointerId);
    const vertical = this.#orientation.peek() === "vertical";
    const from = vertical ? e.clientY : e.clientX, width = this.#start.peek();
    const dir = !vertical && getComputedStyle(this).direction === "rtl" ? -1 : 1;
    const move = (m: PointerEvent) => (this.#wanted.value = this.#clamp(width + ((vertical ? m.clientY : m.clientX) - from) * dir));
    const cleanup = () => {
      bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", cancel); bar.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", escape, true);
      this.#stopDrag = undefined;
      if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    };
    const cancel = () => { this.#wanted.value = width; cleanup(); };
    const up = () => { cleanup(); this.#save(); };
    const escape = (key: KeyboardEvent) => { if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); cancel(); } };
    this.#stopDrag = cancel;
    bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", cancel); bar.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", escape, true);
  }

  #key(e: KeyboardEvent): void {
    const width = this.#start.peek();
    if (e.key === "Enter" && this.#collapsible.peek()) { e.preventDefault(); this.collapsed = !this.collapsed; return; }
    if (this.#collapsed.peek()) return;
    const vertical = this.#orientation.peek() === "vertical";
    const forward = !vertical && getComputedStyle(this).direction === "rtl" ? -STEP : STEP;
    let next: number;
    switch (e.key) {
      case "ArrowLeft":
        if (vertical) return;
        next = width - forward;
        break;
      case "ArrowRight":
        if (vertical) return;
        next = width + forward;
        break;
      case "ArrowUp":
        if (!vertical) return;
        next = width - STEP; break;
      case "ArrowDown":
        if (!vertical) return;
        next = width + STEP; break;
      case "Home":
        next = this.#min.peek();
        break;
      case "End":
        next = this.#max.peek();
        break;
      default:
        return;
    }
    e.preventDefault();
    this.#wanted.value = this.#clamp(next);
    this.#save();
  }

  #clamp(v: number): number {
    return Math.round(Math.min(this.#max.peek(), Math.max(this.#min.peek(), v)));
  }

  #save(): void {
    if (!this.#persist) return;
    try {
      localStorage.setItem(`aster-split:${this.#persist}`, String(this.#start.peek()));
    } catch {
      // Not kept; the width still applies now.
    }
  }
}

define("aster-split", Split);
