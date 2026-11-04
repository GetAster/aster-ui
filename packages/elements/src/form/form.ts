import type { Collection, EditFieldPolicy, EditModel, EditPolicy } from "@getaster/data";
import { effect, type ReadonlySignal } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import type { PickerOptions } from "../picker/options.ts";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import "../field/field.ts";
import "../section/section.ts";
import { controlFor, type FormControl } from "./controls.ts";
import {
  savesOnEnter,
  validationOn,
  validateFormFeatures,
  withFormFeature,
  withoutFormFeature,
  type FormFeature,
  type ValidateOn,
} from "./features.ts";
import {
  autoFocusOnError,
  errorSummaryShown,
  formColumns,
  inlineErrorsShown,
  titleOrientation,
  type FormChrome,
  type FormPolicy,
} from "./policy.ts";

export type { FormFeature } from "./features.ts";
export type { FormChrome, FormPolicy } from "./policy.ts";

/** A field of the model, optionally spanning columns; `options` makes a foreign key a picker. */
export interface FormField {
  readonly field: string;
  readonly span?: number;
  readonly options?: Collection | PickerOptions;
  /** A label override; default: the field's title from metadata. */
  readonly title?: string;
  /** Help text under the control. */
  readonly hint?: string;
  /** Placeholder text, for the controls that have one. */
  readonly placeholder?: string;
  /** Starts read-only unless a page rule names read-only. */
  readonly readOnly?: boolean;
  /** Starts disabled unless a page rule names enabled. */
  readonly disabled?: boolean;
  /** Starts required unless a page rule names required. */
  readonly required?: boolean;
  /** A typed editor override, or a renderer for a custom control (JavaScript only). */
  readonly control?: FormControl;
}

/** A value shown read-only, such as a figure derived from other fields. */
export interface FormValue {
  readonly title: string;
  readonly value: ReadonlySignal<string>;
  readonly span?: number;
}

export type FormItem = string | FormField | FormValue;

export interface FormSection {
  readonly title: string;
  readonly columns?: number;
  /** Starts collapsed when false. */
  readonly open?: boolean;
  readonly items: readonly FormItem[];
}

/** What the cancelable `form-submit` event carries. */
export interface FormSubmitDetail {
  readonly model: EditModel;
}

/**
 * Fields laid out from metadata. The app gives the arrangement
 * (sections, columns, spans) and may override a field's label, hint,
 * placeholder or editor; each field's control, type, allowed values and
 * state still come from the model and its metadata. Static read-only,
 * disabled and required values are defaults that page rules override.
 */
export class Form extends AsterElement {
  #shared: ReadonlyMap<string, string> = new Map();
  readonly #model = this.prop<EditModel | undefined>(undefined);
  readonly #sections = this.prop<readonly FormSection[]>([]);
  readonly #level = this.prop<2 | 3 | 4>(2);
  readonly #policy = this.prop<FormPolicy>({});
  readonly #chrome = this.prop<FormChrome>({});
  readonly #features = this.prop<readonly FormFeature[]>([]);
  readonly #id = uid("aster-form");

  get model(): EditModel | undefined {
    return this.#model.value;
  }
  set model(v: EditModel | undefined) {
    this.#model.value = v;
  }
  get sections(): readonly FormSection[] {
    return this.#sections.value;
  }
  set sections(v: readonly FormSection[]) {
    this.#sections.value = v;
  }

  /** The sections' heading level in the page outline. */
  get headingLevel(): 2 | 3 | 4 {
    return this.#level.value;
  }
  set headingLevel(v: 2 | 3 | 4) {
    this.#level.value = v;
  }

  /** Static edit defaults for the whole form, as [[object:FormPolicy]]. Default `{}`. */
  get policy(): FormPolicy {
    return this.#policy.value;
  }
  set policy(v: FormPolicy) {
    this.#policy.value = v;
  }

  /** Sugar for `policy.readOnly`. Default `false`. */
  get readOnly(): boolean {
    return this.#policy.value.readOnly === true;
  }
  set readOnly(v: boolean) {
    this.#policy.value = { ...this.#policy.peek(), readOnly: v };
  }

