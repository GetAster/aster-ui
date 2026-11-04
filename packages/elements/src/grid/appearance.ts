import type { Entity, Field, KeyText, Value } from "@getaster/data";
import { formatValue } from "../field/values.ts";
import { formatDate, type DateFormat } from "../date/dates.ts";
import { absoluteTime } from "../format.ts";

/** One class or several. A string may name space-separated classes. */
export type ClassNames = string | readonly string[];

/** How a column's values and header line up. */
export type ColumnAlign = "start" | "center" | "end";

/** The semantic tone a hilite or value-map entry names; CSS decides its look. */
export type PresentationTone = "neutral" | "positive" | "caution" | "negative";

/** How a plain-data match compares a record's field. */
export type ValueMatchOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "between" | "contains" | "empty" | "notEmpty";

/**
 * A presentation condition on one record field. `in` takes an array and
 * `between` a two-item inclusive range; `empty` and `notEmpty` take no value.
 * A JS-only predicate is the `test` hook of a class rule or hilite.
 */
export type ValueMatch = {
  /** The record field to read. */
  readonly field: string;
  /** How the field's value is compared. */
  readonly op: ValueMatchOperator;
  /** The comparison value; an array for `in`, two values for `between`. */
  readonly value?: Value | readonly Value[];
};

/** How a number is written: plain decimal (default), integer, percent or currency. */
export type NumberFormatStyle = "decimal" | "integer" | "percent" | "currency";

/**
 * A declarative display format for a date or number column. It only applies
 * to a matching field type; other values keep the grid's default text.
 */
export type ColumnFormat =
  | {
      /** A calendar date (`Edm.Date`). */
      readonly kind: "date";
      /** `"medium"` (default), `"short"` or `"iso"`, as [[type:DateFormat]]. */
      readonly style?: DateFormat;
    }
  | {
      /** A numeric field (integers, decimal, single and double). */
      readonly kind: "number";
      /** The display style; `"decimal"` (default). */
      readonly style?: NumberFormatStyle;
      /** ISO 4217 code for `"currency"`; defaults to `"GBP"`. */
      readonly currency?: string;
      /** Minimum fraction digits. */
      readonly minimumFractionDigits?: number;
      /** Maximum fraction digits; `"integer"` defaults it to `0`. */
      readonly maximumFractionDigits?: number;
    };

/** A value-map entry: display text alone, or text with a tone and classes. */
export type ValueMapValue = string | {
  /** The display text for the raw value. */
  readonly label: string;
  /** A semantic tone for the cell. */
  readonly tone?: PresentationTone;
  /** Extra classes for the cell. */
  readonly class?: ClassNames;
};

/**
 * Per-column display overrides, keyed by the raw value written as text
 * (`String(value)`). Metadata allowed values remain the base for entries the
 * map omits; an unknown value keeps the grid's default display.
 */
export type ColumnValueMap = Readonly<Record<string, ValueMapValue>>;

/** A value-map lookup hit: text plus the optional tone and classes. */
export type MappedValue = {
  /** The display text. */
  readonly label: string;
  /** A semantic tone for the cell. */
  readonly tone?: PresentationTone;
  /** Extra classes for the cell. */
  readonly class?: ClassNames;
};

/** The row a class rule or predicate sees. */
export type RowStyleContext = {
  /** The record drawn in the row. */
  readonly entity: Entity;
  /** The record's key. */
  readonly key: KeyText;
  /** The row's position in the grid as rendered. */
  readonly index: number;
};

/** The cell a class rule or predicate sees. */
export type CellStyleContext = RowStyleContext & {
  /** The column's field name. */
  readonly field: string;
  /** The record's raw value for the field. */
  readonly value: Value | undefined;
};

/** A plain-data row class rule, with a JS-only predicate where matching needs code. */
export type RowClassRule = {
  /** A condition on a record field. */
  readonly when?: ValueMatch;
  /** A JS-only predicate; combined with `when` when both are present. */
  readonly test?: (row: RowStyleContext) => boolean;
  /** The classes the rule adds when it matches. */
  readonly class: ClassNames;
};

/** A plain-data cell class rule, with a JS-only predicate where matching needs code. */
export type CellClassRule = {
  /** A condition on a record field. */
  readonly when?: ValueMatch;
  /** A JS-only predicate; combined with `when` when both are present. */
  readonly test?: (cell: CellStyleContext) => boolean;
  /** The classes the rule adds when it matches. */
  readonly class: ClassNames;
};

/**
 * Static classes, an ordered list mixing static names, rules and JS-only
 * predicates, or a JS-only predicate. Predicates are rejected by the
 * composition catalog.
 */
export type RowClass = ClassNames | readonly (RowClassRule | string | ((row: RowStyleContext) => ClassNames | undefined))[] | ((row: RowStyleContext) => ClassNames | undefined);

/** Static classes, an ordered list mixing names, rules and JS-only predicates, or a predicate. */
export type CellClass = ClassNames | readonly (CellClassRule | string | ((cell: CellStyleContext) => ClassNames | undefined))[] | ((cell: CellStyleContext) => ClassNames | undefined);

/**
 * A status/traffic-light rule. Row-scoped rules mark the row; cell-scoped
 * rules mark one column's cells. A plain-data `when` and a JS-only `test`
 * combine with AND when both are present.
 */
