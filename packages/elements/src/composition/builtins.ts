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
import { Grid } from "../grid/grid.ts";
import { TileGrid } from "../tile-grid/tile-grid.ts";
import { Listbox } from "../listbox/listbox.ts";
import { Form } from "../form/form.ts";
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
import { Window } from "../window/window.ts";
import { Dialog } from "../dialog/dialog.ts";
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
const formItem = checked<import("../form/form.ts").FormItem>("field name, configured field or derived value", v =>
  typeof v === "string" || object(v) && optionalNumber(v.span) && (typeof v.field === "string" && sourceOptions(v.options)
    || typeof v.title === "string" && t.signal(t.string).validate(v.value)));
const sections = t.array(t.object({ title: t.string, columns: t.optional(t.positiveInteger), open: t.optional(t.boolean), items: t.array(formItem) }));
const gridView = checked<NonNullable<Grid["view"]>>("Grid view", v => object(v)
  && Array.isArray(v.columns) && v.columns.every(c => object(c) && typeof c.field === "string" && optionalNumber(c.width) && optionalBoolean(c.hidden) && (c.sortField === undefined || typeof c.sortField === "string" && c.sortField.trim().length > 0))
  && Array.isArray(v.sort) && v.sort.every(k => object(k) && typeof k.field === "string" && optionalBoolean(k.descending))
  && object(v.filters) && Object.values(v.filters).every(c => object(c) && typeof c.op === "string")
  && typeof v.frozen === "number" && Number.isSafeInteger(v.frozen) && v.frozen >= 0
  && (v.groupBy === undefined || typeof v.groupBy === "string" || Array.isArray(v.groupBy) && v.groupBy.every(k => typeof k === "string")));
const milliseconds = t.custom("nonnegative milliseconds", (value): value is number => Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= 2_147_483_647, { type: "integer", minimum: 0, maximum: 2_147_483_647 });
const progressTiming = t.object({ delayMs: t.optional(milliseconds), minVisibleMs: t.optional(milliseconds) });
const bound = {
  model: t.optional(t.instance(EditModel)), field: t.string, label: t.string,
  labelled: t.boolean, sharedReasons: t.instance(Map<string, string>),
};

/** Reusable public control contracts. Select entries explicitly for an application's allowlist. */
export const asterComponents = Object.freeze({
  Button: element<Button>()("aster-button", {
    label: t.string,
    busyLabel: t.optional(t.string),
    confirmLabel: t.optional(t.string),
    busy: bindable(t.boolean),
    variant: literals("secondary", "primary"),
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
  }),
  Check: element<Check>()("aster-check", {
    ...bound,
  }),
  Select: element<Select>()("aster-select", {
    ...bound,
    choices: t.optional(options),
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
  }),
  Choice: element<Choice>()("aster-choice", {
    options: options,
    value: checked<Choice["value"]>("Choice.value", v => v === undefined || value(v)),
    label: t.string,
    placeholder: t.string,
  }),
  Switch: element<Switch>()("aster-switch", {
    binding: checked<Switch["binding"]>("Switch.binding", v => v === undefined || object(v) && v.ctx instanceof DataContext && typeof v.set === "string" && typeof v.key === "string" && typeof v.field === "string"),
    label: t.string,
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
    summaries: checked<Grid["summaries"]>("Grid.summaries", v => Array.isArray(v) && v.every(s => object(s) && (s.label === undefined || typeof s.label === "string") && (s.method === "count" || ["sum", "min", "max", "average", "countdistinct"].includes(String(s.method)) && typeof s.field === "string"))),
    lookups: checked<Grid["lookups"]>("Grid.lookups", v => object(v) && Object.values(v).every(l => object(l) && typeof l.set === "string" && typeof l.display === "string")),
    rowMenu: checked<Grid["rowMenu"]>("Grid.rowMenu", fn),
    tree: checked<Grid["tree"]>("Grid.tree", v => v === undefined || object(v) && typeof v.parentField === "string" && optionalBoolean(v.draggable) && (v.filterMode === undefined || ["keepAncestors", "strict"].includes(String(v.filterMode)))),
    rowControls: checked<Grid["rowControls"]>("Grid.rowControls", v => v === undefined || fn(v)),
    expansion: checked<Grid["expansion"]>("Grid.expansion", v => v === undefined || object(v) && fn(v.content) && optionalBoolean(v.single) && optionalNumber(v.limit) && (v.canExpand === undefined || fn(v.canExpand))),
    editable: t.boolean,
    rules: checked<Grid["rules"]>("Grid.rules", object),
    empty: checked<Grid["empty"]>("Grid.empty", view),
    collection: t.optional(t.instance(Collection)),
    selection: t.optional(t.instance(Selection)),
    selectable: t.boolean,
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
  }),
  TreeNavigator: element<TreeNavigator>()("aster-tree-navigator", {
    tree: t.optional(t.instance(Tree)),
    display: t.string,
    label: t.string,
    choosable: checked<TreeNavigator["choosable"]>("TreeNavigator.choosable", v => v === undefined || fn(v)),
    headingLevel: literals(1, 2, 3, 4, 5, 6),
    chooseLabel: t.string,
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
    disabled: t.boolean,
    heading: t.string,
    open: t.boolean,
    body: checked<Section["body"]>("Section.body", view),
    level: literals(2,3,4),
    summary: checked<Section["summary"]>("Section.summary", view),
  }),
  Split: element<Split>()("aster-split", {
    orientation: literals("horizontal", "vertical"), size: t.number, collapsible: t.boolean, collapsed: t.boolean, responsive: t.boolean,
    start: checked<Split["start"]>("Split.start", view),
    end: checked<Split["end"]>("Split.end", view),
    width: t.number,
    min: t.number,
    max: t.number,
    label: t.string,
    persist: t.string,
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
  }),
  Dialog: element<Dialog>()("aster-dialog", {
    content: checked<Dialog["content"]>("Dialog.content", view),
    labelledBy: t.optional(t.string),
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
