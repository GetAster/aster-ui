import type { Value } from "@getaster/data";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { ChoiceState, choiceView, type Option } from "./choice.ts";

/**
 * A select-only combobox not bound to a form: `options`, a `value`, and a
 * `change` event with the chosen value. Filter rows and toolbars use it.
 */
export class Choice extends AsterElement {
  readonly #options = this.prop<readonly Option[]>([]);
  readonly #value = this.prop<Value | undefined>(undefined);
  readonly #label = this.prop("");
  readonly #placeholder = this.prop("Choose…");
  readonly #filter = this.prop(false);
  readonly #clearable = this.prop(false);
  readonly #noResults = this.prop("No matches");
  readonly #disabled = this.prop(false);
  readonly #state = new ChoiceState();
  readonly #id = uid("aster-choice");

  get options(): readonly Option[] {
    return this.#options.value;
  }
  set options(v: readonly Option[]) {
    this.#options.value = v;
  }
  get value(): Value | undefined {
    return this.#value.value;
  }
  set value(v: Value | undefined) {
    this.#value.value = v;
  }
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  get placeholder(): string {
    return this.#placeholder.value;
  }
  set placeholder(v: string) {
    this.#placeholder.value = v;
  }
  /** Filters the list as the person types. Default `false`. */
  get filter(): boolean {
    return this.#filter.value;
  }
  set filter(v: boolean) {
    this.#filter.value = v;
  }
  /** Shows a clear button while a value is chosen. Default `false`. */
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
  /** Removes the choice from the tab order and stops it opening. Default `false`. */
  get disabled(): boolean {
    return this.#disabled.value;
  }
  set disabled(v: boolean) {
    this.#disabled.value = v;
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>("[role=combobox]")?.focus(options);
  }

  protected render(): View {
    return choiceView(this.#state, {
      id: this.#id,
      options: this.#options.value,
      value: this.#value.value,
      placeholder: this.#placeholder.value,
      label: this.#label.value,
      filter: this.#filter.value,
      clearable: this.#clearable.value,
      noResults: this.#noResults.value,
      disabled: this.#disabled.value,
      choose: (v) => {
        this.#value.value = v;
        this.emit("change", v);
      },
    });
  }
}

define("aster-choice", Choice);
