import { batch } from "@preact/signals-core";
import type { EditModel } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";

export interface CompositeFieldContext<T = unknown> {
  readonly value: T;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly commit: (value: T) => void;
}

/** Related editors retain their own model fields, or edit an explicit application value. */
export class CompositeField<T = unknown> extends AsterElement {
  readonly #model = this.prop<EditModel | undefined>(undefined);
  readonly #fields = this.prop<readonly string[]>([]);
  readonly #label = this.prop("");
  readonly #help = this.prop("");
  readonly #error = this.prop("");
  readonly #disabled = this.prop(false);
  readonly #readOnly = this.prop(false);
  readonly #content = this.prop<View>(nothing);
  readonly #value = this.prop<T | undefined>(undefined);
  readonly #renderer = this.prop<((context: CompositeFieldContext<T | undefined>) => View) | undefined>(undefined);
  readonly #id = uid("aster-composite-field");

  get model() { return this.#model.value; }
  set model(v: EditModel | undefined) { this.#validate(this.#fields.peek(), v); this.#model.value = v; }
  get fields() { return this.#fields.value; }
  set fields(v: readonly string[]) { this.#validate(v, this.#model.peek()); this.#fields.value = [...v]; }
  get label() { return this.#label.value; }
  set label(v: string) { this.#label.value = v; }
  get help() { return this.#help.value; }
  set help(v: string) { this.#help.value = v; }
  get error() { return this.#error.value; }
  set error(v: string) { this.#error.value = v; }
  get disabled() { return this.#disabled.value; }
  set disabled(v: boolean) { this.#disabled.value = v; }
  get readOnly() { return this.#readOnly.value; }
  set readOnly(v: boolean) { this.#readOnly.value = v; }
  get content() { return this.#content.value; }
  set content(v: View) { this.#content.value = v; }
  get value() { return this.#value.value; }
  set value(v: T | undefined) { this.#value.value = v; }
  get renderValue() { return this.#renderer.value; }
  set renderValue(v: ((context: CompositeFieldContext<T | undefined>) => View) | undefined) { this.#renderer.value = v; }

  override focus(options?: FocusOptions): void {
    if (this.#disabled.peek()) return;
    (this.querySelector<HTMLElement>("[aria-invalid=true]:not([disabled])") ?? this.querySelector<HTMLElement>("input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),select:not([disabled]),button:not([disabled])"))?.focus(options);
  }

  revert(): void {
    const model = this.#model.peek();
    if (!model || this.#disabled.peek() || this.#readOnly.peek()) return;
    batch(() => {
      for (const name of this.#fields.peek()) {
        const state = model.state(name).peek();
        if (state.visible && !state.readOnly && !model.hidden.peek().has(name)) { model.revert(name); model.forcePending(name, false); }
      }
    });
  }

  #validate(fields: readonly string[], model: EditModel | undefined): void {
    if (new Set(fields).size !== fields.length || fields.some(f => !f || model && !model.type.field(f))) throw new TypeError("CompositeField fields must be unique model field names");
  }

  protected render(): View {
    const model = this.#model.value;
    const fields = this.#fields.value;
    const states = fields.map(f => model?.state(f).value);
    this.hidden = !!model && fields.length > 0 && states.every(s => !s?.visible);
    if (this.hidden) return nothing;
    const pending = fields.some(f => model?.pending(f).value);
    this.toggleAttribute("data-group-pending", pending);
    const disabled = this.#disabled.value;
    const readOnly = this.#readOnly.value;
    const error = this.#error.value;
    const renderer = this.#renderer.value;
    const descriptions = [this.#help.value ? `${this.#id}-help` : "", error ? `${this.#id}-error` : ""].filter(Boolean).join(" ");
    return html`<fieldset class="aster-composite-field" ?disabled=${disabled || readOnly && !renderer} aria-describedby=${descriptions || nothing}>
      <legend>${this.#label.value}</legend>
      ${this.#help.value ? html`<p class="aster-hint" id=${`${this.#id}-help`}>${this.#help.value}</p>` : nothing}
      <div class="aster-composite-content">${renderer ? renderer({ value: this.#value.value, disabled, readOnly, commit: value => {
        if (this.#disabled.peek() || this.#readOnly.peek()) return;
        this.#value.value = value;
        this.emit("value-change", { value });
      } }) : this.#content.value}</div>
      ${pending && !disabled && !readOnly ? html`<button type="button" class="aster-revert" aria-label=${`Revert ${this.#label.value}`} @click=${() => this.revert()}>Revert group</button>` : nothing}
      ${error ? html`<p class="aster-error" role="alert" id=${`${this.#id}-error`}>${error}</p>` : nothing}
    </fieldset>`;
  }
}

define("aster-composite-field", CompositeField);