export type Hilite = {
  /** Where it applies: the row (default) or one column's cells. */
  readonly scope?: "row" | "cell";
  /** The column a cell-scoped hilite marks; required for `scope: "cell"`. */
  readonly field?: string;
  /** The condition, on any record field. */
  readonly when?: ValueMatch;
  /** A JS-only predicate over the record and its value for the matched field. */
  readonly test?: (entity: Entity, value: Value | undefined) => boolean;
  /** The tone to mark; the last matching hilite with a tone wins. */
  readonly tone?: PresentationTone;
  /** Extra classes, in declared order. */
  readonly class?: ClassNames;
};

/** Presentation overrides for one column, keyed by field name. */
export type ColumnPresentation = {
  /** Header text; the metadata title by default. */
  readonly title?: string;
  /** Alignment for the header and cells; numeric fields default to the end. */
  readonly align?: ColumnAlign;
  /** Raw-value display overrides; metadata allowed values are the base. */
  readonly valueMap?: ColumnValueMap;
  /** A display format for date and number fields. */
  readonly format?: ColumnFormat;
  /** Classes for this column's cells: static, rules, or a JS-only predicate. */
  readonly cellClass?: CellClass;
};

/**
 * The grid's one presentation surface: per-column overrides, row and cell
 * class hooks, and hilites. Every field is optional; `{}` keeps today's
 * rendering. Plain data travels through the composition catalog; predicates
 * are JavaScript-only.
 */
export type GridPresentation = {
  /** Per-column overrides, by field name. */
  readonly columns?: Readonly<Record<string, ColumnPresentation>>;
  /** Classes for every record row: static, rules, or a JS-only predicate. */
  readonly rowClass?: RowClass;
  /** Classes for every record cell: static, rules, or a JS-only predicate. */
  readonly cellClass?: CellClass;
  /** Status rules, applied in declared order after the class hooks. */
  readonly hilites?: readonly Hilite[];
};

/** The classes and tone a row or cell received from presentation configuration. */
export type StyleDecoration = {
  /** Classes in precedence order, without duplicates. */
  readonly classes: readonly string[];
  /** The last tone a matching hilite (or value-map entry) supplied. */
  readonly tone?: PresentationTone;
};

