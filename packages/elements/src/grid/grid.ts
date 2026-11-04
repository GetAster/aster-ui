import { computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import {
  isRelative,
  progressPolicy,
  type ProgressPolicy,
  FilterDraft,
  filterOperators as metadataOperators,
  describeCriteria,
  exportCsv,
  type CsvOptions,
  type Aggregate,
  type Summary,
  selectionPublication,
  EditModel,
  editPublication,
  keyText,
  Tree,
  type Collection,
  type CollectionOptions,
  type Selection,
  type Query,
  type FilterMode,
  type FilterNode,
  type TreeRow,
  type FieldRules,
  type Criteria,
  type DataContext,
  type Entity,
  type Field,
  type Grouping,
  type GroupingHeader,
  type Groups,
  type KeyText,
  type Value,
} from "@getaster/data";
import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { styleMap } from "lit-html/directives/style-map.js";
import { AsterElement, define, each, scopeOf, uid, type View } from "../base/element.ts";
import { holds, pressDrag } from "../base/drag.ts";
import { formatValue } from "../field/values.ts";
import { controlFor } from "../form/controls.ts";
import { announce } from "../toast/toast.ts";
import { PickerOptions } from "../picker/picker.ts";
import { CalendarState, calendarView, closeOutside } from "../date/calendar.ts";
import { formatDate, today } from "../date/dates.ts";
import { absoluteTime } from "../format.ts";
import { anchorStyle, openWhen, placeStyle } from "../overlay/anchor.ts";
import type { Menu, MenuItem } from "../menu/menu.ts";
import "../menu/menu.ts";
import "../progress/status.ts";
import "../select/choice-element.ts";
import "../filter/filter-builder.ts";
import type { Dialog } from "../dialog/dialog.ts";
import "../dialog/dialog.ts";
import type { Option } from "../select/choice.ts";
import { containsText, parseRange, rangeText, withDate } from "./filters.ts";
import { RowHeights } from "./rows.ts";
import {
  defaultView,
  effectiveColumns,
  effectiveFrozen,
  effectiveGroups,
  groupFields,
  freezeThrough,
  isNumeric,
  loadViews,
  moveColumn,
  naturalWidth,
  nudgeColumn,
  reconcile,
  removeSort,
  setFilter,
  setGroup,
  setHidden,
  setWidth,
  sortBy,
  sortDirection,
  storeViews,
  track,
  viewQuery,
  viewRefusals,
  criteriaFields,
  type GridColumn,
  type GridView,
  type SavedViews,
  type ViewCapabilities,
  type ViewRefusal,
} from "./view.ts";
import { policyPermits, type Capability, type CapabilityValue, type FieldPolicy, type GridPolicy } from "./policy.ts";
import {
  cellText,
  labelText,
  mappedValue,
  styleCell,
  styleRow,
  validateGridLabels,
  validateGridPresentation,
  type GridLabel,
  type GridLabels,
  type GridPresentation,
  type MappedValue,
} from "./appearance.ts";
import { filterOperatorLabel } from "../rule/operators.ts";
import {
  editMode as featureEditMode,
  multiSort as featureMultiSort,
  paged as featurePaged,
  selectionAppearance as featureSelectionAppearance,
  selectionColumn as featureSelectionColumn,
  validateFeatures,
  withFeature,
  withoutFeature,
  type GridFeature,
} from "./features.ts";
export type { GridFeature } from "./features.ts";

/** Renders a cell's content; `entity` is the row's record. */
export type CellRenderer = (entity: Entity, key: KeyText) => View;
/** Text presentation of a typed value. Queries and exports retain the underlying value. */
export type CellFormatter = (value: Value | undefined, entity: Entity, field: Field | undefined) => string;
/** Where a non-focus scroll puts the requested row or cell. */
export type GridScrollAlign = "start" | "center" | "end" | "nearest";

/** How a column shows a foreign key: the related set and the field to show. */
export interface Lookup {
  readonly set: string;
  readonly display: string;
}

/** An exact total over the grid query; count needs no field. */
export type GridSummary =
  | { readonly method: "count"; readonly label?: string }
  | { readonly method: Aggregate["method"]; readonly field: string; readonly label?: string };

/** Export visible metadata columns, in view order. */
export interface GridCsvOptions extends Omit<CsvOptions, "keys"> {
  /** All filtered results by default, or shared selection in pick order. */
  readonly scope?: "query" | "selection";
}

/** Which grid chrome is shown. Every option preserves today's full grid by default. */
export interface GridChrome {
  /** The toolbar above the table. Default `true`; hide it with `showToolbar`. */
  readonly toolbar?: boolean;
  /** The column header row. Default `true`. When hidden it stays in the accessibility tree. */
  readonly header?: boolean;
  /** The filter row: `"auto"` (default) follows the view and the Filters button; `true` forces it open; `false` removes it. */
  readonly filterRow?: "auto" | boolean;
  /** The per-header menu button. Default `true`; `false` removes it and the header's keyboard menu. */
  readonly headerMenu?: boolean;
  /** The paging bar. Default `true`; shown only when a `page` feature is configured. */
  readonly pagingBar?: boolean;
}

/** Which controls the toolbar shows. Every option defaults to `true`. */
export interface GridToolbar {
  /** The row count. Default `true`. */
  readonly count?: boolean;
  /** The Sort panel button. Default `true`. */
  readonly sort?: boolean;
  /** The filter-row toggle. Default `true`; hidden when `chrome.filterRow` is false. */
  readonly filters?: boolean;
  /** The advanced filter button. Default `true`. */
  readonly advanced?: boolean;
  /** The Columns panel button. Default `true`. */
  readonly columns?: boolean;
  /** The Views panel button, when `persist` is set. Default `true`. */
  readonly views?: boolean;
  /** Expand all / Collapse all in a tree grid. Default `true`. */
  readonly expandAll?: boolean;
  /** A host view placed at the end of the toolbar, after the built-in controls. */
  readonly extra?: View;
}

type Panel = "sort" | "columns" | "views";

/** A row as row controls and expansion content see it; read inside a render, it updates them. */
export interface RowState {
  readonly key: KeyText;
  readonly entity: Entity;
  readonly expanded: boolean;
  readonly editable: boolean;
}

/** A button of a row's floating controls. */
export interface RowControl {
  readonly label: string;
  readonly icon: View;
  readonly run: () => void;
}

/**
 * The content a row expands into. Its state outlives the DOM: scrolled out
 * of view and back, it's the same editor. `dirty`, `save` and `discard` let
 * the grid ask before closing over unsaved changes.
 */
export interface ExpansionEditor {
  readonly view: View;
  readonly dirty?: ReadonlySignal<boolean>;
  save?(): Promise<boolean>;
  discard?(): void;
  dispose?(): void;
}

export interface Expansion {
  content(row: RowState): ExpansionEditor;
  /** Whether a record may expand; all may by default. */
  canExpand?(entity: Entity): boolean;
  /** Expanding a row closes the one already open. */
  single?: boolean;
  /** At most this many open at once; another is refused with a message. */
  limit?: number;
  /** The record's name in messages ("task"). */
  noun?: string;
}

/** Makes the grid a tree grid over a self-referencing set. */
export interface GridTree {
  /** The field holding a record's parent key. */
  readonly parentField: string;
  /** The parent value of top-level records; null by default. */
  readonly rootValue?: Value;
  /** `keepAncestors` (the default) shows a filter's matches with the paths to them. */
  readonly filterMode?: FilterMode;
  /** Rows can be dragged onto another row to move under it, or onto the header to the top level; a touch or pen holds a row still to lift it. */
  readonly draggable?: boolean;
  /** Whether a drop may change a row's parent. Default `true`; `false` leaves only a no-op drop. */
  readonly reparent?: boolean;
  /** Whether a row may be dropped on a leaf. Default `true`; `false` accepts folders and the top level. */
  readonly dropOnLeaves?: boolean;
  /** Levels opened when the tree first loads, below the top level. Default `0`; bounded by `openLimit`. */
  readonly autoOpen?: number;
  /** Openers in the first column. Default `true`. */
  readonly showOpener?: boolean;
  /** A template before a folder's title, when it has children. */
  readonly folderIcon?: View;
  /** A template before a leaf's title. */
  readonly nodeIcon?: View;
  /** Selecting a row applies to its loaded descendants too. Needs a multiple shared Selection. Default `false`. */
  readonly cascadeSelection?: boolean;
  /** Rows per level load. Default the data core's 100. */
  readonly pageSize?: number;
  /** Matches beyond this make keep-ancestors give up. Default the data core's 8000. */
  readonly matchLimit?: number;
  /** Folders opened at most to show where matches are; also bounds Expand all. Default 200. */
  readonly openLimit?: number;
}

/** A line of the grid: a group's header, or a record (not loaded yet when `key` is undefined). */
type Item =
  | GroupingHeader
  | {
      readonly kind: "row";
      readonly key: KeyText | undefined;
      readonly collection: Collection | undefined;
      readonly local: number;
      readonly parent?: string;
      readonly level?: number;
      readonly position?: number;
      readonly siblings?: number;
      /** In a tree grid: the node's level, place among its siblings, and folder state. */
      readonly node?: TreeRow;
    };

/** What the virtualizer lays out: a key per line, and the line itself on demand. */
interface Layout {
  readonly keys: readonly (string | undefined)[];
  /** Records the lines stand for; `undefined` until known. */
  readonly total: number | undefined;
  /** Without a server count: at least this many records, and more may follow. */
  readonly atLeast?: number;
  /** `total` is the server's estimate, not a count. */
  readonly estimate?: boolean;
  /** The absolute position of line 0, when the grid shows one page at a time. */
  readonly first?: number;
  readonly groups: number | undefined;
  at(index: number): Item;
}

const OVERSCAN = 400;
/** The leading selection column's track, kept in step with the stylesheet. */
const SELECT_WIDTH = 44;

/** A count that isn't exact: an estimate, or an uncounted collection's, which includes a page that may not exist. */
const atLeast = (c: Collection): { atLeast?: number; estimate?: boolean } =>
  c.count.value === undefined || c.counted.value ? {}
  : c.estimated.value ? { estimate: true }
  : { atLeast: Math.max(0, c.count.value - c.pageSize) };
const FILTER_DELAY = 300;

/** An estimate to two significant figures: its last digits aren't known. */
function roughly(n: number): number {
  if (n < 100) return n;
  const step = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / step) * step;
}
/** Active-cell rows above the records: the header row, and the filter row when shown. */
const HEADER = -2;
const FILTER_ROW = -1;

/**
 * A virtualized grid over an entity set, shaped by a view the person can
 * change: sort, filter, hide, reorder, resize, freeze; their view is kept
 * per browser with `persist`, and named views can be saved.
 *
 * Layout is CSS: the columns are one `grid-template-columns`, each row is a
 * subgrid, the header and frozen columns are sticky. JS keeps only the rows
 * near the viewport in the DOM (spacers stand for the rest), measures row
 * heights with a ResizeObserver, and writes column tracks as a variable.
 *
 * The collection's query follows the view; rows load by page as they come
 * into view, and ones not loaded yet show as placeholders. Focus is on the
 * grid; its active cell is `aria-activedescendant`. Shared picks are separate
 * from focus; an owned grid without shared selection chooses the active row.
 */
