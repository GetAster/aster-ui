import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "../field/bound-field.ts";
import { ChoiceState, choiceView, type Option } from "./choice.ts";

/**
 * One of a field's allowed values (`Validation.AllowedValues`), labelled from
 * metadata; a nullable field also offers "None". `choices` replaces them,
 * such as the operators that suit another field's type. A select-only
 * combobox (see `choiceView`), so its list matches the picker's.
 */
export class Select extends BoundField {
  readonly #state = new ChoiceState();
  readonly #choices = this.prop<readonly Option[] | undefined>(undefined);
  readonly #placeholder = this.prop("Choose…");
  readonly #filter = this.prop(false);
  readonly #clearable = this.prop(false);
  readonly #noResults = this.prop("No matches");

  get choices(): readonly Option[] | undefined {
    return this.#choices.value;
  }
  set choices(v: readonly Option[] | undefined) {
    this.#choices.value = v;
  }
  /** Shown when no value is chosen. Default "Choose…". */
  get placeholder(): string {
    return this.#placeholder.value;
  }
  set placeholder(v: string) {
    this.#placeholder.value = v;
  }
  /** Filters the allowed values as the person types. Default `false`. */
  get filter(): boolean {
    return this.#filter.value;
  }
  set filter(v: boolean) {
    this.#filter.value = v;
  }
  /** Shows a clear button while a value is chosen; only acts on a nullable field. Default `false`. */
  get clearable(): boolean {
    return this.#clearable.value;
  }
  set clearable(v: boolean) {
    this.#clearable.value = v;
  }
  /** What the filtered list says when nothing matches. Default "No matches". */
  get noResults(): string {
    return this.#noResults.value;
  }
  set noResults(v: string) {
    this.#noResults.value = v;
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>("[role=combobox]")?.focus(options);
  }

  protected control(c: ControlContext): View {
    return choiceView(this.#state, {
      id: c.id,
      options: this.#choices.value ?? [
        ...(c.meta?.nullable ? [{ value: null, label: "None" }] : []),
        ...(c.meta?.allowedValues ?? []).map((a) => ({ value: a.value, label: a.label ?? String(a.value) })),
      ],
      value: c.value,
      placeholder: this.#placeholder.value,
      readOnly: c.state.readOnly,
      disabled: !c.state.enabled,
      filter: this.#filter.value,
      clearable: this.#clearable.value && c.meta?.nullable === true,
      noResults: this.#noResults.value,
      ...(this.labelled ? { labelledBy: `${c.id}-label` } : { label: c.label }),
      required: c.state.required,
      invalid: c.invalid,
      ...(c.describedBy ? { describedBy: c.describedBy } : {}),
      choose: (v) => this.write(v),
    });
  }
}

define("aster-select", Select);