/** The grid's overridable strings. Missing entries keep today's text; `{name}` is a placeholder. */
export const GRID_LABEL_DEFAULTS = {
  toolbarLabel: "{label} view",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  sort: "Sort",
  filters: "Filters",
  filtersActive: "Filters ({count})",
  advancedFilter: "Advanced filter",
  columns: "Columns",
  views: "Views",
  groupsFailed: "Couldn’t load groups.",
  retryGroups: "Retry groups",
  treeSearching: "Finding where the matches are…",
  treeTooBroad: "Too many matches to show where they are. Narrow the filter.",
  treeSearchFailed: "Couldn’t find where the matches are. Change the filter to try again.",
  groupedBy: "Grouped by {field}",
  thenBy: "Then by {field}",
  stopGrouping: "Stop grouping",
  removeGrouping: "Remove grouping {field}",
  moveGroupingEarlier: "Move {field} grouping earlier",
  moveGroupingLater: "Move {field} grouping later",
  groupingRefused: "Grouping is refused.",
  removeRefusedGrouping: "{reason} Remove it from the saved view.",
  filterRefused: "This page doesn’t allow filtering.",
  criteriaNeedsRepair: "Saved filter needs repair. No matches will be returned.",
  notLoaded: "Not loaded",
  loading: "Loading…",
  aboutRows: "About {count} rows",
  atLeastRows: "{count}+ rows",
  row: "1 row",
  rows: "{count} rows",
  group: "1 group",
  groups: "{count} groups",
  groupedRows: "{rows} in {groups}",
  pages: "Pages",
  firstPage: "First page",
  previousPage: "Previous page",
  nextPage: "Next page",
  lastPage: "Last page",
  page: "Page {page}",
  pageOf: "Page {page} of {pages}",
  pageRows: " · rows {first}–{last} of {total}",
  sortRows: "Sort rows",
  noSortableColumns: "This grid has no sortable columns.",
  sortAction: "Sort {field}",
  sortActionNow: "Sort {field}, now {direction}",
  sortReverse: "Click to reverse",
  sortAscending: "Click to sort ascending",
  sortPriority: "Sort priority {priority}.",
  clearFieldSorting: "Clear {field} sorting",
  clearSorting: "Clear sorting",
  moveFieldUp: "Move {field} up",
  moveFieldDown: "Move {field} down",
  resetView: "Reset to the page’s view",
  savedViews: "Saved views",
  noSavedViews: "None yet. Shape the grid, then save it here by name.",
  deleteView: "Delete the view {name}",
  viewName: "Name for this view",
  viewNamePlaceholder: "Name this view",
  save: "Save",
  delete: "Delete",
  sortBy: "Sort by {field}",
  addToSort: "; Shift adds it to the sort",
  dragToMove: "Drag to move",
  dragToResize: "Drag its right edge to resize",
  columnOptions: "{field} column options",
  rowColumn: "{field} column",
  rowMenu: "Row",
  notFilterable: "Not filterable",
  filterField: "Filter {field}",
  chooseFilterDate: "Choose a date to filter {field}",
  menuSort: "Sort",
  ascending: "Ascending",
  descending: "Descending",
  directionAscending: "ascending",
  directionDescending: "descending",
  notSorted: "Not sorted",
  addToSortMenu: "Add to the sort",
  groupBy: "Group by {field}",
  freezeUpTo: "Freeze up to {field}",
  menuMove: "Move",
  moveLeft: "Left",
  moveRight: "Right",
  moveToStart: "To the start",
  moveToEnd: "To the end",
  menuWidth: "Width",
  wider: "Wider",
  narrower: "Narrower",
  fitSpace: "Fit the space",
  hideField: "Hide {field}",
  columnsEllipsis: "Columns…",
  firstColumn: "It's the first column.",
  lastColumn: "It's the last column.",
  sortServiceRefused: "{field} can’t be sorted by this service.",
  sortNavigationRefused: "{field} can’t be sorted until its related record’s display field is known.",
  sortPolicyRefused: "Sorting by {field} isn’t allowed on this page.",
  filterServiceRefused: "{field} can’t be filtered by this service.",
  filterPolicyRefused: "Filtering by {field} isn’t allowed on this page.",
  filterOperatorRefused: "{field} can’t be filtered by {operator} on this page.",
  groupSharedRefused: "{field} can’t be grouped in a grid over shared data.",
  groupUnknownRefused: "{field} can’t be grouped.",
  groupLongRefused: "{field} is too long to group.",
  groupPolicyRefused: "Grouping by {field} isn’t allowed on this page.",
  resizePolicyRefused: "Resizing {field} isn’t allowed on this page.",
  movePolicyRefused: "Moving {field} isn’t allowed on this page.",
  hideLastRefused: "The last visible column can’t be hidden.",
  hidePolicyRefused: "Hiding {field} isn’t allowed on this page.",
  freezePolicyRefused: "Freezing {field} isn’t allowed on this page.",
  freezeUnknownRefused: "{field} can’t be frozen.",
  freezeLastRefused: "At least one column must stay unfrozen.",
  loadFailed: "Couldn’t load rows.",
  retry: "Retry",
  groupLoadFailed: "Couldn’t load group.",
  retryGroup: "Retry group {group}",
  summaryLoadFailed: "Couldn’t load summaries.",
  summaryLoading: "Loading summaries…",
  summariesUpdated: "Summaries updated",
  retrySummaries: "Retry summaries",
  summaryRows: "Rows",
  summarySum: "Sum {field}",
  summaryMinimum: "Minimum {field}",
  summaryMaximum: "Maximum {field}",
  summaryAverage: "Average {field}",
  summaryDistinct: "Distinct {field}",
  summaryAria: "{label} summaries",
  empty: "",
  rowLoadFailed: "Could not load that row. Move to another row or retry.",
  hiddenTitle: "You can't see this value",
  hiddenValue: "Hidden",
  advancedApplied: "Advanced filter applied",
  advancedCleared: "Advanced filter cleared",
  sortedBy: "Sorted by {sorts}",
  sortEntry: "{field}, {direction}",
  sortSeparator: ", then ",
  dragPickedUp: "Picked up {field}. Drop it on another row to move it under that row, or on Top level to move it to the top level.",
  dragNotMoved: "{field} not moved.",
  foldersLimit: "Opened {limit} folders. Narrow the tree to open more.",
  foldersOpened: "All folders opened.",
  foldersClosed: "All folders closed.",
  expansionLimit: "Only {limit} {noun} can be open at once. Close one first.",
  driftSort: "Sorted by {field}",
  driftFilter: "Filtered by {field}",
  driftCriteria: "The advanced filter uses {field}",
  driftGroup: "Grouped by {field}",
  driftHidden: "Column {field} is hidden",
  driftFrozen: "Column {field} is frozen",
  driftEntry: "{what}: {reason}",
  driftNote: "The saved view can’t fully apply. {entries} The view keeps these settings and uses them again when the page allows it.",
  driftFallbackReason: "{field} can’t be used by the saved view.",
  dismiss: "Dismiss",
} as const;

/** One overridable grid string: a key of [[constant:GRID_LABEL_DEFAULTS]]. */
export type GridLabel = keyof typeof GRID_LABEL_DEFAULTS;

/**
 * The grid's label bag. Every entry is optional; a missing entry keeps
 * today's string. `{name}` placeholders are filled from the event the string
 * describes. This is a stopgap before full i18n, not an i18n engine: it
 * carries no plural rules, number locale or direction.
 */
export type GridLabels = { readonly [K in GridLabel]?: string };

const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function isValue(value: unknown): value is Value {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

const TONES: readonly string[] = ["neutral", "positive", "caution", "negative"];
const ALIGNS: readonly string[] = ["start", "center", "end"];
const MATCH_OPS: readonly string[] = ["eq", "ne", "lt", "lte", "gt", "gte", "in", "between", "contains", "empty", "notEmpty"];
const NUMBER_STYLES: readonly string[] = ["decimal", "integer", "percent", "currency"];
const DATE_STYLES: readonly string[] = ["medium", "short", "iso"];
const NUMERIC = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Decimal", "Edm.Single", "Edm.Double"]);

function fail(path: string, message: string): never {
  throw new TypeError(`${path} ${message}`);
}

function onlyKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, "is not a known option");
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") fail(path, "must be a string");
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") fail(path, "must be a boolean");
}

