import { computed } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import { AsterElement, define, uid, type View } from "../base/element.ts";

const STEP = 16;

/** Presentational chrome for a split. */
export interface SplitChrome {
  /**
   * Where a collapsible split's collapse control sits: `"toolbar"` (default),
   * a row above the panes; `"bar"`, a button on the resize bar; or `false`,
   * none, with the host driving `collapsed`.
   */
  readonly collapse?: "toolbar" | "bar" | false;
}
/** Text for the collapse control; the defaults are "Collapse pane" and "Restore pane". */
export interface SplitLabels {
  readonly collapse?: string;
  readonly restore?: string;
}
const COLLAPSE = new Set<unknown>(["toolbar", "bar", false]);

/**
 * Two panes side by side with a resize bar between them. The bar is an ARIA
 * `separator`: drag it, or focus it and use ←/→ (Home and End for the
 * limits). `pane` names the pane that is sized and collapses; the other takes
 * the rest. Its size is clamped to `min` and `max` and written as
 * `--split-start` or `--split-end`; CSS lays out the panes and stacks
 * horizontal splits in narrow containers. ← and → follow the text direction.
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
  readonly #pane = this.prop<"start" | "end">("start");
  readonly #actual = this.prop<number | undefined>(undefined);
  readonly #chrome = this.prop<SplitChrome>(Object.freeze({}));
  readonly #labels = this.prop<SplitLabels>(Object.freeze({}));
  #resize: ResizeObserver | undefined;
  #observed: Element | undefined;
  #stopDrag: (() => void) | undefined;

  get size(): number { return this.width; }
  set size(v: number) { this.width = v; }
  get orientation() { return this.#orientation.value; }
  set orientation(v: "horizontal" | "vertical") { if (!["horizontal", "vertical"].includes(v)) throw new TypeError("Unknown split orientation"); this.#orientation.value = v; }
  get collapsible() { return this.#collapsible.value; }
  set collapsible(v: boolean) { this.#collapsible.value = v; }
  /** Which pane `size`, `min`, `max`, `persist` and collapsing apply to. */
  get pane() { return this.#pane.value; }
  set pane(v: "start" | "end") {
    if (v !== "start" && v !== "end") throw new TypeError("Split pane must be start or end");
    if (v !== this.#pane.peek()) this.#actual.value = undefined;
    this.#pane.value = v;
  }
  /** Presentational chrome. Default `{}`; see SplitChrome. */
  get chrome(): SplitChrome { return this.#chrome.value; }
  set chrome(v: SplitChrome | undefined) {
    const next = v ?? {};
    for (const key of Object.keys(next)) if (key !== "collapse") throw new TypeError(`Unknown split chrome '${key}'`);
    if (next.collapse !== undefined && !COLLAPSE.has(next.collapse)) throw new TypeError("Split chrome.collapse must be toolbar, bar or false");
    this.#chrome.value = Object.freeze({ ...next });
  }
  /** Text for the collapse control. Default `{}`; see SplitLabels. */
  get labels(): SplitLabels { return this.#labels.value; }
  set labels(v: SplitLabels | undefined) {
    const next = v ?? {};
    for (const [key, text] of Object.entries(next)) {
      if (key !== "collapse" && key !== "restore") throw new TypeError(`Unknown split label '${key}'`);
      if (text !== undefined && typeof text !== "string") throw new TypeError(`Split label '${key}' must be a string`);
    }
    this.#labels.value = Object.freeze({ ...next });
  }
  get collapsed() { return this.#collapsed.value; }
  set collapsed(v: boolean) {
    const other = this.#pane.peek() === "start" ? "end" : "start", layout = ":scope > .aster-split-layout";
    if (v && this.querySelector(`${layout} > [data-pane=${this.#pane.peek()}]`)?.contains(document.activeElement)) {
      // The bar first, then the collapse control, then the pane that stays.
      [`${layout} > [role=separator]`, ":scope > .aster-split-tools button", `${layout} > .aster-split-edge`, `${layout} > [data-pane=${other}]`]
        .map(selector => this.querySelector<HTMLElement>(selector))
        .find(target => target?.getClientRects().length)?.focus();
    }
    if (v !== this.#collapsed.peek()) this.#actual.value = undefined;
    this.#collapsed.value = v;
  }
  get responsive() { return this.#responsive.value; }
  set responsive(v: boolean) { this.#responsive.value = v; }

  override disconnectedCallback(): void {
    this.#resize?.disconnect(); this.#resize = undefined; this.#observed = undefined;
    this.#stopDrag?.();
    super.disconnectedCallback();
  }
  protected override updated(): void {
    const pane = this.querySelector<HTMLElement>(`:scope > .aster-split-layout > [data-pane=${this.#pane.peek()}]`);
    if (!pane || pane === this.#observed) return;
    this.#resize ??= new ResizeObserver(([entry]) => {
      const box = entry!.target.getBoundingClientRect();
      this.#actual.value = Math.round(this.#orientation.peek() === "horizontal" ? box.width : box.height);
    });
    this.#resize.disconnect();
    this.#resize.observe(pane);
    this.#observed = pane;
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
    const sized = this.#pane.value, other = sized === "start" ? "end" : "start", controls = `${this.#id}-${sized}`;
    this.style.setProperty(`--split-${sized}`, `${width}px`);
    this.style.removeProperty(`--split-${other}`);
    const pane = (name: "start" | "end", view: View) => name === sized
      ? html`<div class="aster-split-pane" tabindex="0" data-pane=${name} data-sized id=${controls} ?inert=${collapsed} aria-hidden=${collapsed ? "true" : nothing}>${view}</div>`
      : html`<div class="aster-split-pane" tabindex="0" data-pane=${name}>${view}</div>`;
    const control = this.#collapsible.value ? this.#chrome.value.collapse ?? "toolbar" : false;
    const name = collapsed ? this.#labels.value.restore ?? "Restore pane" : this.#labels.value.collapse ?? "Collapse pane";
    const toggle = () => { this.collapsed = !collapsed; };
    return html`${control === "toolbar" ? html`<div class="aster-split-tools"><button type="button" aria-expanded=${!collapsed} aria-controls=${controls} @click=${toggle}>${name}</button></div>` : nothing}
      <div class="aster-split-layout" data-orientation=${this.#orientation.value} data-sized=${sized} ?data-responsive=${this.#responsive.value} ?data-collapsed=${collapsed}
        style=${styleMap({ [`--split-${sized}`]: `${width}px` })}>
      ${pane("start", this.#startView.value)}
      <div class="aster-split-bar" role="separator" tabindex="0" aria-orientation=${vertical ? "horizontal" : "vertical"}
        aria-label=${this.#label.value} aria-controls=${controls}
        aria-valuenow=${collapsed ? 0 : Math.min(this.#max.value, this.#actual.value ?? width)} aria-valuemin=${this.#collapsible.value || collapsed ? 0 : Math.min(this.#min.value, this.#actual.value ?? width)} aria-valuemax=${this.#max.value}
        aria-valuetext=${collapsed ? "Collapsed" : `${this.#actual.value ?? width} pixels`}
        @pointerdown=${(e: PointerEvent) => this.#drag(e)}
        @keydown=${(e: KeyboardEvent) => this.#key(e)}></div>
      ${control === "bar" ? html`<button type="button" class="aster-split-edge" aria-expanded=${!collapsed} aria-controls=${controls}
        aria-label=${name} title=${name} @click=${toggle}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M6 2 3 5l3 3"/></svg></button>` : nothing}
      ${pane("end", this.#endView.value)}</div>`;
  }

  #drag(e: PointerEvent): void {
    if (e.button !== 0 || this.#collapsed.peek()) return;
    this.#stopDrag?.();
    const bar = e.currentTarget as HTMLElement;
    bar.focus(); e.preventDefault(); bar.setPointerCapture(e.pointerId);
    const vertical = this.#orientation.peek() === "vertical";
    const from = vertical ? e.clientY : e.clientX, width = this.#start.peek();
    const dir = (!vertical && getComputedStyle(this).direction === "rtl" ? -1 : 1) * (this.#pane.peek() === "end" ? -1 : 1);
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
    // Arrows move the bar; growing the end pane moves it backward.
    const grow = this.#pane.peek() === "end" ? -STEP : STEP;
    const forward = !vertical && getComputedStyle(this).direction === "rtl" ? -grow : grow;
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
        next = width - grow; break;
      case "ArrowDown":
        if (!vertical) return;
        next = width + grow; break;
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
