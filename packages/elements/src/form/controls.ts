import type { Collection, EditModel, Value } from "@getaster/data";
import type { PickerOptions } from "../picker/options.ts";
import { html, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import type { View } from "../base/element.ts";
import type { ControlContext } from "../field/bound-field.ts";
import "../date/date-field.ts";
import "../field/check.ts";
import "../field/field.ts";
import "../field/number-field.ts";
import "../picker/picker.ts";
import "../select/select.ts";
import "./custom-field.ts";
import type { ValidateOn } from "./features.ts";

/** The editors the form can be told to use for a field. */
export type FormControlName = "text" | "number" | "date" | "check" | "select" | "picker";

/** What a custom editor gets: the bound field's context plus a write that respects the field's state. */
export interface FormControlContext extends ControlContext {
  readonly write: (value: Value) => void;
}

/** A JavaScript-only editor renderer; composition catalogs reject it. */
export type FormControlRender = (context: FormControlContext) => View;

/** A typed editor override: a control name, or a renderer for a custom control. */
export type FormControl = FormControlName | FormControlRender;

/** What [[staticMethod:controlFor]] accepts. Only `labelled` is required. */
export interface ControlOptions {
  /** A foreign key's choices; when given the default control is a picker. */
  readonly options?: Collection | PickerOptions | undefined;
  readonly labelled: boolean;
  readonly span?: number | undefined;
  readonly sharedReasons?: ReadonlyMap<string, string> | undefined;
  /** A label override; default: the field's metadata title. */
  readonly title?: string | undefined;
  /** Help text under the control. */
  readonly hint?: string | undefined;
  /** Placeholder text, for the controls that have one. */
  readonly placeholder?: string | undefined;
  /** A typed editor override, or a custom renderer (JavaScript only). */
  readonly control?: FormControl | undefined;
  /** When to revalidate the field. Default `"submit"`. */
  readonly validateOn?: ValidateOn;
  /** Draw the error under the field. Default `true`. */
  readonly showErrors?: boolean;
}

const NONE: ReadonlyMap<string, string> = new Map();

/** The control metadata picks for a field, before any override. */
export function metadataControl(model: EditModel, name: string, options: ControlOptions["options"]): FormControlName {
  if (options) return "picker";
  const field = model.type.field(name);
  if (field?.type === "Edm.Boolean") return "check";
  if (field?.allowedValues) return "select";
  switch (field?.type) {
    case "Edm.Date":
      return "date";
    case "Edm.Byte":
    case "Edm.SByte":
    case "Edm.Int16":
    case "Edm.Int32":
    case "Edm.Int64":
    case "Edm.Decimal":
    case "Edm.Single":
    case "Edm.Double":
      return "number";
    default:
      return "text";
  }
}

/**
 * The control for one field, chosen from metadata: a foreign key with
 * `options` gives a picker, a Boolean a checkbox, allowed values a select,
 * a Date the date field, anything else a field. `control` replaces that
 * choice with a named editor, or with a renderer that draws its own.
 */
export function controlFor(model: EditModel, name: string, opts: ControlOptions): TemplateResult {
  const style = styleMap(opts.span ? { "--span": String(opts.span) } : {});
  const shared = opts.sharedReasons ?? NONE;
  const labelled = opts.labelled;
  const label = opts.title ?? "";
  const hint = opts.hint ?? "";
  const placeholder = opts.placeholder ?? "";
  const showErrors = opts.showErrors ?? true;
  const validateOn = opts.validateOn ?? "submit";
  const control = typeof opts.control === "function" ? opts.control : opts.control ?? metadataControl(model, name, opts.options);
  if (typeof control === "function") {
    return html`<aster-custom-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared}
      .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .renderControl=${control}></aster-custom-field>`;
  }
  switch (control) {
    case "picker":
      return html`<aster-picker style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn}
        .placeholder=${placeholder} .options=${opts.options}></aster-picker>`;
    case "check":
      return html`<aster-check style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn}></aster-check>`;
    case "select":
      return html`<aster-select style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder}></aster-select>`;
    case "date":
      return html`<aster-date style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder}></aster-date>`;
    case "number":
      return html`<aster-number-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder}></aster-number-field>`;
    case "text":
      return html`<aster-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder}></aster-field>`;
  }
}