function validateClasses(value: unknown, path: string): void {
  if (typeof value === "string") return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) fail(path, "must be a class name or an array of class names");
}

function validateMatch(value: unknown, path: string): void {
  if (!plainObject(value)) fail(path, "must be an object");
  onlyKeys(value, path, ["field", "op", "value"]);
  if (typeof value.field !== "string" || !value.field) fail(`${path}.field`, "must be a nonempty field name");
  if (typeof value.op !== "string" || !MATCH_OPS.includes(value.op)) fail(`${path}.op`, `must be one of ${MATCH_OPS.join(", ")}`);
  const match = value as { op: string; value?: unknown };
  switch (match.op) {
    case "empty":
    case "notEmpty":
      if (match.value !== undefined) fail(`${path}.value`, `must be omitted for "${match.op}"`);
      return;
    case "in":
      if (!Array.isArray(match.value) || match.value.some((entry) => !isValue(entry))) fail(`${path}.value`, 'must be an array of values for "in"');
      return;
    case "between":
      if (!Array.isArray(match.value) || match.value.length !== 2 || match.value.some((entry) => !isValue(entry))) fail(`${path}.value`, 'must be a two-item array for "between"');
      return;
    default:
      if (match.value === undefined || Array.isArray(match.value) || !isValue(match.value)) fail(`${path}.value`, "must be a single value");
  }
}

function validateClassRule(value: unknown, path: string, allowFunctions: boolean): void {
  if (!plainObject(value)) fail(path, "must be a plain object");
  onlyKeys(value, path, ["when", "test", "class"]);
  if (value.when !== undefined) validateMatch(value.when, `${path}.when`);
  if (value.test !== undefined) {
    if (typeof value.test !== "function") fail(`${path}.test`, "must be a function");
    if (!allowFunctions) fail(`${path}.test`, "can’t be a function in a composition catalog");
  }
  if (value.class === undefined) fail(`${path}.class`, "is required");
  validateClasses(value.class, `${path}.class`);
}

function validateClassHook(value: unknown, path: string, allowFunctions: boolean): void {
  if (typeof value === "string") return;
  if (typeof value === "function") {
    if (!allowFunctions) fail(path, "can’t be a function in a composition catalog");
    return;
  }
  if (!Array.isArray(value)) fail(path, "must be a class name, classes, rules or a predicate");
  value.forEach((entry, i) => {
    if (typeof entry === "string") return;
    if (typeof entry === "function") {
      if (!allowFunctions) fail(`${path}[${i}]`, "can’t be a function in a composition catalog");
      return;
    }
    if (plainObject(entry)) {
      validateClassRule(entry, `${path}[${i}]`, allowFunctions);
      return;
    }
    fail(`${path}[${i}]`, "must be a class name, a rule object or a predicate");
  });
}

function validateValueMap(value: unknown, path: string): void {
  if (!plainObject(value)) fail(path, "must be an object");
  for (const [key, entry] of Object.entries(value)) {
    const at = `${path}[${JSON.stringify(key)}]`;
    if (typeof entry === "string") continue;
    if (!plainObject(entry)) fail(at, "must be a string or an object");
    onlyKeys(entry, at, ["label", "tone", "class"]);
    if (typeof entry.label !== "string") fail(`${at}.label`, "must be a string");
    if (entry.tone !== undefined && (typeof entry.tone !== "string" || !TONES.includes(entry.tone))) fail(`${at}.tone`, `must be one of ${TONES.join(", ")}`);
    if (entry.class !== undefined) validateClasses(entry.class, `${at}.class`);
  }
}

function validateFormat(value: unknown, path: string): void {
  if (!plainObject(value)) fail(path, "must be an object");
  const kind = value.kind;
  if (kind !== "date" && kind !== "number") fail(`${path}.kind`, 'must be "date" or "number"');
  if (kind === "date") {
    onlyKeys(value, path, ["kind", "style"]);
    if (value.style !== undefined && (typeof value.style !== "string" || !DATE_STYLES.includes(value.style))) fail(`${path}.style`, `must be one of ${DATE_STYLES.join(", ")}`);
    return;
  }
  onlyKeys(value, path, ["kind", "style", "currency", "minimumFractionDigits", "maximumFractionDigits"]);
  if (value.style !== undefined && (typeof value.style !== "string" || !NUMBER_STYLES.includes(value.style))) fail(`${path}.style`, `must be one of ${NUMBER_STYLES.join(", ")}`);
  if (value.currency !== undefined && (typeof value.currency !== "string" || !value.currency)) fail(`${path}.currency`, "must be a currency code");
  if (value.style === "currency" && typeof value.currency !== "string") fail(`${path}.currency`, 'is required when style is "currency"');
  for (const key of ["minimumFractionDigits", "maximumFractionDigits"] as const) {
    const digits = value[key];
    if (digits !== undefined && (typeof digits !== "number" || !Number.isSafeInteger(digits) || digits < 0)) fail(`${path}.${key}`, "must be a nonnegative integer");
  }
  const minDigits = value.minimumFractionDigits;
  const maxDigits = value.maximumFractionDigits;
  if (minDigits != null && maxDigits != null && minDigits > maxDigits) {
    fail(`${path}.minimumFractionDigits`, "cannot exceed maximumFractionDigits");
  }
  // The integer style defaults its maximum to zero; a minimum above that is impossible.
  if ((value.style ?? "decimal") === "integer" && typeof minDigits === "number" && minDigits > (typeof maxDigits === "number" ? maxDigits : 0)) {
    fail(`${path}.minimumFractionDigits`, "cannot exceed maximumFractionDigits for the integer style");
  }
  // Reject options the renderer's Intl.NumberFormat cannot construct, naming the offending entry.
  if (value.style === "currency") {
    try {
      new Intl.NumberFormat("en-GB", { style: "currency", currency: value.currency as string });
    } catch {
      fail(`${path}.currency`, "must be a well-formed ISO 4217 currency code");
    }
  }
  for (const key of ["minimumFractionDigits", "maximumFractionDigits"] as const) {
    const digits = value[key];
    if (typeof digits !== "number") continue;
    const probe: Intl.NumberFormatOptions = {};
    probe[key] = digits;
    try {
      new Intl.NumberFormat("en-GB", probe);
    } catch {
      fail(`${path}.${key}`, "is outside the range this platform supports");
    }
  }
}

