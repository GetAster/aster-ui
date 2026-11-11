import { Collection, Command, DataContext, EditModel, FilterDraft, ListEdit, Selection, SharedFilters, Tree } from "@getaster/data";
import { nothing } from "lit-html";
import { compositeTypes as t, type CompositeType, type CompositeTypes } from "./contracts.ts";
import { compositeElement } from "./registry.ts";
import { PickerOptions } from "../picker/options.ts";
import { TreeChoices } from "../picker/tree-choices.ts";
import { ProgressStatus } from "../progress/status.ts";
import { Sidebar } from "../sidebar/sidebar.ts";
import { Button } from "../button/button.ts";
import { Field } from "../field/field.ts";
import { NumberField } from "../field/number-field.ts";
import { canonicalNumeric, compareNumeric } from "../field/numeric.ts";
import { CompositeField } from "../field/composite-field.ts";
import { Stack, HorizontalLayout, VerticalLayout } from "../layout/stack.ts";
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs.ts";
import { Accordion } from "../section/accordion.ts";
import { Check } from "../field/check.ts";
import { Select } from "../select/select.ts";
import { Picker } from "../picker/picker.ts";
import { TreePicker } from "../picker/tree-picker.ts";
import { DateField } from "../date/date-field.ts";
import { Choice } from "../select/choice-element.ts";
import { Switch } from "../switch/switch.ts";
import { Grid, type GridToolbar } from "../grid/grid.ts";
import { validateFeatures, type GridFeature } from "../grid/features.ts";
import type { CapabilityValue, FieldPolicy } from "../grid/policy.ts";
import { validateGridLabels, validateGridPresentation, type GridLabels, type GridPresentation } from "../grid/appearance.ts";
import { TileGrid } from "../tile-grid/tile-grid.ts";
import { Listbox } from "../listbox/listbox.ts";
import { Form } from "../form/form.ts";
import { validateFormFeatures, type FormFeature } from "../form/features.ts";
import type { FormControlName } from "../form/controls.ts";
import { ListEditor } from "../list-edit/list-edit.ts";
import { RuleEditor } from "../rule/rule-editor.ts";
import { FilterBuilder } from "../filter/filter-builder.ts";
import { TreeNavigator } from "../tree/navigator.ts";
import { Tabs } from "../tabs/tabs.ts";
import { Section } from "../section/section.ts";
import { Split } from "../split/split.ts";
import { Carousel } from "../carousel/carousel.ts";
import { Slicer } from "../slicer/slicer.ts";
import { ComponentHost } from "../component/component.ts";
import { Window, type WindowChrome, type WindowPlacement } from "../window/window.ts";
import { Dialog } from "../dialog/dialog.ts";
import { Menu } from "../menu/menu.ts";
import { Dashboard } from "../dashboard/dashboard.ts";
import { CommandBar } from "../composition/command-bar.ts";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fn = (value: unknown): boolean => typeof value === "function";
const view = (value: unknown): boolean => value === nothing || object(value) && "_$litType$" in value;
const value = (v: unknown): boolean => v === null || ["string", "boolean"].includes(typeof v) || typeof v === "number" && Number.isFinite(v) || Array.isArray(v) && v.every(value);
const options = t.array(t.object({ value: t.custom("OData value", (v): v is import("@getaster/data").Value => value(v)), label: t.string }));
const tabItems = t.array(t.object({ value: t.string, label: t.string, closable: t.optional(t.boolean), disabled: t.optional(t.boolean) }));
const literals = <const V extends readonly (string | number)[]>(...values: V) => t.custom("one of " + values.join(", "), (v): v is V[number] => values.some(item => item === v), { enum: values });
function checked<T>(description: string, test: (value: unknown) => boolean): CompositeType<T> {
  return t.custom(description, (value): value is T => test(value));
}
function bindable<T>(inner: CompositeType<T>): CompositeType<T | import("@preact/signals-core").ReadonlySignal<T>> {
  const signal = t.signal(inner);
  return t.custom(inner.description + " or signal", (v): v is T | import("@preact/signals-core").ReadonlySignal<T> => inner.validate(v) || signal.validate(v), { anyOf: [inner.schema ?? {}, signal.schema ?? {}] });
}
// Omission preserves the element's own default; explicit undefined must still validate.
function element<T>() {
  return <const C extends Partial<{ [K in keyof T]: CompositeType<T[K]> }> & CompositeTypes>(tag: string, props: C) => {
    const defaults = Object.fromEntries(Object.entries(props).map(([key, spec]) => [key, Object.freeze({ ...spec, optional: true as const })])) as { readonly [K in keyof C]: C[K] & { readonly optional: true } };
    return Object.freeze(compositeElement(tag, Object.freeze(defaults)));
  };
}
const optionalNumber = (v: unknown) => v === undefined || t.number.validate(v);
const optionalBoolean = (v: unknown) => v === undefined || typeof v === "boolean";
const numeric = (v: unknown): v is string | number => {
  if (typeof v !== "string" && typeof v !== "number") return false;
  try { canonicalNumeric(v); return true; } catch { return false; }
};
const sourceOptions = (v: unknown) => v === undefined || v instanceof Collection || v instanceof PickerOptions;
const formControlName = checked<FormControlName>("form control name", (v): v is FormControlName =>
  v === "text" || v === "number" || v === "date" || v === "check" || v === "select" || v === "picker");
