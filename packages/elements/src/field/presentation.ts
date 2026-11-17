import type { Entity, Field, KeyText, Value } from "@getaster/data";
import { html } from "lit-html";
import type { View } from "../base/element.ts";
import { formatValue } from "./values.ts";
import { formatDate, type DateFormat } from "../date/dates.ts";
import { absoluteTime, formatFigure, isNumericField, validateValueFormat, type ValueFormat } from "../format.ts";

export type FieldFormat = { readonly kind: "date"; readonly style?: DateFormat } | ({ readonly kind: "number" } & ValueFormat);
export type FieldValueMap = Readonly<Record<string, string | { readonly label: string }>>;
/** Callbacks receive only loaded, visible values in a frozen record projection. */
export interface FieldPresentationContext {
  readonly field: Field | undefined;
  readonly name: string;
  readonly value: Value | undefined;
  readonly entity: Entity;
  readonly key: KeyText;
}
export interface FieldPresentation {
  readonly format?: FieldFormat;
  readonly valueMap?: FieldValueMap;
  readonly formatter?: (context: FieldPresentationContext) => string;
  readonly display?: (context: FieldPresentationContext) => View | string;
  readonly treatment?: "text" | "email";
}
export interface FieldPresentations {
  readonly fields?: Readonly<Record<string, FieldPresentation>>;
  /** Keys match AsterData.Type values, including application semantic types. */
  readonly types?: Readonly<Record<string, FieldPresentation>>;
}

/** Missing members inherit independently; unknown metadata keeps primitive display. */
export function resolveFieldPresentation(field: Field | undefined, name: string, host: FieldPresentations = {}, local?: FieldPresentation): FieldPresentation {
  const semantic = field?.annotations?.["AsterData.Type"];
  const type = typeof semantic === "string" ? semantic : undefined;
  const metadata: FieldPresentation = type?.toLowerCase() === "email" ? { treatment: "email" } : {};
  const result: Record<string, unknown> = {};
  for (const layer of [metadata, type ? host.types?.[type] : undefined, host.fields?.[name], local]) {
    for (const [key, value] of Object.entries(layer ?? {})) if (value !== undefined) result[key] = value;
  }
  return result as FieldPresentation;
}

/** Display only: values retain their original types in queries, edits and exports. */
export function presentField(context: FieldPresentationContext & { readonly hidden?: ReadonlySet<string> | undefined; readonly known?: ReadonlySet<string> | undefined }, presentation: FieldPresentation = {}): View | string {
  if (context.value === undefined || context.hidden?.has(context.name) || context.known && !context.known.has(context.name)) return "";
  const entity = Object.freeze(Object.fromEntries(Object.entries(context.entity).filter(([name, value]) => value !== undefined && !context.hidden?.has(name) && (!context.known || context.known.has(name))))) as Entity;
  const safe: FieldPresentationContext = { field: context.field, name: context.name, value: context.value, key: context.key, entity };
  if (presentation.display) return presentation.display(safe);
  if (presentation.formatter) return presentation.formatter(safe);
  const mapped = presentation.valueMap?.[String(context.value)];
  if (presentation.valueMap && Object.hasOwn(presentation.valueMap, String(context.value)) && mapped !== undefined) return typeof mapped === "string" ? mapped : mapped.label;
  const text = fieldText(context.field, context.value, presentation.format);
  if (presentation.treatment === "email" && typeof context.value === "string" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(context.value)) {
    return html`<a class="aster-field-link" href=${`mailto:${encodeURIComponent(context.value).replace(/%40/gi, "@")}`}>${text}</a>`;
  }
  return text;
}

/** Reject explicit mistakes at their configuration path. Metadata is never validated as configuration. */
export function validateFieldPresentation(value: unknown, path = "fieldPresentation", allowFunctions = true): asserts value is FieldPresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  for (const [name, member] of Object.entries(value)) {
    const at = `${path}.${name}`;
    if (member === undefined) continue;
    switch (name) {
      case "treatment": if (member !== "text" && member !== "email") throw new TypeError(`${at} must be text or email`); break;
      case "display": case "formatter": if (!allowFunctions || typeof member !== "function") throw new TypeError(`${at} must be a registered callback`); break;
      case "format": {
        if (!member || typeof member !== "object" || !("kind" in member)) throw new TypeError(`${at} must name a format kind`);
        const format = member as FieldFormat;
        switch (format.kind) {
          case "number": { const { kind: _kind, ...options } = format; validateValueFormat(options); break; }
          case "date": if (format.style !== undefined && !["short", "medium", "iso"].includes(format.style)) throw new TypeError(`${at}.style must be short, medium or iso`); break;
          default: throw new TypeError(`${at}.kind must be date or number`);
        }
        break;
      }
      case "valueMap":
        if (!member || typeof member !== "object" || Array.isArray(member) || !Object.values(member).every(v => typeof v === "string" || !!v && typeof v === "object" && "label" in v && typeof v.label === "string")) throw new TypeError(`${at} must map raw values to labels`);
        break;
      default: throw new TypeError(`${at} is not a presentation member`);
    }
  }
}
export function validateFieldPresentations(value: unknown, path = "fieldPresentation", allowFunctions = true): asserts value is FieldPresentations {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  for (const [key, entries] of Object.entries(value)) {
    if (key !== "fields" && key !== "types") throw new TypeError(`${path}.${key} must be fields or types`);
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new TypeError(`${path}.${key} must be an object`);
    for (const [name, entry] of Object.entries(entries)) validateFieldPresentation(entry, `${path}.${key}.${name}`, allowFunctions);
  }
}

export function fieldText(field: Field | undefined, value: Value | undefined, format?: FieldFormat): string {
  if (value === null || value === undefined) return "";
  if (format?.kind === "date" && field?.type === "Edm.Date" && typeof value === "string") return formatDate(value, format.style);
  if (format?.kind === "number" && isNumericField(field) && (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))))) return formatFigure(value, format, { field });
  if (field?.type === "Edm.Boolean") return value ? "Yes" : "";
  if (field?.type === "Edm.Date" && typeof value === "string") return formatDate(value);
  if (field?.type === "Edm.DateTimeOffset" && typeof value === "string") return absoluteTime(value);
  return formatValue(field, value);
}
