import { html, nothing } from "lit-html";
import { inputView } from "./input.ts";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "./bound-field.ts";
import { formatValue, inputKind, parseInput } from "./values.ts";

/**
 * A text field. Bound to an edit model's field, it shows that field's value
 * and writes every keystroke back, parsed by the field's type (numbers,
 * decimals, dates); text that doesn't parse stays as typed, and validation
 * says what's wrong. Without a model it shows `value`, and `readOnly`
 * selects everything on focus.
 *
 * The frame owns the focus ring. `trailing` renders beside the frame (an
 * Invite button), so the error still spans under both.
 */
export class Field extends BoundField {
  readonly #value = this.prop("");
  readonly #placeholder = this.prop("");
  readonly #readonly = this.prop(false);
  readonly #trailing = this.prop<View>(nothing);
  readonly #keyboard = this.prop("");

  get value(): string {
    return this.#value.value;
  }
  set value(v: string) {
    this.#value.value = v;
  }
  get placeholder(): string {
    return this.#placeholder.value;
  }
  set placeholder(v: string) {
    this.#placeholder.value = v;
  }
  get readOnly(): boolean {
    return this.#readonly.value;
  }
  set readOnly(v: boolean) {
    this.#readonly.value = v;
  }
  /** The `inputmode` to offer, when the field's type doesn't say (a number kept as text). */
  get keyboard(): string {
    return this.#keyboard.value;
  }
  set keyboard(v: string) {
    this.#keyboard.value = v;
  }
  get trailing(): View {
    return this.#trailing.value;
  }
  set trailing(v: View) {
    this.#trailing.value = v;
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>("input, textarea")?.focus(options);
  }

  protected override row(c: ControlContext): View {
    return html`<div class="aster-field-row">${this.control(c)}${this.#trailing.value}</div>`;
  }

  protected control(c: ControlContext): View {
    const bound = this.model !== undefined;
    // While typing, a Decimal shows exactly what was typed, not padded to its scale.
    const text = bound ? (typeof c.value === "string" && c.meta?.type === "Edm.Decimal" ? c.value : formatValue(c.meta, c.value)) : this.#value.value;
    const readOnly = this.#readonly.value || c.state.readOnly;
    const kind = inputKind(c.meta);
    return inputView({ id: c.id, value: text, type: kind.type, keyboard: this.#keyboard.value || kind.inputmode || "",
      ...(this.labelled ? {} : { label: c.label }), placeholder: this.#placeholder.value, readOnly, required: c.state.required,
      invalid: c.invalid, ...(c.describedBy ? { describedBy: c.describedBy } : {}), ...(isProse(c.meta) ? { rows: 2 } : {}),
      input: (text) => this.write(parseInput(c.meta, text)) });
  }
}

/** Long text (over 500 characters allowed) edits in a textarea that grows with it. */
function isProse(field: ControlContext["meta"]): boolean {
  return field?.type === "Edm.String" && !field.allowedValues && (field.maxLength ?? 0) > 500;
}

define("aster-field", Field);
