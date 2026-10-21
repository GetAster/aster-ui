import type { Collection, EditModel } from "@getaster/data";
import type { PickerOptions } from "../picker/options.ts";
import { html, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import "../date/date-field.ts";
import "../field/check.ts";
import "../field/field.ts";
import "../field/number-field.ts";
import "../picker/picker.ts";
import "../select/select.ts";

const NONE: ReadonlyMap<string, string> = new Map();

/**
 * The control for one field, chosen from metadata: a foreign key with
 * `options` gives a picker, a Boolean a checkbox, allowed values a select,
 * a Date the date field, anything else a field.
 */
export function controlFor(
  model: EditModel,
  name: string,
  opts: { options?: Collection | PickerOptions | undefined; labelled: boolean; span?: number; sharedReasons?: ReadonlyMap<string, string> },
): TemplateResult {
  const style = styleMap(opts.span ? { "--span": String(opts.span) } : {});
  const shared = opts.sharedReasons ?? NONE;
  if (opts.options) {
    return html`<aster-picker style=${style} .model=${model} .field=${name} .labelled=${opts.labelled} .sharedReasons=${shared} .options=${opts.options}></aster-picker>`;
  }
  if (model.type.field(name)?.type === "Edm.Boolean") {
    return html`<aster-check style=${style} .model=${model} .field=${name} .labelled=${opts.labelled} .sharedReasons=${shared}></aster-check>`;
  }
  if (model.type.field(name)?.allowedValues) {
    return html`<aster-select style=${style} .model=${model} .field=${name} .labelled=${opts.labelled} .sharedReasons=${shared}></aster-select>`;
  }
  if (model.type.field(name)?.type === "Edm.Date") {
    return html`<aster-date style=${style} .model=${model} .field=${name} .labelled=${opts.labelled} .sharedReasons=${shared}></aster-date>`;
  }
  if (["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Decimal", "Edm.Single", "Edm.Double"].includes(model.type.field(name)?.type ?? "")) {
    return html`<aster-number-field style=${style} .model=${model} .field=${name} .labelled=${opts.labelled} .sharedReasons=${shared}></aster-number-field>`;
  }
  return html`<aster-field style=${style} .model=${model} .field=${name} .labelled=${opts.labelled} .sharedReasons=${shared}></aster-field>`;
}
