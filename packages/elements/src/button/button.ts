import { html, nothing } from "lit-html";
import { AsterElement, define, read, type Bindable, type View } from "../base/element.ts";

/** A button's visual weight: neutral, accented, or destructive. */
export type ButtonTone = "secondary" | "primary" | "danger";
/** A button's size on the density scale. */
export type ButtonSize = "sm" | "md" | "lg";

/**
 * A button with every state: rest, hover, pressed, focus, busy and
 * disabled. Busy and confirmation swap the label in place; every label is
 * stacked in one grid cell, so the width never changes. While busy, clicks
 * are ignored and a submit doesn't fire.
 *
 * `disabled` is the native state: the button leaves the tab order and can't
 * be pressed. Prefer `reason` for an advisory refusal: the button stays
 * focusable, says why in its title, and its click is swallowed.
 *
 * With an icon, `labelled = false` draws the icon alone: the label is then
 * the button's accessible name and its hover text.
 */
export class Button extends AsterElement {
  readonly #label = this.prop("");
  readonly #labelled = this.prop(true);
  readonly #busyLabel = this.prop<string | undefined>(undefined);
  readonly #confirmLabel = this.prop<string | undefined>(undefined);
  readonly #busy = this.prop<Bindable<boolean>>(false);
  readonly #confirming = this.prop(false);
  readonly #tone = this.prop<ButtonTone>("secondary");
  readonly #size = this.prop<ButtonSize>("md");
  readonly #disabled = this.prop(false);
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
  /** Show the label beside the icon. Otherwise it's the accessible name and hover text only. Default `true`; a button without an icon always shows its label. */
  get labelled(): boolean {
    return this.#labelled.value;
  }
  set labelled(v: boolean) {
    this.#labelled.value = v;
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
  /** Sugar for `tone`: `"primary"` or `"secondary"`. A `"danger"` tone reads back as secondary. */
  get variant(): "secondary" | "primary" {
    return this.#tone.value === "primary" ? "primary" : "secondary";
  }
  set variant(v: "secondary" | "primary") {
    if (v !== "secondary" && v !== "primary") throw new TypeError('variant must be "secondary" or "primary"');
    this.#tone.value = v;
  }
  /** The button's visual weight. Default `"secondary"`. */
  get tone(): ButtonTone {
    return this.#tone.value;
  }
  set tone(v: ButtonTone) {
    if (v !== "secondary" && v !== "primary" && v !== "danger") throw new TypeError('tone must be "secondary", "primary" or "danger"');
    this.#tone.value = v;
  }
  /** The button's size. Default `"md"`. */
  get size(): ButtonSize {
    return this.#size.value;
  }
  set size(v: ButtonSize) {
    if (v !== "sm" && v !== "md" && v !== "lg") throw new TypeError('size must be "sm", "md" or "lg"');
    this.#size.value = v;
  }
  /** The native disabled state: out of the tab order, and no click or submit. Default `false`. */
  get disabled(): boolean {
    return this.#disabled.value;
  }
  set disabled(v: boolean) {
    this.#disabled.value = v;
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
    const disabled = this.#disabled.value;
    const icon = this.#icon.value;
    const iconOnly = !this.#labelled.value && icon !== nothing;
    const name = iconOnly ? labels[showing] : undefined;
    return html`<button class="aster-button" type=${this.#type.value} data-tone=${this.#tone.value}
      data-variant=${this.#tone.value === "primary" ? "primary" : "secondary"} data-size=${this.#size.value}
      ?data-icon-only=${iconOnly} ?disabled=${disabled}
      aria-busy=${busy ? "true" : "false"} aria-disabled=${reason && !disabled ? "true" : nothing}
      aria-label=${name || nothing} title=${reason ?? (name || nothing)}>
      ${icon}
      ${iconOnly ? nothing : html`<span class="aster-label-swap">
        ${labels.map((l, i) => (l === undefined ? nothing : html`<span ?data-off=${i !== showing}>${l}</span>`))}
      </span>`}
    </button>`;
  }

  #guard(e: MouseEvent): void {
    if (this.#disabled.peek() || read(this.#busy.peek()) || this.#reason.peek()) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}

define("aster-button", Button);