function validateColumn(value: unknown, path: string, allowFunctions: boolean): void {
  if (!plainObject(value)) fail(path, "must be an object");
  onlyKeys(value, path, ["title", "align", "valueMap", "format", "cellClass"]);
  optionalString(value.title, `${path}.title`);
  if (value.align !== undefined && (typeof value.align !== "string" || !ALIGNS.includes(value.align))) fail(`${path}.align`, `must be one of ${ALIGNS.join(", ")}`);
  if (value.valueMap !== undefined) validateValueMap(value.valueMap, `${path}.valueMap`);
  if (value.format !== undefined) validateFormat(value.format, `${path}.format`);
  if (value.cellClass !== undefined) validateClassHook(value.cellClass, `${path}.cellClass`, allowFunctions);
}

function validateHilite(value: unknown, path: string, allowFunctions: boolean): void {
  if (!plainObject(value)) fail(path, "must be an object");
  onlyKeys(value, path, ["scope", "field", "when", "test", "tone", "class"]);
  if (value.scope !== undefined && value.scope !== "row" && value.scope !== "cell") fail(`${path}.scope`, 'must be "row" or "cell"');
  if (value.field !== undefined && (typeof value.field !== "string" || !value.field)) fail(`${path}.field`, "must be a nonempty field name");
  if (value.scope === "cell" && value.field === undefined) fail(`${path}.field`, 'is required when scope is "cell"');
  if (value.when !== undefined) validateMatch(value.when, `${path}.when`);
  if (value.test !== undefined) {
    if (typeof value.test !== "function") fail(`${path}.test`, "must be a function");
    if (!allowFunctions) fail(`${path}.test`, "can’t be a function in a composition catalog");
  }
  if (value.tone !== undefined && (typeof value.tone !== "string" || !TONES.includes(value.tone))) fail(`${path}.tone`, `must be one of ${TONES.join(", ")}`);
  if (value.class !== undefined) validateClasses(value.class, `${path}.class`);
}

/**
 * Checks a [[type:GridPresentation]] value. With `allowFunctions` true, the
 * JS-only class predicates and hilite tests are accepted; the composition
 * catalog calls it without that, so plain-data shapes are all it can carry.
 */
export function validateGridPresentation(value: unknown, allowFunctions = false): asserts value is GridPresentation {
  if (!plainObject(value)) fail("presentation", "must be an object");
  onlyKeys(value, "presentation", ["columns", "rowClass", "cellClass", "hilites"]);
  if (value.columns !== undefined) {
    if (!plainObject(value.columns)) fail("presentation.columns", "must be an object keyed by field name");
    for (const [field, column] of Object.entries(value.columns)) {
      if (!field) fail("presentation.columns", "must not have an empty field name");
      validateColumn(column, `presentation.columns[${JSON.stringify(field)}]`, allowFunctions);
    }
  }
  if (value.rowClass !== undefined) validateClassHook(value.rowClass, "presentation.rowClass", allowFunctions);
  if (value.cellClass !== undefined) validateClassHook(value.cellClass, "presentation.cellClass", allowFunctions);
  if (value.hilites !== undefined) {
    if (!Array.isArray(value.hilites)) fail("presentation.hilites", "must be an array");
    value.hilites.forEach((hilite, i) => validateHilite(hilite, `presentation.hilites[${i}]`, allowFunctions));
  }
}

/** Checks a [[type:GridLabels]] value: known keys, string values only. */
export function validateGridLabels(value: unknown): asserts value is GridLabels {
  if (!plainObject(value)) fail("labels", "must be an object");
  for (const [key, text] of Object.entries(value)) {
    if (!Object.hasOwn(GRID_LABEL_DEFAULTS, key)) fail(`labels.${key}`, "is not a known label");
    if (typeof text !== "string") fail(`labels.${key}`, "must be a string");
  }
}