const formItem = checked<import("../form/form.ts").FormItem>("field name, configured field or derived value", v =>
  typeof v === "string" || (object(v) && optionalNumber(v.span) && (
    (typeof v.field === "string" && sourceOptions(v.options)
      && (v.title === undefined || typeof v.title === "string")
      && (v.hint === undefined || typeof v.hint === "string")
      && (v.placeholder === undefined || typeof v.placeholder === "string")
      && optionalBoolean(v.readOnly) && optionalBoolean(v.disabled) && optionalBoolean(v.required)
      && (v.control === undefined || formControlName.validate(v.control)))
    || (typeof v.title === "string" && t.signal(t.string).validate(v.value)))));
const sections = t.array(t.object({ title: t.string, columns: t.optional(t.positiveInteger), open: t.optional(t.boolean), items: t.array(formItem) }));
const formPolicy = t.object({ readOnly: t.optional(t.boolean), disabled: t.optional(t.boolean) });
const formChrome = t.object({
  columns: t.optional(t.positiveInteger),
  titleOrientation: t.optional(literals("top", "start")),
  showInlineErrors: t.optional(t.boolean),
  errorSummary: t.optional(t.boolean),
  autoFocus: t.optional(t.boolean),
});
const formFeatures = t.custom<readonly FormFeature[]>("form feature list", (value): value is readonly FormFeature[] => {
  try { validateFormFeatures(value); return true; } catch { return false; }
}, { type: "array", items: { type: "object" } });
const isoDate = checked<string>("date (YYYY-MM-DD)", (v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
const gridView = checked<NonNullable<Grid["view"]>>("Grid view", v => object(v)
  && Array.isArray(v.columns) && v.columns.every(c => object(c) && typeof c.field === "string" && optionalNumber(c.width) && optionalBoolean(c.hidden) && (c.sortField === undefined || typeof c.sortField === "string" && c.sortField.trim().length > 0))
  && Array.isArray(v.sort) && v.sort.every(k => object(k) && typeof k.field === "string" && optionalBoolean(k.descending))
  && object(v.filters) && Object.values(v.filters).every(c => object(c) && typeof c.op === "string")
  && typeof v.frozen === "number" && Number.isSafeInteger(v.frozen) && v.frozen >= 0
  && (v.groupBy === undefined || typeof v.groupBy === "string" || Array.isArray(v.groupBy) && v.groupBy.every(k => typeof k === "string")));
const gridChrome = t.object({
  toolbar: t.optional(t.boolean),
  header: t.optional(t.boolean),
  filterRow: t.optional(checked<"auto" | boolean>('true, false or "auto"', v => v === "auto" || typeof v === "boolean")),
  headerMenu: t.optional(t.boolean),
  pagingBar: t.optional(t.boolean),
});
const gridToolbar = t.object({
  count: t.optional(t.boolean),
  sort: t.optional(t.boolean),
  filters: t.optional(t.boolean),
  advanced: t.optional(t.boolean),
  columns: t.optional(t.boolean),
  views: t.optional(t.boolean),
  expandAll: t.optional(t.boolean),
  extra: t.optional(checked<GridToolbar["extra"]>("Grid.toolbar.extra", v => v === undefined || view(v))),
});
// Capability switches in a composition catalog are plain data: a boolean or a
// field-name allowlist. Predicates remain a JavaScript-only setter value.
const gridCapability = t.custom<CapabilityValue>("boolean or field allowlist", (value): value is CapabilityValue =>
  typeof value === "boolean" || Array.isArray(value) && value.every((field) => typeof field === "string"), { anyOf: [{ type: "boolean" }, { type: "array", items: { type: "string" } }] });
const fieldPolicy = t.object({
  sortable: t.optional(gridCapability), filterable: t.optional(gridCapability), groupable: t.optional(gridCapability),
  resizable: t.optional(gridCapability), movable: t.optional(gridCapability), hideable: t.optional(gridCapability),
  freezable: t.optional(gridCapability), editable: t.optional(gridCapability),
});
const fieldPolicies = t.custom<Readonly<Record<string, FieldPolicy>>>("field policy record",
  (value): value is Readonly<Record<string, FieldPolicy>> => object(value) && Object.values(value).every((entry) => fieldPolicy.validate(entry)),
  { type: "object", additionalProperties: fieldPolicy.schema ?? {} });
const gridPolicy = t.object({
  sortable: t.optional(gridCapability),
  filterable: t.optional(gridCapability),
  groupable: t.optional(gridCapability),
  resizable: t.optional(gridCapability),
  movable: t.optional(gridCapability),
  hideable: t.optional(gridCapability),
  freezable: t.optional(gridCapability),
  editable: t.optional(gridCapability),
  selectable: t.optional(t.boolean),
  fields: t.optional(fieldPolicies),
});
const gridFeatures = t.custom<readonly GridFeature[]>("grid feature list", (value): value is readonly GridFeature[] => {
  try { validateFeatures(value); return true; } catch { return false; }
}, { type: "array", items: { type: "object" } });
// Presentation is plain data in a catalog; JS-only class predicates and hilite
// tests fail validation because `validateGridPresentation` rejects functions.
const gridPresentation = t.custom<GridPresentation>("grid presentation", (value): value is GridPresentation => {
  try { validateGridPresentation(value); return true; } catch { return false; }
}, { type: "object" });
const gridLabels = t.custom<GridLabels>("grid label bag", (value): value is GridLabels => {
  try { validateGridLabels(value); return true; } catch { return false; }
}, { type: "object", additionalProperties: { type: "string" } });
const milliseconds = t.custom("nonnegative milliseconds", (value): value is number => Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= 2_147_483_647, { type: "integer", minimum: 0, maximum: 2_147_483_647 });
const sectionChrome = t.object({
  titleBar: t.optional(t.boolean),
  fold: t.optional(t.boolean),
  close: t.optional(t.boolean),
  footer: t.optional(t.boolean),
  status: t.optional(literals("collapsed", "always")),
});
const windowChrome: CompositeType<WindowChrome> = t.object({
  header: t.optional(t.boolean),
  title: t.optional(t.boolean),
  close: t.optional(t.boolean),
  minimize: t.optional(t.boolean),
  maximize: t.optional(t.boolean),
  resizer: t.optional(t.boolean),
  footer: t.optional(t.boolean),
  statusBar: t.optional(t.boolean),
});
const positiveNumber = t.custom("positive finite number", (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0, { type: "number", exclusiveMinimum: 0 });
const windowPlacement: CompositeType<WindowPlacement> = t.object({
  state: literals("normal", "maximized", "minimized"),
  bounds: t.optional(t.object({ x: t.number, y: t.number, width: positiveNumber, height: positiveNumber })),
  restoreMaximized: t.optional(t.boolean),
});
const initialFocus = checked<Dialog["initialFocus"]>('"first", "dialog", "none" or a focus function', v =>
  v === undefined || v === "first" || v === "dialog" || v === "none" || fn(v));
const progressTiming = t.object({ delayMs: t.optional(milliseconds), minVisibleMs: t.optional(milliseconds) });
const bound = {
  model: t.optional(t.instance(EditModel)), field: t.string, label: t.string,
  labelled: t.boolean, sharedReasons: t.instance(Map<string, string>),
  hint: t.string, showErrors: t.boolean, validateOn: literals("submit", "change", "exit"),
};

/** Reusable public control contracts. Select entries explicitly for an application's allowlist. */
export const asterComponents = Object.freeze({
  Button: element<Button>()("aster-button", {
    label: t.string,
    busyLabel: t.optional(t.string),
    confirmLabel: t.optional(t.string),
    busy: bindable(t.boolean),
    variant: literals("secondary", "primary"),
    tone: literals("secondary", "primary", "danger"),
    size: literals("sm", "md", "lg"),
    disabled: t.boolean,
    type: literals("button", "submit"),
    icon: checked<Button["icon"]>("Button.icon", view),
    reason: t.optional(t.string),
  }),
  Field: element<Field>()("aster-field", {
    ...bound,
    value: t.string,
    placeholder: t.string,
    readOnly: t.boolean,
    keyboard: t.string,
    trailing: checked<Field["trailing"]>("Field.trailing", view),
  }),
  NumberField: element<NumberField>()("aster-number-field", {
    ...bound, value: checked<NumberField["value"]>("numeric value", v => v === null || typeof v === "string" || typeof v === "number" && Number.isFinite(v)),
    numericType: literals("decimal", "integer", "float"),
    min: t.optional(t.custom("numeric bound", numeric)),
    max: t.optional(t.custom("numeric bound", numeric)),
    step: t.optional(t.custom("positive numeric step", (v): v is string | number => numeric(v) && compareNumeric(v, 0) > 0)),
    stepButtons: t.boolean, prefixText: t.string, suffixText: t.string, placeholder: t.string, readOnly: t.boolean,
    format: checked<NumberField["format"]>("numeric display formatter", v => v === undefined || fn(v)),
  }),
  CompositeField: element<CompositeField>()("aster-composite-field", {
    model: t.optional(t.instance(EditModel)), fields: t.array(t.string), label: t.string, help: t.string, error: t.string,
    disabled: t.boolean, readOnly: t.boolean, content: checked<CompositeField["content"]>("CompositeField.content", view),
    value: t.custom("application value", (_v): _v is unknown => true),
    renderValue: checked<CompositeField["renderValue"]>("composite value renderer", v => v === undefined || fn(v)),
  }),
  Stack: Object.freeze(compositeElement(Stack)),
  HorizontalLayout: Object.freeze(compositeElement(HorizontalLayout)),
  VerticalLayout: Object.freeze(compositeElement(VerticalLayout)),
  Breadcrumbs: Object.freeze(compositeElement(Breadcrumbs)),
  Accordion: element<Accordion>()("aster-accordion", {
    items: checked<Accordion["items"]>("accordion items", v => Array.isArray(v) && new Set(v.map(i => i?.id)).size === v.length && v.every(i => object(i) && typeof i.id === "string" && i.id.length > 0 && typeof i.heading === "string" && !(i.body !== undefined && i.create !== undefined) && optionalBoolean(i.disabled) && (i.body === undefined || view(i.body)) && (i.summary === undefined || view(i.summary)) && (i.actions === undefined || view(i.actions)) && (i.create === undefined || fn(i.create)))),
    expanded: t.array(t.string), multiple: t.boolean, headingLevel: literals(2,3,4),
    visibilityMode: literals("multiple", "mutex"),
    canClose: t.boolean, canReorder: t.boolean, canCollapseAll: t.boolean,
  }),
  Check: element<Check>()("aster-check", {
    ...bound,
    labelPosition: literals("above", "start", "end"),
  }),
  Select: element<Select>()("aster-select", {
    ...bound,
    choices: t.optional(options),
    placeholder: t.string,
    filter: t.boolean,
    clearable: t.boolean,
    noResults: t.string,
  }),
  Picker: element<Picker>()("aster-picker", {
    ...bound,
    options: checked<Picker["options"]>("Picker.options", v => v === undefined || v instanceof Collection || v instanceof PickerOptions),
    display: t.string,
    valueField: t.string,
    multiple: t.boolean,
    values: checked<Picker["values"]>("Picker.values", v => Array.isArray(v) && v.every(value)),
    placeholder: t.string,
  }),
  TreePicker: element<TreePicker>()("aster-tree-picker", {
    ...bound,
    options: t.optional(t.instance(TreeChoices)),
    placeholder: t.string,
  }),
  DateField: element<DateField>()("aster-date", {
    ...bound,
    min: t.optional(isoDate),
    max: t.optional(isoDate),
    format: literals("medium", "short", "iso"),
    placeholder: t.string,
    dismissOnSelect: t.boolean,
  }),
  Choice: element<Choice>()("aster-choice", {
    options: options,
    value: checked<Choice["value"]>("Choice.value", v => v === undefined || value(v)),
    label: t.string,
    placeholder: t.string,
    filter: t.boolean,
    clearable: t.boolean,
    noResults: t.string,
    disabled: t.boolean,
  }),
  Switch: element<Switch>()("aster-switch", {
    binding: checked<Switch["binding"]>("Switch.binding", v => v === undefined || object(v) && v.ctx instanceof DataContext && typeof v.set === "string" && typeof v.key === "string" && typeof v.field === "string"),
    label: t.string,
    disabled: t.boolean,
    readOnly: t.boolean,
    onLabel: t.optional(t.string),
    offLabel: t.optional(t.string),
  }),
  Grid: element<Grid>()("aster-grid", {
    progressPolicy: progressTiming,
    ctx: t.optional(t.instance(DataContext)),
    set: t.string,
    base: checked<Grid["base"]>("Grid.base", v => v === undefined || object(v) && typeof v.op === "string"),
    view: t.optional(gridView),
    label: t.string,
    publish: t.string,
    persist: t.string,
    renderers: checked<Grid["renderers"]>("Grid.renderers", v => object(v) && Object.values(v).every(fn)),
    formatters: checked<Grid["formatters"]>("Grid.formatters", v => object(v) && Object.values(v).every(fn)),
    presentation: gridPresentation,
    labels: gridLabels,
    summaries: checked<Grid["summaries"]>("Grid.summaries", v => Array.isArray(v) && v.every(s => object(s) && (s.label === undefined || typeof s.label === "string") && (s.method === "count" || ["sum", "min", "max", "average", "countdistinct"].includes(String(s.method)) && typeof s.field === "string"))),
    lookups: checked<Grid["lookups"]>("Grid.lookups", v => object(v) && Object.values(v).every(l => object(l) && typeof l.set === "string" && typeof l.display === "string")),
    rowMenu: checked<Grid["rowMenu"]>("Grid.rowMenu", fn),
    columnMenu: checked<Grid["columnMenu"]>("Grid.columnMenu", fn),
    filterOperators: checked<Grid["filterOperators"]>("Grid.filterOperators", v => object(v) && Object.values(v).every(list => Array.isArray(list) && list.every(op => typeof op === "string" && op.length > 0))),
    tree: checked<Grid["tree"]>("Grid.tree", v => v === undefined || object(v) && typeof v.parentField === "string"
      && optionalBoolean(v.draggable) && optionalBoolean(v.reparent) && optionalBoolean(v.dropOnLeaves) && optionalBoolean(v.cascadeSelection)
      && optionalBoolean(v.showOpener) && (v.autoOpen === undefined || Number.isSafeInteger(v.autoOpen) && typeof v.autoOpen === "number" && v.autoOpen >= 0)
      && (v.pageSize === undefined || t.positiveInteger.validate(v.pageSize)) && (v.matchLimit === undefined || t.positiveInteger.validate(v.matchLimit))
      && (v.openLimit === undefined || t.positiveInteger.validate(v.openLimit))
      && (v.folderIcon === undefined || view(v.folderIcon)) && (v.nodeIcon === undefined || view(v.nodeIcon))
      && (v.filterMode === undefined || ["keepAncestors", "strict"].includes(String(v.filterMode)))),
    rowControls: checked<Grid["rowControls"]>("Grid.rowControls", v => v === undefined || fn(v)),
    expansion: checked<Grid["expansion"]>("Grid.expansion", v => v === undefined || object(v) && fn(v.content) && optionalBoolean(v.single) && optionalNumber(v.limit) && (v.canExpand === undefined || fn(v.canExpand))),
    policy: gridPolicy,
    features: gridFeatures,
    sortable: gridCapability,
    filterable: gridCapability,
    groupable: gridCapability,
    resizable: gridCapability,
    movable: gridCapability,
    hideable: gridCapability,
    freezable: gridCapability,
    editable: gridCapability,
    multiSort: t.boolean,
    editMode: literals("row", "cell"),
    selectionAppearance: literals("row", "cell"),
    selectionColumn: t.boolean,
    rules: checked<Grid["rules"]>("Grid.rules", object),
    empty: checked<Grid["empty"]>("Grid.empty", view),
    loading: checked<Grid["loading"]>("Grid.loading", view),
    loadingMessage: t.string,
    error: checked<Grid["error"]>("Grid.error", v => v === undefined || fn(v)),
    autoFetch: t.boolean,
    pageSize: t.positiveInteger,
    keepPages: t.optional(t.positiveInteger),
    exactCount: t.boolean,
    collection: t.optional(t.instance(Collection)),
    selection: t.optional(t.instance(Selection)),
    selectable: t.boolean,
    chrome: gridChrome,
    toolbar: gridToolbar,
    showHeader: t.boolean,
    showToolbar: t.boolean,
    showFilterRow: t.boolean,
    showHeaderMenu: t.boolean,
    showPagingBar: t.boolean,
  }),
  TileGrid: element<TileGrid>()("aster-tile-grid", {
    collection: t.optional(t.instance(Collection)),
    selection: t.optional(t.instance(Selection)),
    selectable: t.boolean,
    label: t.string,
    publish: t.string,
    presentTile: checked<TileGrid["presentTile"]>("TileGrid.presentTile", v => v === undefined || fn(v)),
    renderTile: checked<TileGrid["renderTile"]>("TileGrid.renderTile", v => v === undefined || fn(v)),
    actions: checked<TileGrid["actions"]>("TileGrid.actions", v => v === undefined || fn(v)),
    empty: checked<TileGrid["empty"]>("TileGrid.empty", view),
    layout: literals("uniform", "content"),
    virtualized: t.boolean,
  }),
  Listbox: element<Listbox>()("aster-listbox", {
    collection: t.optional(t.instance(Collection)),
    selection: t.optional(t.instance(Selection)),
    publish: t.string,
    renderRow: checked<Listbox["renderRow"]>("Listbox.renderRow", fn),
    empty: checked<Listbox["empty"]>("Listbox.empty", view),
    label: t.string,
  }),
  Form: element<Form>()("aster-form", {
    model: t.optional(t.instance(EditModel)),
    sections,
    headingLevel: literals(2,3,4),
    policy: formPolicy,
    readOnly: t.boolean,
    disabled: t.boolean,
    chrome: formChrome,
    columns: t.positiveInteger,
    titleOrientation: literals("top", "start"),
    showInlineErrors: t.boolean,
    errorSummary: t.boolean,
    autoFocus: t.boolean,
    features: formFeatures,
    validateOn: literals("submit", "change", "exit"),
    saveOnEnter: t.boolean,
  }),
  ListEditor: element<ListEditor>()("aster-list-editor", {
    list: t.optional(t.instance(ListEdit)),
    columns: checked<ListEditor["columns"]>("ListEditor.columns", v => Array.isArray(v) && v.every(c => object(c) && typeof c.field === "string")),
    label: t.string,
    addLabel: t.string,
    readOnlyReason: t.optional(t.string),
    empty: checked<ListEditor["empty"]>("ListEditor.empty", view),
  }),
  RuleEditor: element<RuleEditor>()("aster-rule-editor", {
    list: t.optional(t.instance(ListEdit)),
    category: t.string,
    label: t.string,
    messages: t.boolean,
    fields: checked<RuleEditor["fields"]>("RuleEditor.fields", v => v === undefined || v instanceof PickerOptions || v instanceof TreeChoices),
    describe: checked<RuleEditor["describe"]>("RuleEditor.describe", v => v === undefined || fn(v)),
    readOnlyReason: t.optional(t.string),
    empty: t.string,
  }),
  FilterBuilder: element<FilterBuilder>()("aster-filter-builder", {
    model: t.optional(t.instance(FilterDraft)),
    label: t.string,
    readOnlyReason: t.optional(t.string),
    operators: checked<FilterBuilder["operators"]>("FilterBuilder.operators", v => v === undefined || fn(v)),
  }),
  TreeNavigator: element<TreeNavigator>()("aster-tree-navigator", {
    tree: t.optional(t.instance(Tree)),
    display: t.string,
    label: t.string,
    choosable: checked<TreeNavigator["choosable"]>("TreeNavigator.choosable", v => v === undefined || fn(v)),
    headingLevel: literals(1, 2, 3, 4, 5, 6),
    chooseLabel: t.string,
    search: t.boolean,
  }),
  Tabs: element<Tabs>()("aster-tabs", {
    renderPanel: checked<Tabs["renderPanel"]>("Tabs.renderPanel", v => v === undefined || fn(v)),
    activation: literals("automatic", "manual"),
    items: bindable(tabItems),
    value: bindable(t.optional(t.string)),
    label: t.string,
    controls: t.optional(t.string),
  }),
  Section: element<Section>()("aster-section", {
    actions: checked<Section["actions"]>("Section.actions", view),
    chrome: sectionChrome,
    collapsible: t.boolean,
    disabled: t.boolean,
    footer: checked<Section["footer"]>("Section.footer", view),
    heading: t.string,
    open: t.boolean,
    body: checked<Section["body"]>("Section.body", view),
    level: literals(2,3,4),
    summary: checked<Section["summary"]>("Section.summary", view),
    canClose: t.boolean,
  }),
  Split: element<Split>()("aster-split", {
    orientation: literals("horizontal", "vertical"), pane: literals("start", "end"), size: t.number, collapsible: t.boolean, collapsed: t.boolean, responsive: t.boolean,
    start: checked<Split["start"]>("Split.start", view),
    end: checked<Split["end"]>("Split.end", view),
    width: t.number,
    min: t.number,
    max: t.number,
    label: t.string,
    persist: t.string,
    chrome: t.object({ collapse: t.optional(t.custom<"toolbar" | "bar" | false>("toolbar, bar or false", (v): v is "toolbar" | "bar" | false => v === "toolbar" || v === "bar" || v === false, { enum: ["toolbar", "bar", false] })) }),
    labels: t.object({ collapse: t.optional(t.string), restore: t.optional(t.string) }),
  }),
  Carousel: element<Carousel>()("aster-carousel", {
    slides: checked<Carousel["slides"]>("Carousel.slides", v => Array.isArray(v) && new Set(v.filter(s => s?.id !== undefined).map(s => s.id)).size === v.filter(s => s?.id !== undefined).length && v.every(s => object(s) && typeof s.label === "string" && (s.id === undefined || typeof s.id === "string") && view(s.view))),
    label: t.string,
  }),
  Slicer: element<Slicer>()("aster-slicer", {
    filters: t.optional(t.instance(SharedFilters)),
    label: t.string,
    empty: t.string,
  }),
  ComponentHost: element<ComponentHost>()("aster-component", {
    progressPolicy: progressTiming,
    adapter: checked<ComponentHost["adapter"]>("ComponentHost.adapter", v => v === undefined || !!v && typeof v === "object" && "mount" in v && fn(v.mount)),
    alternative: checked<ComponentHost["alternative"]>("ComponentHost.alternative", v => v === undefined || fn(v)),
    label: t.string,
    locale: t.optional(t.string),
  }),
  Window: element<Window>()("aster-window", {
    heading: t.string,
    content: checked<Window["content"]>("Window.content", view),
    managed: t.boolean,
    preserveContent: t.boolean,
    beforeClose: checked<Window["beforeClose"]>("Window.beforeClose", v => v === undefined || fn(v)),
    chrome: windowChrome,
    footer: checked<Window["footer"]>("Window.footer", view),
    status: checked<Window["status"]>("Window.status", view),
    initialPlacement: windowPlacement,
    modal: t.boolean,
    dismissOnEscape: t.boolean,
    keepInParentRect: t.boolean,
    autoCenter: t.boolean,
    showHeader: t.boolean,
    showTitle: t.boolean,
    showCloseButton: t.boolean,
    showMinimizeButton: t.boolean,
    showMaximizeButton: t.boolean,
    showResizer: t.boolean,
    showFooter: t.boolean,
    showStatusBar: t.boolean,
  }),
  Dialog: element<Dialog>()("aster-dialog", {
    content: checked<Dialog["content"]>("Dialog.content", view),
    labelledBy: t.optional(t.string),
    title: t.string,
    header: t.boolean,
    footer: checked<Dialog["footer"]>("Dialog.footer", view),
    showCloseButton: t.boolean,
    modal: t.boolean,
    dismissOnEscape: t.boolean,
    dismissOnBackdrop: t.boolean,
    initialFocus,
  }),
  Menu: element<Menu>()("aster-menu", {
    showIcons: t.boolean,
    showShortcuts: t.boolean,
    submenuDirection: literals("auto", "start", "end"),
    autoDismiss: t.boolean,
    emptyMessage: t.string,
  }),
  Dashboard: element<Dashboard>()("aster-dashboard", {
    label: t.string,
  }),
  CommandBar: element<CommandBar>()("aster-command-bar", {
    showErrors: t.boolean,
    formatError: checked<CommandBar["formatError"]>("CommandBar.formatError", v => v === undefined || fn(v)),
    label: t.string,
    commands: t.array(t.instance(Command)),
  }),
  ProgressStatus: element<ProgressStatus>()("aster-progress-status", {
    busy: t.boolean, error: t.optional(t.string), progressPolicy: progressTiming,
    pendingText: t.string, completeText: t.string, reserveSpace: t.boolean,
  }),
  Sidebar: Object.freeze(compositeElement(Sidebar)),
});
