import { html, nothing } from "lit-html";
import { AsterElement, define, read, type Bindable, type View } from "../base/element.ts";

/**
 * A button with every state: rest, hover, pressed, focus, busy and
 * disabled. Busy and confirmation swap the label in place; every label is
 * stacked in one grid cell, so the width never changes. While busy, clicks
 * are ignored and a submit doesn't fire.
 *
 * Prefer `reason` to disabling: the button stays focusable, says why in its
 * title, and its click is swallowed.
 */
export class Button extends AsterElement {
  readonly #label = this.prop("");
  readonly #busyLabel = this.prop<string | undefined>(undefined);
  readonly #confirmLabel = this.prop<string | undefined>(undefined);
  readonly #busy = this.prop<Bindable<boolean>>(false);
  readonly #confirming = this.prop(false);
  readonly #variant = this.prop<"secondary" | "primary">("secondary");
  readonly #type = this.prop<"button" | "submit">("button");
  readonly #icon = this.prop<View>(nothing);
  readonly #reason = this.prop<string | undefined>(undefined);
  #confirmTimer: ReturnType<typeof setTimeout> | undefined;

  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /** Shown while busy, such as "Inviting…". */
  get busyLabel(): string | undefined {
    return this.#busyLabel.value;
  }
  set busyLabel(v: string | undefined) {
    this.#busyLabel.value = v;
  }
  /** Shown briefly by `confirm()`, such as "Copied". */
  get confirmLabel(): string | undefined {
    return this.#confirmLabel.value;
  }
  set confirmLabel(v: string | undefined) {
    this.#confirmLabel.value = v;
  }
  get busy(): Bindable<boolean> {
    return this.#busy.value;
  }
  set busy(v: Bindable<boolean>) {
    this.#busy.value = v;
  }
  get variant(): "secondary" | "primary" {
    return this.#variant.value;
  }
  set variant(v: "secondary" | "primary") {
    this.#variant.value = v;
  }
  get type(): "button" | "submit" {
    return this.#type.value;
  }
  set type(v: "button" | "submit") {
    this.#type.value = v;
  }
  get icon(): View {
    return this.#icon.value;
  }
  set icon(v: View) {
    this.#icon.value = v;
  }
  /** Why the button can't act now. Setting it disables the button without removing it from the tab order. */
  get reason(): string | undefined {
    return this.#reason.value;
  }
  set reason(v: string | undefined) {
    this.#reason.value = v;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.listen(this, "click", (e) => this.#guard(e), { capture: true });
  }

  /** Shows the confirm label in place for a moment. */
  confirm(ms = 1600): void {
    clearTimeout(this.#confirmTimer);
    this.#confirming.value = true;
    this.#confirmTimer = setTimeout(() => (this.#confirming.value = false), ms);
  }

  override focus(options?: FocusOptions): void {
    this.querySelector("button")?.focus(options);
  }

  protected render(): View {
    const busy = read(this.#busy.value);
    const confirming = this.#confirming.value;
    const labels = [this.#label.value, this.#busyLabel.value, this.#confirmLabel.value];
    const showing = busy && labels[1] ? 1 : confirming && labels[2] ? 2 : 0;
    const reason = this.#reason.value;
    return html`<button class="aster-button" type=${this.#type.value} data-variant=${this.#variant.value}
      aria-busy=${busy ? "true" : "false"} aria-disabled=${reason ? "true" : nothing} title=${reason ?? nothing}>
      ${this.#icon.value}
      <span class="aster-label-swap">
        ${labels.map((l, i) => (l === undefined ? nothing : html`<span ?data-off=${i !== showing}>${l}</span>`))}
      </span>
    </button>`;
  }

  #guard(e: MouseEvent): void {
    if (read(this.#busy.peek()) || this.#reason.peek()) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}

define("aster-button", Button);