/** One label, overridden or defaulted, with `{name}` placeholders filled. */
export function labelText(labels: GridLabels, key: GridLabel, values?: Readonly<Record<string, string | number>>): string {
  const template = labels[key] ?? GRID_LABEL_DEFAULTS[key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const entry = values[name];
    return entry === undefined ? whole : String(entry);
  });
}

/** Whether one record meets a plain-data match. */
export function matchValue(match: ValueMatch, entity: Entity): boolean {
  const value = entity[match.field];
  switch (match.op) {
    case "eq":
      return sameValue(value, match.value as Value);
    case "ne":
      return !sameValue(value, match.value as Value);
    case "lt":
      return compare(value, match.value as Value) === -1;
    case "lte": {
      const order = compare(value, match.value as Value);
      return order === -1 || order === 0;
    }
    case "gt":
      return compare(value, match.value as Value) === 1;
    case "gte": {
      const order = compare(value, match.value as Value);
      return order === 1 || order === 0;
    }
    case "in":
      return Array.isArray(match.value) && match.value.some((entry) => sameValue(value, entry));
    case "between": {
      if (!Array.isArray(match.value) || match.value.length !== 2) return false;
      const low = compare(value, match.value[0]!);
      const high = compare(value, match.value[1]!);
      return low !== undefined && high !== undefined && low >= 0 && high <= 0;
    }
    case "contains":
      return value !== null && value !== undefined && String(value).toLowerCase().includes(String(match.value).toLowerCase());
    case "empty":
      return value === null || value === undefined || value === "";
    case "notEmpty":
      return !(value === null || value === undefined || value === "");
  }
}

/** Numbers and numeric text compare numerically, so a YAML threshold meets a Decimal string. */
function numericValue(value: Value | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Plain decimal text exact; any other numeric text as the double it parses to. */
type NumericKey = { readonly kind: "double"; readonly value: number }
  | { readonly kind: "exact"; readonly sign: "" | "-"; readonly integer: string; readonly fraction: string };

function numericKey(value: Value | undefined): NumericKey | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? { kind: "double", value } : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "") return undefined;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? { kind: "double", value: parsed } : undefined;
  }
  const body = text.replace(/^[+-]/, "");
  const [integer, fraction = ""] = body.split(".");
  return { kind: "exact", sign: text.startsWith("-") ? "-" : "", integer: integer || "0", fraction };
}

/** Exact decimal order: digits compared as integers, never through a double. */
function exactCompare(a: { readonly sign: "" | "-"; readonly integer: string; readonly fraction: string },
  b: { readonly sign: "" | "-"; readonly integer: string; readonly fraction: string }): -1 | 0 | 1 {
  if (a.sign !== b.sign) return a.sign === "-" ? -1 : 1;
  const length = Math.max(a.fraction.length, b.fraction.length);
  const scale = 10n ** BigInt(length);
  const left = BigInt(a.integer) * scale + BigInt(a.fraction.padEnd(length, "0") || "0");
  const right = BigInt(b.integer) * scale + BigInt(b.fraction.padEnd(length, "0") || "0");
  if (a.sign === "-") return left < right ? 1 : left > right ? -1 : 0;
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameValue(left: Value | undefined, right: Value | undefined): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  const a = numericKey(left);
  const b = numericKey(right);
  if (a && b) {
    if (a.kind === "exact" && b.kind === "exact") return exactCompare(a, b) === 0;
    // A double on either side keeps floating-point semantics, like a Decimal string against a JS number.
    const x = numericValue(left);
    const y = numericValue(right);
    return x !== undefined && y !== undefined && x === y;
  }
  return (typeof left === "string" || typeof left === "number") && (typeof right === "string" || typeof right === "number") && String(left) === String(right);
}

function compare(left: Value | undefined, right: Value | undefined): -1 | 0 | 1 | undefined {
  const a = numericKey(left);
  const b = numericKey(right);
  if (a && b) {
    if (a.kind === "exact" && b.kind === "exact") return exactCompare(a, b);
    const x = numericValue(left);
    const y = numericValue(right);
    if (x !== undefined && y !== undefined) return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeFamily(left) !== typeFamily(right) || typeFamily(left) === "other") {
    return sameValue(left, right) ? 0 : undefined;
  }
  const x = typeof left === "number" ? left : String(left);
  const y = typeof right === "number" ? right : String(right);
  return x < y ? -1 : x > y ? 1 : 0;
}

function typeFamily(value: Value | undefined): "number" | "string" | "boolean" | "null" | "other" {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "number":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    default:
      return "other";
  }
}

/** A rule matches when every present condition matches; no condition matches. */
function ruleMatches(when: ValueMatch | undefined, test: (() => boolean) | undefined, entity: Entity): boolean {
  return (when === undefined || matchValue(when, entity)) && (test === undefined || test());
}

function classList(value: ClassNames | undefined, into: string[]): void {
  if (value === undefined) return;
  for (const name of typeof value === "string" ? value.split(/\s+/) : value) if (name) into.push(name);
}