export class Grid extends AsterElement {
  readonly #filterDraft = signal<FilterDraft | undefined>(undefined);
  readonly #filterBusy = signal(false);
  readonly #filterNote = signal("");
  #filterGeneration = 0;
  #filterOpener: HTMLElement | null = null;
  #filterSnapshot = "";
  #filterOwner: DataContext | undefined;
  #filterShow = false;
  readonly #criteriaCheck = computed(() => {
    const criteria = this.#view.value?.criteria;
    const ctx = this.#ctx.value;
    if (!criteria || !ctx || !this.set) return undefined;
    try { return new FilterDraft(ctx.schema, this.set, criteria).result.value; }
    catch { return { valid: false, criteria: undefined, problems: [{ id: "", message: "This saved expression cannot be read. Clear it or restore a valid expression." }] }; }
  });
  readonly #ctx = this.prop<DataContext | undefined>(undefined);
  readonly #set = this.prop("");
  readonly #binding = this.prop<Collection | undefined>(undefined);
  readonly #selection = this.prop<Selection | undefined>(undefined);
  readonly #policy = this.prop<GridPolicy>({});
  readonly #features = this.prop<readonly GridFeature[]>([]);
  /** Bumped on a policy change, so effects that rebuild the query follow it. */
  readonly #capabilitiesVersion = signal(0);
  readonly #driftDismissed = signal("");
  #ownsCollection = false;
  #bound: Collection | undefined;
  #boundQuery: Query | undefined;
  #boundBase: Criteria | undefined;
  #selectionAnchor: { key: KeyText; index: number; query: Query } | undefined;
  readonly #selectionNote = signal("");
  readonly #selectionInside = signal<KeyText | undefined>(undefined);
  readonly #activeKey = signal<KeyText | undefined>(undefined);
  readonly #groupFocus = signal<{ id: string; path: readonly Value[] } | undefined>(undefined);
  #focusRequest = 0;
  #scrollRequest = 0;
  #viewRequest = 0;
  readonly #pendingFocus = signal<number | undefined>(undefined);
  #focusBefore: Element | null = null;
  #groupToolFocus: { field: string | undefined; action: string } | undefined;
  readonly #base = this.prop<Criteria | undefined>(undefined);
  readonly #view = this.prop<GridView | undefined>(undefined);
  /** Entries the current view keeps but the derived query leaves out. */
  readonly #drift = computed((): readonly (ViewRefusal & { readonly reason: string })[] => {
    const view = this.#view.value;
    if (!view) return [];
    const seen = new Set<string>();
    const out: (ViewRefusal & { readonly reason: string })[] = [];
    for (const entry of viewRefusals(view, this.#capabilities())) {
      const id = `${entry.kind}:${entry.field}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const reason = this.#refusalReason(entry);
      out.push({ ...entry, reason: reason ?? labelText(this.#labels.value, "driftFallbackReason", { field: this.#title(entry.field) }) });
    }
    return out;
  });
  readonly #label = this.prop("");
  readonly #publish = this.prop("");
  readonly #persist = this.prop("");
  readonly #renderers = this.prop<Readonly<Record<string, CellRenderer>>>({});
  readonly #formatters = this.prop<Readonly<Record<string, CellFormatter>>>({});
  readonly #presentation = this.prop<GridPresentation>({});
  readonly #labels = this.prop<GridLabels>({});
  readonly #lookups = this.prop<Readonly<Record<string, Lookup>>>({});
  readonly #summaries = this.prop<readonly GridSummary[]>([]);
  readonly #progressPolicy = this.prop<ProgressPolicy>({});
  #summary: Summary | undefined;
  #summaryConfig: readonly GridSummary[] | undefined;
  #summaryCollection: Collection | undefined;
  #summaryContext: DataContext | undefined;
  readonly #empty = this.prop<View>(nothing);
  readonly #loading = this.prop<View>(nothing);
  readonly #loadingMessage = this.prop("Loading…");
  readonly #errorView = this.prop<((error: unknown, retry: () => void) => View) | undefined>(undefined);
  readonly #autoFetch = this.prop(true);
  readonly #pageSize = this.prop(100);
  readonly #keepPages = this.prop<number | undefined>(undefined);
  readonly #exactCount = this.prop(false);
  /** The page shown in paged mode, zero-based. */
  readonly #page = signal(0);
  /** Set by refresh() or the first interaction; autoFetch false waits for it. */
  readonly #demand = signal(false);
  readonly #chrome = this.prop<GridChrome>({});
  readonly #toolbarOptions = this.prop<GridToolbar>({});
  readonly #treeOptions = this.prop<GridTree | undefined>(undefined);
  readonly #rowControls = this.prop<((row: RowState) => readonly RowControl[]) | undefined>(undefined);
  readonly #expansion = this.prop<Expansion | undefined>(undefined);
  /** Expanded records' keys, in the order they opened (not group headers). */
  readonly #open = signal<readonly KeyText[]>([]);
  readonly #editors = new Map<KeyText, ExpansionEditor>();
  /** The expanded row being asked about unsaved changes. */
  readonly #asking = signal<KeyText | undefined>(undefined);
  #tree: Tree | undefined;
  /** The filter cell whose calendar is open. */
  readonly #filterCalendar = new CalendarState();
  readonly #filterCalendarField = this.prop<string | undefined>(undefined);
  readonly #rowMenu = this.prop<(entity: Entity, key: KeyText) => readonly MenuItem[]>(() => []);
  readonly #columnMenu = this.prop<(field: string) => readonly MenuItem[]>(() => []);
  readonly #filterOperators = this.prop<Readonly<Record<string, readonly string[]>>>({});
  readonly #rules = this.prop<Readonly<Record<string, FieldRules>>>({});
  readonly #editing = signal<{ readonly key: KeyText; readonly field: string; readonly column: number; readonly edit: EditModel; readonly stop: () => void } | undefined>(undefined);

  readonly #id = uid("aster-grid");
  readonly #heights = new RowHeights(37);
  readonly #version = signal(0);
  readonly #top = signal(0);
  readonly #viewport = signal(600);
  readonly #active = signal({ row: 0, col: 0 });
  readonly #panel = signal<Panel | undefined>(undefined);
  readonly #showFilters = signal(false);
  readonly #filterText = signal<Readonly<Record<string, string>>>({});
  readonly #filterErrors = signal<Readonly<Record<string, string>>>({});
  readonly #saved = signal<SavedViews>({ named: {} });
  #offered: GridView | undefined;
  #collection: Collection | undefined;
  readonly #selected = signal<KeyText | undefined>(undefined);
  /** The row a touch or pen is dragging, drawn lifted. */
  readonly #lifted = signal<KeyText | undefined>(undefined);
  #grouping: Grouping | undefined;
  readonly #options = new Map<string, PickerOptions>();
  #observer: ResizeObserver | undefined;
  /** The scroll box the observer watches, and its width when last measured. */
  #scrollBox: HTMLElement | undefined;
  #scrollWidth = 0;
  /** The rows the observer watches. A removed row must go: it would report 0×0 out of the document. */
  readonly #observedRows = new Set<HTMLElement>();
  readonly #filterTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #anchor: { index: number; delta: number } | undefined;
  #pendingSizes: ResizeObserverEntry[] = [];
  #sizeFrame = 0;

  get ctx(): DataContext | undefined {
    return this.#ctx.value;
  }
  set ctx(v: DataContext | undefined) {
    this.#ctx.value = v;
  }
  /** The entity set the grid shows. */
  get set(): string {
    return this.#binding.value?.query.set ?? this.#selection.value?.collection.query.set ?? this.#set.value;
  }
  set set(v: string) {
    this.#set.value = v;
  }
  /** Criteria every row meets, beneath the view's own filters. */
  get base(): Criteria | undefined {
    return this.#base.value;
  }
  set base(v: Criteria | undefined) {
    this.#base.value = v;
  }
  /** The view in use. Set by the page, it's also what Reset goes back to. */
  get view(): GridView | undefined {
    return this.#view.value;
  }
  set view(v: GridView | undefined) {
    if (groupFields(v).length && this.#external()) throw new Error("A shared collection grid supports flat rows; grouping uses an owned collection");
    for (const column of v?.columns ?? []) if (column.sortField !== undefined && (typeof column.sortField !== "string" || !column.sortField.trim())) throw new TypeError("Column sortField must be a nonempty server field path");
    this.#offered ??= v;
    this.#viewRequest++;
    this.#view.value = v;
  }
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /** The page-scope key for the view and selection. */
  get publish(): string {
    return this.#publish.value;
  }
  set publish(v: string) {
    this.#publish.value = v;
  }
  /** Keeps the person's views in this browser under this name. */
  get persist(): string {
    return this.#persist.value;
  }
  set persist(v: string) {
    this.#persist.value = v;
  }
  /** Cell content by field, where the default formatting isn't enough. */
  get renderers(): Readonly<Record<string, CellRenderer>> {
    return this.#renderers.value;
  }
  set renderers(v: Readonly<Record<string, CellRenderer>>) {
    this.#renderers.value = v;
  }
  /** Text-only display formatting by field; never changes server sorting or filtering. */
  get formatters(): Readonly<Record<string, CellFormatter>> { return this.#formatters.value; }
  set formatters(value: Readonly<Record<string, CellFormatter>>) { this.#formatters.value = value; }
  /**
   * Declarative presentation: per-column titles, alignment, value maps and
   * formats, row and cell classes, and hilites. Default `{}`, which keeps
   * today's rendering. Renderers and formatters (JavaScript) outrank these
   * plain-data display overrides for cell content.
   */
  get presentation(): GridPresentation { return this.#presentation.value; }
  set presentation(value: GridPresentation) {
    validateGridPresentation(value, true);
    this.#presentation.value = { ...value };
  }
  /**
   * The grid's overridable strings. Every entry is optional; a missing entry
   * keeps today's text, and `{name}` placeholders are filled by the grid.
   * A stopgap before full i18n, not an i18n engine.
   */
  get labels(): GridLabels { return this.#labels.value; }
  set labels(value: GridLabels) {
    validateGridLabels(value);
    this.#labels.value = { ...value };
  }
  /** Exact overall totals and, when grouped, totals on each group header. */
  get summaries(): readonly GridSummary[] { return this.#summaries.value; }
  set summaries(value: readonly GridSummary[]) {
    if (value.length && this.#treeOptions.peek()) throw new Error("Tree summaries require an explicit query through the data summary API");
    this.#summaries.value = value.map((item) => ({ ...item }));
  }

  /** Fresh server values; custom DOM renderers and lookup labels are not exported. */
  async exportCsv(options: GridCsvOptions = {}): Promise<string> {
    const ctx = this.#ctx.peek();
    const collection = this.#collection;
    const view = this.#view.peek();
    if (!ctx || !collection || !view) throw new Error("Connect a grid before exporting");
    if (this.#tree) throw new Error("Tree export requires an explicit query through the data export API");
    if (this.#editing.peek()?.edit.dirty.value) throw new Error("Finish editing before exporting");
    const { scope = "query", ...csv } = options;
    if (scope !== "query" && scope !== "selection") throw new Error("Unknown export scope");
    const selection = this.#selection.peek();
    if (scope === "selection" && !selection) throw new Error("Selection export requires a shared Selection");
    const columns = this.#visibleColumns(view).map((c) => ({ field: c.field }));
    return exportCsv(ctx, collection.query, columns, { ...csv, ...(scope === "selection" ? { keys: selection!.keys.peek() } : {}) });
  }

  /** Foreign keys shown by a related record's field, by column. */
  get lookups(): Readonly<Record<string, Lookup>> {
    return this.#lookups.value;
  }
  set lookups(v: Readonly<Record<string, Lookup>>) {
    this.#lookups.value = v;
  }
  /** The page's actions for a row, shown first in its menu (right-click, Shift+F10, the Menu key). */
  get rowMenu(): (entity: Entity, key: KeyText) => readonly MenuItem[] {
    return this.#rowMenu.value;
  }
  set rowMenu(v: (entity: Entity, key: KeyText) => readonly MenuItem[]) {
    this.#rowMenu.value = v;
  }
  /**
   * The page's actions for a column, shown first in its menu. Read each time
   * a menu opens. Default: no items.
   */
  get columnMenu(): (field: string) => readonly MenuItem[] {
    return this.#columnMenu.value;
  }
  set columnMenu(v: (field: string) => readonly MenuItem[]) {
    this.#columnMenu.value = v;
  }
  /**
   * Per-field operator allowlists for filtering, by column field. Each entry
   * narrows the operators the metadata offers; it can never add one. Default
   * `{}`: the metadata's operators.
   */
  get filterOperators(): Readonly<Record<string, readonly string[]>> {
    return this.#filterOperators.value;
  }
  set filterOperators(v: Readonly<Record<string, readonly string[]>>) {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new TypeError("filterOperators must be a record of operator lists");
    for (const [field, list] of Object.entries(v)) {
      if (!Array.isArray(list) || list.some((op) => typeof op !== "string" || !op)) throw new TypeError(`filterOperators.${field} must be a list of operators`);
    }
    this.#filterOperators.value = Object.fromEntries(Object.entries(v).map(([field, list]) => [field, [...list]]));
  }
  /**
   * A tree grid: the first column shows each record's level with an opener;
   * levels load as they open; a filter keeps the path to each match. Set it
   * before the grid connects.
   */
  get tree(): GridTree | undefined {
    return this.#treeOptions.value;
  }
  set tree(v: GridTree | undefined) {
    if (v && this.#binding.peek()) throw new Error("A shared collection grid supports flat rows");
    if (v && this.#summaries.peek().length) throw new Error("Tree summaries require an explicit query through the data summary API");
    this.#treeOptions.value = v;
  }
  /** The lazy group hierarchy of an owned grouped grid. */
  get groupingModel(): Grouping | undefined { return this.#grouping; }

  /** The tree model, in a tree grid: open state, reveal, move. */
  get treeModel(): Tree | undefined {
    return this.#tree;
  }
  /**
   * Floating controls for each row, recomputed from its state. They show on
   * hover, on the selected and the active row; Tab reaches them from the
   * grid, ←/→ move between them, Escape goes back.
   */
  get rowControls(): ((row: RowState) => readonly RowControl[]) | undefined {
    return this.#rowControls.value;
  }
  set rowControls(v: ((row: RowState) => readonly RowControl[]) | undefined) {
    this.#rowControls.value = v;
  }
  /** Rows expand in place into content the page supplies (double-click, or `expand`). */
  get expansion(): Expansion | undefined {
    return this.#expansion.value;
  }
  set expansion(v: Expansion | undefined) {
    this.#expansion.value = v;
  }
  /** Keys of the expanded rows, in the order they opened. */
  get expanded(): ReadonlySignal<readonly KeyText[]> {
    return this.#open;
  }

  /**
   * Expands a row and moves focus into its content. Refused (false) for a
   * record that can't expand, or over the limit, which says so.
   */
  expand(key: KeyText): boolean {
    const expansion = this.#expansion.peek();
    const entity = this.#entity(key);
    if (!expansion || !entity || (expansion.canExpand && !expansion.canExpand(entity))) return false;
    const open = this.#open.peek();
    if (open.includes(key)) return true;
    if (expansion.single && open.length) {
      const other = open[0]!;
      if (this.#editors.get(other)?.dirty?.peek()) {
        this.#asking.value = other;
        return false;
      }
      this.#close(other, false);
    } else if (expansion.limit !== undefined && open.length >= expansion.limit) {
      const noun = expansion.noun ?? "row";
      const text = this.#text("expansionLimit", { limit: expansion.limit, noun: expansion.limit === 1 ? noun : `${noun}s` });
      announce(text);
      this.#refused.value = text;
      return false;
    }
    this.#refused.value = undefined;
    this.#editors.set(key, expansion.content(this.#rowState(key, entity, true)));
    this.#open.value = [...this.#open.peek(), key];
    this.#focusExpansion(key);
    return true;
  }

  /**
   * Focus goes to the content's first field, or else its first control, once
   * it has rendered; unless focus has moved to something else meanwhile, as
   * when the content focuses a control itself or the person has clicked. A
   * control that opened the row and was then re-rendered leaves focus on the
   * body, which isn't a move.
   */
  #focusExpansion(key: KeyText, frames = 10, from = document.activeElement): void {
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now !== from && now !== null && now !== document.body) return;
      const content = this.querySelector<HTMLElement>(`.aster-grid-row[data-key="${CSS.escape(key)}"] .aster-grid-expansion`);
      const target =
        content?.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select, [role='combobox']") ??
        (frames === 0 ? content?.querySelector<HTMLElement>("button, [tabindex='0']") : null);
      if (target) target.focus();
      else if (frames > 0) this.#focusExpansion(key, frames - 1, from);
    });
  }

  /**
   * Collapses a row. `ask` (the default) asks first when it has unsaved
   * changes; `discard` drops them on purpose; `save` saves, and stays open
   * if that fails.
   */
  async collapse(key: KeyText, how: "ask" | "discard" | "save" = "ask"): Promise<boolean> {
    const editor = this.#editors.get(key);
    if (!editor) return true;
    if (how === "save") {
      if (editor.save && !(await editor.save())) return false;
    } else if (how === "discard") {
      editor.discard?.();
    } else if (editor.dirty?.peek()) {
      this.#asking.value = key;
      requestAnimationFrame(() => this.querySelector<HTMLElement>(".aster-grid-asking button")?.focus());
      return false;
    }
    this.#close(key, true);
    return true;
  }

  readonly #refused = signal<string | undefined>(undefined);

  #close(key: KeyText, refocus: boolean): void {
    if (this.#asking.peek() === key) this.#asking.value = undefined;
    this.#editors.get(key)?.dispose?.();
    this.#editors.delete(key);
    this.#open.value = this.#open.peek().filter((k) => k !== key);
    if (refocus) {
      requestAnimationFrame(() => {
        const row = this.querySelector<HTMLElement>(`.aster-grid-row[data-key="${CSS.escape(key)}"]`);
        (row?.querySelector<HTMLElement>(".aster-grid-controls button") ?? this.querySelector<HTMLElement>(".aster-grid-scroll"))?.focus();
      });
    }
  }

  #entity(key: KeyText): Entity | undefined {
    const set = this.#collection?.query.set;
    return set ? this.#ctx.peek()?.store.get(set, key)?.entity : undefined;
  }

  #rowState(key: KeyText, entity: Entity, expanded: boolean): RowState {
    return { key, entity, expanded, editable: this.#editEnabled() };
  }

  #selectionAllowed(): boolean {
    return this.#policy.value.selectable ?? true;
  }

  /** Whether selection gets a leading checkbox column. */
  #selectionColumnOn(): boolean {
    return featureSelectionColumn(this.#features.value) && this.#selectionAllowed();
  }

  /** How selected records are highlighted. */
  #selectionAppearance(): "row" | "cell" {
    return featureSelectionAppearance(this.#features.value);
  }

  #restoreSelectionFocus(): void {
    if (!(document.activeElement instanceof Element) || !this.contains(document.activeElement) || !document.activeElement.closest(".aster-grid-selection, .aster-grid-select")) return;
    this.#selectionInside.value = undefined;
    queueMicrotask(() => this.focus({ preventScroll: true }));
  }

  #title(field: string): string {
    return this.#presentation.value.columns?.[field]?.title ?? this.#collection?.type.field(field)?.title ?? field;
  }

  /** One label text, overridden or the shipped default, with placeholders filled. */
  #text(key: GridLabel, values?: Readonly<Record<string, string | number>>): string {
    return labelText(this.#labels.value, key, values);
  }

  /** A value the server hides from this person on this record: said, not left blank. */
  #hiddenValue(): View {
    return html`<span class="aster-hidden" title=${this.#text("hiddenTitle")}>${this.#text("hiddenValue")}</span>`;
  }

  /** Whether the page lets this field use a capability, before schema and structure. */
  #policyAllows(capability: keyof FieldPolicy, field: string, fallback: boolean): boolean {
    return policyPermits(this.#policy.value, capability, field, fallback);
  }

  /** Whether the column's own values sort; a lookup column needs its related display path. */
  #structurallySortable(field: string): boolean {
    return !this.#lookups.value[field] || this.#sortPaths.value[field] !== undefined;
  }

  /** Why sorting this field is refused, in precedence order: schema, structure, policy. */
  #sortRefusal(field: string): string | undefined {
    const title = this.#title(field);
    const schema = this.#ctx.value?.schema.sets.get(this.set);
    const navigation = this.#sortPaths.value[field]?.split("/")[0];
    if (schema?.nonSortable.has(field) || (navigation !== undefined && schema?.nonSortable.has(navigation))) return this.#text("sortServiceRefused", { field: title });
    if (!this.#structurallySortable(field)) return this.#text("sortNavigationRefused", { field: title });
    if (!this.#policyAllows("sortable", field, true)) return this.#text("sortPolicyRefused", { field: title });
    return undefined;
  }

  /** Why filtering this field is refused, in precedence order: schema, policy. */
  #filterRefusal(field: string): string | undefined {
    const title = this.#title(field);
    if (this.#ctx.value?.schema.sets.get(this.set)?.nonFilterable.has(field)) return this.#text("filterServiceRefused", { field: title });
    if (!this.#policyAllows("filterable", field, true)) return this.#text("filterPolicyRefused", { field: title });
    return undefined;
  }

  /** The operators a field may use: the metadata's, narrowed by the page's allowlist. */
  #operators(field: string): readonly string[] {
    const offered = metadataOperators(this.#collection?.type.field(field));
    const allowed = this.#filterOperators.value[field];
    return allowed === undefined ? offered : offered.filter((op) => allowed.includes(op));
  }

  /** Why one filter operator is refused for a field. */
  #filterOperatorRefusal(field: string, op: string): string | undefined {
    if (this.#operators(field).includes(op)) return undefined;
    return this.#text("filterOperatorRefused", { field: this.#title(field), operator: filterOperatorLabel(op) });
  }

  /** Whether a parsed filter row criteria uses only operators the page allows. */
  #criteriaOperatorRefusal(field: string, criteria: Criteria): string | undefined {
    const map = (node: Criteria): string | undefined => {
      if (!node || typeof node !== "object") return undefined;
      const value = node as { readonly op?: string; readonly args?: readonly Criteria[]; readonly arg?: Criteria };
      switch (value.op) {
        case "and":
        case "or":
          return value.args?.map(map).find((reason) => reason !== undefined);
        case "not":
          return value.arg ? map(value.arg) : undefined;
        default:
          return value.op === undefined ? undefined : this.#filterOperatorRefusal(field, value.op);
      }
    };
    return map(criteria);
  }

  /** Why a draft condition uses an operator the page refuses; related-record fields are metadata-only. */
  #draftOperatorRefusal(model: FilterDraft): string | undefined {
    const own = this.#collection?.type;
    const walk = (node: FilterNode): string | undefined => {
      if (node.kind !== "condition") {
        for (const child of node.children) {
          const reason = walk(child);
          if (reason) return reason;
        }
        return undefined;
      }
      if (!node.field || model.typeFor(node.id) !== own) return undefined;
      return this.#filterOperatorRefusal(node.field, node.op);
    };
    return walk(model.root.peek());
  }

  /** Why grouping by this field is refused, in precedence order: structure, policy. */
  #groupRefusal(field: string): string | undefined {
    const title = this.#title(field);
    if (this.#tree || this.#external()) return this.#text("groupSharedRefused", { field: title });
    const type = this.#collection?.type;
    const entry = type?.field(field);
    if (!entry) return this.#text("groupUnknownRefused", { field: title });
    if (entry.type === "Edm.String" && !entry.allowedValues && (entry.maxLength ?? 0) > 500) return this.#text("groupLongRefused", { field: title });
    if (!this.#policyAllows("groupable", field, true)) return this.#text("groupPolicyRefused", { field: title });
    return undefined;
  }

  /** Whether grouping this field is permitted and possible. */
  #groupable(field: string): boolean {
    return this.#groupRefusal(field) === undefined;
  }

  /** Why resizing this column is refused. */
  #resizeRefusal(field: string): string | undefined {
    return this.#policyAllows("resizable", field, true) ? undefined : this.#text("resizePolicyRefused", { field: this.#title(field) });
  }

  /** Why moving this column is refused. */
  #moveRefusal(field: string): string | undefined {
    return this.#policyAllows("movable", field, true) ? undefined : this.#text("movePolicyRefused", { field: this.#title(field) });
  }

  /** Why hiding this column is refused, in precedence order: the last visible column, policy. */
  #hideRefusal(field: string): string | undefined {
    const view = this.#view.value;
    if (!view) return undefined;
    const visible = this.#visibleColumns(view);
    if (visible.length <= 1 && visible.some((column) => column.field === field)) return this.#text("hideLastRefused");
    if (!this.#policyAllows("hideable", field, true)) return this.#text("hidePolicyRefused", { field: this.#title(field) });
    return undefined;
  }

  /** Why freezing this column is refused. */
  #freezeRefusal(field: string): string | undefined {
    return this.#policyAllows("freezable", field, true) ? undefined : this.#text("freezePolicyRefused", { field: this.#title(field) });
  }

  /** Why freezing through this column is refused: every frozen column must be freezable and one must stay unfrozen. */
  #freezeThroughRefusal(field: string): string | undefined {
    const view = this.#view.value;
    if (!view) return undefined;
    const visible = this.#visibleColumns(view);
    const at = visible.findIndex((column) => column.field === field);
    if (at < 0) return this.#text("freezeUnknownRefused", { field: this.#title(field) });
    if (at === visible.length - 1) return this.#text("freezeLastRefused");
    for (let i = 0; i <= at; i++) {
      const reason = this.#freezeRefusal(visible[i]!.field);
      if (reason) return reason;
    }
    return undefined;
  }

  /** The columns shown, honoring a page that forbids hiding. */
  #visibleColumns(view: GridView): readonly GridColumn[] {
    return effectiveColumns(view, (field) => this.#policyAllows("hideable", field, true));
  }

  /** The frozen run in force, honoring a page that forbids freezing. */
  #frozenCount(view: GridView, visible: readonly GridColumn[] = this.#visibleColumns(view)): number {
    return effectiveFrozen(view, visible, (field) => this.#policyAllows("freezable", field, true));
  }

  /** The grouping levels in force, honoring structure and policy. */
  #groupedFields(view: GridView | undefined = this.#view.value): readonly string[] {
    return effectiveGroups(view, (field) => this.#groupable(field));
  }

  /** Whether the person may add another sort key. */
  #multiSort(): boolean {
    return featureMultiSort(this.#features.value);
  }

  /** Whether the grid loads a page at a time. */
  #paged(): boolean {
    return featurePaged(this.#features.value);
  }

  /** Paged mode applies to flat rows; grouped and tree grids keep loading by viewport. */
  #pagedMode(): boolean {
    return this.#paged() && !this.#tree && this.#groupedFields().length === 0;
  }

  /** The data-core options for an owned collection. Defaults keep the collection's own. */
  #collectionOptions(): CollectionOptions {
    return {
      pageSize: this.#pageSize.value,
      ...(this.#keepPages.value === undefined ? {} : { keepPages: this.#keepPages.value }),
      ...(this.#exactCount.value ? { exactCount: true } : {}),
    };
  }

  /** Whether the page lets this field be edited; schema and page rules still refuse on their own. */
  #fieldEditable(field: string): boolean {
    return this.#policyAllows("editable", field, false);
  }

  #capabilities(): ViewCapabilities {
    return {
      sortable: (field) => this.#sortRefusal(field) === undefined,
      filterable: (field) => this.#filterRefusal(field) === undefined,
      groupable: (field) => this.#groupRefusal(field) === undefined,
      hideable: (field) => this.#hideRefusal(field) === undefined,
      freezable: (field) => this.#freezeRefusal(field) === undefined,
    };
  }

  /** The refusal for one drift entry, with the same precedence its affordance uses. */
  #refusalReason(entry: ViewRefusal): string | undefined {
    switch (entry.kind) {
      case "sort":
        return this.#sortRefusal(entry.field);
      case "filter":
      case "criteria":
        return this.#filterRefusal(entry.field);
      case "group":
        return this.#groupRefusal(entry.field);
      case "hidden":
        return this.#hideRefusal(entry.field);
      case "frozen":
        return this.#freezeRefusal(entry.field);
    }
  }

  #driftKey(entries: readonly ViewRefusal[]): string {
    return entries.map((entry) => `${entry.kind}:${entry.field}`).sort().join("|");
  }

  #driftText(entries: readonly (ViewRefusal & { readonly reason: string })[]): string {
    const parts = entries.map((entry) => {
      const title = this.#title(entry.field);
      const what = ((): string => {
        switch (entry.kind) {
          case "sort":
            return this.#text("driftSort", { field: title });
          case "filter":
            return this.#text("driftFilter", { field: title });
          case "criteria":
            return this.#text("driftCriteria", { field: title });
          case "group":
            return this.#text("driftGroup", { field: title });
          case "hidden":
            return this.#text("driftHidden", { field: title });
          case "frozen":
            return this.#text("driftFrozen", { field: title });
        }
      })();
      return this.#text("driftEntry", { what, reason: entry.reason });
    });
    return this.#text("driftNote", { entries: parts.join(" ") });
  }

  /** Whether any visible column can be edited in place. */
  #editEnabled(): boolean {
    const view = this.#view.value;
    const type = this.#collection?.type;
    if (!view || !type) return false;
    return this.#visibleColumns(view).some((column) => !type.field(column.field)?.computed && this.#fieldEditable(column.field));
  }

  /** The row's floating controls, in a cell of their own past the last column. */
  #controls(key: KeyText, entity: Entity, expanded: boolean, activeRow: boolean, columns: number): View {
    const make = this.#rowControls.value;
    if (!make) return nothing;
    const controls = make(this.#rowState(key, entity, expanded));
    if (!controls.length) return nothing;
    return html`<div class="aster-grid-controls" role="gridcell" aria-colindex=${columns + 1} @keydown=${(e: KeyboardEvent) => this.#controlsKey(e)}
      @dblclick=${(e: MouseEvent) => e.stopPropagation()}>
      ${controls.map(
        (c) => html`<button type="button" aria-label=${c.label} title=${c.label} tabindex=${activeRow ? "0" : "-1"}
          @click=${(e: MouseEvent) => {
            e.stopPropagation();
            c.run();
          }}>${c.icon}</button>`,
      )}
    </div>`;
  }

  #controlsKey(e: KeyboardEvent): void {
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button")];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight":
        e.preventDefault();
        e.stopPropagation();
        buttons[(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        this.querySelector<HTMLElement>(".aster-grid-scroll")?.focus();
        return;
      default:
        // Keys on a control are its own, not the grid's.
        if (e.key !== "Tab") e.stopPropagation();
    }
  }

  /** The expanded row's content, with the question about unsaved changes when there's one. */
  #expansionCell(key: KeyText, columns: number): View {
    const editor = this.#editors.get(key);
    if (!editor) return nothing;
    const asking = this.#asking.value === key;
    const noun = this.#expansion.value?.noun ?? "row";
    return html`<div class="aster-grid-expansion" role="gridcell" aria-colindex="1" aria-colspan=${columns}
      @keydown=${(e: KeyboardEvent) => this.#expansionKey(e, key)} @dblclick=${(e: MouseEvent) => e.stopPropagation()}
      @contextmenu=${(e: MouseEvent) => e.stopPropagation()}>
      ${asking
        ? html`<div class="aster-grid-asking" role="alertdialog" aria-label="Unsaved changes">
            <p>This ${noun} has unsaved changes.</p>
            <button type="button" class="aster-button" data-variant="primary" @click=${() => void this.collapse(key, "save")}>Save</button>
            <button type="button" class="aster-button" @click=${() => void this.collapse(key, "discard")}>Discard</button>
            <button type="button" class="aster-button" data-variant="quiet" @click=${() => (this.#asking.value = undefined)}>Keep editing</button>
          </div>`
        : nothing}
      ${editor.view}
    </div>`;
  }

  /** Keys inside expanded content belong to it; Escape asks to close. */
  #expansionKey(e: KeyboardEvent, key: KeyText): void {
    e.stopPropagation();
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (this.#asking.peek() === key) this.#asking.value = undefined;
    else void this.collapse(key);
  }

  /**
   * In a tree grid, opens the path to a record, makes its row active and
   * scrolls it to the top. Resolves to whether the record is in the tree.
   */
  async reveal(key: KeyText): Promise<boolean> {
    const tree = this.#tree;
    if (!tree) return false;
    const index = await tree.reveal(key);
    if (index < 0) return false;
    this.#activate(index, 0);
    // A revealed row goes to the top of the view, not just inside it.
    const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
    if (scroll) scroll.scrollTop = this.#heights.offset(index);
    return true;
  }
  /**
   * What the page allows, by capability and field. Policy can only restrict:
   * schema and structure refuse first, and a page rule's read-only reason
   * outranks a policy reason. It is host configuration, never part of the
   * saved [[object:GridView]].
   */
  get policy(): GridPolicy {
    return this.#policy.value;
  }
  set policy(value: GridPolicy) {
    const before = this.#selectionAllowed();
    this.#policy.value = value;
    this.#capabilitiesVersion.value++;
    if (before && !this.#selectionAllowed()) this.#restoreSelectionFocus();
  }

  /** Sugar for `policy.sortable`: no sorting, an allowlist, or a predicate. */
  get sortable(): CapabilityValue | undefined {
    const value = this.#policy.value.sortable;
    return typeof value === "function" ? true : value;
  }
  set sortable(value: Capability | undefined) {
    const { sortable: _, ...rest } = this.#policy.peek();
    this.policy = value === undefined ? rest : { ...rest, sortable: value };
  }

  /** Sugar for `policy.filterable`: no filtering, an allowlist, or a predicate. */
  get filterable(): CapabilityValue | undefined {
    const value = this.#policy.value.filterable;
    return typeof value === "function" ? true : value;
  }
  set filterable(value: Capability | undefined) {
    const { filterable: _, ...rest } = this.#policy.peek();
    this.policy = value === undefined ? rest : { ...rest, filterable: value };
  }

  /** Sugar for `policy.groupable`: no grouping, an allowlist, or a predicate. */
  get groupable(): CapabilityValue | undefined {
    return this.#capabilityValue("groupable");
  }
  set groupable(value: Capability | undefined) {
    this.#setCapability("groupable", value);
  }

  /** Sugar for `policy.resizable`: no column resizing, an allowlist, or a predicate. */
  get resizable(): CapabilityValue | undefined {
    return this.#capabilityValue("resizable");
  }
  set resizable(value: Capability | undefined) {
    this.#setCapability("resizable", value);
  }

  /** Sugar for `policy.movable`: no column moving, an allowlist, or a predicate. */
  get movable(): CapabilityValue | undefined {
    return this.#capabilityValue("movable");
  }
  set movable(value: Capability | undefined) {
    this.#setCapability("movable", value);
  }

  /** Sugar for `policy.hideable`: no column hiding, an allowlist, or a predicate. */
  get hideable(): CapabilityValue | undefined {
    return this.#capabilityValue("hideable");
  }
  set hideable(value: Capability | undefined) {
    this.#setCapability("hideable", value);
  }

  /** Sugar for `policy.freezable`: no column freezing, an allowlist, or a predicate. */
  get freezable(): CapabilityValue | undefined {
    return this.#capabilityValue("freezable");
  }
  set freezable(value: Capability | undefined) {
    this.#setCapability("freezable", value);
  }

  #capabilityValue(capability: "groupable" | "resizable" | "movable" | "hideable" | "freezable"): CapabilityValue | undefined {
    const value = this.#policy.value[capability];
    return typeof value === "function" ? true : value;
  }

  #setCapability(capability: "groupable" | "resizable" | "movable" | "hideable" | "freezable", value: Capability | undefined): void {
    const { [capability]: _, ...rest } = this.#policy.peek();
    this.policy = value === undefined ? rest : { ...rest, [capability]: value };
  }

  /** Sugar for `policy.editable`: no editing, an allowlist, or a predicate. */
  get editable(): CapabilityValue {
    const value = this.#policy.value.editable;
    return typeof value === "function" ? true : value ?? false;
  }
  set editable(value: Capability) {
    this.policy = { ...this.#policy.peek(), editable: value };
  }

  /**
   * How permitted capabilities behave, as [[type:GridFeature]] descriptors.
   * The structured form is the contract; the matching properties are sugar.
   * Default `[]`, which keeps today's grid.
   */
  get features(): readonly GridFeature[] {
    return this.#features.value;
  }
  set features(value: readonly GridFeature[]) {
    validateFeatures(value);
    this.#features.value = value.map((entry) => ({ ...entry }));
  }

  /**
   * Sugar for a `sort` feature's `multi`: whether Shift adds another sort key.
   * `false` makes every sort action replace the sort. Default `true`.
   */
  get multiSort(): boolean {
    return this.#multiSort();
  }
  set multiSort(value: boolean) {
    if (typeof value !== "boolean") throw new TypeError("multiSort must be a boolean");
    this.#features.value = value ? withoutFeature(this.#features.peek(), "sort") : withFeature(this.#features.peek(), { kind: "sort", multi: false });
  }

  /** Sugar for an `edit` feature's `mode`: a whole row (`"row"`, the default) or one cell (`"cell"`). */
  get editMode(): "row" | "cell" {
    return featureEditMode(this.#features.value);
  }
  set editMode(value: "row" | "cell") {
    if (value !== "row" && value !== "cell") throw new TypeError('editMode must be "row" or "cell"');
    this.#features.value = value === "row" ? withoutFeature(this.#features.peek(), "edit") : withFeature(this.#features.peek(), { kind: "edit", mode: "cell" });
  }

  /** Sugar for a `select` feature's `appearance`: how a selected record is highlighted. */
  get selectionAppearance(): "row" | "cell" {
    return featureSelectionAppearance(this.#features.value);
  }
  set selectionAppearance(value: "row" | "cell") {
    if (value !== "row" && value !== "cell") throw new TypeError('selectionAppearance must be "row" or "cell"');
    const select = this.#selectFeature();
    if (value === "row" && select.column !== true) this.#features.value = withoutFeature(this.#features.peek(), "select");
    else this.#features.value = withFeature(this.#features.peek(), { kind: "select", appearance: value, ...(select.column ? { column: true } : {}) });
  }

  /** Sugar for a `select` feature's `column`: whether selection gets a checkbox column. */
  get selectionColumn(): boolean {
    return featureSelectionColumn(this.#features.value);
  }
  set selectionColumn(value: boolean) {
    if (typeof value !== "boolean") throw new TypeError("selectionColumn must be a boolean");
    const select = this.#selectFeature();
    if (!value && select.appearance === undefined) this.#features.value = withoutFeature(this.#features.peek(), "select");
    else this.#features.value = withFeature(this.#features.peek(), { kind: "select", ...(select.appearance ? { appearance: select.appearance } : {}), ...(value ? { column: true } : {}) });
  }

  #selectFeature(): { appearance?: "row" | "cell"; column?: boolean } {
    return this.#features.value.find((entry): entry is Extract<GridFeature, { kind: "select" }> => entry.kind === "select") ?? {};
  }
  /**
   * Page rules for the cells of a row being edited. Each row has a child
   * scope where it's published as `row`, so a rule reads its own record.
   */
  get rules(): Readonly<Record<string, FieldRules>> {
    return this.#rules.value;
  }
  set rules(v: Readonly<Record<string, FieldRules>>) {
    this.#rules.value = v;
  }
  get progressPolicy(): ProgressPolicy { return this.#progressPolicy.value; }
  set progressPolicy(value: ProgressPolicy) { progressPolicy(value); this.#progressPolicy.value = Object.freeze({ ...value }); }

  /** Shown when the query matches nothing. */
  get empty(): View {
    return this.#empty.value;
  }
  set empty(v: View) {
    this.#empty.value = v;
  }

  /**
   * Shown in the content area while the first page loads. Default: the
   * built-in presentation with [[attr:Grid.loadingMessage]].
   */
  get loading(): View {
    return this.#loading.value;
  }
  set loading(v: View) {
    this.#loading.value = v;
  }
  /** The built-in loading presentation's text. Default `"Loading…"`. */
  get loadingMessage(): string {
    return this.#loadingMessage.value;
  }
  set loadingMessage(v: string) {
    if (typeof v !== "string") throw new TypeError("loadingMessage must be a string");
    this.#loadingMessage.value = v;
  }
  /**
   * The root collection failure, as a template: the page says what happened
   * and offers `retry`, which calls [[method:Grid.refresh]]. Default: a
   * "Couldn’t load rows." message with a Retry button.
   */
  get error(): ((error: unknown, retry: () => void) => View) | undefined {
    return this.#errorView.value;
  }
  set error(v: ((error: unknown, retry: () => void) => View) | undefined) {
    if (v !== undefined && typeof v !== "function") throw new TypeError("error must be a function");
    this.#errorView.value = v;
  }
  /**
   * Load on connect (the default) or wait for [[method:Grid.refresh]] or the
   * first interaction with the grid. Default `true`.
   */
  get autoFetch(): boolean {
    return this.#autoFetch.value;
  }
  set autoFetch(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("autoFetch must be a boolean");
    this.#autoFetch.value = v;
  }
  /**
   * Rows per load, in either loading mode. Default `100`. In paged mode it is
   * also the number of rows shown at once.
   */
  get pageSize(): number {
    return this.#pageSize.value;
  }
  set pageSize(v: number) {
    if (!Number.isSafeInteger(v) || v < 1) throw new TypeError("pageSize must be a positive integer");
    this.#pageSize.value = v;
  }
  /** Loaded pages kept while scrolling; the data core's default (20) when unset. */
  get keepPages(): number | undefined {
    return this.#keepPages.value;
  }
  set keepPages(v: number | undefined) {
    if (v !== undefined && (!Number.isSafeInteger(v) || v < 1)) throw new TypeError("keepPages must be a positive integer");
    this.#keepPages.value = v;
  }
  /** Ask the server for an exact total where it would estimate or omit one. Default `false`. */
  get exactCount(): boolean {
    return this.#exactCount.value;
  }
  set exactCount(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("exactCount must be a boolean");
    this.#exactCount.value = v;
  }

  /**
   * Reloads the rows the grid shows, keeping them visible until the answer
   * arrives. Rejects when the load fails; the error view or `collection.error`
   * reports it. With `autoFetch` false it also starts the first load.
   */
  async refresh(): Promise<void> {
    this.#demand.value = true;
    const grouping = this.#grouping;
    if (grouping) return grouping.root.refresh();
    const collection = this.#collection;
    if (!collection) return;
    if (this.#tree) {
      const top = this.#tree.level(undefined);
      await top.ensure(0, top.pageSize);
      return this.#tree.refresh();
    }
    return collection.refresh();
  }

  /** Whether autoFetch false is still waiting for refresh() or a first interaction. */
  #deferred(): boolean {
    return !this.#autoFetch.value && !this.#demand.value;
  }

  /** The collection whose loading/error state the content area reports. */
  #rootState(): Collection | Groups | undefined {
    return this.#grouping?.root ?? this.#collection;
  }

  /** Whether the content area is waiting for rows; a deferred grid is idle, not busy. */
  #busy(count: number | undefined): boolean {
    const status = this.#rootState()?.status.value;
    if (status === "loading") return true;
    if (this.#deferred()) return false;
    return count === undefined && status !== "error";
  }

  /** The root collection's failure, if any, as a banner with a retry. */
  #failureView(): View {
    const root = this.#rootState();
    if (!root || root.status.value !== "error") return nothing;
    const error = root.error.value;
    const retry = () => {
      this.focus({ preventScroll: true });
      void this.refresh().catch(() => {});
    };
    const custom = this.#errorView.value;
    return html`<div class="aster-grid-failure" role="alert">
      ${custom
        ? custom(error, retry)
        : html`<span>${this.#text("loadFailed")}</span><button type="button" class="aster-grid-tool" @click=${retry}>${this.#text("retry")}</button>`}
    </div>`;
  }

  /** The content-area loading presentation, used only while there is nothing to show. */
  #loadingView(): View {
    // The label bag may reword the built-in text; an explicit loadingMessage wins.
    const message = this.#loadingMessage.value === "Loading…" ? this.#text("loading") : this.#loadingMessage.value;
    return this.#loading.value !== nothing
      ? this.#loading.value
      : html`<div class="aster-grid-loading" role="status">${message}</div>`;
  }

  /** What sits below the rows: loading while empty, the empty template once the query is known to match nothing. */
  #contentState(layout: Layout, count: number | undefined): View {
    if (this.#rootState()?.status.value === "error") return nothing;
    if (this.#busy(count) && layout.keys.length === 0) return this.#loadingView();
    if (count !== 0) return nothing;
    const empty = this.#empty.value !== nothing ? this.#empty.value : this.#text("empty");
    return html`<div class="aster-grid-empty">${empty || nothing}</div>`;
  }

  /** The paging bar, in paged mode when chrome permits it. */
  #pagingBar(layout: Layout): View {
    if (!this.#pagedMode() || this.#chrome.value.pagingBar === false) return nothing;
    const total = layout.total;
    const size = Math.max(1, this.#pageSize.value);
    const pages = total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
    const page = pages === undefined ? Math.max(0, this.#page.value) : Math.min(Math.max(0, this.#page.value), pages - 1);
    const loaded = layout.keys.filter((key) => key !== undefined).length;
    const firstRow = page * size;
    const lastRow = total === undefined ? firstRow + loaded : Math.min(total, firstRow + size);
    const canNext = pages === undefined ? loaded >= size : page < pages - 1;
    const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);
    const label = pages === undefined
      ? this.#text("page", { page: fmt(page + 1) })
      : this.#text("pageOf", { page: fmt(page + 1), pages: fmt(pages) })
        + (total ? this.#text("pageRows", { first: fmt(firstRow + 1), last: fmt(lastRow), total: fmt(total) }) : "");
    const button = (name: string, action: string, target: number, disabled: boolean, text: string) => html`<button type="button"
      class="aster-grid-tool" data-page-action=${action} aria-label=${name} ?disabled=${disabled} @click=${() => this.#goPage(target, action)}>${text}</button>`;
    return html`<div class="aster-grid-paging" role="group" aria-label=${this.#text("pages")}>
      ${button(this.#text("firstPage"), "first", 0, page === 0, "«")}
      ${button(this.#text("previousPage"), "previous", page - 1, page === 0, "‹")}
      <span class="aster-grid-page" role="status">${label}</span>
      ${button(this.#text("nextPage"), "next", page + 1, !canNext, "›")}
      ${button(this.#text("lastPage"), "last", pages === undefined ? page + 1 : pages - 1, pages === undefined ? !canNext : page >= pages - 1, "»")}
    </div>`;
  }

  /** Moves to a page, clamping to the known range; a new page starts at the top. */
  #goPage(page: number, action?: string): void {
    if (!this.#pagedMode()) return;
    const total = this.#collection?.count.value;
    const size = Math.max(1, this.#pageSize.peek());
    const pages = total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
    const next = pages === undefined ? Math.max(0, page) : Math.min(Math.max(0, page), pages - 1);
    if (action) this.#pagingFocus = action;
    if (next === this.#page.peek()) return;
    this.#page.value = next;
    const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
    if (scroll) scroll.scrollTop = 0;
    this.#top.value = 0;
    const { row, col } = this.#active.peek();
    if (row >= 0) this.#active.value = { row: 0, col };
  }

  #pagingFocus: string | undefined;

  /** Which chrome the grid shows. Default `{}`: the full toolbar, header, automatic filter row and paging bar. */
  get chrome(): GridChrome {
    return this.#chrome.value;
  }
  set chrome(v: GridChrome) {
    this.#setChrome(v);
  }
  /** The toolbar's controls. Default `{}`: every control shown. Object-only; use `showToolbar` to hide the toolbar. */
  get toolbar(): GridToolbar {
    return this.#toolbarOptions.value;
  }
  set toolbar(v: GridToolbar) {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new TypeError("toolbar must be an object; use showToolbar to hide the toolbar");
    this.#toolbarOptions.value = { ...v };
  }
  /** Sugar for `chrome.header`. Default `true`; false hides the header visually but keeps it for assistive technology. */
  get showHeader(): boolean {
    return this.#chrome.value.header !== false;
  }
  set showHeader(v: boolean) {
    this.#setChrome({ ...this.#chrome.peek(), header: v });
  }
  /** Sugar for `chrome.toolbar`. Default `true`. */
  get showToolbar(): boolean {
    return this.#chrome.value.toolbar !== false;
  }
  set showToolbar(v: boolean) {
    this.#setChrome({ ...this.#chrome.peek(), toolbar: v });
  }
  /** Sugar for `chrome.filterRow`: false removes the row, true forces it open, "auto" (the default) follows the view. */
  get showFilterRow(): boolean {
    return this.#chrome.value.filterRow !== false;
  }
  set showFilterRow(v: boolean) {
    this.#setChrome({ ...this.#chrome.peek(), filterRow: v });
  }
  /** Sugar for `chrome.headerMenu`. Default `true`. */
  get showHeaderMenu(): boolean {
    return this.#chrome.value.headerMenu !== false;
  }
  set showHeaderMenu(v: boolean) {
    this.#setChrome({ ...this.#chrome.peek(), headerMenu: v });
  }
  /** Sugar for `chrome.pagingBar`. Default `true`. */
  get showPagingBar(): boolean {
    return this.#chrome.value.pagingBar !== false;
  }
  set showPagingBar(v: boolean) {
    this.#setChrome({ ...this.#chrome.peek(), pagingBar: v });
  }

  #setChrome(v: GridChrome): void {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new TypeError("chrome must be an object");
    if (v.filterRow !== undefined && v.filterRow !== "auto" && typeof v.filterRow !== "boolean") throw new TypeError('chrome.filterRow must be true, false or "auto"');
    this.#chrome.value = { ...v };
    // The active cell cannot stay on a row that is no longer reachable.
    const { row, col } = this.#active.peek();
    const header = this.#chrome.value.header !== false;
    const filters = this.#filtersShown();
    if (row === HEADER && !header) this.#active.value = { row: 0, col };
    else if (row === FILTER_ROW && !filters) this.#active.value = { row: header ? HEADER : 0, col };
  }

  get collection(): Collection | undefined {
    return this.#external() ?? this.#collection;
  }
  set collection(v: Collection | undefined) {
    if (v && (this.#treeOptions.peek() || groupFields(this.#view.peek()).length)) throw new Error("A shared collection grid supports flat rows");
    if (v && this.#selection.peek() && this.#selection.peek()!.collection !== v) throw new Error("collection and selection must refer to the same collection");
    this.#binding.value = v;
  }
  /** Shared selection; without collection, its collection supplies the binding. */
  get selection(): Selection | undefined { return this.#selection.value; }
  /**
   * Allows this view to change selection; borrowed selection state remains
   * visible. Sugar for `policy.selectable`, default on.
   */
  get selectable(): boolean { return this.#selectionAllowed(); }
  set selectable(value: boolean) {
    this.policy = { ...this.#policy.peek(), selectable: value };
  }
  set selection(v: Selection | undefined) {
    if (v && groupFields(this.#view.peek()).length) throw new Error("A shared selection grid supports flat rows");
    if (v && this.#binding.peek() && v.collection !== this.#binding.peek()) throw new Error("collection and selection must refer to the same collection");
    if (v && this.#treeOptions.peek() && v.collection.query.set !== this.set) throw new Error("A tree grid's selection must be over the same entity set");
    this.#selection.value = v;
    this.#selectionNote.value = "";
    this.#selectionAnchor = undefined;
  }
  /** Navigation key, independent of a shared selection. */
  get activeKey(): KeyText | undefined { return this.#activeKey.value; }
  /** Saves an inline edit before an owner changes or removes this view. False keeps invalid/failed edits open. */
  async finishEditing(): Promise<boolean> { return this.#endEdit(true); }
  /** The selected record's key. */
  get selected(): KeyText | undefined {
    return this.#selection.value?.key.value ?? (this.#selection.value ? undefined : this.#selected.value);
  }

  /** Loads and focuses a flat collection position without changing shared selection. */
  async focusIndex(index: number, column = 0): Promise<boolean> {
    const collection = this.#collection;
    if (!this.isConnected || !collection || this.#tree || groupFields(this.#view.peek()).length || !Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(column)) return false;
    this.#demand.value = true;
    const request = ++this.#focusRequest;
    const query = collection.query;
    this.#pendingFocus.value = index;
    try {
      await collection.view(index, index + 1, [index, this.#active.peek().row]);
      if (!this.isConnected || request !== this.#focusRequest || this.#collection !== collection || collection.query !== query || collection.keys.peek()[index] === undefined) return false;
      const paged = this.#pagedMode();
      const size = Math.max(1, this.#pageSize.peek());
      const page = paged ? Math.floor(index / size) : 0;
      if (paged) {
        if (page !== this.#page.peek()) this.#page.value = page;
        await collection.view(page * size, page * size + size, [index - page * size, 0]);
        if (!this.isConnected || request !== this.#focusRequest || this.#collection !== collection || collection.query !== query || collection.keys.peek()[index] === undefined) return false;
      }
      const columns = this.#visibleColumns(this.#view.peek()!).length;
      this.#activate(paged ? index - page * size : index, Math.max(0, Math.min(columns - 1, column)));
      const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
      if (scroll) this.#top.value = scroll.scrollTop;
      queueMicrotask(() => this.focus({ preventScroll: true }));
      return true;
    } catch {
      this.#selectionNote.value = this.#text("rowLoadFailed");
      return false;
    } finally {
      if (request === this.#focusRequest) this.#pendingFocus.value = undefined;
    }
  }

  /** Reveals a key currently loaded in the flat collection. */
  async focusKey(key: KeyText, column = 0): Promise<boolean> {
    const index = this.#collection?.keys.peek().indexOf(key) ?? -1;
    return index < 0 ? false : this.focusIndex(index, column);
  }

  /**
   * Scrolls a flat row into view without moving focus or the active cell.
   * Loads its page if needed. False for grouped/tree grids or a bad position.
   */
  async scrollToRow(index: number, align: GridScrollAlign = "start"): Promise<boolean> {
    return this.#scrollTo(index, undefined, align);
  }

  /**
   * Scrolls a flat row and visible column into view without moving focus or
   * the active cell. A frozen column needs no sideways scroll. False like
   * [[method:Grid.scrollToRow]].
   */
  async scrollToCell(index: number, column: number, align: GridScrollAlign = "start"): Promise<boolean> {
    if (!Number.isSafeInteger(column) || column < 0) return false;
    return this.#scrollTo(index, column, align);
  }

  async #scrollTo(index: number, column: number | undefined, align: GridScrollAlign): Promise<boolean> {
    if (align !== "start" && align !== "center" && align !== "end" && align !== "nearest") return false;
    const collection = this.#collection;
    if (!this.isConnected || !collection || this.#tree || this.#groupedFields().length || !Number.isSafeInteger(index) || index < 0) return false;
    const request = ++this.#scrollRequest;
    const query = collection.query;
    try {
      await collection.ensure(index, index + 1);
      if (!this.isConnected || request !== this.#scrollRequest || this.#collection !== collection || collection.query !== query || collection.keys.peek()[index] === undefined) return false;
      let local = index;
      if (this.#pagedMode()) {
        const size = Math.max(1, this.#pageSize.peek());
        const page = Math.floor(index / size);
        if (page !== this.#page.peek()) this.#page.value = page;
        await collection.view(page * size, page * size + size);
        if (!this.isConnected || request !== this.#scrollRequest || this.#collection !== collection || collection.query !== query || collection.keys.peek()[index] === undefined) return false;
        local = index - page * size;
      }
      this.#scrollNow(local, column, align);
      // A rendered row changes an estimate into a measurement; place it again once that lands.
      await new Promise(requestAnimationFrame);
      if (!this.isConnected || request !== this.#scrollRequest || this.#collection !== collection || collection.query !== query) return false;
      this.#scrollNow(local, column, align);
      return true;
    } catch {
      this.#selectionNote.value = this.#text("rowLoadFailed");
      return false;
    }
  }

  /** Writes the scroll positions for one row (and optional visible column). */
  #scrollNow(row: number, column: number | undefined, align: GridScrollAlign): void {
    const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
    if (!scroll) return;
    const layout = untracked(() => this.#layout());
    this.#heights.setKeys(layout.keys);
    const height = this.#heights.height(row);
    const top = this.#heights.offset(row);
    const inset = this.querySelector<HTMLElement>(".aster-grid-headgroup")?.offsetHeight ?? 0;
    let target = scroll.scrollTop;
    switch (align) {
      case "start":
        target = top - inset;
        break;
      case "center":
        target = top - (scroll.clientHeight - height) / 2;
        break;
      case "end":
        target = top - scroll.clientHeight + height;
        break;
      case "nearest":
        if (top < scroll.scrollTop + inset) target = top - inset;
        else if (top + height > scroll.scrollTop + scroll.clientHeight) target = top + height - scroll.clientHeight;
        break;
    }
    scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, target));

    if (column === undefined) {
      this.#top.value = scroll.scrollTop;
      return;
    }
    const view = this.#view.peek();
    if (!view) return;
    const columns = this.#visibleColumns(view);
    const col = Math.max(0, Math.min(columns.length - 1, column));
    if (col < this.#frozenCount(view, columns)) {
      this.#top.value = scroll.scrollTop;
      return;
    }
    const header = this.querySelector<HTMLElement>(`#${CSS.escape(`${this.#id}-h-${col}`)}`);
    if (!header) {
      this.#top.value = scroll.scrollTop;
      return;
    }
    const box = scroll.getBoundingClientRect();
    const rect = header.getBoundingClientRect();
    const left = rect.left - box.left + scroll.scrollLeft;
    let sideways = scroll.scrollLeft;
    switch (align) {
      case "start":
        sideways = left;
        break;
      case "center":
        sideways = left - (box.width - rect.width) / 2;
        break;
      case "end":
        sideways = left - box.width + rect.width;
        break;
      case "nearest": {
        const at = left - scroll.scrollLeft;
        if (at < 0) sideways = left;
        else if (at + rect.width > box.width) sideways = left + rect.width - box.width;
        break;
      }
    }
    scroll.scrollLeft = Math.max(0, Math.min(scroll.scrollWidth - scroll.clientWidth, sideways));
    this.#top.value = scroll.scrollTop;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // One observer for the scroll box and the rows. A new width can change
    // any row's height, so the shown rows are measured in the callback and the
    // re-render lands before paint: rows it adds are deeper than the scroll
    // box, so the observer still reports them this frame. A row that resized
    // alone applies next frame, as re-rendering for it here would add rows at
    // its own depth, which the observer defers with a loop error.
    this.#observer = new ResizeObserver((entries) => {
      const rows: ResizeObserverEntry[] = [];
      let remeasured = false;
      for (const entry of entries) {
        if (entry.target !== this.#scrollBox) rows.push(entry);
        else remeasured = this.#boxResized(entry.target as HTMLElement) || remeasured;
      }
      if (remeasured || rows.length === 0) return;
      this.#pendingSizes.push(...rows);
      this.#sizeFrame ||= requestAnimationFrame(() => {
        this.#sizeFrame = 0;
        const sizes = this.#pendingSizes.splice(0).map((e) => {
          const row = e.target as HTMLElement;
          return [row, e.borderBoxSize[0]?.blockSize ?? row.offsetHeight] as const;
        });
        this.#measured(sizes);
      });
    });
    this.onDisconnect(() => cancelAnimationFrame(this.#sizeFrame));
    this.onDisconnect(() => {
      this.#filterGeneration++;
      this.querySelector<Dialog>(".aster-grid-advanced")?.close();
      this.#filterDraft.value = undefined;
      this.#observer?.disconnect();
      this.#scrollBox = undefined;
      this.#observedRows.clear();
    });
    this.onDisconnect(effect(() => this.#restore()));
    this.onDisconnect(effect(() => this.#follow()));
    this.onDisconnect(effect(() => this.#syncBound()));
    this.onDisconnect(effect(() => this.#recoverActive()));
    this.onDisconnect(effect(() => this.#group()));
    this.onDisconnect(effect(() => this.#summarize()));
    this.onDisconnect(() => {
      this.#focusRequest++;
      this.#nextLoad = undefined;
      if (this.#ownsCollection && this.#collection) {
        this.#ctx.peek()?.release(this.#collection);
        this.#collection = undefined;
        this.#ownsCollection = false;
      }
      this.#editing.peek()?.stop();
      this.#editing.value = undefined;
      this.#summary?.dispose();
      this.#summary = undefined;
      this.#summaryConfig = undefined;
      this.#grouping?.dispose();
      this.#grouping = undefined;
    });
    this.onDisconnect(effect(() => this.#load()));
    this.onDisconnect(effect(() => this.#toTop()));
    this.onDisconnect(effect(() => this.#keep()));
    this.onDisconnect(effect(() => this.#announce()));
    this.onDisconnect(effect(() => this.#driftAnnounce()));
    this.onDisconnect(effect(() => this.#viewChanged()));
    this.onDisconnect(effect(() => this.#selectionChanged()));
    this.listen(document, "pointerdown", (e) => {
      if (this.#panel.peek() && !(e.target as Element).closest(".aster-grid-panel, .aster-grid-tool")) this.#panel.value = undefined;
    });
    // Where a click doesn't focus the button that opened a panel (WebKit), Escape arrives on the body.
    this.listen(document, "keydown", (e) => {
      if (e.target === document.body) this.#panelKey(e as KeyboardEvent);
    });
    // autoFetch false waits for refresh() or the person's first demand.
    const demand = () => {
      this.#demand.value = true;
    };
    this.listen(this, "pointerdown", demand);
    this.listen(this, "keydown", demand);
    this.listen(this, "scroll", demand, { capture: true });
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>(".aster-grid-scroll")?.focus(options);
  }

  protected render(): View {
    this.#focusBefore = this.#external() && this.contains(document.activeElement) ? document.activeElement : null;
    this.#version.value;
    const ctx = this.#ctx.value;
    const collection = this.#collection;
    const view = this.#view.value;
    if (!ctx || !collection || !view) return nothing;
    const type = collection.type;
    const columns = this.#visibleColumns(view);
    const lookups = this.#lookups.value;
    const fields = columns.map((c) => type.field(c.field));
    const numeric = columns.map((c, i) => isNumeric(fields[i]) && !lookups[c.field]);
    const presentation = this.#presentation.value;
    const titles = columns.map((c) => this.#title(c.field));
    const layout = this.#layout();
    const count = layout.keys.length === 0 && layout.total === undefined ? undefined : layout.keys.length;
    this.#heights.setKeys(layout.keys);
    const { start, end } = this.#heights.window(this.#top.value, this.#viewport.value, OVERSCAN);
    const top = this.#heights.offset(start);
    const bottom = this.#heights.total() - this.#heights.offset(end);
    const active = this.#active.value;
    const selection = this.#selection.value;
    const selectedKeys = selection?.keys.value ?? [];
    const selected = this.#selected.value;
    const selectColumn = this.#selectionColumnOn();
    const selectionAppearance = this.#selectionAppearance();
    const totalColumns = columns.length + (selectColumn ? 1 : 0);
    const frozen = this.#frozenCount(view, columns);
    const frozenLeft = this.#frozenOffsets(columns, frozen, selectColumn ? SELECT_WIDTH : 0);
    const style = styleMap({
      "--grid-columns": [selectColumn ? `${SELECT_WIDTH}px` : undefined, ...columns.map((c, i) => track(c, lookups[c.field] ? undefined : fields[i]))].filter(Boolean).join(" "),
      ...Object.fromEntries(frozenLeft.map((left, i) => [`--frozen-${i}`, `${left}px`])),
    });
    const rows = [];
    for (let i = start; i < end; i++) rows.push(i);
    const cellId = (row: number, col: number) => `${this.#id}-${row}-${col}`;
    const filters = this.#filtersShown();
    const chrome = this.#chrome.value;
    const toolbarOptions = this.#toolbarOptions.value;
    const headerShown = chrome.header !== false;
    const toolbarShown = chrome.toolbar !== false;
    // A hidden header or filter row stays in the DOM but must not own the active cell.
    const activeCell = active.row === HEADER && !headerShown ? { row: 0, col: active.col }
      : active.row === FILTER_ROW && !filters ? { row: headerShown ? HEADER : 0, col: active.col }
      : active;
    const activeId =
      activeCell.row === HEADER ? `${this.#id}-h-${activeCell.col}`
      : activeCell.row === FILTER_ROW ? `${this.#id}-f-${activeCell.col}`
      : !count ? undefined
      : cellId(activeCell.row, activeCell.row < count && layout.at(activeCell.row).kind === "group" ? 0 : activeCell.col);
    const countId = `${this.#id}-total`;
    const countAnnounced = !toolbarShown || toolbarOptions.count !== false;
    const describedBy = countAnnounced && (layout.atLeast !== undefined || layout.estimate || !toolbarShown) ? countId : nothing;
    const frozenStyle = (i: number) => (i < frozen ? `left:var(--frozen-${i})` : nothing);
    return html`<div class="aster-grid-chrome">${toolbarShown ? this.#toolbar(view, layout) : html`<span class="aster-grid-total aster-sr-only" id=${countId} aria-live="polite">${this.#countText(layout)}</span>`}${this.#driftView()}${this.#failureView()}${this.#pagingBar(layout)}</div>
      <div class="aster-grid-scroll" role=${this.#groupedFields(view).length || this.#tree ? "treegrid" : "grid"} tabindex="0" aria-label=${this.#label.value}
        ?data-fixed-columns=${columns.length > 0 && columns.every((c) => c.width !== undefined)} ?data-head-hidden=${!headerShown}
        data-selection-appearance=${selectionAppearance}
        aria-rowcount=${layout.atLeast !== undefined || layout.estimate ? -1
          : (layout.first !== undefined && layout.total !== undefined ? layout.total : count ?? 0) + (filters ? 2 : 1)} aria-colcount=${totalColumns + (this.#rowControls.value ? 1 : 0)}
        aria-describedby=${describedBy}
        aria-multiselectable=${this.#selectionAllowed() && selection?.multiple ? "true" : nothing}
        aria-activedescendant=${activeId && (activeCell.row < 0 || (activeCell.row >= start && activeCell.row < end)) ? activeId : nothing} aria-busy=${this.#busy(count) ? "true" : "false"}
        ?data-draggable=${!!this.#treeOptions.value?.draggable && this.#editEnabled()}
        @scroll=${(e: Event) => this.#scrolled(e.currentTarget as HTMLElement)}
        @keydown=${(e: KeyboardEvent) => this.#key(e, columns.length)}
        @click=${(e: MouseEvent) => this.#click(e)}
        @focusout=${() => queueMicrotask(() => { if (!this.contains(document.activeElement)) this.#focusRequest++; })}
        @dblclick=${(e: MouseEvent) => this.#dblclick(e)}
        @contextmenu=${(e: MouseEvent) => this.#contextMenu(e)}
        @pointerdown=${(e: PointerEvent) => this.#dragRow(e)}>
        <div class="aster-grid-table" style=${style}>
          <div class="aster-grid-headgroup">
            ${this.#treeOptions.value?.draggable && this.#editEnabled() ? html`<div class="aster-grid-root-drop">Top level</div>` : nothing}
            <div class="aster-grid-row aster-grid-head" role="row" aria-rowindex="1">
              ${selectColumn ? this.#selectionHead(selection, selectedKeys) : nothing}
              ${columns.map((c, i) => this.#header(c, fields[i], i, view, numeric[i]!, frozen, frozenStyle(i), activeCell.row === HEADER && activeCell.col === i, selectColumn ? 2 : 1))}
            </div>
            ${filters
              ? html`<div class="aster-grid-row aster-grid-filters" role="row" aria-rowindex="2" @keydown=${(e: KeyboardEvent) => this.#filterKey(e)}>
                  ${selectColumn ? html`<div class="aster-grid-cell aster-grid-select" role="gridcell" aria-colindex="1" data-col="-1"></div>` : nothing}
                  ${columns.map((c, i) => html`<div class="aster-grid-cell aster-grid-filter" role="gridcell" aria-colindex=${i + (selectColumn ? 2 : 1)}
                    data-col=${i} id=${`${this.#id}-f-${i}`} ?data-active=${activeCell.row === FILTER_ROW && activeCell.col === i}
                    ?data-frozen=${i < frozen} style=${frozenStyle(i)}>${this.#filter(c, fields[i], view)}</div>`)}
                </div>`
              : nothing}
          </div>
          <div class="aster-grid-spacer" style=${`height:${top}px`}></div>
          ${each(
            rows.map((i) => ({ i, item: layout.at(i) })),
            ({ i, item }) => (item.kind === "group" ? item.id : (item.key ?? `?${i}`)),
            ({ i, item }) => {
              if (item.kind === "group") return this.#groupRow(item, i, i + (filters ? 3 : 2), totalColumns, view, activeCell.row === i);
              const key = item.key;
              const stored = key === undefined ? undefined : ctx.store.record(collection.query.set, key).value;
              const entity = stored?.entity;
              const editing = this.#editing.value;
              const edit = editing && key !== undefined && editing.key === key ? editing.edit : undefined;
              const conflict = edit?.conflict.value;
              const formError = edit?.formError.value;
              // A read-only reason shows once for the row, not under every cell it covers.
              // Page-rule and schema reasons come first; a policy refusal adds its own.
              // Cell mode shows only the pressed cell's reasons.
              const rowMode = this.editMode === "row";
              const edited = columns.filter((c) => rowMode || c.field === editing?.field);
              const reasons = edit
                ? [...new Set([
                    ...edited.flatMap((c) => {
                      const st = fields.some((f) => f?.name === c.field) ? edit.state(c.field).value : undefined;
                      return st?.readOnly && st.reasons.readOnly && !fields.find((f) => f?.name === c.field)?.computed ? [st.reasons.readOnly] : [];
                    }),
                    // Page rules and schema reasons win: a field already read-only keeps its own reason.
                    ...edited.flatMap((c) => {
                      if (this.#fieldEditable(c.field) || !this.#collection?.type.field(c.field) || edit.state(c.field).value.readOnly) return [];
                      return [`Editing ${this.#title(c.field)} isn’t allowed on this page.`];
                    }),
                  ])]
                : [];
              const shared = new Map(reasons.map((r, n) => [r, `${this.#id}-reason-${n}`]));
              const rowSelected = key !== undefined && (selection ? selectedKeys.includes(key) : key === selected);
              const selectedColumn = Math.max(0, Math.min(columns.length - 1, active.col));
              const rowStyle = entity && key !== undefined ? styleRow(presentation, { entity, key, index: i }) : undefined;
              return html`<div class=${["aster-grid-row", ...(rowStyle?.classes ?? [])].join(" ")} role="row" aria-rowindex=${i + (filters ? 3 : 2) + (layout.first ?? 0)} data-index=${i}
                data-tone=${rowStyle?.tone ?? nothing}
                aria-level=${item.node?.level ?? item.level ?? nothing}
                aria-posinset=${item.node?.position ?? item.position ?? nothing} aria-setsize=${item.node?.siblings ?? item.siblings ?? nothing}
                style=${item.node || item.level ? `--level:${(item.node?.level ?? item.level ?? 1) - 1}` : nothing}
                aria-expanded=${item.node && item.node.folder !== false && item.key !== undefined ? (item.node.open ? "true" : "false") : nothing}
                data-key=${key ?? nothing} aria-selected=${this.#external() && !selection ? nothing : rowSelected ? "true" : "false"}
                ?data-grouped-row=${item.level !== undefined}
                ?data-active-row=${activeCell.row === i} ?data-expanded=${key !== undefined && this.#open.value.includes(key)}
                ?data-placeholder=${!entity} ?data-editing=${edit !== undefined} ?data-lifted=${key !== undefined && key === this.#lifted.value}
                @keydown=${edit ? (e: KeyboardEvent) => this.#editKey(e) : nothing}
                @mousedown=${edit ? (e: MouseEvent) => this.#focusPressed(e) : nothing}
                @focusout=${edit ? (e: FocusEvent) => this.#editBlur(e) : nothing}>
                ${selectColumn ? this.#selectionCell(key, i, selection, selectedKeys, entity, stored?.hidden) : nothing}
                ${columns.map((c, col) => {
                  const columnPresentation = presentation.columns?.[c.field];
                  const value = entity?.[c.field];
                  const mapped = mappedValue(columnPresentation, value);
                  const cellStyle = entity && key !== undefined
                    ? styleCell(presentation, columnPresentation, { entity, key, index: i, field: c.field, value }, mapped)
                    : undefined;
                  const content = !entity ? html`<span class="aster-grid-skeleton"></span>`
                    : edit && this.#fieldEditable(c.field) && !fields[col]?.computed && (rowMode || c.field === editing!.field)
                      ? controlFor(edit, c.field, { options: lookups[c.field] ? this.#optionsFor(c.field, lookups[c.field]!) : undefined, labelled: false, sharedReasons: shared })
                      : stored?.hidden?.has(c.field) ? this.#hiddenValue() : this.#cell(c, fields[col], entity, key!, ctx, mapped);
                  return html`<div class=${["aster-grid-cell", ...(cellStyle?.classes ?? [])].join(" ")} role="gridcell" id=${cellId(i, col)} data-col=${col}
                    aria-colindex=${col + (selectColumn ? 2 : 1)} ?data-active=${activeCell.row === i && activeCell.col === col}
                    ?data-selected-cell=${selectionAppearance === "cell" && rowSelected && col === selectedColumn}
                    data-tone=${cellStyle?.tone ?? nothing} data-align=${columnPresentation?.align ?? nothing}
                    ?data-numeric=${numeric[col]} ?data-frozen=${col < frozen} style=${`grid-column:${col + (selectColumn ? 2 : 1)};${col < frozen ? `left:var(--frozen-${col})` : ""}`} data-label=${titles[col]!}>
                    ${col === 0 && item.node ? this.#treeLead(item.node) : nothing}
                    ${col === 0 && key !== undefined && selection && !selectColumn && this.#selectionAllowed() ? html`<div class="aster-grid-selection-value">
                      ${this.#selectionControl(key, entity, selectedKeys, stored?.hidden)}<div class="aster-grid-selection-content">${content}</div>
                    </div>` : content}
                  </div>`;
                })}
                ${key !== undefined && entity ? this.#controls(key, entity, this.#open.value.includes(key), activeCell.row === i, totalColumns) : nothing}
                ${key !== undefined && this.#open.value.includes(key) ? this.#expansionCell(key, totalColumns) : nothing}
                ${conflict
                  ? html`<p class="aster-grid-row-note" role="alert">Someone else changed ${conflict.fields.map((f) => type.field(f)?.title ?? f).join(", ")} while you were editing.
                      <button type="button" @pointerdown=${keepFocus} @click=${() => edit!.rebase()}>Keep mine</button>
                      <button type="button" @pointerdown=${keepFocus} @click=${() => (edit!.discard(), this.#endEdit(true))}>Take theirs</button></p>`
                  : formError
                    ? html`<p class="aster-grid-row-note aster-error" role="alert">${formError}</p>`
                    : nothing}
                ${[...shared].map(([reason, id]) => html`<p class="aster-grid-row-note aster-hint" id=${id}>${reason}</p>`)}
              </div>`;
            },
          )}
          <div class="aster-grid-spacer" style=${`height:${bottom}px`}></div>
        </div>
        ${this.#contentState(layout, count)}
      </div>
      ${this.#summaryView()}
      <aster-menu class="aster-grid-menu"></aster-menu>
      <aster-dialog class="aster-grid-advanced" .labelledBy=${`${this.#id}-advanced-title`}
        .content=${this.#advancedContent()} @close=${() => { this.#filterGeneration++; this.#filterDraft.value = undefined; }}></aster-dialog>`;
  }

  protected override updated(): void {
    if (this.#filterShow) {
      this.#filterShow = false;
      const generation = this.#filterGeneration;
      queueMicrotask(() => {
        if (this.isConnected && this.#filterDraft.peek() && generation === this.#filterGeneration) this.querySelector<Dialog>(".aster-grid-advanced")?.show(this.#filterOpener);
      });
    }
    const focusBefore = this.#focusBefore;
    const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
    if (!scroll || !this.#observer) return;
    if (this.#scrollBox !== scroll) {
      if (this.#scrollBox) this.#observer.unobserve(this.#scrollBox);
      this.#scrollBox = scroll;
      this.#scrollWidth = scroll.clientWidth;
      this.#observer.observe(scroll);
      this.#viewport.value = scroll.clientHeight;
    }
    const rows = [...this.querySelectorAll<HTMLElement>(".aster-grid-row[data-key]")];
    const shown = new Set(rows);
    for (const row of this.#observedRows) {
      if (shown.has(row)) continue;
      this.#observer.unobserve(row);
      this.#observedRows.delete(row);
    }
    for (const row of rows) {
      if (this.#observedRows.has(row)) continue;
      this.#observer.observe(row);
      this.#observedRows.add(row);
    }
    // Heights replaced estimates above the viewport: keep the same row at the same place.
    const anchor = this.#anchor;
    if (anchor) {
      this.#anchor = undefined;
      const want = this.#heights.offset(anchor.index) + anchor.delta;
      if (Math.abs(scroll.scrollTop - want) >= 1) scroll.scrollTop = want;
    }
    // Rows new to the grid are measured now rather than when the observer
    // reports them, so the window and spacers settle in the frame they appear.
    const fresh = rows.filter((r) => !this.#heights.has(r.dataset.key!));
    if (fresh.length > 0) this.#measured(fresh.map((r) => [r, r.getBoundingClientRect().height]));
    const groupTool = this.#groupToolFocus;
    if (groupTool) {
      this.#groupToolFocus = undefined;
      const tools = groupTool.field ? this.querySelector<HTMLElement>(`.aster-grid-group-tools[data-group-field="${CSS.escape(groupTool.field)}"]`) : undefined;
      const target = tools?.querySelector<HTMLElement>(`[data-group-action="${groupTool.action}"]:not(:disabled)`) ?? tools?.querySelector<HTMLElement>("button");
      if (target) target.focus({ preventScroll: true });
      else this.focus({ preventScroll: true });
    }
    const paging = this.#pagingFocus;
    if (paging) {
      this.#pagingFocus = undefined;
      const bar = this.querySelector<HTMLElement>(".aster-grid-paging");
      if (bar && !bar.contains(document.activeElement)) {
        const target = bar.querySelector<HTMLElement>(`[data-page-action="${paging}"]:not(:disabled)`) ?? bar.querySelector<HTMLElement>("button:not(:disabled)");
        target?.focus({ preventScroll: true });
      }
    }
    if (focusBefore && !focusBefore.isConnected && document.activeElement === document.body) this.focus({ preventScroll: true });
  }

  // ── toolbar and panels ──

  #filterContext(): string {
    return JSON.stringify([this.set, this.#view.value, this.#base.value, this.#external()?.query, this.#capabilitiesVersion.value]);
  }

  #filterStale(): boolean {
    return this.#filterOwner !== this.#ctx.value || this.#filterSnapshot !== this.#filterContext();
  }

  #openAdvanced(opener: HTMLElement): void {
    const ctx = this.#ctx.peek();
    if (!ctx || !this.set) return;
    this.#filterGeneration++;
    this.#filterShow = true;
    this.#filterOpener = opener;
    this.#filterOwner = ctx;
    this.#filterBusy.value = false;
    this.#filterNote.value = "";
    this.#filterSnapshot = this.#filterContext();
    try { this.#filterDraft.value = new FilterDraft(ctx.schema, this.set, this.#view.peek()?.criteria); }
    catch { this.#filterDraft.value = new FilterDraft(ctx.schema, this.set); this.#filterNote.value = "This saved expression cannot be read. Build a replacement or cancel to keep it."; }
  }

  #advancedContent(): View {
    const model = this.#filterDraft.value;
    if (!model) return nothing;
    const stale = this.#filterStale();
    const reason = this.#filterBusy.value ? "Saving the current row before applying…" : stale ? "The grid query changed while you were editing. Reload its current expression before applying." : undefined;
    return html`<h2 id=${`${this.#id}-advanced-title`}>${this.#label.value}: advanced filter</h2>
      <p class="aster-hint">This expression combines with column filters and the page’s query constraints.</p>
      ${this.#filterNote.value ? html`<p class="aster-error" role="status">${this.#filterNote.value}</p>` : nothing}
      <aster-filter-builder .model=${model} .readOnlyReason=${reason}
        .operators=${(field: Field | undefined) => (field ? this.#operators(field.name) : [])}
        @apply=${(e: CustomEvent<Criteria | undefined>) => { e.preventDefault(); void this.#applyAdvanced(model); }}
        @cancel=${() => this.querySelector<Dialog>(".aster-grid-advanced")?.close()}></aster-filter-builder>
      ${stale ? html`<button type="button" class="aster-button" @click=${() => this.#openAdvanced(this.#filterOpener!)}>Reload current expression</button>` : nothing}
      ${reason ? html`<button type="button" class="aster-button" @click=${() => this.querySelector<Dialog>(".aster-grid-advanced")?.close()}>Close</button>` : nothing}`;
  }

  async #applyAdvanced(model: FilterDraft): Promise<void> {
    if (this.#filterBusy.peek() || !model.result.peek().valid || this.#filterStale()) return;
    const generation = this.#filterGeneration;
    this.#filterBusy.value = true;
    const saved = !this.#editing.peek() || await this.#endEdit(true);
    if (generation !== this.#filterGeneration || !this.isConnected) return;
    this.#filterBusy.value = false;
    if (!saved) { this.#filterNote.value = "The current row could not be saved. Your filter draft is still available."; return; }
    if (this.#filterStale()) return;
    const refusedOperator = this.#draftOperatorRefusal(model);
    if (refusedOperator) {
      this.#filterNote.value = `${refusedOperator} Change that condition to apply the filter.`;
      return;
    }
    if (!model.apply()) return;
    const view = this.#view.peek();
    if (!view) return;
    const { criteria: _, ...rest } = view;
    const criteria = model.applied.peek();
    const refused = criteria ? [...new Set(criteriaFields(criteria))].map((field) => [field, this.#filterRefusal(field)] as const).find(([, reason]) => reason !== undefined) : undefined;
    if (refused) {
      this.#filterNote.value = `${refused[1]} Remove that condition to apply the filter.`;
      return;
    }
    this.#setView({ ...rest, ...(criteria ? { criteria } : {}) });
    this.querySelector<Dialog>(".aster-grid-advanced")?.close();
    announce(criteria ? this.#text("advancedApplied") : this.#text("advancedCleared"));
  }

  #query(set: string, view: GridView, base?: Criteria, paths: Readonly<Record<string, string>> = {}): Query {
    const checked = this.#criteriaCheck.value;
    return viewQuery(set, checked?.valid === false ? { ...view, criteria: { op: "or", args: [] } } : view, base, paths, this.#capabilities());
  }

  /**
   * A saved sort, filter or expression the page now refuses stays in the
   * view but not in the query. The note says which field and why; it lives
   * outside the toolbar so hiding the toolbar cannot silence it.
   */
  #driftView(): View {
    const entries = this.#drift.value;
    if (!entries.length) return nothing;
    const key = this.#driftKey(entries);
    if (this.#driftDismissed.value === key) return nothing;
    // No live-region role: #driftAnnounce announces it once per set of entries.
    return html`<div class="aster-grid-drift">
      <span>${this.#driftText(entries)}</span>
      <button type="button" class="aster-grid-tool" @click=${() => {
        this.#driftDismissed.value = key;
        this.querySelector<HTMLElement>(".aster-grid-scroll")?.focus();
      }}>${this.#text("dismiss")}</button>
    </div>`;
  }

  #countText(layout: Layout): string {
    const count = layout.total;
    const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);
    if (count === undefined) return this.#deferred() ? this.#text("notLoaded") : this.#text("loading");
    if (layout.estimate) return this.#text("aboutRows", { count: fmt(roughly(count)) });
    if (layout.atLeast !== undefined) return this.#text("atLeastRows", { count: fmt(layout.atLeast) });
    const rows = count === 1 ? this.#text("row") : this.#text("rows", { count: fmt(count) });
    if (layout.groups === undefined) return rows;
    const groups = layout.groups === 1 ? this.#text("group") : this.#text("groups", { count: fmt(layout.groups) });
    return this.#text("groupedRows", { rows, groups });
  }

  #toolbar(view: GridView, layout: Layout): View {
    const panel = this.#panel.value;
    const options = this.#toolbarOptions.value;
    const filters = Object.keys(view.filters).length;
    const storedGroups = groupFields(view);
    const grouped = this.#groupedFields(view);
    const refusedGroups = storedGroups.filter((field) => !grouped.includes(field));
    const groupTitle = (field: string) => this.#title(field);
    const visible = this.#visibleColumns(view);
    const filterRefusal = visible.map((column) => this.#filterRefusal(column.field)).find((reason) => reason !== undefined);
    const anyFilterable = visible.some((column) => this.#filterRefusal(column.field) === undefined);
    const tool = (name: Panel, label: string) => html`<button type="button" class="aster-grid-tool"
      style=${anchorStyle(`${this.#id}-tool-${name}`)}
      aria-expanded=${panel === name ? "true" : "false"} aria-controls=${`${this.#id}-${name}`}
      @click=${() => (this.#panel.value = panel === name ? undefined : name)}>${label}</button>`;
    return html`<div class="aster-grid-toolbar" role="toolbar" aria-label=${this.#text("toolbarLabel", { label: this.#label.value })}
      @keydown=${(e: KeyboardEvent) => this.#panelKey(e)}>
      ${options.count === false ? nothing : html`<span class="aster-grid-total" id=${`${this.#id}-total`} aria-live="polite">${this.#countText(layout)}</span>`}
      ${options.expandAll === false || !this.#tree ? nothing : html`<button type="button" class="aster-grid-tool" @click=${() => void this.#expandAll()}>${this.#text("expandAll")}</button>
        <button type="button" class="aster-grid-tool" @click=${() => this.#collapseAll()}>${this.#text("collapseAll")}</button>`}
      ${options.sort === false ? nothing : tool("sort", this.#text("sort"))}
      ${this.#selectionNote.value ? html`<span class="aster-grid-note" role="status">${this.#selectionNote.value}</span>` : nothing}
      ${this.#grouping?.root.error.value !== undefined ? html`<span class="aster-grid-note aster-error" role="status">${this.#text("groupsFailed")}</span>
        <button type="button" class="aster-grid-tool" @click=${() => { this.focus({ preventScroll: true }); void this.#grouping?.retry(); }}>${this.#text("retryGroups")}</button>` : nothing}
      ${this.#refused.value ? html`<span class="aster-grid-note aster-grid-refused">${this.#refused.value}</span>` : nothing}
      ${this.#tree?.searching.value
        ? html`<span class="aster-grid-note" role="status">${this.#text("treeSearching")}</span>`
        : this.#tree?.tooBroad.value
          ? html`<span class="aster-grid-note" role="status">${this.#text("treeTooBroad")}</span>`
          : this.#tree?.error.value !== undefined
            ? html`<span class="aster-grid-note aster-error" role="status">${this.#text("treeSearchFailed")}</span>`
            : nothing}
      ${grouped.map((field, i) => html`<span class="aster-grid-group-tools" data-group-field=${field}>
        <button type="button" class="aster-grid-tool" data-group-action="remove" aria-pressed="true" title=${grouped.length === 1 ? this.#text("stopGrouping") : this.#text("removeGrouping", { field: groupTitle(field) })}
          @click=${() => this.#setView(setGroup(view, storedGroups.filter((f) => f !== field)))}>${i ? this.#text("thenBy", { field: groupTitle(field) }) : this.#text("groupedBy", { field: groupTitle(field) })} ✕</button>
        ${grouped.length > 1 ? html`<button type="button" class="aster-grid-tool" data-group-action="earlier" aria-label=${this.#text("moveGroupingEarlier", { field: groupTitle(field) })} ?disabled=${i === 0}
          @click=${() => this.#reorderGroup(field, -1)}>↑</button>
          <button type="button" class="aster-grid-tool" data-group-action="later" aria-label=${this.#text("moveGroupingLater", { field: groupTitle(field) })} ?disabled=${i === grouped.length - 1}
          @click=${() => this.#reorderGroup(field, 1)}>↓</button>` : nothing}
      </span>`)}
      ${refusedGroups.map((field) => html`<span class="aster-grid-group-tools" data-group-field=${field} data-refused>
        <button type="button" class="aster-grid-tool" data-group-action="remove" title=${this.#text("removeRefusedGrouping", { reason: this.#groupRefusal(field) ?? this.#text("groupingRefused") })}
          @click=${() => this.#setView(setGroup(view, storedGroups.filter((f) => f !== field)))}>${this.#text("groupedBy", { field: groupTitle(field) })} ✕</button>
      </span>`)}
      ${options.filters === false || this.#chrome.value.filterRow === false ? nothing : html`<button type="button" class="aster-grid-tool" aria-pressed=${this.#filtersShown() ? "true" : "false"}
        ?disabled=${!anyFilterable && filters === 0} title=${!anyFilterable && filters === 0 ? (filterRefusal ?? this.#text("filterRefused")) : nothing}
        @click=${() => this.#toggleFilters(view)}>${filters ? this.#text("filtersActive", { count: filters }) : this.#text("filters")}</button>`}
      ${options.advanced === false ? nothing : html`<button type="button" class="aster-grid-tool" aria-haspopup="dialog" aria-pressed=${view.criteria ? "true" : "false"}
        ?disabled=${!anyFilterable} title=${!anyFilterable ? (filterRefusal ?? this.#text("filterRefused")) : nothing}
        @click=${(e: Event) => this.#openAdvanced(e.currentTarget as HTMLElement)}>${this.#text("advancedFilter")}</button>`}
      ${!anyFilterable ? html`<span class="aster-sr-only">${filterRefusal ?? this.#text("filterRefused")}</span>` : nothing}
      ${view.criteria ? html`<span class="aster-grid-expression" role="status">${this.#criteriaCheck.value?.valid === false
        ? this.#text("criteriaNeedsRepair")
        : describeCriteria(view.criteria, this.#collection!.type)}</span>` : nothing}
      ${options.columns === false ? nothing : tool("columns", this.#text("columns"))}
      ${options.views === false || !this.#persist.value ? nothing : tool("views", this.#text("views"))}
      ${options.extra ?? nothing}
      ${panel === "sort" ? this.#sortPanel(view) : panel === "columns" ? this.#columnsPanel(view) : panel === "views" ? this.#viewsPanel(view) : nothing}
    </div>`;
  }

  #sortPanel(view: GridView): View {
    const fieldTitle = (field: string) => this.#title(field);
    const offered = this.#visibleColumns(view)
      .filter((column) => this.#sortable(column.field))
      .map((column) => ({ field: column.field, offered: true, refusal: undefined as string | undefined }));
    const shown = new Set(offered.map((row) => row.field));
    // A sort on a hidden or now-refused column still shows, with its reason:
    // the panel never says nothing is sorted, and the stored key stays clearable.
    const rows: { field: string; offered: boolean; refusal: string | undefined }[] = [...offered];
    for (const key of view.sort) {
      if (shown.has(key.field)) continue;
      shown.add(key.field);
      rows.push({ field: key.field, offered: false, refusal: this.#sortRefusal(key.field) });
    }
    const active = view.sort.filter((key) => this.#sortable(key.field));
    const priority = new Map(active.map((key, i) => [key.field, i + 1]));
    const toggle = (field: string) => {
      const key = view.sort.find((sortKey) => sortKey.field === field);
      const sorted = key !== undefined;
      const descending = key?.descending === true;
      const name = fieldTitle(field);
      const action = sorted
        ? this.#text("sortActionNow", { field: name, direction: descending ? this.#text("directionDescending") : this.#text("directionAscending") })
        : this.#text("sortAction", { field: name });
      return html`<button type="button" class="aster-grid-sort-direction" aria-label=${action} aria-pressed=${sorted ? "true" : "false"}
        title=${`${action}. ${sorted ? this.#text("sortReverse") : this.#text("sortAscending")}.`}
        @click=${() => this.#setView(sortDirection(view, field, sorted ? !descending : false, this.#multiSort()))}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d=${sorted
          ? descending ? "M2 3.5 5 6.5l3-3" : "M2 6.5 5 3.5l3 3"
          : "M2 3.5 5 .5l3 3M2 6.5 5 9.5l3-3"}/></svg>
      </button>`;
    };
    return html`<div class="aster-grid-panel aster-grid-sort-panel aster-popover" popover="manual" ${openWhen(true)}
      style=${placeStyle(`${this.#id}-tool-sort`)} id=${`${this.#id}-sort`} role="group" aria-label=${this.#text("sortRows")}
      @keydown=${(e: KeyboardEvent) => this.#panelKey(e)}>
      <p class="aster-grid-panel-title">${this.#text("sortRows")}</p>
      ${rows.length === 0
        ? html`<p class="aster-grid-panel-note">${this.#text("noSortableColumns")}</p>`
        : html`<ul>
          ${rows.map(({ field, offered, refusal }) => html`<li data-field=${field} ?data-refused=${refusal !== undefined}>
            <span class="aster-grid-sort-name"><span class="aster-grid-sort-title">${fieldTitle(field)}</span>
              ${refusal ? html`<small class="aster-grid-sort-reason">${refusal}</small>` : nothing}</span>
            <span class="aster-grid-sort-actions">
              <small class="aster-grid-sort-priority" aria-hidden="true">${priority.has(field) && active.length > 1 ? priority.get(field) : ""}</small>
              ${priority.has(field) && active.length > 1 ? html`<span class="aster-sr-only">${this.#text("sortPriority", { priority: priority.get(field)! })}</span>` : nothing}
              ${refusal ? nothing : toggle(field)}
              <button type="button" class="aster-grid-sort-clear" aria-label=${this.#text("clearFieldSorting", { field: fieldTitle(field) })} ?disabled=${!view.sort.some((key) => key.field === field)}
                @click=${(e: MouseEvent) => {
                  // Clearing disables this button, so focus a control that survives the render.
                  if (offered) (e.currentTarget as HTMLElement).closest("li")?.querySelector<HTMLElement>(".aster-grid-sort-direction")?.focus();
                  else this.querySelector<HTMLElement>(`.aster-grid-tool[aria-controls="${this.#id}-sort"]`)?.focus();
                  this.#setView(removeSort(view, field));
                }}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5 7.5 7.5M7.5 2.5 2.5 7.5"/></svg>
              </button>
            </span>
          </li>`)}
        </ul>`}
      <button type="button" class="aster-grid-panel-action" ?disabled=${view.sort.length === 0}
        @click=${() => {
          const first = this.querySelector<HTMLElement>(".aster-grid-sort-panel .aster-grid-sort-direction");
          (first ?? this.querySelector<HTMLElement>(`.aster-grid-tool[aria-controls="${this.#id}-sort"]`))?.focus();
          this.#setView({ ...view, sort: [] });
        }}>${this.#text("clearSorting")}</button>
    </div>`;
  }

  #columnsPanel(view: GridView): View {
    const title = (field: string) => this.#title(field);
    const shown = new Set(this.#visibleColumns(view).map((column) => column.field));
    return html`<div class="aster-grid-panel aster-popover" popover="manual" ${openWhen(true)} style=${placeStyle(`${this.#id}-tool-columns`)}
      id=${`${this.#id}-columns`} role="group" aria-label=${this.#text("columns")}
      @keydown=${(e: KeyboardEvent) => this.#panelKey(e)}>
      <p class="aster-grid-panel-title">${this.#text("columns")}</p>
      <ul>
        ${view.columns.map((c, i) => {
          const visible = shown.has(c.field);
          const hide = visible ? this.#hideRefusal(c.field) : undefined;
          const move = this.#moveRefusal(c.field);
          return html`<li>
            <label title=${hide ?? nothing}><input type="checkbox" .checked=${visible} ?disabled=${hide !== undefined}
              @change=${(e: Event) => this.#setView(setHidden(view, c.field, !(e.target as HTMLInputElement).checked))}>
              ${title(c.field)}</label>
            <button type="button" aria-label=${this.#text("moveFieldUp", { field: title(c.field) })} ?disabled=${i === 0 || move !== undefined} title=${move ?? nothing}
              @click=${() => this.#setView(moveColumn(view, c.field, i - 1))}>↑</button>
            <button type="button" aria-label=${this.#text("moveFieldDown", { field: title(c.field) })} ?disabled=${i === view.columns.length - 1 || move !== undefined} title=${move ?? nothing}
              @click=${() => this.#setView(moveColumn(view, c.field, i + 1))}>↓</button>
          </li>`;
        })}
      </ul>
      <button type="button" class="aster-grid-panel-action" @click=${() => this.#reset()}>${this.#text("resetView")}</button>
    </div>`;
  }

  #viewsPanel(view: GridView): View {
    const saved = this.#saved.value;
    const names = Object.keys(saved.named).sort();
    // The name is read from the input on submit: a re-render mustn't lose what was typed.
    const save = (form: HTMLFormElement) => {
      const n = (form.querySelector("input")?.value ?? "").trim();
      if (!n) return;
      this.#saved.value = { ...saved, named: { ...saved.named, [n]: view } };
      this.#panel.value = undefined;
    };
    return html`<div class="aster-grid-panel aster-popover" popover="manual" ${openWhen(true)} style=${placeStyle(`${this.#id}-tool-views`)}
      id=${`${this.#id}-views`} role="group" aria-label=${this.#text("views")}
      @keydown=${(e: KeyboardEvent) => this.#panelKey(e)}>
      <p class="aster-grid-panel-title">${this.#text("savedViews")}</p>
      ${names.length === 0 ? html`<p class="aster-grid-panel-note">${this.#text("noSavedViews")}</p>` : nothing}
      <ul>
        ${names.map(
          (n) => html`<li>
            <button type="button" class="aster-grid-panel-view" @click=${() => {
              this.#setView(reconcile(saved.named[n]!, this.#offered ?? view));
              this.#panel.value = undefined;
            }}>${n}</button>
            <button type="button" aria-label=${this.#text("deleteView", { name: n })} @click=${() => {
              const { [n]: _, ...rest } = saved.named;
              this.#saved.value = { ...saved, named: rest };
            }}>${this.#text("delete")}</button>
          </li>`,
        )}
      </ul>
      <form class="aster-grid-panel-save" @submit=${(e: SubmitEvent) => (e.preventDefault(), save(e.currentTarget as HTMLFormElement))}>
        <label class="aster-field" data-ring-owner>
          <input aria-label=${this.#text("viewName")} placeholder=${this.#text("viewNamePlaceholder")}>
        </label>
        <button type="submit" class="aster-grid-panel-action">${this.#text("save")}</button>
      </form>
      <button type="button" class="aster-grid-panel-action" @click=${() => this.#reset()}>${this.#text("resetView")}</button>
    </div>`;
  }

  #reset(): void {
    if (this.#offered) this.#setView(this.#offered);
    this.#panel.value = undefined;
  }

  /** Escape in an open panel, or on the toolbar while one is open, closes it; focus goes to its button. */
  #panelKey(e: KeyboardEvent): void {
    const panel = this.#panel.peek();
    if (e.key !== "Escape" || !panel) return;
    e.stopPropagation();
    this.#panel.value = undefined;
    this.querySelector<HTMLElement>(`.aster-grid-tool[aria-controls="${this.#id}-${panel}"]`)?.focus();
  }

  // ── header ──

  #header(column: GridColumn, field: Field | undefined, i: number, view: GridView, numeric: boolean, frozen: number, style: unknown, active: boolean, offset: number): View {
    // Only an effective key counts as sorted: a stored key the page refuses
    // is reported by the drift note, not drawn as if the rows came sorted.
    const keys = view.sort.filter((key) => this.#sortable(key.field));
    const sort = keys.findIndex((key) => key.field === column.field);
    const key = sort >= 0 ? keys[sort] : undefined;
    const ariaSort = sort === 0 ? (key!.descending ? "descending" : "ascending") : nothing;
    const title = this.#title(column.field);
    const align = this.#presentation.value.columns?.[column.field]?.align;
    const refusal = this.#sortRefusal(column.field);
    const move = this.#moveRefusal(column.field);
    const resize = this.#resizeRefusal(column.field);
    const multi = this.#multiSort();
    const hint = [
      refusal ?? this.#text("sortBy", { field: title }) + (multi ? this.#text("addToSort") : ""),
      move ?? this.#text("dragToMove"),
      resize ?? this.#text("dragToResize"),
    ].join(". ");
    return html`<div class="aster-grid-cell aster-grid-header" role="columnheader" aria-colindex=${i + offset} id=${`${this.#id}-h-${i}`}
      data-col=${i} aria-sort=${ariaSort} ?data-numeric=${numeric} ?data-frozen=${i < frozen} ?data-active=${active} style=${style}
      data-align=${align ?? nothing}
      data-field=${column.field} data-sortable=${refusal ? "false" : "true"} ?data-movable=${!move} ?data-resizable=${!resize}>
      <button type="button" class="aster-grid-sort" tabindex="-1" title=${hint}
        @pointerdown=${(e: PointerEvent) => this.#dragColumn(e, column.field)}
        @click=${(e: MouseEvent) => this.#sort(column.field, e.shiftKey)}>
        <span>${title}</span>
        ${key
          ? html`<svg class="aster-grid-sort-mark" viewBox="0 0 10 10" aria-hidden="true">
              <path d=${key.descending ? "M2 3.5 5 6.5l3-3" : "M2 6.5 5 3.5l3 3"}/></svg>
              ${keys.length > 1 ? html`<small>${sort + 1}</small>` : nothing}`
          : nothing}
      </button>
      ${refusal ? html`<span class="aster-sr-only">${refusal}</span>` : nothing}
      ${this.showHeaderMenu ? html`<button type="button" class="aster-grid-header-menu" tabindex="-1" aria-label=${this.#text("columnOptions", { field: title })}
        @click=${(e: MouseEvent) => this.#openMenu(column.field, e.currentTarget as HTMLElement)}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8l3-3"/></svg>
      </button>` : nothing}
      ${resize ? nothing : html`<span class="aster-grid-resize" aria-hidden="true" @pointerdown=${(e: PointerEvent) => this.#resize(e, column.field)}
        @dblclick=${() => this.#setView(setWidth(this.#view.peek()!, column.field, undefined))}></span>`}
    </div>`;
  }

  #menuItems(field: string): MenuItem[] {
    const view = this.#view.peek()!;
    const title = this.#title(field);
    const sorted = view.sort.find((s) => s.field === field);
    const visible = this.#visibleColumns(view);
    const frozen = this.#frozenCount(view, visible);
    const at = visible.findIndex((c) => c.field === field);
    const set = (v: GridView) => this.#setView(v);
    const width = (delta: number) => set(setWidth(view, field, (visible[at]?.width ?? this.#measuredWidth(field)) + delta));
    const frozenHere = at + 1 === frozen;
    const move = (to: number) => set(moveColumn(view, field, view.columns.findIndex((c) => c.field === visible[to]?.field)));
    const sortedFields = groupFields(view);
    const groupRefusal = this.#groupRefusal(field);
    const freezeRefusal = this.#freezeThroughRefusal(field);
    const moveRefusal = this.#moveRefusal(field);
    const resizeRefusal = this.#resizeRefusal(field);
    const hideRefusal = at < 0 ? undefined : this.#hideRefusal(field);
    const moveItem = (label: string, run: () => void, unavailable?: string): MenuItem =>
      moveRefusal ? { label, run: () => {}, disabled: moveRefusal } : { label, run, ...(unavailable ? { disabled: unavailable } : {}) };
    const custom = this.#columnMenu.value(field);
    return [
      ...custom,
      ...(custom.length ? [{ kind: "separator" as const }] : []),
      ...(this.#sortable(field)
        ? [
            {
              kind: "group" as const,
              label: this.#text("menuSort"),
              items: [
                { kind: "radio" as const, label: this.#text("ascending"), checked: !!sorted && !sorted.descending, run: () => set(sortDirection(view, field, false, false)) },
                { kind: "radio" as const, label: this.#text("descending"), checked: !!sorted?.descending, run: () => set(sortDirection(view, field, true, false)) },
                { kind: "radio" as const, label: this.#text("notSorted"), checked: !sorted, run: () => set(removeSort(view, field)) },
                ...(this.#multiSort() && view.sort.length > 0 && !sorted ? [{ label: this.#text("addToSortMenu"), run: () => set(sortDirection(view, field, false, true)) }] : []),
              ],
            },
            { kind: "separator" as const },
          ]
        : []),
      groupRefusal
        ? { label: this.#text("groupBy", { field: title }), run: () => {}, disabled: groupRefusal }
        : { kind: "check", label: this.#text("groupBy", { field: title }), checked: sortedFields.includes(field), run: () => set(setGroup(view, sortedFields.includes(field) ? sortedFields.filter((f) => f !== field) : [...sortedFields, field])) },
      freezeRefusal
        ? { label: this.#text("freezeUpTo", { field: title }), run: () => {}, disabled: freezeRefusal }
        : {
            kind: "check",
            label: this.#text("freezeUpTo", { field: title }),
            checked: frozenHere,
            run: () => set(frozenHere ? { ...view, frozen: 0 } : freezeThrough(view, field, (f) => this.#measuredWidth(f))),
          },
      {
        kind: "submenu",
        label: this.#text("menuMove"),
        items: [
          moveItem(this.#text("moveLeft"), () => set(nudgeColumn(view, field, -1)), at > 0 ? undefined : this.#text("firstColumn")),
          moveItem(this.#text("moveRight"), () => set(nudgeColumn(view, field, 1)), at < visible.length - 1 ? undefined : this.#text("lastColumn")),
          moveItem(this.#text("moveToStart"), () => move(0), at > 0 ? undefined : this.#text("firstColumn")),
          moveItem(this.#text("moveToEnd"), () => move(visible.length - 1), at < visible.length - 1 ? undefined : this.#text("lastColumn")),
        ],
      },
      {
        kind: "submenu",
        label: this.#text("menuWidth"),
        items: resizeRefusal
          ? [this.#text("wider"), this.#text("narrower"), this.#text("fitSpace")].map((label): MenuItem => ({ label, run: () => {}, disabled: resizeRefusal }))
          : [
              { label: this.#text("wider"), run: () => width(40) },
              { label: this.#text("narrower"), run: () => width(-40) },
              { label: this.#text("fitSpace"), run: () => set(setWidth(view, field, undefined)) },
            ],
      },
      { kind: "separator" },
      hideRefusal
        ? { label: this.#text("hideField", { field: title }), run: () => {}, disabled: hideRefusal }
        : { label: this.#text("hideField", { field: title }), run: () => set(setHidden(view, field, true)) },
      { label: this.#text("columnsEllipsis"), run: () => (this.#panel.value = "columns") },
    ];
  }

  #openMenu(field: string, anchor: HTMLElement, returnTo: HTMLElement = anchor): void {
    const title = this.#title(field);
    this.querySelector<Menu>(".aster-grid-menu")?.openFrom(anchor, this.#menuItems(field), this.#text("rowColumn", { field: title }), returnTo);
  }

  /**
   * The row's menu: the page's actions for the record, then the column's
   * own options as a submenu. At the pointer, or under the active cell.
   */
  #openRowMenu(row: number, col: number, point?: { x: number; y: number }): void {
    const item = untracked(() => this.#layout()).at(row);
    const field = this.#visibleColumns(this.#view.peek()!)[col]?.field;
    if (!field) return;
    const title = this.#collection!.type.field(field)?.title ?? field;
    const key = item.kind === "row" ? item.key : undefined;
    const entity = key === undefined ? undefined : this.#ctx.peek()?.store.get(this.#collection!.query.set, key)?.entity;
    const actions = key !== undefined && entity ? this.#rowMenu.peek()(entity, key) : [];
    const items: MenuItem[] = [
      ...actions,
      ...(actions.length ? [{ kind: "separator" as const }] : []),
      { kind: "submenu", label: this.#text("rowColumn", { field: title }), items: this.#menuItems(field) },
    ];
    const cell = this.querySelector<HTMLElement>(`#${CSS.escape(`${this.#id}-${row}-${col}`)}`);
    const rect = cell?.getBoundingClientRect();
    const at = point ?? { x: rect?.left ?? 0, y: rect?.bottom ?? 0 };
    this.querySelector<Menu>(".aster-grid-menu")?.openAt(at, items, key !== undefined ? this.#text("rowMenu") : this.#text("rowColumn", { field: title }), this.querySelector(".aster-grid-scroll"));
  }

  // ── filters ──

  /** A filter cell whose operator allowlist leaves no usable control. */
  #filterRefused(reason: string): View {
    return html`<span class="aster-grid-filter-refused" data-filterable="false" title=${reason}>${this.#text("notFilterable")}<span class="aster-sr-only"> ${reason}</span></span>`;
  }

  #filter(column: GridColumn, field: Field | undefined, view: GridView): View {
    if (!field) return nothing;
    const refusal = this.#filterRefusal(column.field);
    if (refusal) return this.#filterRefused(refusal);
    const operators = this.#operators(column.field);
    const title = this.#title(column.field);
    const current = view.filters[column.field];
    const lookup = this.#lookups.value[column.field];
    if (lookup && !operators.includes("in")) return this.#filterRefused(this.#filterOperatorRefusal(column.field, "in")!);
    if (!lookup && (field.type === "Edm.Boolean" || field.allowedValues) && !operators.includes("eq")) return this.#filterRefused(this.#filterOperatorRefusal(column.field, "eq")!);
    const ranged = isNumeric(field) || field.type === "Edm.Date";
    if (!lookup && !(field.type === "Edm.Boolean" || field.allowedValues) && !ranged && !operators.includes("contains")) {
      return this.#filterRefused(this.#filterOperatorRefusal(column.field, "contains")!);
    }
    if (!lookup && ranged && !["eq", "gt", "ge", "lt", "le"].some((op) => operators.includes(op))) {
      return this.#filterRefused(this.#filterOperatorRefusal(column.field, "eq")!);
    }
    const pick = (options: readonly Option[], value: Value | undefined, to: (v: Value) => Criteria | undefined) =>
      html`<aster-choice .label=${`Filter ${title}`} .placeholder=${"Any"} .options=${[{ value: "\u0000any", label: "Any" }, ...options]}
        .value=${value ?? "\u0000any"}
        @change=${(e: CustomEvent<Value>) => this.#setView(setFilter(this.#view.peek()!, column.field, e.detail === "\u0000any" ? undefined : to(e.detail)))}></aster-choice>`;
    const eq = (v: Value): Criteria => ({ op: "eq", field: column.field, value: v });
    // The grid's own filters are plain values; a relative date shows as no choice.
    const chosen = current && current.op === "eq" && "value" in current && !isRelative(current.value) ? current.value : undefined;
    if (lookup) {
      // Any of several: chips, and an `in` filter.
      const values = !current ? [] : current.op === "in" ? current.values : chosen !== undefined ? [chosen] : [];
      return html`<aster-picker .options=${this.#optionsFor(column.field, lookup)} .multiple=${true} .values=${values}
        .label=${`Filter ${title}`} .placeholder=${"Any"}
        @change=${(e: CustomEvent<readonly Value[]>) =>
          this.#setView(setFilter(this.#view.peek()!, column.field, e.detail.length ? { op: "in", field: column.field, values: e.detail } : undefined))}></aster-picker>`;
    }
    if (field.type === "Edm.Boolean") return pick([{ value: true, label: "Yes" }, { value: false, label: "No" }], chosen, eq);
    if (field.allowedValues) return pick(field.allowedValues.map((a) => ({ value: a.value, label: a.label ?? String(a.value) })), chosen, eq);
    const text = this.#filterText.value[column.field] ?? (ranged ? rangeText(current) : current && "value" in current ? String(current.value) : "");
    const error = this.#filterErrors.value[column.field];
    const errorId = `${this.#id}-filter-${column.field}`;
    const date = field.type === "Edm.Date";
    const anchor = `${this.#id}-filter-anchor-${column.field}`;
    const dialog = `${this.#id}-filter-calendar`;
    const open = date && this.#filterCalendar.open.value && this.#filterCalendarField.value === column.field;
    const button = `${this.#id}-filter-date-${column.field}`;
    const close = (refocus: boolean) => {
      this.#filterCalendar.open.value = false;
      if (refocus) this.querySelector<HTMLElement>(`#${CSS.escape(button)}`)?.focus();
    };
    return html`<label class="aster-field" data-ring-owner style=${date ? anchorStyle(anchor) : nothing}>
        <input .value=${live(text)} aria-label=${this.#text("filterField", { field: title })} aria-invalid=${error ? "true" : nothing}
          aria-describedby=${error ? errorId : nothing}
          placeholder=${ranged ? (date ? ">=1 Oct 2026" : ">5 or 1..3") : "Contains"}
          @input=${(e: InputEvent) => this.#typeFilter(column.field, field, (e.target as HTMLInputElement).value, ranged)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.#flushFilter(column.field)}
          @blur=${() => this.#flushFilter(column.field)}>
        ${date
          ? html`<button type="button" class="aster-date-button" id=${button} aria-label=${this.#text("chooseFilterDate", { field: title })}
              aria-haspopup="dialog" aria-expanded=${open ? "true" : "false"} aria-controls=${dialog}
              @click=${(e: MouseEvent) => {
                e.preventDefault();
                if (open) return close(false);
                this.#filterCalendarField.value = column.field;
                this.#filterCalendar.show(/\d{4}-\d{2}-\d{2}/.exec(text)?.[0], today());
                closeOutside(this.#filterCalendar, this);
              }}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>
            </button>`
          : nothing}
      </label>
      ${open
        ? calendarView(this.#filterCalendar, {
            id: dialog,
            anchor,
            value: undefined,
            today: today(),
            label: `Choose a date to filter ${title}`,
            choose: (d) => {
              close(true);
              this.#typeFilter(column.field, field, withDate(text, d), ranged);
            },
            dismiss: close,
          })
        : nothing}
      ${error ? html`<p class="aster-error" id=${errorId}>${error}</p>` : nothing}`;
  }

  /** Applies a filter being typed now, rather than after the pause: Enter or leaving the input. */
  #flushFilter(name: string): void {
    const pending = this.#filterApply.get(name);
    if (!pending) return;
    clearTimeout(this.#filterTimers.get(name));
    pending();
  }

  readonly #filterApply = new Map<string, () => void>();

  #typeFilter(name: string, field: Field, text: string, ranged: boolean): void {
    this.#filterText.value = { ...this.#filterText.peek(), [name]: text };
    clearTimeout(this.#filterTimers.get(name));
    const apply = () => {
      this.#filterApply.delete(name);
        const parsed: { criteria?: Criteria | undefined; error?: string } = ranged
          ? parseRange(field, text)
          : { criteria: containsText(name, text) };
        const refused = parsed.criteria && !parsed.error ? this.#criteriaOperatorRefusal(name, parsed.criteria) : undefined;
        if (refused) parsed.error = refused;
        const { [name]: _, ...errors } = this.#filterErrors.peek();
        this.#filterErrors.value = parsed.error ? { ...errors, [name]: parsed.error } : errors;
        if (!parsed.error) this.#setView(setFilter(this.#view.peek()!, name, parsed.criteria));
    };
    this.#filterApply.set(name, apply);
    this.#filterTimers.set(name, setTimeout(apply, FILTER_DELAY));
  }

  #toggleFilters(view: GridView): void {
    if (this.#chrome.peek().filterRow === false) return;
    const showing = this.#filtersShown();
    if (showing && Object.keys(view.filters).length > 0) {
      this.#filterText.value = {};
      this.#filterErrors.value = {};
      this.#setView({ ...view, filters: {} });
    }
    // A forced row stays open; the button still clears its filters.
    if (this.#chrome.peek().filterRow === true) return;
    this.#showFilters.value = !showing;
  }

  #optionsFor(field: string, lookup: Lookup): PickerOptions {
    let options = this.#options.get(field);
    if (!options) {
      const ctx = this.#ctx.peek()!;
      options = new PickerOptions(ctx, { set: lookup.set, display: lookup.display, pageSize: 500 });
      void options.all.loadAll();
      this.#options.set(field, options);
      const all = options.all;
      this.onDisconnect(() => ctx.release(all));
    }
    return options;
  }

  // ── cells ──

  #cell(column: GridColumn, field: Field | undefined, entity: Entity, key: KeyText, ctx: DataContext, mapped?: MappedValue): View | string {
    const render = this.#renderers.value[column.field];
    if (render) return render(entity, key);
    const value: Value | undefined = entity[column.field];
    const formatter = this.#formatters.value[column.field];
    if (formatter) return formatter(value, entity, field);
    if (mapped) return mapped.label;
    const lookup = this.#lookups.value[column.field];
    if (lookup && value !== null && value !== undefined) {
      const related = ctx.lookup(lookup.set, keyText([value])).value;
      return related ? String(related[lookup.display] ?? "") : html`<span class="aster-grid-skeleton"></span>`;
    }
    return cellText(field, value, this.#presentation.value.columns?.[column.field]?.format);
  }

  #external(): Collection | undefined {
    const binding = this.#binding.value;
    if (binding) return binding;
    // A tree owns one collection per level; a supplied selection is state, not the data binding.
    if (this.#treeOptions.value) return undefined;
    return this.#selection.value?.collection;
  }

  #syncBound(): void {
    const collection = this.#external();
    const view = this.#view.value;
    const base = this.#base.value;
    const paths = this.#sortPaths.value;
    // Capability changes alter the projected query even when the view doesn't.
    this.#policy.value;
    this.#ctx.value;
    if (!collection) { this.#bound = undefined; return; }
    const query = collection.query;
    untracked(() => {
      if (collection !== this.#bound || query !== this.#boundQuery) {
        const sameFilter = collection === this.#bound && JSON.stringify(query.filter) === JSON.stringify(this.#boundQuery?.filter);
        const initial = this.#bound === undefined;
        this.#bound = collection;
        this.#boundQuery = query;
        if (!sameFilter) this.#boundBase = query.filter;
        const reverse = new Map(Object.entries(paths).map(([field, path]) => [path, field]));
        const { criteria: _, ...rest } = view ?? defaultView(collection.type);
        this.view = { ...(sameFilter || initial ? (view ?? rest) : rest), ...(!sameFilter && !initial ? { filters: {} } : {}),
          sort: (query.orderBy ?? []).map((sort) => ({ ...sort, field: reverse.get(sort.field) ?? sort.field })) };
        return;
      }
      if (!view) return;
      const parts = [this.#boundBase, base].filter((c): c is Criteria => c !== undefined);
      const filter = parts.length > 1 ? { op: "and" as const, args: parts } : parts[0];
      // View entries go through capability filtering; refused filters drop out and the drift note reports them.
      const projected = this.#query(query.set, view, filter, paths);
      if (JSON.stringify([query.filter, query.orderBy]) === JSON.stringify([projected.filter, projected.orderBy])) return;
      const { filter: _filter, orderBy: _orderBy, ...rest } = query;
      const next: Query = { ...rest, ...projected };
      this.#boundQuery = next;
      collection.setQuery(next);
    });
  }

  #recoverActive(): void {
    this.#version.value;
    // Paged mode keeps the active row inside the page it chose.
    if (this.#pagedMode()) return;
    const grouping = this.#grouping;
    if (grouping) {
      const rows = grouping.rows.value;
      const total = grouping.total.value;
      const key = this.#activeKey.value;
      const header = this.#groupFocus.value;
      untracked(() => {
        const { row, col } = this.#active.peek();
        if (row < 0 || total === undefined) return;
        let next = rows.findIndex((r) => r.kind === "row" ? key !== undefined && r.key === key : key === undefined && r.id === header?.id);
        if (next < 0 && header) {
          for (let n = header.path.length; n > 0 && next < 0; n--) next = rows.findIndex((r) => r.kind === "group" && JSON.stringify(r.path) === JSON.stringify(header.path.slice(0, n)));
        }
        if (next < 0) next = Math.min(row, Math.max(0, rows.length - 1));
        if (next !== row) this.#active.value = { row: next, col };
        const target = rows[next];
        if (target?.kind === "group" && (key !== undefined || header?.id !== target.id)) {
          this.#activeKey.value = undefined;
          this.#groupFocus.value = { id: target.id, path: target.path };
        }
      });
      return;
    }
    const collection = this.#collection;
    if (!collection || !this.#external()) return;
    const keys = collection.keys.value;
    if (collection.count.value === undefined) return;
    const active = this.#activeKey.value;
    untracked(() => {
      const { row, col } = this.#active.peek();
      if (row < 0) return;
      const found = active === undefined ? -1 : keys.indexOf(active);
      const next = found >= 0 ? found : Math.min(row, Math.max(0, keys.length - 1));
      if (next !== row) this.#active.value = { row: next, col };
      // An evicted position keeps its navigation key until that position is loaded again.
      if (keys[next] !== undefined || keys.length === 0) this.#activeKey.value = keys[next];
    });
  }

  #choose(key: KeyText, index: number, extend: boolean, toggle: boolean): boolean {
    if (!this.#selectionAllowed()) return false;
    const selection = this.#selection.peek();
    if (!selection) return false;
    let accepted = true;
    if (extend && selection.multiple) {
      accepted = selection.selectAll(this.#shiftRange(selection, key, index, this.#selectionAnchor));
    } else if (!extend && this.#cascadeEnabled(selection)) {
      // Cascades settle several keys at once: toggling the clicked row first
      // would keep it selected when an ordered selection rejects the whole.
      accepted = this.#cascadeChoose(selection, key, !selection.keys.peek().includes(key));
      this.#selectionAnchor = { key, index, query: selection.collection.query };
    } else {
      if (toggle || selection.ordered) accepted = selection.toggle(key);
      else selection.select(key);
      this.#selectionAnchor = { key, index, query: selection.collection.query };
    }
    this.#selectionNote.value = accepted ? "" : `Select at most ${selection.maxOrdered} ordered items. Deselect an item to add another.`;
    return accepted;
  }

  /** The keys between the anchor and the click: visible tree order when there is a tree, membership order otherwise. */
  #shiftRange(selection: Selection, key: KeyText, index: number, anchor: { key: KeyText; index: number; query: Query } | undefined): KeyText[] {
    if (this.#tree && anchor) {
      const visible = this.#layout().keys;
      const from = visible.indexOf(anchor.key);
      const to = visible.indexOf(key);
      if (from >= 0 && to >= 0) {
        return visible.slice(Math.min(from, to), Math.max(from, to) + 1).filter((k): k is KeyText => k !== undefined);
      }
    }
    const slots = selection.collection.keys.peek();
    const loaded = anchor ? slots.indexOf(anchor.key) : -1;
    const from = loaded >= 0 ? loaded : anchor?.query === selection.collection.query ? anchor.index : index;
    return slots.slice(Math.min(from, index), Math.max(from, index) + 1).filter((k): k is KeyText => k !== undefined);
  }

  /** Cascade needs a tree, a multiple shared selection and the tree's switch. */
  #cascadeEnabled(selection: Selection): boolean {
    return selection.multiple && this.#tree !== undefined && this.#treeOptions.value?.cascadeSelection === true;
  }

  /** The loaded tree rows whose parent chain passes through `key`. */
  #loadedDescendants(key: KeyText): KeyText[] {
    const rows = this.#tree?.rows.peek() ?? [];
    const parentOf = new Map<KeyText, KeyText | undefined>();
    for (const row of rows) if (row.key !== undefined) parentOf.set(row.key, row.parent);
    const under = (candidate: KeyText): boolean => {
      let parent = parentOf.get(candidate);
      while (parent !== undefined) {
        if (parent === key) return true;
        parent = parentOf.get(parent);
      }
      return false;
    };
    return rows.flatMap((row) => (row.key !== undefined && under(row.key) ? [row.key] : []));
  }

  /**
   * Applies a selection to a node's loaded descendants, and settles each
   * ancestor on whether all its loaded children are chosen. `choosing` is
   * the clicked row's state before this call, which itself changes nothing.
   */
  #cascadeChoose(selection: Selection, key: KeyText, choosing: boolean): boolean {
    const rows = this.#tree?.rows.peek() ?? [];
    const parentOf = new Map<KeyText, KeyText | undefined>();
    for (const row of rows) if (row.key !== undefined) parentOf.set(row.key, row.parent);
    const under = new Set<KeyText>([key, ...this.#loadedDescendants(key)]);
    let next = [...selection.keys.peek()];
    if (choosing) {
      for (const row of rows) if (row.key !== undefined && under.has(row.key) && !next.includes(row.key)) next.push(row.key);
    } else {
      next = next.filter((candidate) => !under.has(candidate));
    }
    let parent = parentOf.get(key);
    while (parent !== undefined) {
      const children = rows.flatMap((row) => (row.key !== undefined && row.parent === parent ? [row.key] : []));
      const completed = children.length > 0 && children.every((child) => next.includes(child));
      if (completed && !next.includes(parent)) next.push(parent);
      if (!completed) next = next.filter((candidate) => candidate !== parent);
      parent = parentOf.get(parent);
    }
    return selection.selectAll(next);
  }

  #moveSelection(key: KeyText, delta: number): void {
    if (!this.#selectionAllowed()) return;
    const selection = this.#selection.peek();
    if (!selection) return;
    const index = selection.keys.peek().indexOf(key) + delta;
    if (selection.move(key, index)) this.#selectionNote.value = `Moved to selection position ${index + 1}.`;
  }

  #selectionControl(key: KeyText, entity: Entity | undefined, chosen: readonly KeyText[], hidden?: ReadonlySet<string>): View {
    const selection = this.#selection.value!;
    const index = chosen.indexOf(key);
    const field = this.#collection!.type.titleField;
    const name = field && hidden?.has(field) ? "Hidden" : String((entity && field ? entity[field] : undefined) ?? key);
    return html`<span class="aster-grid-selection" @click=${(e: Event) => e.stopPropagation()}
      @dblclick=${(e: Event) => e.stopPropagation()}
      @focusout=${(e: FocusEvent) => {
        const node = e.currentTarget as HTMLElement;
        queueMicrotask(() => { if (!node.contains(document.activeElement)) this.#selectionInside.value = undefined; });
      }} @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault(); this.#selectionInside.value = undefined; this.focus();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
        if (e.key !== "Tab") e.stopPropagation();
      }}>
      <button type="button" class="aster-grid-pick" tabindex=${this.#selectionInside.value === key ? 0 : -1} aria-pressed=${String(index >= 0)}
        aria-label=${`${selection.multiple && index >= 0 ? "Deselect" : "Select"} ${name}`}
        @click=${() => this.#choose(key, this.#collection!.keys.peek().indexOf(key), false, selection.multiple)}>
        ${index < 0 ? "○" : selection.ordered ? String(index + 1) : "✓"}</button>
      ${selection.ordered && index >= 0 ? html`<span class="aster-sr-only">Selection ${index + 1} of ${chosen.length}.</span>
        <button type="button" tabindex=${this.#selectionInside.value === key ? 0 : -1} class="aster-grid-pick" aria-label=${`Move ${name} earlier in selection`}
          ?disabled=${index === 0} @click=${() => this.#moveSelection(key, -1)}>↑</button>
        <button type="button" tabindex=${this.#selectionInside.value === key ? 0 : -1} class="aster-grid-pick" aria-label=${`Move ${name} later in selection`}
          ?disabled=${index === chosen.length - 1} @click=${() => this.#moveSelection(key, 1)}>↓</button>` : nothing}
    </span>`;
  }

  /**
   * The selection column's header. With a multiple shared selection it is a
   * select-all for the loaded rows, mixed when only some are chosen; a single
   * or owned selection has nothing to select in bulk.
   */
  #selectionHead(selection: Selection | undefined, chosen: readonly KeyText[]): View {
    const loaded = this.#tree
      ? this.#tree.rows.peek().flatMap((row) => (row.key !== undefined ? [row.key] : []))
      : this.#collection?.keys.value.filter((key): key is KeyText => key !== undefined) ?? [];
    const loadedSet = new Set(loaded);
    const picked = loaded.filter((key) => chosen.includes(key));
    const checked = loaded.length > 0 && picked.length === loaded.length;
    const mixed = picked.length > 0 && !checked;
    const multiple = selection?.multiple === true;
    return html`<div class="aster-grid-cell aster-grid-select aster-grid-select-head" role="columnheader" aria-colindex="1" id=${`${this.#id}-h-s`}>
      ${multiple
        ? html`<input type="checkbox" .checked=${checked} .indeterminate=${mixed} tabindex="0"
            aria-label=${checked ? "Clear the selection of loaded rows" : mixed ? "Select all loaded rows, some are selected" : "Select all loaded rows"}
            @change=${(e: Event) => {
              const input = e.currentTarget as HTMLInputElement;
              if (!selection) return;
              if (checked) {
                const keep = chosen.filter((key) => !loadedSet.has(key));
                selection.selectAll(keep);
                this.#selectionNote.value = keep.length ? `Kept ${keep.length} selected ${keep.length === 1 ? "row" : "rows"} not loaded here.` : "";
              } else if (selection.selectAll([...new Set([...chosen, ...loaded])])) {
                this.#selectionNote.value = "";
              } else {
                this.#selectionNote.value = `Select at most ${selection.maxOrdered} ordered items. Deselect an item to add another.`;
              }
              const now = selection.keys.peek();
              const picked = loaded.filter((key) => now.includes(key)).length;
              input.checked = loaded.length > 0 && picked === loaded.length;
              input.indeterminate = picked > 0 && picked < loaded.length;
            }}>`
        : html`<span class="aster-sr-only">Selection</span>`}
    </div>`;
  }

  /** One row's checkbox in the leading selection column. */
  #selectionCell(key: KeyText | undefined, index: number, selection: Selection | undefined, chosen: readonly KeyText[], entity: Entity | undefined, hidden?: ReadonlySet<string>): View {
    if (key === undefined) return html`<div class="aster-grid-cell aster-grid-select" role="gridcell" aria-colindex="1" data-col="-1"></div>`;
    const chosenIndex = chosen.indexOf(key);
    const checked = selection ? chosenIndex >= 0 : key === this.#selected.value;
    const field = this.#collection?.type.titleField;
    const name = field && hidden?.has(field) ? "Hidden" : String((entity && field ? entity[field] : undefined) ?? key);
    // A folder with some chosen descendants is mixed while cascade is on.
    const mixed = !checked && selection?.multiple === true && this.#tree !== undefined && this.#treeOptions.value?.cascadeSelection === true
      && this.#loadedDescendants(key).some((descendant) => chosen.includes(descendant));
    const label = mixed
      ? `Select all under ${name}, some are selected`
      : selection?.multiple ? `${checked ? "Deselect" : "Select"} ${name}` : `${checked ? "Selected" : "Select"} ${name}`;
    return html`<div class="aster-grid-cell aster-grid-select" role="gridcell" aria-colindex="1" data-col="-1" data-label="Select">
      <input type="checkbox" .checked=${checked} .indeterminate=${mixed} tabindex="-1" aria-label=${label}
        @change=${(e: Event) => {
          const input = e.currentTarget as HTMLInputElement;
          if (selection) this.#choose(key, this.#collection!.keys.peek().indexOf(key), false, selection.multiple);
          else this.#activate(index, this.#active.peek().col);
          // The native toggle ran first; settle it on the state that resulted.
          input.checked = selection ? selection.keys.peek().includes(key) : key === this.#selected.peek();
          const chosenNow = selection?.keys.peek() ?? [];
          input.indeterminate = !input.checked && selection?.multiple === true && this.#tree !== undefined && this.#treeOptions.peek()?.cascadeSelection === true
            && this.#loadedDescendants(key).some((descendant) => chosenNow.includes(descendant));
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Escape") {
            e.preventDefault();
            this.focus();
          } else if (e.key !== "Tab") e.stopPropagation();
        }}
        @dblclick=${(e: MouseEvent) => e.stopPropagation()}
        @contextmenu=${(e: MouseEvent) => e.stopPropagation()}>
      ${selection?.ordered && chosenIndex >= 0 ? html`<span class="aster-grid-select-rank" aria-hidden="true">${chosenIndex + 1}</span>` : nothing}
    </div>`;
  }

  // ── data and view ──

  /** With `persist`, the person's last view replaces the page's, reconciled with today's columns. */
  #restore(): void {
    const key = this.#persist.value;
    const offered = this.#offered;
    if (!key || !offered) return;
    untracked(() => {
      const saved = loadViews(key);
      this.#restored = true;
      this.#saved.value = saved;
      if (saved.current) this.#view.value = reconcile(saved.current, offered);
    });
  }

  /** The one place views are written: the current view and the named ones, whenever either changes. */
  #keep(): void {
    const view = this.#view.value;
    const saved = this.#saved.value;
    const key = this.#persist.value;
    if (!key || !view || !this.#restored) return;
    storeViews(key, { named: saved.named, current: view });
  }

  /** Stored views have been read; until then, writing would replace them. */
  #restored = false;
  /** The view and effective selection the change events last reported. */
  #viewBefore: GridView | undefined;
  #selectionBefore: string | undefined;

  /** Publishes the shared selection or active row, plus view and total. */
  #announce(): void | (() => void) {
    const key = this.#publish.value;
    const scope = scopeOf(this);
    this.#version.value;
    const ctx = this.#ctx.peek();
    const collection = this.#collection;
    if (!key || !scope || !ctx || !collection) return undefined;
    const set = collection.query.set;
    const shared = this.#selection.value;
    const publication = shared ? selectionPublication(shared) : undefined;
    return scope.publish(key, {
      values: {
        key: this.#selected,
        selected: computed(() => {
          const k = this.#selected.value;
          return k === undefined ? undefined : ctx.store.record(set, k).value?.entity;
        }),
        any: computed(() => this.#selected.value !== undefined),
        ...publication?.values,
        view: computed(() => this.#view.value),
        total: computed(() => this.#layout().total),
      },
      types: { selected: collection.type },
      ...(publication?.hidden ? { hidden: publication.hidden } : {}),
    });
  }

  /** Drift is announced once per set of dropped entries; dismissing hides the note, not the announcement. */
  #driftAnnounced = "";

  /** Notifies after the view changed, whichever code changed it; never cancelable. */
  #viewChanged(): void {
    const view = this.#view.value;
    if (view === this.#viewBefore) return;
    const before = this.#viewBefore;
    this.#viewBefore = view;
    if (!before || !view) return;
    if (JSON.stringify(before.sort) !== JSON.stringify(view.sort)) this.emit("sort-change", { sort: view.sort }, { cancelable: false });
    if (JSON.stringify(before.filters) !== JSON.stringify(view.filters)) this.emit("filter-change", { filters: view.filters }, { cancelable: false });
    if (JSON.stringify(before.criteria) !== JSON.stringify(view.criteria)) this.emit("criteria-change", { criteria: view.criteria }, { cancelable: false });
  }

  /** Notifies after the effective selection changed; owned selection reports its one key. */
  #selectionChanged(): void {
    const shared = this.#selection.value;
    const keys = shared ? [...shared.keys.value] : this.#selected.value === undefined ? [] : [this.#selected.value];
    const id = keys.join("\u0000");
    if (id === this.#selectionBefore) return;
    const first = this.#selectionBefore === undefined;
    this.#selectionBefore = id;
    if (!first) this.emit("selection-change", { keys }, { cancelable: false });
  }

  #driftAnnounce(): void {
    const entries = this.#drift.value;
    const key = this.#driftKey(entries);
    if (!entries.length) {
      this.#driftAnnounced = "";
      this.#driftDismissed.value = "";
      return;
    }
    if (key === this.#driftAnnounced) return;
    this.#driftAnnounced = key;
    announce(this.#driftText(entries));
  }

  #setView(view: GridView): void {
    const request = ++this.#viewRequest;
    if (this.#editing.peek() && (JSON.stringify(this.#groupedFields(view)) !== JSON.stringify(this.#groupedFields(this.#view.peek())) || JSON.stringify(view.criteria) !== JSON.stringify(this.#view.peek()?.criteria))) {
      void this.#endEdit(true).then((saved) => {
        if (saved && this.isConnected && request === this.#viewRequest) this.#commitView(view);
      });
      return;
    }
    this.#commitView(view);
  }

  #commitView(view: GridView): void {
    const beforeGroups = this.#groupedFields(this.#view.peek());
    const afterGroups = this.#groupedFields(view);
    const focused = this.contains(document.activeElement) ? document.activeElement?.closest<HTMLElement>(".aster-grid-group-tools") : null;
    if (focused && JSON.stringify(beforeGroups) !== JSON.stringify(afterGroups)) {
      const field = focused.dataset.groupField!;
      this.#groupToolFocus = { field: afterGroups.includes(field) ? field : afterGroups[Math.min(beforeGroups.indexOf(field), afterGroups.length - 1)],
        action: (document.activeElement as HTMLElement)?.dataset.groupAction ?? "remove" };
    }
    const before = this.#view.peek()?.sort;
    this.#view.value = view;
    if (before && JSON.stringify(before) !== JSON.stringify(view.sort)) announce(this.#sortText(view));
  }

  /** Uses a supplied collection, or owns one whose query follows the view. */
  #follow(): void {
    const ctx = this.#ctx.value;
    const set = this.set;
    const binding = this.#external();
    if (!ctx || !set) return;
    if (binding) {
      untracked(() => {
        this.#selected.value = undefined;
        this.#ownedOptions = undefined;
        if (this.#collection === binding) { this.#ownsCollection = false; return; }
        if (this.#ownsCollection && this.#collection) ctx.release(this.#collection);
        this.#ownsCollection = false;
        this.#collection = binding;
        this.#version.value++;
      });
      return;
    }
    untracked(() => {
      if (!this.#view.peek()) this.view = defaultView(ctx.schema.set(set).type);
    });
    const options = this.#collectionOptions();
    const optionsKey = JSON.stringify(options);
    if (this.#collection?.query.set === set && (this.#tree || (this.#ownsCollection && this.#ownedOptions === optionsKey))) return;
    const treeOptions = untracked(() => this.#treeOptions.value);
    if (treeOptions) {
      untracked(() => {
        this.#ownedOptions = undefined;
        this.#tree?.dispose();
        const filters = computed((): Criteria | undefined => {
          return this.#query(set, this.#view.value ?? { columns: [], sort: [], filters: {}, frozen: 0 }).filter;
        });
        this.#tree = new Tree(ctx, {
          set,
          ...treeOptions,
          base: computed(() => this.#base.value),
          filter: filters,
          orderBy: computed(() => viewQuery(set, this.#view.value ?? { columns: [], sort: [], filters: {}, frozen: 0 }, undefined, this.#sortPaths.value, this.#capabilities()).orderBy ?? []),
        });
        this.#collection = this.#tree.level(undefined);
        this.#autoOpen(this.#tree, treeOptions.autoOpen ?? 0);
        this.#version.value++;
      });
      this.onDisconnect(() => {
        this.#tree?.dispose();
        this.#tree = undefined;
        this.#collection = undefined;
      });
      return;
    }
    const query = computed(() => this.#query(set, this.#view.value ?? { columns: [], sort: [], filters: {}, frozen: 0 }, this.#base.value, this.#sortPaths.value));
    untracked(() => {
      if (this.#ownsCollection && this.#collection) ctx.release(this.#collection);
      this.#collection = ctx.collection(query, options);
      this.#ownsCollection = true;
      this.#ownedOptions = optionsKey;
      this.#version.value++;
    });
  }

  /** The owned collection's data options, so a change recreates it. */
  #ownedOptions: string | undefined;

  /** A new query (filter, sort, grouping, base) starts at the top, with its first row active. */
  #toTop(): void {
    const view = this.#view.value;
    // Before the view arrives there's no query to compare with.
    if (!view) return;
    const key = JSON.stringify([view.filters, view.criteria, view.sort, view.groupBy, this.#base.value, this.#external()?.query, this.#capabilitiesVersion.value]);
    untracked(() => {
      if (this.#lastQuery !== undefined && this.#lastQuery !== key) {
        this.#page.value = 0;
        const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
        if (scroll) scroll.scrollTop = 0;
        this.#top.value = 0;
        // A sort or filter made from the header or filter row keeps the active cell there.
        const { row, col } = this.#active.peek();
        this.#active.value = { row: row < 0 ? row : 0, col };
      }
      this.#lastQuery = key;
    });
  }

  #lastQuery: string | undefined;

  /**
   * Loads the pages the viewport shows, once scrolling pauses: of the
   * collection, or of each expanded group in view.
   */
  #load(): void {
    const collection = this.#collection;
    this.#version.value;
    if (!collection || this.#deferred()) return;
    const layout = this.#layout();
    this.#heights.setKeys(layout.keys);
    const { start, end } = this.#heights.window(this.#top.value, this.#viewport.value, OVERSCAN);
    const wanted = new Map<Collection, { from: number; to: number }>();
    if (this.#pagedMode()) {
      const first = layout.first ?? 0;
      const size = Math.max(1, this.#pageSize.peek());
      wanted.set(collection, { from: first, to: Math.max(first + 1, layout.total === undefined ? first + size : Math.min(layout.total, first + size)) });
    } else if (!this.#groupedFields().length && !this.#tree) wanted.set(collection, { from: start, to: Math.max(end, 1) });
    else {
      // A tree's top level loads before it has lines to look at.
      if (this.#tree && collection.count.value === undefined) wanted.set(collection, { from: 0, to: 1 });
      for (let i = start; i < end; i++) {
        const item = layout.at(i);
        if (item.kind !== "row" || !item.collection) continue;
        const range = wanted.get(item.collection) ?? { from: item.local, to: item.local + 1 };
        wanted.set(item.collection, { from: Math.min(range.from, item.local), to: Math.max(range.to, item.local + 1) });
      }
    }
    // One load at a time, always for the latest position: while one is in
    // flight, the newest wanted range waits and the ones scrolled past drop.
    const pending = this.#pendingFocus.value;
    const retain = [this.#active.peek().row, ...(pending === undefined ? [] : [pending])];
    const run = () => {
      this.#loadingRows = true;
      void Promise.all([...wanted].map(([c, r]) => c.view(r.from, r.to, c === this.#external() ? retain : []).catch(() => {}))).finally(() => {
        this.#loadingRows = false;
        const next = this.#nextLoad;
        this.#nextLoad = undefined;
        next?.();
      });
    };
    if (this.#loadingRows) this.#nextLoad = run;
    else run();
  }

  #loadingRows = false;
  #nextLoad: (() => void) | undefined;

  /** The grid's lines: the collection's keys, or groups with the rows of those expanded. */
  #layout(): Layout {
    const collection = this.#collection!;
    const view = this.#view.value;
    const tree = this.#tree;
    if (tree) {
      const nodes = tree.rows.value;
      const keys = nodes.map((n) => n.key);
      return {
        keys,
        total: collection.count.value,
        ...atLeast(collection),
        groups: undefined,
        at: (i) => {
          const n = nodes[i]!;
          return { kind: "row", key: n.key, collection: n.collection, local: n.index, node: n };
        },
      };
    }
    if (this.#pagedMode()) {
      const keys = collection.keys.value;
      const total = collection.count.value;
      const size = Math.max(1, this.#pageSize.value);
      const pages = total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
      const page = pages === undefined ? Math.max(0, this.#page.value) : Math.min(Math.max(0, this.#page.value), pages - 1);
      const first = page * size;
      const end = total === undefined ? Math.min(keys.length, first + size) : Math.min(total, first + size);
      const slice = keys.slice(first, end);
      return {
        keys: slice,
        total,
        ...atLeast(collection),
        groups: undefined,
        first,
        at: (i) => ({ kind: "row", key: slice[i], collection, local: first + i }),
      };
    }
    if (!this.#groupedFields(view).length) {
      const keys = collection.keys.value;
      const total = collection.count.value;
      return { keys, total, ...atLeast(collection), groups: undefined, at: (i) => ({ kind: "row", key: keys[i], collection, local: i }) };
    }
    const grouping = this.#grouping;
    const rows = grouping?.rows.value ?? [];
    const keys = rows.map((row) => row.kind === "group" ? row.id : row.key);
    return { keys, total: grouping?.total.value, groups: grouping?.root.rows.value?.length, at: (i) => rows[i]! };
  }

  #groupRow(item: GroupingHeader, index: number, rowIndex: number, columns: number, _view: GridView, active: boolean): View {
    const field = this.#collection!.type.field(item.field);
    const label = this.#groupLabel(item.field, field, item.group.value);
    const fields = this.#groupedFields(this.#view.value);
    const path = item.path.map((value, i) => String(this.#groupLabel(fields[i]!, this.#collection!.type.field(fields[i]!), value))).join(" / ");
    return html`<div class="aster-grid-row aster-grid-group" role="row" aria-rowindex=${rowIndex} data-index=${index}
      data-key=${item.id} aria-level=${item.level} aria-posinset=${item.position} aria-setsize=${item.siblings}
      aria-expanded=${item.expanded ? "true" : "false"} aria-busy=${item.loading ? "true" : "false"} style=${`--level:${item.level - 1}`}>
      <div class="aster-grid-cell" role="gridcell" id=${`${this.#id}-${index}-0`} aria-colindex="1" aria-colspan=${columns}
        ?data-active=${active} @click=${(e: MouseEvent) => { if (!(e.target as Element).closest("button")) this.#toggleGroup(item.id); }}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3"/></svg>
        <span class="aster-sr-only">${this.#title(item.field)}: </span>
        <span class="aster-grid-group-label">${label}</span>
        <span class="aster-grid-group-count">${new Intl.NumberFormat("en-GB").format(item.group.count)}</span>
        ${item.totalsAvailable ? this.#summaries.value.map((summary, i) => summary.method === "count" ? nothing : html`<span class="aster-grid-group-summary">${this.#summaryLabel(summary)}: ${this.#summaryValue(summary, item.group.totals[`s${i}`] ?? null)}</span>`) : nothing}
        ${item.loading ? html`<span class="aster-grid-group-loading" role="status">${this.#text("loading")}</span>` : nothing}
        ${item.error !== undefined ? html`<span class="aster-error" role="status">${this.#text("groupLoadFailed")}</span>
          <button type="button" class="aster-grid-tool" aria-label=${this.#text("retryGroup", { group: path })} @click=${() => { this.#activate(index, 0); this.focus({ preventScroll: true }); void this.#grouping?.retry(item.id).catch(() => {}); }}>${this.#text("retry")}</button>` : nothing}
      </div>
    </div>`;
  }

  #aggregates(summaries: readonly GridSummary[]): Aggregate[] {
    return summaries.flatMap((s, i) => s.method === "count" ? [] : [{ field: s.field, method: s.method, as: `s${i}` }]);
  }

  #summarize(): void {
    this.#version.value;
    const ctx = this.#ctx.value;
    const collection = this.#collection;
    const config = this.#summaries.value;
    untracked(() => {
      if (this.#summaryConfig !== undefined && this.#summaryCollection === collection && this.#summaryConfig === config && this.#summaryContext === ctx) return;
      this.#summary?.dispose();
      this.#summary = undefined;
      this.#summaryCollection = collection;
      this.#summaryConfig = config;
      this.#summaryContext = ctx;
      if (ctx && collection && config.length) {
        this.#summary = ctx.summary(computed(() => collection.query), this.#aggregates(config));
      }
      this.#version.value++;
    });
  }

  #summaryLabel(summary: GridSummary): string {
    if (summary.label) return summary.label;
    if (summary.method === "count") return this.#text("summaryRows");
    const title = this.#title(summary.field);
    switch (summary.method) {
      case "sum":
        return this.#text("summarySum", { field: title });
      case "min":
        return this.#text("summaryMinimum", { field: title });
      case "max":
        return this.#text("summaryMaximum", { field: title });
      case "average":
        return this.#text("summaryAverage", { field: title });
      case "countdistinct":
        return this.#text("summaryDistinct", { field: title });
      default:
        return title;
    }
  }

  #summaryValue(summary: GridSummary, value: Value): View | string {
    if (value === null) return "—";
    if (summary.method === "count" || summary.method === "countdistinct") return new Intl.NumberFormat("en-GB").format(Number(value));
    const field = this.#collection?.type.field(summary.field);
    const format = this.#presentation.value.columns?.[summary.field]?.format;
    return format ? cellText(field, value, format) : formatValue(field, value);
  }

  #summaryView(): View {
    const summary = this.#summary;
    if (!summary) return nothing;
    const values = summary.values.value;
    const status = summary.status.value;
    return html`<section class="aster-grid-summary" aria-label=${this.#text("summaryAria", { label: this.#label.value })} aria-busy=${status === "loading" ? "true" : "false"}>
      <aster-progress-status class="aster-grid-summary-status" .busy=${status === "loading"}
        .error=${status === "error" ? this.#text("summaryLoadFailed") : undefined} .progressPolicy=${this.#progressPolicy.value}
        .pendingText=${this.#text("summaryLoading")} .completeText=${this.#text("summariesUpdated")}></aster-progress-status>
      ${status === "error" ? html`<button type="button" class="aster-grid-tool" @click=${() => { this.focus({ preventScroll: true }); void summary.refresh(); }}>${this.#text("retrySummaries")}</button>` : nothing}
      ${values ? html`<dl>${this.#summaries.value.map((s, i) => html`<div><dt>${this.#summaryLabel(s)}</dt><dd>${this.#summaryValue(s, values[s.method === "count" ? "count" : `s${i}`] ?? null)}</dd></div>`)}</dl>` : nothing}
    </section>`;
  }

  #groupLabel(name: string, field: Field | undefined, value: Value): View | string {
    const column = this.#presentation.value.columns?.[name];
    const mapped = mappedValue(column, value);
    if (mapped) return mapped.label;
    if (value === null) return "None";
    const lookup = this.#lookups.value[name];
    if (lookup) return String(this.#ctx.peek()!.lookup(lookup.set, keyText([value])).value?.[lookup.display] ?? "…");
    if (column?.format) return cellText(field, value, column.format);
    if (field?.type === "Edm.Boolean") return value ? "Yes" : "No";
    if (field?.type === "Edm.Date" && typeof value === "string") return formatDate(value);
    if (field?.type === "Edm.DateTimeOffset" && typeof value === "string") return absoluteTime(value);
    return formatValue(field, value);
  }

  async #toggleGroup(id: string): Promise<void> {
    const grouping = this.#grouping;
    if (!grouping) return;
    const editing = this.#editing.peek();
    if (editing && grouping.open.peek().has(id)) {
      const rows = grouping.rows.peek();
      const parent = rows.find((r): r is GroupingHeader => r.kind === "group" && r.id === id);
      const record = rows.find((r) => r.kind === "row" && r.key === editing.key);
      const leaf = record && rows.find((r): r is GroupingHeader => r.kind === "group" && r.id === record.parent);
      if (parent && leaf && JSON.stringify(leaf.path.slice(0, parent.path.length)) === JSON.stringify(parent.path)) {
        if (!(await this.#endEdit(true)) || !this.isConnected || this.#grouping !== grouping) return;
      }
    }
    const rows = grouping.rows.peek();
    const index = rows.findIndex((r) => r.kind === "group" && r.id === id);
    if (index < 0) return;
    // Collapse can remove the active descendant. Keep its parent header active.
    const active = rows[this.#active.peek().row];
    if (grouping.open.peek().has(id) && active && active !== rows[index]) {
      const parent = active.kind === "group" ? active.path : rows.find((r): r is GroupingHeader => r.kind === "group" && r.id === active.parent)?.path;
      const target = (rows[index] as GroupingHeader).path;
      if (parent && JSON.stringify(parent.slice(0, target.length)) === JSON.stringify(target)) this.#activate(index, 0);
    }
    void grouping.toggle(id).catch(() => {});
  }

  #reorderGroup(field: string, step: -1 | 1): void {
    const view = this.#view.peek();
    if (!view) return;
    const stored = [...groupFields(view)];
    const effective = this.#groupedFields(view);
    const neighbour = effective[effective.indexOf(field) + step];
    if (neighbour === undefined) return;
    const a = stored.indexOf(field);
    const b = stored.indexOf(neighbour);
    if (a < 0 || b < 0) return;
    [stored[a], stored[b]] = [stored[b]!, stored[a]!];
    this.#setView(setGroup(view, stored));
  }

  #groupSummaryConfig: readonly GridSummary[] | undefined;
  #groupFieldsKey = "";
  #groupContext: DataContext | undefined;

  /** Grouping order creates the model; query signals update its open branches. */
  #group(): void {
    const ctx = this.#ctx.value;
    const set = this.set;
    const fields = this.#groupedFields(this.#view.value);
    const key = JSON.stringify([set, fields]);
    const summaries = this.#summaries.value;
    untracked(() => {
      if (this.#grouping && this.#groupContext === ctx && this.#groupFieldsKey === key) {
        if (this.#groupSummaryConfig !== summaries) {
          this.#groupSummaryConfig = summaries;
          this.#grouping.setAggregates(this.#aggregates(summaries));
        }
        return;
      }
      this.#grouping?.dispose();
      this.#grouping = undefined;
      this.#groupContext = ctx;
      this.#groupFieldsKey = key;
      this.#groupSummaryConfig = summaries;
      if (ctx && set && fields.length) {
        const query = computed(() => this.#query(set, this.#view.value ?? { columns: [], sort: [], filters: {}, frozen: 0 }, this.#base.value, this.#sortPaths.value));
        this.#grouping = ctx.grouping(query, fields, this.#aggregates(summaries), { pageSize: 100, keepPages: 4 });
      }
      this.#version.value++;
    });
  }

  #scrolled(scroll: HTMLElement): void {
    this.#top.value = scroll.scrollTop;
  }

  /** The scroll box resized: the viewport follows, and a new width re-measures the rows. Returns whether it did. */
  #boxResized(scroll: HTMLElement): boolean {
    // Retained views have no geometry while an ancestor is hidden.
    if (scroll.clientWidth === 0 || scroll.clientHeight === 0) return false;
    this.#viewport.value = scroll.clientHeight;
    if (scroll.clientWidth === this.#scrollWidth) return false;
    this.#scrollWidth = scroll.clientWidth;
    const rows = [...this.querySelectorAll<HTMLElement>(".aster-grid-row[data-key]")];
    this.#measured(rows.map((r) => [r, r.getBoundingClientRect().height]));
    return true;
  }

  /** Records rows' heights; when any changed, re-renders with the row at the viewport's top held in place. */
  #measured(sizes: readonly (readonly [HTMLElement, number])[]): void {
    const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
    if (!scroll) return;
    const index = this.#heights.indexAt(scroll.scrollTop);
    const delta = scroll.scrollTop - this.#heights.offset(index);
    let changed = false;
    for (const [row, height] of sizes) {
      const key = row.dataset.key;
      if (!key || !row.isConnected || height <= 0) continue;
      if (this.#heights.measure(key, Math.round(height * 100) / 100)) changed = true;
    }
    if (!changed) return;
    this.#anchor = { index, delta };
    this.#version.value++;
  }

  #frozenOffsets(columns: readonly GridColumn[], frozen: number, base = 0): number[] {
    const out: number[] = [];
    let left = base;
    for (let i = 0; i < Math.min(frozen, columns.length); i++) {
      out.push(left);
      left += columns[i]!.width ?? 0;
    }
    return out;
  }

  /** A column's rendered width, for fixing it when it's frozen or nudged. */
  #measuredWidth(field: string): number {
    const header = this.querySelector<HTMLElement>(`.aster-grid-header[data-field="${CSS.escape(field)}"]`);
    return Math.round(header?.getBoundingClientRect().width ?? naturalWidth(this.#collection?.type.field(field)));
  }

  /**
   * A column sorts by its own values. A foreign key shows a related record's
   * field, and sorting it by the key would look sorted but isn't, so it
   * doesn't sort until the server can order by the related field.
   */
  #sortable(field: string): boolean {
    return this.#sortRefusal(field) === undefined;
  }

  /**
   * Lookup columns sort by the related record's display field, through the
   * navigation whose key is the column (`personId` sorts by `person/name`).
   */
  readonly #sortPaths = computed((): Readonly<Record<string, string>> => {
    const ctx = this.#ctx.value;
    const type = ctx && this.set ? ctx.schema.set(this.set).type : undefined;
    if (!type) return {};
    const paths: Record<string, string> = {};
    for (const [field, lookup] of Object.entries(this.#lookups.value)) {
      const nav = type.navigations.find((n) => !n.collection && n.keys.length === 1 && n.keys[0]![0] === field);
      if (nav) paths[field] = `${nav.name}/${lookup.display}`;
    }
    for (const column of this.#view.value?.columns ?? []) if (column.sortField) paths[column.field] = column.sortField;
    return paths;
  });

  #sort(field: string, add: boolean): void {
    if (this.#dragged) return;
    const refusal = this.#sortRefusal(field);
    if (refusal) {
      this.#refused.value = refusal;
      announce(refusal);
      return;
    }
    this.#refused.value = undefined;
    const view = this.#view.peek();
    if (view) this.#setView(sortBy(view, field, add && this.#multiSort()));
  }

  /** Drag the right edge of a header; JS writes only the column's width. */
  #resize(e: PointerEvent, field: string): void {
    if (e.button !== 0 || this.#resizeRefusal(field)) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const from = e.clientX;
    const width = this.#measuredWidth(field);
    const move = (m: PointerEvent) => this.#setView(setWidth(this.#view.peek()!, field, width + m.clientX - from));
    const up = () => handle.removeEventListener("pointermove", move);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  }

  #dragged = false;

  /** Drag a header sideways to move its column; a press without moving sorts. */
  #dragColumn(e: PointerEvent, field: string): void {
    if (e.button !== 0) return;
    const refusal = this.#moveRefusal(field);
    if (refusal) {
      this.#refused.value = refusal;
      announce(refusal);
      return;
    }
    const button = e.currentTarget as HTMLElement;
    const from = e.clientX;
    this.#dragged = false;
    button.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      if (!this.#dragged && Math.abs(m.clientX - from) < 6) return;
      this.#dragged = true;
      this.toggleAttribute("data-dragging", true);
    };
    const up = (u: PointerEvent) => {
      button.removeEventListener("pointermove", move);
      this.toggleAttribute("data-dragging", false);
      if (!this.#dragged) return;
      const headers = [...this.querySelectorAll<HTMLElement>(".aster-grid-header")];
      const target = headers.find((h) => {
        const r = h.getBoundingClientRect();
        return u.clientX >= r.left && u.clientX < r.right;
      });
      const view = this.#view.peek()!;
      if (target?.dataset.field && target.dataset.field !== field) {
        this.#setView(moveColumn(view, field, view.columns.findIndex((c) => c.field === target.dataset.field)));
      }
      // The click that follows the drag isn't a sort.
      setTimeout(() => (this.#dragged = false));
    };
    button.addEventListener("pointermove", move);
    button.addEventListener("pointerup", up, { once: true });
    button.addEventListener("pointercancel", up, { once: true });
  }

  /**
   * Dragging a row in a tree grid: a mouse lifts it past a few pixels, a
   * touch or pen by holding still (`pressDrag`). A label follows the
   * pointer; the row under it becomes the new parent (the header: the top
   * level). A row can't go under itself or its own subtree; that drop says
   * why. Letting go anywhere else, or an interrupted pointer, moves nothing.
   */
  #dragRow(e: PointerEvent): void {
    const tree = this.#tree;
    const target = e.target as Element;
    if (!tree || !this.#treeOptions.peek()?.draggable || e.button !== 0 || !this.#editEnabled()) return;
    if (target.closest("button, input, textarea, select, a, [data-editing], .aster-grid-expansion, .aster-grid-controls")) return;
    const row = target.closest<HTMLElement>(".aster-grid-row[data-key]:not(.aster-grid-head)");
    const key = row?.dataset.key;
    if (!row || !key) return;
    const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll")!;
    const touch = holds(e);
    const title = (row.querySelector(".aster-grid-cell")?.textContent ?? "").trim();
    let label: HTMLElement | undefined;
    let over: { el: HTMLElement; to: KeyText | undefined; why: string | undefined } | undefined;
    // The node's ancestors from stored records: a drop is refused where its own key is among them.
    const from = ((): KeyText | undefined => {
      const parent = tree.entity(key)?.[tree.options.parentField];
      return parent === null || parent === undefined ? undefined : keyText([parent]);
    })();
    const options = this.#treeOptions.peek()!;
    const why = (to: KeyText | undefined): string | undefined => {
      // Structure refuses first; a drop rule is host policy on top.
      for (let k = to; k !== undefined; ) {
        if (k === key) return "A row can’t move under itself or its own subtree.";
        const parent = tree.entity(k)?.[tree.options.parentField];
        k = parent === null || parent === undefined ? undefined : keyText([parent]);
      }
      if (options.reparent === false && to !== from) return "Rows can’t be moved to another parent on this page.";
      if (options.dropOnLeaves === false && to !== undefined) {
        const node = tree.rows.peek().find((row) => row.key === to);
        if (node?.folder === false) return "A row can’t be dropped on a leaf; drop it on a folder or the top level.";
      }
      return undefined;
    };
    pressDrag(e, { distance: 6, escape: true, capture: scroll, scroller: () => scroll, inset: () => this.querySelector<HTMLElement>(".aster-grid-headgroup")?.offsetHeight ?? 0 }, {
      lift: () => {
        label = document.createElement("div");
        label.className = "aster-grid-drag";
        label.textContent = title;
        label.setAttribute("aria-hidden", "true");
        label.toggleAttribute("data-touch", touch);
        this.append(label);
        this.toggleAttribute("data-dragging", true);
        if (touch) this.#lifted.value = key;
        announce(this.#text("dragPickedUp", { field: title }));
      },
      move: (x, y) => {
        // Above a finger, where it can be seen (below it near the top); beside a mouse pointer.
        label!.style.translate = touch ? `${x - 24}px ${y < 72 ? y + 32 : y - 64}px` : `${x + 12}px ${y + 8}px`;
        over?.el.removeAttribute("data-drop");
        const under = document.elementFromPoint(x, y);
        const head = under?.closest<HTMLElement>(".aster-grid-head, .aster-grid-root-drop");
        const into = under?.closest<HTMLElement>(".aster-grid-row[data-key]:not(.aster-grid-head)");
        // A finger starts over its own row; there it is only being held.
        over = head
          ? { el: head, to: undefined, why: undefined }
          : into?.dataset.key && !(touch && into.dataset.key === key)
            ? { el: into, to: into.dataset.key, why: why(into.dataset.key) }
            : undefined;
        over?.el.setAttribute("data-drop", over.why ? "refused" : "ok");
      },
      end: (drop) => {
        this.toggleAttribute("data-dragging", false);
        this.#lifted.value = undefined;
        label?.remove();
        over?.el.removeAttribute("data-drop");
        void this.#dropRow(tree, key, title, drop ? over : undefined);
      },
    });
  }

  /** Ends a row drag: moves the row under `over`, says why it can't, or that nothing moved. */
  async #dropRow(tree: Tree, key: KeyText, title: string, over: { to: KeyText | undefined; why: string | undefined } | undefined): Promise<void> {
    if (over?.why) {
      this.#refused.value = over.why;
      announce(over.why);
      return;
    }
    const parent = tree.entity(key)?.[tree.options.parentField];
    const from = parent === null || parent === undefined ? undefined : keyText([parent]);
    if (!over || over.to === from) {
      announce(this.#text("dragNotMoved", { field: title }));
      return;
    }
    try {
      await tree.move(key, over.to);
      this.#refused.value = undefined;
      if (over.to !== undefined) await tree.expand(over.to);
      this.emit("moved", { key, from, to: over.to });
    } catch (err) {
      this.#refused.value = err instanceof Error ? err.message : String(err);
    }
  }

  // ── keyboard and focus ──

  #dblclick(e: MouseEvent): void {
    if ((e.target as Element).closest("button, input, select, textarea, a[href], [contenteditable], [data-editing]")) return;
    const row = (e.target as Element).closest<HTMLElement>('[role="row"][data-index]:not(.aster-grid-group)');
    const pressed = (e.target as Element).closest<HTMLElement>('[role="gridcell"]');
    if (row?.dataset.key && pressed && Number(pressed.dataset.col ?? -1) >= 0) {
      const column = Number(pressed.dataset.col);
      const target = { key: row.dataset.key, field: this.#visibleColumns(this.#view.peek()!)[column]?.field, row: Number(row.dataset.index), column, originalEvent: e };
      if (!this.emit("cell-double-click", target)) return;
    }
    if (row?.dataset.key && !this.emit("row-open", { key: row.dataset.key })) return;
    // With expansion, a double-click opens the row rather than editing it in
    // place, and closes it again unless it has unsaved changes.
    if (this.#expansion.peek() && row?.dataset.key && !(e.target as Element).closest("[data-editing]")) {
      const key = row.dataset.key;
      if (!this.#open.peek().includes(key)) this.expand(key);
      else if (!this.#editors.get(key)?.dirty?.peek()) void this.collapse(key);
      return;
    }
    if (!this.#editEnabled() || (e.target as Element).closest("[data-editing]")) return;
    const cell = (e.target as Element).closest<HTMLElement>('[role="gridcell"]');
    if (row?.dataset.key) this.#startEdit(row.dataset.key, Number(cell?.dataset.col ?? 0));
  }

  /**
   * Starts editing a row: an edit model with the grid's rules in a child
   * scope where the row is published as `row`. Any other row being edited
   * saves first, and stays if it can't.
   */
  async #startEdit(key: KeyText, col: number): Promise<void> {
    if (!this.#editEnabled() || this.#editing.peek()?.key === key) return;
    const columns = this.#visibleColumns(this.#view.peek()!);
    const field = columns[col]?.field;
    const type = this.#collection?.type;
    // Cell mode edits the pressed cell; a cell that isn't editable starts nothing.
    if (this.editMode === "cell" && (!field || !this.#fieldEditable(field) || type?.field(field)?.computed)) return;
    if (!this.emit("edit-start", { key, field }, { cancelable: true })) return;
    if (!(await this.#endEdit(true))) return;
    const ctx = this.#ctx.peek()!;
    const set = this.#collection!.query.set;
    const edit = new EditModel(ctx, set, key);
    const scope = (scopeOf(this) ?? undefined)?.child();
    const withdraw = scope?.publish("row", editPublication(edit));
    const rules = this.#rules.peek();
    if (scope && Object.keys(rules).length) edit.applyRules(scope, `${this.#publish.peek() || "grid"}.row`, rules);
    // The draft's values change signal is the single source for cell-change.
    let before = { ...edit.values.peek() };
    const stopChanges = effect(() => {
      const values = edit.values.value;
      for (const [name, value] of Object.entries(values)) {
        if (JSON.stringify(value) === JSON.stringify(before[name])) continue;
        this.emit("cell-change", { key, field: name, value, previous: before[name] }, { cancelable: false });
      }
      before = { ...values };
    });
    this.#editing.value = { key, field: field ?? "", column: col, edit, stop: () => (stopChanges(), withdraw?.(), edit.dispose()) };
    requestAnimationFrame(() => this.#focusEditor(key, col));
  }

  #focusEditor(key: KeyText, col: number): void {
    const row = this.querySelector<HTMLElement>(`.aster-grid-row[data-key="${CSS.escape(key)}"]`);
    // A user may choose another control before deferred initial focus runs.
    if (row?.contains(document.activeElement)) return;
    const cells = row ? [...row.querySelectorAll<HTMLElement>('[role="gridcell"][data-col]')] : [];
    const target =
      cells.find((cell) => Number(cell.dataset.col) === col)?.querySelector<HTMLElement>("input:not([readonly]), textarea:not([readonly]), [role=combobox]:not([aria-readonly])") ??
      row?.querySelector<HTMLElement>("input:not([readonly]), textarea:not([readonly]), [role=combobox]:not([aria-readonly])");
    target?.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.select();
  }

  /**
   * Ends editing. Saving: a row with errors or a conflict stays in edit and
   * returns false. The grid takes focus back when `refocus`, on the row,
   * wherever the save moved it.
   */
  async #endEdit(save: boolean, refocus = false, only?: { readonly key: KeyText }): Promise<boolean> {
    const editing = this.#editing.peek();
    if (!editing || (only && editing !== only)) return true;
    if (save && editing.edit.dirty.peek()) {
      const changes: Record<string, Value> = {};
      const values = editing.edit.values.peek();
      const baseline = editing.edit.baseline.peek();
      for (const [field, value] of Object.entries(values)) {
        if (JSON.stringify(value) !== JSON.stringify(baseline[field])) changes[field] = value;
      }
      if (!this.emit("edit-save", { key: editing.key, changes }, { cancelable: true })) return false;
      const saved = await editing.edit.save();
      if (!saved) {
        this.emit("edit-error", {
          key: editing.key,
          error: editing.edit.formError.peek() ?? "The row couldn’t be saved.",
          errors: editing.edit.errors.peek(),
        }, { cancelable: false });
        requestAnimationFrame(() => this.querySelector<HTMLElement>(`.aster-grid-row[data-editing] [aria-invalid="true"]`)?.focus());
        return false;
      }
    }
    if (this.#editing.peek() !== editing) return true;
    editing.stop();
    this.#editing.value = undefined;
    if (refocus) {
      this.focus();
      requestAnimationFrame(() => {
        const index = untracked(() => this.#layout()).keys.indexOf(editing.key);
        if (index >= 0) this.#activate(index, this.#active.peek().col);
      });
    }
    return true;
  }

  #editKey(e: KeyboardEvent): void {
    if ((e.target as Element).closest('[aria-expanded="true"]')) return;
    // Shift+Enter is a new line in long text; Enter alone saves the row.
    if (e.key === "Enter" && e.shiftKey && (e.target as Element).matches("textarea")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void this.#endEdit(true, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.#editing.peek()?.edit.revert();
      void this.#endEdit(false, true);
    }
  }

  /**
   * WebKit doesn't focus a checkbox, radio or button that's pressed: its
   * mousedown blurs the row's field, which reads as focus leaving the row and
   * saves it before the click lands. Here the press focuses the control
   * instead, and its click still toggles or activates it.
   */
  #focusPressed(e: MouseEvent): void {
    const control = (e.target as Element).closest<HTMLElement>('input[type="checkbox"], input[type="radio"], button, [role="checkbox"], [role="switch"]');
    if (!control || control.matches(":disabled")) return;
    e.preventDefault();
    control.focus({ preventScroll: true });
  }

  /** Focus leaving the row saves it; within the row, or into a list it opened, it doesn't. */
  #editBlur(e: FocusEvent): void {
    const row = e.currentTarget as HTMLElement;
    const next = e.relatedTarget as Node | null;
    if (next && row.contains(next)) return;
    const editing = this.#editing.peek();
    requestAnimationFrame(() => {
      if (row.contains(document.activeElement) || !editing) return;
      void this.#endEdit(true, false, editing);
    });
  }

  #contextMenu(e: MouseEvent): void {
    const cell = (e.target as Element).closest<HTMLElement>('[role="gridcell"]');
    const row = cell?.closest<HTMLElement>('[role="row"][data-index]:not(.aster-grid-group)');
    if (!cell || !row || (e.target as Element).closest("[data-editing]")) return;
    e.preventDefault();
    const index = Number(row.dataset.index);
    const col = Number(cell.dataset.col ?? 0);
    if (row.dataset.key && col >= 0) {
      const target = { key: row.dataset.key, field: this.#visibleColumns(this.#view.peek()!)[col]?.field, row: index, column: col, originalEvent: e };
      if (!this.emit("cell-context-menu", target)) return;
    }
    this.#activate(index, Math.max(0, col));
    this.#openRowMenu(index, Math.max(0, col), { x: e.clientX, y: e.clientY });
  }

  #click(e: MouseEvent): void {
    const cell = (e.target as Element).closest<HTMLElement>('[role="gridcell"]');
    const row = cell?.closest<HTMLElement>('[role="row"][data-index]');
    if (!cell || !row) return;
    if ((e.target as Element).closest("button, input, select, textarea, a[href], [contenteditable], [data-editing]")) return;
    const index = Number(row.dataset.index);
    const column = Number(cell.dataset.col ?? 0);
    const field = this.#visibleColumns(this.#view.peek()!)[column]?.field;
    const layout = untracked(() => this.#layout());
    const item = layout.at(index);
    if (item.kind === "row" && item.key !== undefined && column >= 0) {
      const target = { key: item.key, field, row: index, column, originalEvent: e };
      // Both action events fire; either may veto the default.
      const cellOk = this.emit("cell-click", target);
      const rowOk = this.emit("row-click", { key: item.key, row: index, originalEvent: e });
      if (!cellOk || !rowOk) return;
      // Selection indices are collection-relative; later pages render rows that start mid-collection.
      this.#choose(item.key, (layout.first ?? 0) + index, e.shiftKey, e.ctrlKey || e.metaKey);
    }
    this.#activate(index, row.classList.contains("aster-grid-group") ? this.#active.peek().col : Math.max(0, column));
  }

  #key(e: KeyboardEvent, columns: number): void {
    if ((e.target as Element).closest(".aster-grid-filters, .aster-grid-panel, .aster-grid-selection, [data-editing], .aster-grid-group button")) return;
    // Focus can still be on the grid during the frame an edit starts in; Escape ends it all the same.
    if (e.key === "Escape" && this.#editing.peek()) {
      e.preventDefault();
      this.#editing.peek()!.edit.revert();
      void this.#endEdit(false, true);
      return;
    }
    const layout = untracked(() => this.#layout());
    const count = layout.keys.length;
    const { row, col } = this.#active.peek();
    if (row < 0) return this.#headKey(e, row, col, columns, count);
    if (!count) return;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") && this.#groupKey(e, row, col)) return;
    if (col === 0 && (e.key === "ArrowRight" || e.key === "ArrowLeft") && this.#treeKey(e, row)) return;
    const item = layout.at(row);
    if (this.#selection.peek()?.ordered && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && item.kind === "row" && item.key !== undefined) {
      e.preventDefault(); this.#moveSelection(item.key, e.key === "ArrowUp" ? -1 : 1); return;
    }
    if (e.key === " " && this.#selection.peek() && item.kind === "row" && item.key !== undefined) {
      e.preventDefault(); this.#choose(item.key, (layout.first ?? 0) + row, e.shiftKey, this.#selection.peek()!.multiple); return;
    }
    const page = Math.max(1, Math.floor(this.#viewport.peek() / this.#heights.estimate) - 1);
    let next: { row: number; col: number };
    switch (e.key) {
      case "ArrowDown":
        next = { row: row + 1, col };
        break;
      case "ArrowUp":
        if (row === 0) {
          // Above the first row: the filter row when shown, else the header when it is reachable.
          if (this.#filtersShown()) {
            e.preventDefault();
            this.#active.value = { row: FILTER_ROW, col };
          } else if (this.#headerShown()) {
            e.preventDefault();
            this.#active.value = { row: HEADER, col };
          }
          return;
        }
        next = { row: row - 1, col };
        break;
      case "ArrowRight":
        next = { row, col: col + 1 };
        break;
      case "ArrowLeft":
        next = { row, col: col - 1 };
        break;
      case "PageDown":
        next = { row: row + page, col };
        break;
      case "PageUp":
        next = { row: row - page, col };
        break;
      case "Home":
        next = e.ctrlKey || e.metaKey ? { row: 0, col: 0 } : { row, col: 0 };
        break;
      case "End":
        next = e.ctrlKey || e.metaKey ? { row: count - 1, col: columns - 1 } : { row, col: columns - 1 };
        break;
      case "Enter":
      case "F2": {
        if (item.kind !== "row" || item.key === undefined) return;
        if (e.key === "F2" && this.#selectionAllowed() && this.#selection.peek() && (!this.#editEnabled() || e.shiftKey)) {
          e.preventDefault();
          this.#selectionInside.value = item.key;
          const pick = this.#selectionColumnOn() ? ".aster-grid-select input" : ".aster-grid-pick";
          queueMicrotask(() => this.querySelector<HTMLElement>(`.aster-grid-row[data-key="${CSS.escape(item.key!)}"] ${pick}`)?.focus());
          return;
        }
        if (e.key === "Enter" && !this.emit("row-open", { key: item.key })) { e.preventDefault(); return; }
        // With expansion, Enter expands the row, as a double-click does; F2 still edits in place.
        if (e.key === "Enter" && this.#expansion.peek()) {
          e.preventDefault();
          this.expand(item.key);
          return;
        }
        if (!this.#editEnabled()) return;
        e.preventDefault();
        this.#startEdit(item.key, col);
        return;
      }
      case "Escape": {
        // Closes the active row's expansion, as Escape inside it does.
        if (item.kind !== "row" || item.key === undefined || !this.#open.peek().includes(item.key)) return;
        e.preventDefault();
        void this.collapse(item.key);
        return;
      }
      case "F10":
      case "ContextMenu": {
        if (e.key === "F10" && !e.shiftKey) return;
        e.preventDefault();
        this.#openRowMenu(row, col);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    const target = Math.max(0, Math.min(count - 1, next.row));
    if (this.#selection.peek() && e.shiftKey && target !== row) {
      const destination = layout.at(target);
      if (destination.kind === "row" && destination.key !== undefined) this.#choose(destination.key, (layout.first ?? 0) + target, true, false);
    }
    this.#activate(target, Math.max(0, Math.min(columns - 1, next.col)));
  }

  #sortText(view: GridView): string {
    const sort = view.sort.filter((key) => this.#sortable(key.field));
    if (!sort.length) return this.#text("notSorted");
    const entries = sort.map((key) => this.#text("sortEntry", {
      field: this.#title(key.field),
      direction: key.descending ? this.#text("directionDescending") : this.#text("directionAscending"),
    }));
    return this.#text("sortedBy", { sorts: entries.join(this.#text("sortSeparator")) });
  }

  /** The first column's indent, optional opener and node icon in a tree grid. */
  #treeLead(node: TreeRow): View {
    const options = this.#treeOptions.value;
    const folder = node.folder !== false && node.key !== undefined;
    const icon = folder ? options?.folderIcon : options?.nodeIcon;
    const opener = options?.showOpener !== false;
    return html`<span class="aster-grid-tree" style=${`--level:${node.level - 1}`}>${opener
      ? folder
        ? html`<button type="button" class="aster-grid-opener" tabindex="-1" aria-hidden="true" ?data-open=${node.open}
            @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              void this.#tree?.toggle(node.key!);
            }}><svg viewBox="0 0 10 10"><path d="M3.5 2 6.5 5l-3 3"/></svg></button>`
        : html`<span class="aster-grid-opener" aria-hidden="true"></span>`
      : nothing}
      ${icon ? html`<span class="aster-grid-tree-icon" aria-hidden="true">${icon}</span>` : nothing}</span>`;
  }

  /**
   * Opens the levels a tree loads with: `autoOpen` levels below the top, or
   * every folder for Expand all. Bounded by `openLimit` and by the first page
   * of each level.
   */
  async #expandLevels(tree: Tree, depth: number, limit: number): Promise<number> {
    let opened = 0;
    let parents: (KeyText | undefined)[] = [undefined];
    for (let level = 0; level < depth && parents.length > 0 && opened < limit; level++) {
      const next: KeyText[] = [];
      for (const parent of parents) {
        const collection = tree.level(parent);
        await collection.ensure(0, collection.pageSize);
        if (!this.isConnected || this.#tree !== tree) return opened;
        for (const key of collection.keys.peek()) {
          if (key === undefined || tree.isOpen(key)) continue;
          const node = tree.rows.peek().find((row) => row.key === key);
          if (node?.folder === false) continue;
          await tree.expand(key);
          next.push(key);
          if (++opened >= limit) return opened;
        }
      }
      parents = next;
    }
    return opened;
  }

  /** Expand all: every folder in the loaded pages, up to `openLimit`. */
  async #expandAll(): Promise<void> {
    const tree = this.#tree;
    if (!tree) return;
    const limit = this.#treeOptions.peek()?.openLimit ?? 200;
    const opened = await this.#expandLevels(tree, Number.POSITIVE_INFINITY, limit);
    announce(opened >= limit ? this.#text("foldersLimit", { limit }) : this.#text("foldersOpened"));
  }

  #collapseAll(): void {
    this.#tree?.setOpen([]);
    if (this.#tree) announce(this.#text("foldersClosed"));
  }

  /** Opens the configured initial depth once, when the tree is built. */
  #autoOpen(tree: Tree, depth: number): void {
    if (!(depth > 0)) return;
    const limit = this.#treeOptions.peek()?.openLimit ?? 200;
    void this.#expandLevels(tree, depth, limit).catch(() => {});
  }

  /**
   * → on a closed folder opens it, on an open one goes to its first child;
   * ← on an open folder closes it, otherwise goes to the parent. Only in the
   * tree's column; elsewhere the arrows move between cells.
   */
  #treeKey(e: KeyboardEvent, row: number): boolean {
    const tree = this.#tree;
    const item = untracked(() => this.#layout()).at(row);
    if (!tree || item.kind !== "row" || !item.node || item.key === undefined) return false;
    const node = item.node;
    e.preventDefault();
    if (e.key === "ArrowRight") {
      if (node.folder === false) return true;
      if (!node.open) void tree.expand(item.key);
      else this.#activate(row + 1, 0);
      return true;
    }
    if (node.open) tree.collapse(item.key);
    else if (node.parent !== undefined) {
      const at = untracked(() => tree.rows.value).findIndex((r) => r.key === node.parent);
      if (at >= 0) this.#activate(at, 0);
    }
    return true;
  }

  #filtersShown(): boolean {
    const filterRow = this.#chrome.value.filterRow ?? "auto";
    if (filterRow === false) return false;
    if (filterRow === true) return true;
    return this.#showFilters.value || Object.keys(this.#view.value?.filters ?? {}).length > 0;
  }

  #headerShown(): boolean {
    return this.#chrome.value.header !== false;
  }

  #groupKey(e: KeyboardEvent, row: number, col: number): boolean {
    const grouping = this.#grouping;
    if (!grouping) return false;
    const rows = grouping.rows.peek();
    const item = rows[row];
    if (!item) return false;
    if (item.kind === "group" && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      if (item.error !== undefined) void grouping.retry(item.id).catch(() => {});
      else this.#toggleGroup(item.id);
      return true;
    }
    if (item.kind !== "group" && col !== 0) return false;
    e.preventDefault();
    if (e.key === "ArrowRight") {
      if (item.kind === "group") {
        if (!item.expanded) this.#toggleGroup(item.id);
        else if (rows[row + 1]?.parent === item.id) this.#activate(row + 1, 0);
      } else return false;
    } else if (e.key === "ArrowLeft") {
      if (item.kind === "group" && item.expanded) this.#toggleGroup(item.id);
      else if (item.parent !== undefined) {
        const parent = rows.findIndex((r) => r.kind === "group" && r.id === item.parent);
        if (parent >= 0) this.#activate(parent, 0);
      }
    } else return false;
    return true;
  }

  /**
   * Keys on the header row (Enter or Space sorts, with Shift adding to the
   * sort; Shift+F10 or the Menu key opens the column's menu) and the filter
   * row (Enter or F2 goes into the filter; Escape there comes back).
   */
  #headKey(e: KeyboardEvent, row: number, col: number, columns: number, count: number): void {
    const field = this.#visibleColumns(this.#view.peek()!)[col]?.field;
    const move = (to: { row: number; col: number }) => {
      e.preventDefault();
      this.#active.value = { row: to.row, col: Math.max(0, Math.min(columns - 1, to.col)) };
    };
    switch (e.key) {
      case "ArrowLeft":
        return move({ row, col: col - 1 });
      case "ArrowRight":
        return move({ row, col: col + 1 });
      case "Home":
        return move({ row, col: 0 });
      case "End":
        return move({ row, col: columns - 1 });
      case "ArrowUp":
        return row === FILTER_ROW && this.#headerShown() ? move({ row: HEADER, col }) : undefined;
      case "ArrowDown":
        if (row === HEADER && this.#filtersShown()) return move({ row: FILTER_ROW, col });
        if (!count) return;
        e.preventDefault();
        this.#activate(0, col);
        return;
      case "Enter":
      case " ":
      case "F2":
        if (!field) return;
        e.preventDefault();
        if (row === FILTER_ROW) {
          this.querySelector<HTMLElement>(`#${CSS.escape(`${this.#id}-f-${col}`)}`)?.querySelector<HTMLElement>("input, [role='combobox']")?.focus();
        } else if (e.key !== "F2") {
          this.#sort(field, e.shiftKey);
        }
        return;
      case "F10":
      case "ContextMenu": {
        if ((e.key === "F10" && !e.shiftKey) || row !== HEADER || !field || !this.showHeaderMenu) return;
        e.preventDefault();
        const opener = this.querySelector<HTMLElement>(`.aster-grid-header[data-field="${CSS.escape(field)}"] .aster-grid-header-menu`);
        if (opener) this.#openMenu(field, opener, this.querySelector<HTMLElement>(".aster-grid-scroll") ?? opener);
        return;
      }
    }
  }

  /** Escape in a filter (its list closed) returns to the grid, on that filter's cell. */
  #filterKey(e: KeyboardEvent): void {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const cell = (e.target as Element).closest<HTMLElement>(".aster-grid-filter");
    if (!cell) return;
    e.preventDefault();
    this.#active.value = { row: FILTER_ROW, col: Number(cell.dataset.col ?? 0) };
    this.querySelector<HTMLElement>(".aster-grid-scroll")?.focus();
  }

  /** Reveals the active cell; only an owned grid without shared selection chooses its row. */
  #activate(row: number, col: number): void {
    this.#focusRequest++;
    this.#pendingFocus.value = undefined;
    this.#anchor = undefined;
    this.#active.value = { row, col };
    const item = untracked(() => this.#layout()).at(row);
    if (this.#grouping && item) {
      const header = item.kind === "group" ? item : this.#grouping.rows.peek().find((r): r is GroupingHeader => r.kind === "group" && r.id === item.parent);
      this.#groupFocus.value = header ? { id: header.id, path: header.path } : undefined;
    }
    if (item.kind === "row" && item.key !== undefined) {
      this.#activeKey.value = item.key;
      if (this.#selectionAllowed() && !this.#selection.peek() && !this.#external()) this.#selected.value = item.key;
    } else this.#activeKey.value = undefined;
    const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
    const head = this.querySelector<HTMLElement>(".aster-grid-headgroup");
    if (!scroll) return;
    const headHeight = head?.offsetHeight ?? 0;
    const top = this.#heights.offset(row);
    const bottom = this.#heights.offset(row + 1);
    if (top < scroll.scrollTop) scroll.scrollTop = top;
    else if (bottom + headHeight > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = bottom + headHeight - scroll.clientHeight;
    this.#top.value = scroll.scrollTop;
  }
}


/** A press that leaves focus in the editor, so it doesn't end the edit (a click doesn't focus a button everywhere). */
function keepFocus(e: PointerEvent): void {
  e.preventDefault();
}

function and(a: Criteria | undefined, b: Criteria): Criteria {
  return a ? { op: "and", args: [a, b] } : b;
}


define("aster-grid", Grid);
