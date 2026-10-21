import type { Collection, EditModel } from "@getaster/data";
import type { ReadonlySignal } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import type { PickerOptions } from "../picker/options.ts";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import "../field/field.ts";
import "../section/section.ts";
import { controlFor } from "./controls.ts";

/** A field of the model, optionally spanning columns; `options` makes a foreign key a picker. */
export interface FormField {
  readonly field: string;
  readonly span?: number;
  readonly options?: Collection | PickerOptions;
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

/**
 * Fields laid out from metadata. The app gives only the arrangement
 * (sections, columns, spans); each field's control, label, type, required
 * marker, allowed values and state come from the model and its metadata:
 * allowed values become a select, a foreign key with `options` a picker,
 * anything else a field.
 */
export class Form extends AsterElement {
  #shared: ReadonlyMap<string, string> = new Map();
  readonly #model = this.prop<EditModel | undefined>(undefined);
  readonly #sections = this.prop<readonly FormSection[]>([]);
  readonly #level = this.prop<2 | 3 | 4>(2);
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

  /** Focuses the first field with an error, or the first field. */
  focusFirst(): void {
    const target =
      this.querySelector<HTMLElement>("[aria-invalid='true']") ??
      this.querySelector<HTMLElement>("input:not([readonly]), textarea:not([readonly]), [role=combobox]:not([aria-readonly])");
    target?.focus();
  }

  protected render(): View {
    const model = this.#model.value;
    if (!model) return nothing;
    // A read-only reason that applies to several fields shows once, above them.
    const counts = new Map<string, number>();
    for (const item of this.#sections.value.flatMap((s) => s.items).filter(isField)) {
      const state = model.state(nameOf(item)).value;
      const reason = state.visible && state.readOnly ? state.reasons.readOnly : undefined;
      if (reason !== undefined) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    const shared = new Map([...counts].filter(([, n]) => n > 1).map(([reason], i) => [reason, `${this.#id}-reason-${i}`]));
    this.#shared = shared;
    return html`${[...shared].map(([reason, id]) => html`<p class="aster-hint aster-form-reason" id=${id}>${reason}</p>`)}
      ${this.#sections.value.map((section) => {
      const changed = section.items.filter(isField).filter((i) => model.pending(nameOf(i)).value).length;
      return html`<aster-section .heading=${section.title} .level=${this.#level.value} .open=${section.open ?? true}
        .summary=${changed ? `${changed} ${changed === 1 ? "change" : "changes"}` : nothing}
        .body=${html`<div class="aster-form-grid" style=${styleMap({ "--columns": String(section.columns ?? 2) })}>
          ${section.items.map((item) => this.#item(model, item))}
        </div>`}></aster-section>`;
    })}`;
  }

  #item(model: EditModel, item: FormItem): View {
    const span = typeof item === "object" ? (item.span ?? 1) : 1;
    if (typeof item === "object" && "value" in item) {
      return html`<aster-field style=${styleMap({ "--span": String(span) })} .labelled=${true} .label=${item.title}
        .value=${item.value.value} .readOnly=${true}></aster-field>`;
    }
    const options = typeof item === "object" ? item.options : undefined;
    return controlFor(model, nameOf(item), { options, labelled: true, span, sharedReasons: this.#shared });
  }
}

function isField(item: FormItem): item is string | FormField {
  return typeof item === "string" || "field" in item;
}

function nameOf(item: string | FormField): string {
  return typeof item === "string" ? item : item.field;
}

define("aster-form", Form);