function classEntries<C extends RowStyleContext | CellStyleContext>(
  hook: ClassNames | readonly (RowClassRule | CellClassRule | string | ((context: C) => ClassNames | undefined))[] | ((context: C) => ClassNames | undefined) | undefined,
  context: C,
  entity: Entity,
): string[] {
  const out: string[] = [];
  if (hook === undefined) return out;
  if (typeof hook === "function") {
    classList(hook(context), out);
    return out;
  }
  if (typeof hook === "string") {
    classList(hook, out);
    return out;
  }
  for (const entry of hook) {
    if (typeof entry === "string") {
      classList(entry, out);
      continue;
    }
    if (typeof entry === "function") {
      classList((entry as (argument: C) => ClassNames | undefined)(context), out);
      continue;
    }
    const rule = entry as RowClassRule | CellClassRule;
    const test = rule.test ? () => (rule.test as (argument: C) => boolean)(context) : undefined;
    if (ruleMatches(rule.when, test, entity)) classList(rule.class, out);
  }
  return out;
}

function hiliteMatches(hilite: Hilite, entity: Entity): boolean {
  const field = hilite.when?.field ?? hilite.field;
  const value = field === undefined ? undefined : entity[field];
  const test = hilite.test ? () => hilite.test!(entity, value) : undefined;
  return ruleMatches(hilite.when, test, entity);
}

/**
 * Classes and tone for one record row: the row hook first, then row-scoped
 * hilites in declared order. The last hilite with a tone wins.
 */
export function styleRow(presentation: GridPresentation, context: RowStyleContext): StyleDecoration {
  const classes = classEntries(presentation.rowClass, context, context.entity);
  let tone: PresentationTone | undefined;
  for (const hilite of presentation.hilites ?? []) {
    if ((hilite.scope ?? "row") !== "row") continue;
    if (!hiliteMatches(hilite, context.entity)) continue;
    classList(hilite.class, classes);
    if (hilite.tone !== undefined) tone = hilite.tone;
  }
  return { classes: dedupe(classes), ...(tone ? { tone } : {}) };
}

/**
 * Classes and tone for one record cell: the grid cell hook, then the column
 * hook, then a value-map entry, then cell-scoped hilites in declared order.
 * The last tone wins.
 */
export function styleCell(presentation: GridPresentation, column: ColumnPresentation | undefined, context: CellStyleContext, mapped?: MappedValue): StyleDecoration {
  const classes = [
    ...classEntries(presentation.cellClass, context, context.entity),
    ...classEntries(column?.cellClass, context, context.entity),
  ];
  let tone: PresentationTone | undefined;
  if (mapped?.class !== undefined) classList(mapped.class, classes);
  if (mapped?.tone !== undefined) tone = mapped.tone;
  for (const hilite of presentation.hilites ?? []) {
    if (hilite.scope !== "cell" || hilite.field !== context.field) continue;
    if (!hiliteMatches(hilite, context.entity)) continue;
    classList(hilite.class, classes);
    if (hilite.tone !== undefined) tone = hilite.tone;
  }
  return { classes: dedupe(classes), ...(tone ? { tone } : {}) };
}

function dedupe(classes: readonly string[]): string[] {
  return [...new Set(classes)];
}

/**
 * A value-map entry for a raw value, keyed by `String(value)`. `undefined`
 * means the map has no entry: metadata allowed values and default formatting
 * still apply.
 */
export function mappedValue(column: ColumnPresentation | undefined, value: Value | undefined): MappedValue | undefined {
  if (!column?.valueMap || value === undefined) return undefined;
  const key = String(value);
  // Only own entries map; names like "constructor" must not read the prototype.
  if (!Object.hasOwn(column.valueMap, key)) return undefined;
  const entry = column.valueMap[key];
  if (entry === undefined) return undefined;
  return typeof entry === "string"
    ? { label: entry }
    : { label: entry.label, ...(entry.tone !== undefined ? { tone: entry.tone } : {}), ...(entry.class !== undefined ? { class: entry.class } : {}) };
}

/**
 * The text a value shows when no renderer, formatter or value-map entry
 * applies. A date or number format overrides the matching type's default;
 * everything else is [[staticMethod:formatValue]]'s text.
 */
export function cellText(field: Field | undefined, value: Value | undefined, format?: ColumnFormat): string {
  if (value === null || value === undefined) return "";
  if (format?.kind === "date" && field?.type === "Edm.Date" && typeof value === "string") return formatDate(value, format.style);
  if (format?.kind === "number" && NUMERIC.has(field?.type ?? "") && (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))))) {
    // Int64 and Decimal text formats exactly; a double would drop digits.
    if ((field?.type === "Edm.Int64" || field?.type === "Edm.Decimal") && typeof value === "string") return exactNumberText(value, format);
    return numberText(Number(value), format);
  }
  if (field?.type === "Edm.Boolean") return value ? "Yes" : "";
  if (field?.type === "Edm.Date" && typeof value === "string") return formatDate(value);
  if (field?.type === "Edm.DateTimeOffset" && typeof value === "string") return absoluteTime(value);
  return formatValue(field, value);
}

function numberText(value: number, format: Extract<ColumnFormat, { kind: "number" }>): string {
  const key = JSON.stringify(format);
  let writer = NUMBER_FORMATS.get(key);
  if (!writer) {
    const style = format.style ?? "decimal";
    const options: Intl.NumberFormatOptions = {};
    if (style === "percent") options.style = "percent";
    else if (style === "currency") {
      options.style = "currency";
      options.currency = format.currency ?? "GBP";
    } else if (style === "integer") options.maximumFractionDigits = 0;
    if (format.minimumFractionDigits !== undefined) options.minimumFractionDigits = format.minimumFractionDigits;
    if (format.maximumFractionDigits !== undefined) options.maximumFractionDigits = format.maximumFractionDigits;
    writer = new Intl.NumberFormat("en-GB", options);
    NUMBER_FORMATS.set(key, writer);
  }
  return writer.format(value);
}

