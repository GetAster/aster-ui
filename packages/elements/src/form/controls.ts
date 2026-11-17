import { presentField, resolveFieldPresentation, type FieldPresentation } from "../field/presentation.ts";
import type { Collection, EditModel, Value } from "@getaster/data";
import type { PickerOptions } from "../picker/options.ts";
import { TreeChoices } from "../picker/tree-choices.ts";
import { html, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import type { View } from "../base/element.ts";
import type { ValueFormat } from "../format.ts";
import type { ControlContext } from "../field/bound-field.ts";
import "../date/date-field.ts";
import "../field/check.ts";
import "../field/field.ts";
import "../field/number-field.ts";
import "../picker/picker.ts";
import "../picker/tree-picker.ts";
import "../select/select.ts";
import "../slider/slider.ts";
import "./custom-field.ts";
import type { ValidateOn } from "./features.ts";

/** The editors the form can be told to use for a field. */
export type FormControlName = "text" | "multiline" | "number" | "slider" | "date" | "check" | "select" | "picker";

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
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly presentation?: FieldPresentation;
  /** A foreign key's choices; when given the default control is a picker, or a tree picker for a [[class:TreeChoices]]. */
  readonly options?: Collection | PickerOptions | TreeChoices | undefined;
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
  /** How a number reads while its input is not focused, for the number control. */
  readonly format?: ValueFormat | undefined;
  /** When to revalidate the field. Default `"submit"`. */
  readonly validateOn?: ValidateOn;
  /** Draw the error under the field. Default `true`. */
  readonly showErrors?: boolean;
}

const NONE: ReadonlyMap<string, string> = new Map();

/**
 * The tree a foreign key points into, when metadata makes its target set a tree. A tree's own parent field is
 * left out: its choices must exclude the record and its subtree, which only the host can say.
 */
function treeOf(model: EditModel, name: string): TreeChoices | undefined {
  const link = model.type.navigations.find((n) => !n.collection && n.keys.length === 1 && n.keys[0]![0] === name);
  if (!link) return undefined;
  const tree = TreeChoices.of(model.ctx, link.target);
  return tree && !(link.target === model.entitySet && tree.spec.parentField === name) ? tree : undefined;
}

/** The control metadata picks for a field, before any override. */
export function metadataControl(model: EditModel, name: string, options: ControlOptions["options"]): FormControlName | "tree-picker" {
  if (options instanceof TreeChoices) return "tree-picker";
  if (options) return "picker";
  if (treeOf(model, name)) return "tree-picker";
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
  const display = opts.presentation ?? resolveFieldPresentation(model.type.field(name), name);
  if ((opts.readOnly || model.state(name).value.readOnly) && Object.keys(display).length) {
    const render = (context: FormControlContext): View => html`${presentField({ field: context.meta, name, value: context.value, entity: model.values.value, key: model.key.value ?? "", hidden: new Set([...model.hidden.value, ...model.type.fields.filter(field => !model.state(field.name).value.visible).map(field => field.name)]) }, display)}`;
    return html`<aster-custom-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
      .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .renderControl=${render}></aster-custom-field>`;
  }
  if (typeof control === "function") {
    return html`<aster-custom-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
      .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .renderControl=${control}></aster-custom-field>`;
  }
  switch (control) {
    case "picker":
      return html`<aster-picker style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn}
        .placeholder=${placeholder} .options=${opts.options instanceof TreeChoices ? undefined : opts.options}></aster-picker>`;
    case "tree-picker":
      return html`<aster-tree-picker style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn}
        .placeholder=${placeholder} .options=${opts.options instanceof TreeChoices ? opts.options : treeOf(model, name)}></aster-tree-picker>`;
    case "check":
      return html`<aster-check style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn}></aster-check>`;
    case "select":
      return html`<aster-select style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder}></aster-select>`;
    case "date":
      return html`<aster-date style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder}></aster-date>`;
    case "number":
      return html`<aster-number-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder} .format=${opts.format}></aster-number-field>`;
    case "slider":
      return html`<aster-slider style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn}></aster-slider>`;
    case "multiline":
      return html`<aster-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder} .multiline=${true}></aster-field>`;
    case "text":
      return html`<aster-field style=${style} .model=${model} .field=${name} .labelled=${labelled} .sharedReasons=${shared} .hostReadOnly=${opts.readOnly ?? false} .hostDisabled=${opts.disabled ?? false}
        .label=${label} .hint=${hint} .showErrors=${showErrors} .validateOn=${validateOn} .placeholder=${placeholder}></aster-field>`;
  }
}
