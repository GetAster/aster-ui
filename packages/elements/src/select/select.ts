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

  get choices(): readonly Option[] | undefined {
    return this.#choices.value;
  }
  set choices(v: readonly Option[] | undefined) {
    this.#choices.value = v;
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
      placeholder: "Choose…",
      readOnly: c.state.readOnly,
      ...(this.labelled ? { labelledBy: `${c.id}-label` } : { label: c.label }),
      required: c.state.required,
      invalid: c.invalid,
      ...(c.describedBy ? { describedBy: c.describedBy } : {}),
      choose: (v) => this.write(v),
    });
  }
}

define("aster-select", Select);
