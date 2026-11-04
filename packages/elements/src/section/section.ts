import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { windowBar } from "../window/chrome.ts";
import { closeShown } from "./policy.ts";

/** Presentational chrome for a section, independent of its contents. */
export interface SectionChrome {
  /** Window-bar look, via the shared title-bar template (window/chrome.ts). */
  titleBar?: boolean;
  /** Separate fold chevron in the title bar. Defaults to true with `titleBar`; ignored without it. */
  fold?: boolean;
  /** Close control; activating it emits a cancelable `close` action event. */
  close?: boolean;
  /** Footer region at the bottom of the body area. */
  footer?: boolean;
  /** Where `summary` shows: only while collapsed (default), or always. */
  status?: "collapsed" | "always";
}

/**
 * A titled section that collapses. The heading is a button with
 * `aria-expanded`; the body stays in the DOM, inert while collapsed, and CSS
 * animates its height (a grid row from 0fr to 1fr), so no layout is
 * measured in JS. A collapsed section opens when an error newly appears in
 * it; collapsing it again holds while that error stays.
 *
 * Optional chrome turns it into an in-flow panel: a shared window title bar
 * with a separate fold control, a close control, a footer and a status that
 * can stay visible. `collapsible: false` renders a plain heading and keeps
 * the body open. The panel never closes itself; the host handles `close`.
 */
export class Section extends AsterElement {
  readonly #heading = this.prop("");
  readonly #open = this.prop(true);
  readonly #body = this.prop<View>(nothing);
  readonly #summary = this.prop<View>(nothing);
  readonly #actions = this.prop<View>(nothing);
  readonly #level = this.prop<2 | 3 | 4>(2);
  readonly #disabled = this.prop(false);
  readonly #chrome = this.prop<SectionChrome>({});
  readonly #collapsible = this.prop(true);
  readonly #canClose = this.prop(true);
  readonly #footer = this.prop<View>(nothing);
  readonly #id = uid("aster-section");
  /** Whether the body held an error after the last commit, so only a new one opens the section. */
  #errored = false;
  #errors: MutationObserver | undefined;

