import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";

/**
 * A titled section that collapses. The heading is a button with
 * `aria-expanded`; the body stays in the DOM, inert while collapsed, and CSS
 * animates its height (a grid row from 0fr to 1fr), so no layout is
 * measured in JS. A collapsed section opens when an error newly appears in
 * it; collapsing it again holds while that error stays.
 */
export class Section extends AsterElement {
  readonly #heading = this.prop("");
  readonly #open = this.prop(true);
  readonly #body = this.prop<View>(nothing);
  readonly #summary = this.prop<View>(nothing);
  readonly #actions = this.prop<View>(nothing);
  readonly #level = this.prop<2 | 3 | 4>(2);
  readonly #disabled = this.prop(false);
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
    if (!v && this.querySelector(".aster-section-body")?.contains(document.activeElement)) this.querySelector<HTMLButtonElement>(".aster-section-head button")?.focus();
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

  protected render(): View {
    const open = this.#open.value;
    this.toggleAttribute("data-open", open);
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

  #checkErrors(): void {
    const errored = this.querySelector(".aster-section-body [aria-invalid='true']") !== null;
    if (errored && !this.#errored && !this.#open.peek()) this.#toggle(true, "error");
    this.#errored = errored;
  }

  #toggle(open: boolean, reason: "user" | "error"): void {
    this.#open.value = open;
    this.emit("section-toggle", { open, reason });
  }
}

define("aster-section", Section);