  /** Sugar for `policy.disabled`. Default `false`. */
  get disabled(): boolean {
    return this.#policy.value.disabled === true;
  }
  set disabled(v: boolean) {
    this.#policy.value = { ...this.#policy.peek(), disabled: v };
  }

  /** Which presentation surfaces the form shows, as [[object:FormChrome]]. Default `{}`. */
  get chrome(): FormChrome {
    return this.#chrome.value;
  }
  set chrome(v: FormChrome) {
    this.#chrome.value = v;
  }

  /** Sugar for `chrome.columns`: columns for sections that don't set their own. Default `2`. */
  get columns(): number {
    return formColumns(this.#chrome.value);
  }
  set columns(v: number) {
    if (!Number.isSafeInteger(v) || v < 1) throw new TypeError("columns must be a positive integer");
    this.#chrome.value = { ...this.#chrome.peek(), columns: v };
  }

  /** Sugar for `chrome.titleOrientation`: labels above (`"top"`) or beside (`"start"`) their controls. Default `"top"`. */
  get titleOrientation(): "top" | "start" {
    return titleOrientation(this.#chrome.value);
  }
  set titleOrientation(v: "top" | "start") {
    if (v !== "top" && v !== "start") throw new TypeError('titleOrientation must be "top" or "start"');
    this.#chrome.value = { ...this.#chrome.peek(), titleOrientation: v };
  }

  /** Sugar for `chrome.showInlineErrors`. Default `true`. */
  get showInlineErrors(): boolean {
    return inlineErrorsShown(this.#chrome.value);
  }
  set showInlineErrors(v: boolean) {
    this.#chrome.value = { ...this.#chrome.peek(), showInlineErrors: v };
  }

  /** Sugar for `chrome.errorSummary`. Default `false`. */
  get errorSummary(): boolean {
    return errorSummaryShown(this.#chrome.value);
  }
  set errorSummary(v: boolean) {
    this.#chrome.value = { ...this.#chrome.peek(), errorSummary: v };
  }

  /** Sugar for `chrome.autoFocus`. Default `false`. */
  get autoFocus(): boolean {
    return autoFocusOnError(this.#chrome.value);
  }
  set autoFocus(v: boolean) {
    this.#chrome.value = { ...this.#chrome.peek(), autoFocus: v };
  }

  /** How the form behaves, as [[type:FormFeature]] descriptors. Default `[]`. */
  get features(): readonly FormFeature[] {
    return this.#features.value;
  }
  set features(v: readonly FormFeature[]) {
    validateFormFeatures(v);
    this.#features.value = v.map((entry) => ({ ...entry }));
  }

  /** Sugar for a `validation` feature's timing: `"submit"` (default), `"change"` or `"exit"`. */
  get validateOn(): ValidateOn {
    return validationOn(this.#features.value);
  }
  set validateOn(v: ValidateOn) {
    if (v !== "submit" && v !== "change" && v !== "exit") throw new TypeError('validateOn must be "submit", "change" or "exit"');
    this.#features.value = v === "submit"
      ? withoutFormFeature(this.#features.peek(), "validation")
      : withFormFeature(this.#features.peek(), { kind: "validation", on: v });
  }

  /** Sugar for a `save` feature: Enter in a single-line field saves. Default `false`. */
  get saveOnEnter(): boolean {
    return savesOnEnter(this.#features.value);
  }
  set saveOnEnter(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("saveOnEnter must be a boolean");
    this.#features.value = v ? withFormFeature(this.#features.peek(), { kind: "save" }) : withoutFormFeature(this.#features.peek(), "save");
  }

  override connectedCallback(): void {
    super.connectedCallback();
    let applied: EditModel | undefined;
    const stopPolicy = effect(() => {
      const model = this.#model.value;
      const policy = this.#editPolicy(this.#policy.value);
      if (applied && applied !== model) applied.applyPolicy({});
      applied = model;
      model?.applyPolicy(policy);
    });
    let hadErrors = false;
    const stopFocus = effect(() => {
      const model = this.#model.value;
      if (!model || !autoFocusOnError(this.#chrome.value)) {
        hadErrors = false;
        return;
      }
      const any = Object.keys(model.errors.value).length > 0;
      if (any && !hadErrors) requestAnimationFrame(() => this.focusFirst());
      hadErrors = any;
    });
    this.listen(this, "keydown", (event) => this.#keydown(event));
    this.onDisconnect(() => {
      stopPolicy();
      stopFocus();
      applied?.applyPolicy({});
    });
  }

  /** Focuses the first field with an error, or the first editable field. */
  focusFirst(): void {
    const invalid = [...this.querySelectorAll<HTMLElement>("[aria-invalid='true']")];
    const target = invalid.find(isFocusable) ?? invalid[0] ?? this.#firstFocusable("input, textarea, [role=combobox]");
    target?.focus();
  }

  protected render(): View {
    const model = this.#model.value;
    if (!model) return nothing;
    const chrome = this.#chrome.value;
    this.setAttribute("data-title-orientation", titleOrientation(chrome));
    const showErrors = inlineErrorsShown(chrome);
    this.#shared = this.#sharedReasons(model);
    const labels = this.#fieldLabels(model);
    const summary = errorSummaryShown(chrome) ? this.#summary(model, labels) : nothing;
    const timing = validationOn(this.#features.value);
    return html`${summary}${[...this.#shared].map(([reason, id]) => html`<p class="aster-hint aster-form-reason" id=${id}>${reason}</p>`)}
      ${this.#sections.value.map((section) => {
      const changed = section.items.filter(isField).filter((i) => model.pending(nameOf(i)).value).length;
      return html`<aster-section .heading=${section.title} .level=${this.#level.value} .open=${section.open ?? true}
        .summary=${changed ? `${changed} ${changed === 1 ? "change" : "changes"}` : nothing}
        .body=${html`<div class="aster-form-grid" style=${styleMap({ "--columns": String(section.columns ?? formColumns(chrome)) })}>
          ${section.items.map((item) => this.#item(model, item, timing, showErrors))}
        </div>`}></aster-section>`;
    })}`;
  }

  #item(model: EditModel, item: FormItem, timing: ValidateOn, showErrors: boolean): View {
    const span = typeof item === "object" ? (item.span ?? 1) : 1;
    if (typeof item === "object" && "value" in item) {
      return html`<aster-field style=${styleMap({ "--span": String(span) })} .labelled=${true} .label=${item.title}
        .value=${item.value.value} .readOnly=${true}></aster-field>`;
    }
    const configured = typeof item === "object" ? item : undefined;
    return controlFor(model, nameOf(item), {
      options: configured?.options,
      labelled: true,
      span,
      sharedReasons: this.#shared,
      title: configured?.title,
      hint: configured?.hint,
      placeholder: configured?.placeholder,
      control: configured?.control,
      validateOn: timing,
      showErrors,
    });
  }

  /** Reasons shown once for several fields: read-only and disabled reasons repeated across fields. */
  #sharedReasons(model: EditModel): ReadonlyMap<string, string> {
    const counts = new Map<string, number>();
    for (const item of this.#sections.value.flatMap((s) => s.items).filter(isField)) {
      const state = model.state(nameOf(item)).value;
      if (!state.visible) continue;
      for (const reason of [state.readOnly ? state.reasons.readOnly : undefined, state.enabled ? undefined : state.reasons.enabled]) {
        if (reason !== undefined) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    return new Map([...counts].filter(([, n]) => n > 1).map(([reason], i) => [reason, `${this.#id}-reason-${i}`]));
  }

  /** Field names in the layout with the text the summary should use. */
  #fieldLabels(model: EditModel): ReadonlyMap<string, string> {
    const labels = new Map<string, string>();
    for (const item of this.#sections.value.flatMap((s) => s.items).filter(isField)) {
      const name = nameOf(item);
      labels.set(name, (typeof item === "object" ? item.title : undefined) || model.type.field(name)?.title || name);
    }
    return labels;
  }

  /** The errors above the sections, each a button that focuses its field. */
  #summary(model: EditModel, labels: ReadonlyMap<string, string>): View {
    const errors = Object.entries(model.errors.value).filter(([name]) => labels.has(name) && model.state(name).value.visible);
    const formError = model.formError.value;
    if (!errors.length && !formError) return nothing;
    return html`<div class="aster-form-summary" role="alert" tabindex="-1">
      ${errors.length ? html`<p class="aster-form-summary-title">${errors.length === 1 ? "There is 1 problem" : `There are ${errors.length} problems`}</p>` : nothing}
      ${formError ? html`<p class="aster-form-summary-form">${formError}</p>` : nothing}
      ${errors.length ? html`<ul>${errors.map(([name, messages]) => html`<li>${messages.map((message) =>
        html`<button type="button" @click=${() => this.#focusField(name)}>${labels.get(name)}: ${message}</button>`)}</li>`)}</ul>` : nothing}
    </div>`;
  }

  /** Focuses a field by name, opening its collapsed section first and waiting for the field to take focus. */
  #focusField(name: string, frames = 5): void {
    requestAnimationFrame(() => {
      const element = this.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`);
      const section = element?.closest<HTMLElement & { open: boolean }>("aster-section");
      if (section && !section.open) section.open = true;
      element?.focus();
      // Custom editors may not be focusable themselves; hand focus to their
      // editor control, before any row chrome such as a revert button.
      if (element && !(element === document.activeElement || element.contains(document.activeElement))) {
        const editor = [...element.querySelectorAll<HTMLElement>("input:not([type=hidden]), textarea, select, [role=combobox], [contenteditable]")].find(isFocusable)
          ?? [...element.querySelectorAll<HTMLElement>("button, [tabindex]")].find(isFocusable);
        editor?.focus();
      }
      // Succeeded only when the field took focus, not when it stayed on the summary button.
      if (element && (element === document.activeElement || element.contains(document.activeElement))) return;
      if (frames > 0) this.#focusField(name, frames - 1);
    });
  }

  #firstFocusable(selector: string): HTMLElement | undefined {
    return [...this.querySelectorAll<HTMLElement>(selector)].find(isFocusable);
  }

  /** Static defaults the form adds to the model: form-wide entries, then each field's own. */
  #editPolicy(policy: FormPolicy): EditPolicy {
    const fields: Record<string, EditFieldPolicy> = {};
    for (const item of this.#sections.value.flatMap((s) => s.items)) {
      if (typeof item !== "object" || !("field" in item)) continue;
      if (item.readOnly === undefined && item.disabled === undefined && item.required === undefined) continue;
      fields[item.field] = {
        ...(item.readOnly === undefined ? {} : { readOnly: item.readOnly }),
        ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
        ...(item.required === undefined ? {} : { required: item.required }),
      };
    }
    return {
      ...(policy.readOnly === undefined ? {} : { readOnly: policy.readOnly }),
      ...(policy.disabled === undefined ? {} : { disabled: policy.disabled }),
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  }

  #keydown(event: KeyboardEvent): void {
    if (!savesOnEnter(this.#features.peek())) return;
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    // A textarea takes its own newline; buttons, links and comboboxes have their own Enter.
    if (target.closest("textarea, button, a, [role=button], [role=combobox], input[type=checkbox], input[type=radio]")) return;
    const model = this.#model.peek();
    if (!model) return;
    if (!this.emit<FormSubmitDetail>("form-submit", { model })) return;
    event.preventDefault();
    void model.save();
  }
}

function isField(item: FormItem): item is string | FormField {
  return typeof item === "string" || "field" in item;
}

function nameOf(item: string | FormField): string {
  return typeof item === "string" ? item : item.field;
}

/** A control that can take focus: not natively disabled, ARIA-disabled or read-only. */
function isFocusable(element: HTMLElement): boolean {
  return !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true"
    && !element.hasAttribute("readonly") && element.getAttribute("aria-readonly") !== "true";
}

define("aster-form", Form);