const EXACT_GROUPER = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const EXACT_MINUS = new Intl.NumberFormat("en-GB").formatToParts(-1).find((p) => p.type === "minusSign")?.value ?? "-";
const EXACT_POINT = new Intl.NumberFormat("en-GB").formatToParts(1.1).find((p) => p.type === "decimal")?.value ?? ".";
const EXACT_LAYOUTS = new Map<string, readonly Intl.NumberFormatPart[]>();

/** The fraction bounds Intl resolves for the same options the renderer builds. */
function exactFractionBounds(format: Extract<ColumnFormat, { kind: "number" }>): { min: number; max: number } {
  const style = format.style ?? "decimal";
  const options: Intl.NumberFormatOptions = {};
  if (style === "percent") options.style = "percent";
  else if (style === "currency") { options.style = "currency"; options.currency = format.currency ?? "GBP"; }
  else if (style === "integer") options.maximumFractionDigits = 0;
  if (format.minimumFractionDigits !== undefined) options.minimumFractionDigits = format.minimumFractionDigits;
  if (format.maximumFractionDigits !== undefined) options.maximumFractionDigits = format.maximumFractionDigits;
  const resolved = new Intl.NumberFormat("en-GB", options).resolvedOptions();
  return { min: resolved.minimumFractionDigits ?? 0, max: resolved.maximumFractionDigits ?? 0 };
}

/** Rounds magnitude digits half away from zero, as Intl does, without a double in between. */
function roundMagnitude(integer: string, fraction: string, max: number): { integer: string; fraction: string } {
  if (fraction.length > max) {
    const kept = fraction.slice(0, max);
    const carried = fraction[max]! >= "5" ? incrementDigits(integer + kept) : integer + kept;
    if (carried.length > integer.length + kept.length) {
      // A carry that grows the digits moves the point left: the new leading
      // digit belongs to the integer and every kept fraction digit became zero.
      return { integer: carried.slice(0, carried.length - max), fraction: "0".repeat(max) };
    }
    // Otherwise the point sits after the original integer part.
    return { integer: carried.slice(0, integer.length), fraction: carried.slice(integer.length) };
  }
  return { integer, fraction };
}

function incrementDigits(digits: string): string {
  const out = digits.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== "9") { out[i] = String(Number(out[i]) + 1); return out.join(""); }
    out[i] = "0";
  }
  return `1${out.join("")}`;
}

/** Percent style scales by 100, like Intl's percent does. */
function scalePercent(body: string): string {
  const [integer, fraction = ""] = body.split(".");
  const shifted = fraction.padEnd(2, "0");
  const whole = `${integer}${shifted.slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  const rest = shifted.slice(2);
  return rest ? `${whole}.${rest}` : whole;
}

/** Formats plain decimal text exactly: Int64 and Decimal strings keep every digit. */
function exactNumberText(value: string, format: Extract<ColumnFormat, { kind: "number" }>): string {
  const text = value.trim();
  const negative = text.startsWith("-");
  const body = text.replace(/^[+-]/, "");
  // Exponent or odd text keeps the double path's behaviour.
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(body)) return numberText(Number(text), format);
  const { min, max } = exactFractionBounds(format);
  const scaled = format.style === "percent" ? scalePercent(body) : body;
  const parts = scaled.split(".");
  // A leading "." is the same magnitude as a leading "0.".
  const integerRaw = parts[0] || "0";
  const fractionRaw = parts[1] ?? "";
  const rounded = roundMagnitude(integerRaw, fractionRaw, max);
  const integer = rounded.integer || "0";
  let fraction = rounded.fraction.padEnd(min, "0");
  while (fraction.length > min && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const grouped = EXACT_GROUPER.format(BigInt(integer));
  const layout = makeExactLayout(format, min, max);
  let out = "";
  for (const part of layout) {
    if (part.type === "integer") {
      out += grouped;
      if (fraction && !layout.some((p) => p.type === "fraction")) out += EXACT_POINT + fraction;
      continue;
    }
    if (part.type === "fraction") { out += fraction; continue; }
    out += part.value;
  }
  return negative ? EXACT_MINUS + out : out;
}

/** The skeleton Intl builds for a format; exact digits replace its number parts. */
function makeExactLayout(format: Extract<ColumnFormat, { kind: "number" }>, min: number, max: number): readonly Intl.NumberFormatPart[] {
  const key = JSON.stringify(format);
  const cached = EXACT_LAYOUTS.get(key);
  if (cached) return cached;
  const style = format.style ?? "decimal";
  const options: Intl.NumberFormatOptions = { minimumFractionDigits: min, maximumFractionDigits: max };
  if (style === "percent") options.style = "percent";
  else if (style === "currency") { options.style = "currency"; options.currency = format.currency ?? "GBP"; }
  const parts = new Intl.NumberFormat("en-GB", options).formatToParts(0);
  EXACT_LAYOUTS.set(key, parts);
  return parts;
}