  get heading(): string {
    return this.#heading.value;
  }
  set heading(v: string) {
    this.#heading.value = v;
  }
  get actions(): View { return this.#actions.value; }
  set actions(v: View) { this.#actions.value = v; }
  get disabled(): boolean { return this.#disabled.value; }
  set disabled(v: boolean) { this.#disabled.value = v; }
  get open(): boolean {
    return this.#open.value;
  }
  set open(v: boolean) {
    if (!v && this.#collapsible.peek() && this.querySelector(".aster-section-body")?.contains(document.activeElement)) this.#toggleButton()?.focus();
    this.#open.value = v;
  }
  get body(): View {
    return this.#body.value;
  }
  set body(v: View) {
    this.#body.value = v;
  }
  /** The heading's level in the page outline. */
  get level(): 2 | 3 | 4 {
    return this.#level.value;
  }
  set level(v: 2 | 3 | 4) {
    this.#level.value = v;
  }
  /** Shown beside the heading while collapsed, such as "2 changes". */
  get summary(): View {
    return this.#summary.value;
  }
  set summary(v: View) {
    this.#summary.value = v;
  }
  /** Presentational chrome. Default `{}`; omitted fields keep their defaults. */
  get chrome(): SectionChrome {
    return this.#chrome.value;
  }
  set chrome(v: SectionChrome | undefined) {
    this.#chrome.value = Object.freeze({ ...(v ?? {}) });
  }
  /** Whether the heading toggles the body. Default `true`. */
  get collapsible(): boolean { return this.#collapsible.value; }
  set collapsible(v: boolean) { this.#collapsible.value = v; }
  /** Whether the section permits a close control. Default `true`; `chrome.close` still chooses whether to show it as [[object:SectionChrome]]. */
  get canClose(): boolean { return this.#canClose.value; }
  set canClose(v: boolean) { this.#canClose.value = v; }
  /** Footer content; setting it also sets `chrome.footer`. Default `nothing`. */
  get footer(): View { return this.#footer.value; }
  set footer(v: View) {
    this.#footer.value = v;
    this.#chrome.value = Object.freeze({ ...this.#chrome.peek(), footer: v !== nothing });
  }

  protected render(): View {
    const open = this.#open.value;
    const collapsible = this.#collapsible.value;
    const chrome = this.#chrome.value;
    const expanded = open || !collapsible;
    this.toggleAttribute("data-open", expanded);
    return this.#defaultChrome(collapsible, chrome) ? this.#defaultView(open) : this.#panelView(open, collapsible, expanded, chrome);
  }

  /** No option set: keep the original template verbatim, including its markers. */
  #defaultChrome(collapsible: boolean, chrome: SectionChrome): boolean {
    return collapsible && chrome.titleBar !== true && chrome.close !== true && chrome.footer !== true && chrome.status !== "always";
  }

  #defaultView(open: boolean): View {
    return html`<div class="aster-section-head" role="heading" aria-level=${this.#level.value}>
        <button type="button" ?disabled=${this.#disabled.value} aria-expanded=${open ? "true" : "false"} aria-controls=${this.#id}
          @click=${() => this.#toggle(!this.#open.peek(), "user")}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3"/></svg>
          <span>${this.#heading.value}</span>
        </button>
        ${open ? nothing : html`<span class="aster-section-summary">${this.#summary.value}</span>`}
        ${this.#actions.value === nothing ? nothing : html`<div class="aster-section-actions">${this.#actions.value}</div>`}
      </div>
      <div class="aster-section-body" id=${this.#id} role="region" aria-label=${this.#heading.value} ?inert=${!open}>
        <div class="aster-section-inner">${this.#body.value}</div>
      </div>`;
  }

  #panelView(open: boolean, collapsible: boolean, expanded: boolean, chrome: SectionChrome): View {
    if (chrome.titleBar === true) return html`${this.#titleBar(expanded, collapsible, chrome)}
      ${this.#bodyRegion(collapsible, chrome)}`;
    return html`<div class="aster-section-head" role="heading" aria-level=${this.#level.value}>
        ${collapsible
          ? html`<button type="button" ?disabled=${this.#disabled.value} aria-expanded=${open ? "true" : "false"} aria-controls=${this.#id}
          @click=${() => this.#toggle(!this.#open.peek(), "user")}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3"/></svg>
          <span>${this.#heading.value}</span>
        </button>`
          : html`<span class="aster-section-title">${this.#heading.value}</span>`}
        ${this.#showsSummary(expanded, chrome) ? html`<span class="aster-section-summary">${this.#summary.value}</span>` : nothing}
        ${this.#actions.value === nothing ? nothing : html`<div class="aster-section-actions">${this.#actions.value}</div>`}
        ${closeShown(this.#canClose.value, chrome.close) ? this.#close() : nothing}
      </div>
      ${this.#bodyRegion(collapsible, chrome)}`;
  }

  protected override updated(): void {
    if (!this.#errors) {
      this.#errors = new MutationObserver(() => this.#checkErrors());
      this.#errors.observe(this, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-invalid"] });
    }
    this.#checkErrors();
  }

  override disconnectedCallback(): void {
    this.#errors?.disconnect(); this.#errors = undefined;
    super.disconnectedCallback();
  }

  /** The retained body, inert while collapsed; the footer moves with it. */
  #bodyRegion(collapsible: boolean, chrome: SectionChrome): View {
    return html`<div class="aster-section-body" id=${this.#id} role="region" aria-label=${this.#heading.value} ?inert=${collapsible && !this.#open.value}>
        <div class="aster-section-inner">${this.#body.value}${chrome.footer === true ? html`<div class="aster-section-footer">${this.#footer.value}</div>` : nothing}</div>
      </div>`;
  }

  /** The window-style bar: shared title template, status, and bar controls. */
  #titleBar(expanded: boolean, collapsible: boolean, chrome: SectionChrome): View {
    const heading = html`<span class="aster-section-title">${this.#heading.value}</span>${this.#showsSummary(expanded, chrome)
      ? html`<span class="aster-section-summary">${this.#summary.value}</span>`
      : nothing}`;
    const actions = html`${this.#actions.value === nothing ? nothing : html`<div class="aster-section-actions">${this.#actions.value}</div>`}${
      collapsible && chrome.fold !== false ? this.#fold() : nothing
    }${closeShown(this.#canClose.value, chrome.close) ? this.#close() : nothing}`;
    return windowBar(`${this.#id}-heading`, heading, actions, undefined, { level: this.#level.value });
  }

  #showsSummary(expanded: boolean, chrome: SectionChrome): boolean {
    return !expanded || chrome.status === "always";
  }

  #fold(): View {
    const open = this.#open.value;
    return html`<button type="button" class="aster-section-fold" ?disabled=${this.#disabled.value}
      aria-expanded=${open ? "true" : "false"} aria-controls=${this.#id}
      aria-label=${open ? `Collapse ${this.#heading.value}` : `Expand ${this.#heading.value}`}
      @click=${(event: Event) => {
        event.stopPropagation();
        this.#toggle(!this.#open.peek(), "user");
      }}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5l3-3"/></svg>
    </button>`;
  }

  #close(): View {
    return html`<button type="button" class="aster-section-close" aria-label=${`Close ${this.#heading.value}`}
      @click=${(event: Event) => {
        event.stopPropagation();
        this.emit("close");
      }}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
    </button>`;
  }

  #toggleButton(): HTMLButtonElement | undefined {
    return this.querySelector<HTMLButtonElement>(":scope > .aster-window-bar > .aster-section-fold")
      ?? this.querySelector<HTMLButtonElement>(":scope > .aster-section-head > button:not(.aster-section-close)")
      ?? undefined;
  }

  #checkErrors(): void {
    const errored = this.querySelector(".aster-section-body [aria-invalid='true']") !== null;
    if (errored && !this.#errored && !this.#open.peek()) this.#toggle(true, "error");
    this.#errored = errored;
  }

  #toggle(open: boolean, reason: "user" | "error"): void {
    if (!this.#collapsible.peek()) return;
    this.#open.value = open;
    this.emit("section-toggle", { open, reason });
  }
}

define("aster-section", Section);
