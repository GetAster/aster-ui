import { computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import {
  isRelative,
  progressPolicy,
  type ProgressPolicy,
  FilterDraft,
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
  type Selection,
  type Query,
  type FilterMode,
  type TreeRow,
  type FieldRules,
  type Criteria,
  type DataContext,
  type Entity,
  type Field,
  type Grouping,
  type GroupingHeader,
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
  type GridColumn,
  type GridView,
  type SavedViews,
} from "./view.ts";

/** Renders a cell's content; `entity` is the row's record. */
export type CellRenderer = (entity: Entity, key: KeyText) => View;
/** Text presentation of a typed value. Queries and exports retain the underlying value. */
export type CellFormatter = (value: Value | undefined, entity: Entity, field: Field | undefined) => string;

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

type Panel = "columns" | "views";

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
  readonly groups: number | undefined;
  at(index: number): Item;
}

const OVERSCAN = 400;

/** A count that isn't exact: an estimate, or an uncounted collection's, which includes a page that may not exist. */
const atLeast = (c: Collection): { atLeast?: number; estimate?: boolean } =>
  c.count.value === undefined || c.counted.value ? {}
  : c.estimated.value ? { estimate: true }
  : { atLeast: Math.max(0, c.count.value - c.pageSize) };
const FILTER_DELAY = 300;

/** A value the server hides from this person on this record: said, not left blank. */
const hiddenValue = html`<span class="aster-hidden" title="You can't see this value">Hidden</span>`;

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
  readonly #selectable = this.prop(true);
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
  #viewRequest = 0;
  readonly #pendingFocus = signal<number | undefined>(undefined);
  #focusBefore: Element | null = null;
  #groupToolFocus: { field: string | undefined; action: string } | undefined;
  readonly #base = this.prop<Criteria | undefined>(undefined);
  readonly #view = this.prop<GridView | undefined>(undefined);
  readonly #label = this.prop("");
  readonly #publish = this.prop("");
  readonly #persist = this.prop("");
  readonly #renderers = this.prop<Readonly<Record<string, CellRenderer>>>({});
  readonly #formatters = this.prop<Readonly<Record<string, CellFormatter>>>({});
  readonly #lookups = this.prop<Readonly<Record<string, Lookup>>>({});
  readonly #summaries = this.prop<readonly GridSummary[]>([]);
  readonly #progressPolicy = this.prop<ProgressPolicy>({});
  #summary: Summary | undefined;
  #summaryConfig: readonly GridSummary[] | undefined;
  #summaryCollection: Collection | undefined;
  #summaryContext: DataContext | undefined;
  readonly #empty = this.prop<View>(nothing);
  readonly #editable = this.prop(false);
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
  readonly #rules = this.prop<Readonly<Record<string, FieldRules>>>({});
  readonly #editing = signal<{ readonly key: KeyText; readonly edit: EditModel; readonly stop: () => void } | undefined>(undefined);

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
    const columns = view.columns.filter((c) => !c.hidden).map((c) => ({ field: c.field }));
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
   * A tree grid: the first column shows each record's level with an opener;
   * levels load as they open; a filter keeps the path to each match. Set it
   * before the grid connects.
   */
  get tree(): GridTree | undefined {
    return this.#treeOptions.value;
  }
  set tree(v: GridTree | undefined) {
    if (v && this.#external()) throw new Error("A shared collection grid supports flat rows");
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
      announce(`Only ${expansion.limit} ${expansion.limit === 1 ? noun : `${noun}s`} can be open at once. Close one first.`);
      this.#refused.value = `Only ${expansion.limit} ${expansion.limit === 1 ? noun : `${noun}s`} can be open at once. Close one first.`;
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
    return { key, entity, expanded, editable: this.#editable.value };
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
  /** Rows can be edited in place: Enter, F2 or a double-click start, Enter saves, Escape cancels. */
  get editable(): boolean {
    return this.#editable.value;
  }
  set editable(v: boolean) {
    this.#editable.value = v;
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
  /** Allows this view to change selection; borrowed selection state remains visible. */
  get selectable(): boolean { return this.#selectable.value; }
  set selectable(value: boolean) {
    const restore = !value && document.activeElement instanceof Element && this.contains(document.activeElement) && !!document.activeElement.closest(".aster-grid-selection");
    this.#selectable.value = value;
    if (restore) { this.#selectionInside.value = undefined; queueMicrotask(() => this.focus({ preventScroll: true })); }
  }
  set selection(v: Selection | undefined) {
    if (v && (this.#treeOptions.peek() || groupFields(this.#view.peek()).length)) throw new Error("A shared selection grid supports flat rows");
    if (v && this.#binding.peek() && v.collection !== this.#binding.peek()) throw new Error("collection and selection must refer to the same collection");
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
    const request = ++this.#focusRequest;
    const query = collection.query;
    this.#pendingFocus.value = index;
    try {
      await collection.view(index, index + 1, [index, this.#active.peek().row]);
      if (!this.isConnected || request !== this.#focusRequest || this.#collection !== collection || collection.query !== query || collection.keys.peek()[index] === undefined) return false;
      const columns = this.#view.peek()!.columns.filter((c) => !c.hidden).length;
      this.#activate(index, Math.max(0, Math.min(columns - 1, column)));
      const scroll = this.querySelector<HTMLElement>(".aster-grid-scroll");
      if (scroll) this.#top.value = scroll.scrollTop;
      queueMicrotask(() => this.focus({ preventScroll: true }));
      return true;
    } catch {
      this.#selectionNote.value = "Could not load that row. Move to another row or retry.";
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
    this.listen(document, "pointerdown", (e) => {
      if (this.#panel.peek() && !(e.target as Element).closest(".aster-grid-panel, .aster-grid-tool")) this.#panel.value = undefined;
    });
    // Where a click doesn't focus the button that opened a panel (WebKit), Escape arrives on the body.
    this.listen(document, "keydown", (e) => {
      if (e.target === document.body) this.#panelKey(e as KeyboardEvent);
    });
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
    const columns = view.columns.filter((c) => !c.hidden);
    const lookups = this.#lookups.value;
    const fields = columns.map((c) => type.field(c.field));
    const numeric = columns.map((c, i) => isNumeric(fields[i]) && !lookups[c.field]);
    const titles = columns.map((c, i) => fields[i]?.title ?? c.field);
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
    const frozenLeft = this.#frozenOffsets(columns, view.frozen);
    const style = styleMap({
      "--grid-columns": columns.map((c, i) => track(c, lookups[c.field] ? undefined : fields[i])).join(" "),
      ...Object.fromEntries(frozenLeft.map((left, i) => [`--frozen-${i}`, `${left}px`])),
    });
    const rows = [];
    for (let i = start; i < end; i++) rows.push(i);
    const cellId = (row: number, col: number) => `${this.#id}-${row}-${col}`;
    const filters = this.#showFilters.value || Object.keys(view.filters).length > 0;
    const activeId =
      active.row === HEADER ? `${this.#id}-h-${active.col}`
      : active.row === FILTER_ROW ? `${this.#id}-f-${active.col}`
      : !count ? undefined
      : cellId(active.row, active.row < count && layout.at(active.row).kind === "group" ? 0 : active.col);
    const frozenStyle = (i: number) => (i < view.frozen ? `left:var(--frozen-${i})` : nothing);
    return html`${this.#toolbar(view, layout)}
      <div class="aster-grid-scroll" role=${groupFields(view).length || this.#tree ? "treegrid" : "grid"} tabindex="0" aria-label=${this.#label.value}
        ?data-fixed-columns=${columns.length > 0 && columns.every((c) => c.width !== undefined)}
        aria-rowcount=${layout.atLeast !== undefined || layout.estimate ? -1 : (count ?? 0) + (filters ? 2 : 1)} aria-colcount=${columns.length + (this.#rowControls.value ? 1 : 0)}
        aria-describedby=${layout.atLeast !== undefined || layout.estimate ? `${this.#id}-total` : nothing}
        aria-multiselectable=${this.#selectable.value && selection?.multiple ? "true" : nothing}
        aria-activedescendant=${activeId && (active.row < 0 || (active.row >= start && active.row < end)) ? activeId : nothing} aria-busy=${this.#grouping ? this.#grouping.root.status.value === "loading" ? "true" : "false" : collection.status.value === "loading" || count === undefined && collection.status.value !== "error" ? "true" : "false"}
        ?data-draggable=${!!this.#treeOptions.value?.draggable && this.#editable.value}
        @scroll=${(e: Event) => this.#scrolled(e.currentTarget as HTMLElement)}
        @keydown=${(e: KeyboardEvent) => this.#key(e, columns.length)}
        @click=${(e: MouseEvent) => this.#click(e)}
        @focusout=${() => queueMicrotask(() => { if (!this.contains(document.activeElement)) this.#focusRequest++; })}
        @dblclick=${(e: MouseEvent) => this.#dblclick(e)}
        @contextmenu=${(e: MouseEvent) => this.#contextMenu(e)}
        @pointerdown=${(e: PointerEvent) => this.#dragRow(e)}>
        <div class="aster-grid-table" style=${style}>
          <div class="aster-grid-headgroup">
            ${this.#treeOptions.value?.draggable && this.#editable.value ? html`<div class="aster-grid-root-drop">Top level</div>` : nothing}
            <div class="aster-grid-row aster-grid-head" role="row" aria-rowindex="1">
              ${columns.map((c, i) => this.#header(c, fields[i], i, view, numeric[i]!, frozenStyle(i), active.row === HEADER && active.col === i))}
            </div>
            ${filters
              ? html`<div class="aster-grid-row aster-grid-filters" role="row" aria-rowindex="2" @keydown=${(e: KeyboardEvent) => this.#filterKey(e)}>
                  ${columns.map((c, i) => html`<div class="aster-grid-cell aster-grid-filter" role="gridcell" aria-colindex=${i + 1}
                    id=${`${this.#id}-f-${i}`} ?data-active=${active.row === FILTER_ROW && active.col === i}
                    ?data-frozen=${i < view.frozen} style=${frozenStyle(i)}>${this.#filter(c, fields[i], view)}</div>`)}
                </div>`
              : nothing}
          </div>
          <div class="aster-grid-spacer" style=${`height:${top}px`}></div>
          ${each(
            rows.map((i) => ({ i, item: layout.at(i) })),
            ({ i, item }) => (item.kind === "group" ? item.id : (item.key ?? `?${i}`)),
            ({ i, item }) => {
              if (item.kind === "group") return this.#groupRow(item, i, i + (filters ? 3 : 2), columns.length, view, active.row === i);
              const key = item.key;
              const stored = key === undefined ? undefined : ctx.store.record(collection.query.set, key).value;
              const entity = stored?.entity;
              const editing = this.#editing.value;
              const edit = editing && key !== undefined && editing.key === key ? editing.edit : undefined;
              const conflict = edit?.conflict.value;
              const formError = edit?.formError.value;
              // A read-only reason shows once for the row, not under every cell it covers.
              const reasons = edit
                ? [...new Set(columns.flatMap((c) => {
                    const st = fields.some((f) => f?.name === c.field) ? edit.state(c.field).value : undefined;
                    return st?.readOnly && st.reasons.readOnly && !fields.find((f) => f?.name === c.field)?.computed ? [st.reasons.readOnly] : [];
                  }))]
                : [];
              const shared = new Map(reasons.map((r, n) => [r, `${this.#id}-reason-${n}`]));
              return html`<div class="aster-grid-row" role="row" aria-rowindex=${i + (filters ? 3 : 2)} data-index=${i}
                aria-level=${item.node?.level ?? item.level ?? nothing}
                aria-posinset=${item.node?.position ?? item.position ?? nothing} aria-setsize=${item.node?.siblings ?? item.siblings ?? nothing}
                style=${item.node || item.level ? `--level:${(item.node?.level ?? item.level ?? 1) - 1}` : nothing}
                aria-expanded=${item.node && item.node.folder !== false && item.key !== undefined ? (item.node.open ? "true" : "false") : nothing}
                data-key=${key ?? nothing} aria-selected=${this.#external() && !selection ? nothing : key !== undefined && (selection ? selectedKeys.includes(key) : key === selected) ? "true" : "false"}
                ?data-grouped-row=${item.level !== undefined}
                ?data-active-row=${active.row === i} ?data-expanded=${key !== undefined && this.#open.value.includes(key)}
                ?data-placeholder=${!entity} ?data-editing=${edit !== undefined} ?data-lifted=${key !== undefined && key === this.#lifted.value}
                @keydown=${edit ? (e: KeyboardEvent) => this.#editKey(e) : nothing}
                @mousedown=${edit ? (e: MouseEvent) => this.#focusPressed(e) : nothing}
                @focusout=${edit ? (e: FocusEvent) => this.#editBlur(e) : nothing}>
                ${columns.map((c, col) => {
                  const content = !entity ? html`<span class="aster-grid-skeleton"></span>`
                    : edit && !fields[col]?.computed
                      ? controlFor(edit, c.field, { options: lookups[c.field] ? this.#optionsFor(c.field, lookups[c.field]!) : undefined, labelled: false, sharedReasons: shared })
                      : stored?.hidden?.has(c.field) ? hiddenValue : this.#cell(c, fields[col], entity, key!, ctx);
                  return html`<div class="aster-grid-cell" role="gridcell" id=${cellId(i, col)}
                    aria-colindex=${col + 1} ?data-active=${active.row === i && active.col === col}
                    ?data-numeric=${numeric[col]} ?data-frozen=${col < view.frozen} style=${`grid-column:${col + 1};${col < view.frozen ? `left:var(--frozen-${col})` : ""}`} data-label=${titles[col]!}>
                    ${col === 0 && item.node ? this.#treeLead(item.node) : nothing}
                    ${col === 0 && key !== undefined && selection && this.#selectable.value ? html`<div class="aster-grid-selection-value">
                      ${this.#selectionControl(key, entity, selectedKeys, stored?.hidden)}<div class="aster-grid-selection-content">${content}</div>
                    </div>` : content}
                  </div>`;
                })}
                ${key !== undefined && entity ? this.#controls(key, entity, this.#open.value.includes(key), active.row === i, columns.length) : nothing}
                ${key !== undefined && this.#open.value.includes(key) ? this.#expansionCell(key, columns.length) : nothing}
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
        ${count === 0 ? html`<div class="aster-grid-empty">${this.#empty.value}</div>` : nothing}
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
    if (focusBefore && !focusBefore.isConnected && document.activeElement === document.body) this.focus({ preventScroll: true });
  }

  // ── toolbar and panels ──

  #filterContext(): string {
    return JSON.stringify([this.set, this.#view.value, this.#base.value, this.#external()?.query]);
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
    if (this.#filterStale() || !model.apply()) return;
    const view = this.#view.peek();
    if (!view) return;
    const { criteria: _, ...rest } = view;
    const criteria = model.applied.peek();
    this.#setView({ ...rest, ...(criteria ? { criteria } : {}) });
    this.querySelector<Dialog>(".aster-grid-advanced")?.close();
    announce(criteria ? "Advanced filter applied" : "Advanced filter cleared");
  }

  #query(set: string, view: GridView, base?: Criteria, paths: Readonly<Record<string, string>> = {}): Query {
    const checked = this.#criteriaCheck.value;
    return viewQuery(set, checked?.valid === false ? { ...view, criteria: { op: "or", args: [] } } : view, base, paths);
  }

  #toolbar(view: GridView, layout: Layout): View {
    const panel = this.#panel.value;
    const filters = Object.keys(view.filters).length;
    const count = layout.total;
    const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);
    const grouped = this.#treeOptions.value ? [] : groupFields(view);
    const groupTitle = (field: string) => this.#collection?.type.field(field)?.title ?? field;
    const chooseSort = (field: string, descending: boolean) => {
      this.querySelector<Menu>(".aster-grid-menu")?.close();
      this.#setView(sortDirection(view, field, descending, false));
    };
    const tool = (name: Panel, label: string) => html`<button type="button" class="aster-grid-tool"
      style=${anchorStyle(`${this.#id}-tool-${name}`)}
      aria-expanded=${panel === name ? "true" : "false"} aria-controls=${`${this.#id}-${name}`}
      @click=${() => (this.#panel.value = panel === name ? undefined : name)}>${label}</button>`;
    return html`<div class="aster-grid-toolbar" role="toolbar" aria-label=${`${this.#label.value} view`}
      @keydown=${(e: KeyboardEvent) => this.#panelKey(e)}>
      <span class="aster-grid-total" id=${`${this.#id}-total`} aria-live="polite">${count === undefined
        ? "Loading…"
        : layout.estimate
          ? `About ${fmt(roughly(count))} rows`
          : layout.atLeast !== undefined
            ? `${fmt(layout.atLeast)}+ rows`
            : `${fmt(count)} ${count === 1 ? "row" : "rows"}${layout.groups === undefined ? "" : ` in ${fmt(layout.groups)} ${layout.groups === 1 ? "group" : "groups"}`}`}</span>
      <button type="button" class="aster-grid-tool" aria-haspopup="menu" @click=${(event: MouseEvent) => {
        const items: MenuItem[] = view.columns.filter(column => !column.hidden && this.#sortable(column.field)).map(column => {
          const sorted = view.sort.find(key => key.field === column.field);
          return { kind: "group", label: groupTitle(column.field), items: [
            { kind: "radio", label: "Ascending", checked: !!sorted && !sorted.descending, run: () => chooseSort(column.field, false) },
            { kind: "radio", label: "Descending", checked: !!sorted?.descending, run: () => chooseSort(column.field, true) },
          ] };
        });
        items.push({ label: "Clear sorting", run: () => this.#setView({ ...view, sort: [] }) });
        this.querySelector<Menu>(".aster-grid-menu")?.openFrom(event.currentTarget as HTMLElement, items, "Sort rows");
      }}>Sort</button>
      ${this.#selectionNote.value ? html`<span class="aster-grid-note" role="status">${this.#selectionNote.value}</span>` : nothing}
      ${this.#grouping?.root.error.value !== undefined ? html`<span class="aster-grid-note aster-error" role="status">Couldn’t load groups.</span>
        <button type="button" class="aster-grid-tool" @click=${() => { this.focus({ preventScroll: true }); void this.#grouping?.retry(); }}>Retry groups</button>` : nothing}
      ${this.#refused.value ? html`<span class="aster-grid-note aster-grid-refused">${this.#refused.value}</span>` : nothing}
      ${this.#tree?.searching.value
        ? html`<span class="aster-grid-note" role="status">Finding where the matches are…</span>`
        : this.#tree?.tooBroad.value
          ? html`<span class="aster-grid-note" role="status">Too many matches to show where they are. Narrow the filter.</span>`
          : this.#tree?.error.value !== undefined
            ? html`<span class="aster-grid-note aster-error" role="status">Couldn’t find where the matches are. Change the filter to try again.</span>`
            : nothing}
      ${grouped.map((field, i) => html`<span class="aster-grid-group-tools" data-group-field=${field}>
        <button type="button" class="aster-grid-tool" data-group-action="remove" aria-pressed="true" title=${grouped.length === 1 ? "Stop grouping" : `Remove grouping ${groupTitle(field)}`}
          @click=${() => this.#setView(setGroup(view, grouped.filter((f) => f !== field)))}>${i ? "Then by" : "Grouped by"} ${groupTitle(field)} ✕</button>
        ${grouped.length > 1 ? html`<button type="button" class="aster-grid-tool" data-group-action="earlier" aria-label=${`Move ${groupTitle(field)} grouping earlier`} ?disabled=${i === 0}
          @click=${() => this.#reorderGroup(i, -1)}>↑</button>
          <button type="button" class="aster-grid-tool" data-group-action="later" aria-label=${`Move ${groupTitle(field)} grouping later`} ?disabled=${i === grouped.length - 1}
          @click=${() => this.#reorderGroup(i, 1)}>↓</button>` : nothing}
      </span>`)}
      <button type="button" class="aster-grid-tool" aria-pressed=${this.#showFilters.value || filters > 0 ? "true" : "false"}
        @click=${() => this.#toggleFilters(view)}>${filters ? `Filters (${filters})` : "Filters"}</button>
      <button type="button" class="aster-grid-tool" aria-haspopup="dialog" aria-pressed=${view.criteria ? "true" : "false"}
        @click=${(e: Event) => this.#openAdvanced(e.currentTarget as HTMLElement)}>Advanced filter</button>
      ${view.criteria ? html`<span class="aster-grid-expression" role="status">${this.#criteriaCheck.value?.valid === false
        ? "Saved filter needs repair. No matches will be returned."
        : describeCriteria(view.criteria, this.#collection!.type)}</span>` : nothing}
      ${tool("columns", "Columns")}
      ${this.#persist.value ? tool("views", "Views") : nothing}
      ${panel === "columns" ? this.#columnsPanel(view) : panel === "views" ? this.#viewsPanel(view) : nothing}
    </div>`;
  }

  #columnsPanel(view: GridView): View {
    const type = this.#collection!.type;
    const title = (field: string) => type.field(field)?.title ?? field;
    const visible = view.columns.filter((c) => !c.hidden).length;
    return html`<div class="aster-grid-panel aster-popover" popover="manual" ${openWhen(true)} style=${placeStyle(`${this.#id}-tool-columns`)}
      id=${`${this.#id}-columns`} role="group" aria-label="Columns"
      @keydown=${(e: KeyboardEvent) => this.#panelKey(e)}>
      <p class="aster-grid-panel-title">Columns</p>
      <ul>
        ${view.columns.map(
          (c, i) => html`<li>
            <label><input type="checkbox" .checked=${!c.hidden} ?disabled=${!c.hidden && visible === 1}
              @change=${(e: Event) => this.#setView(setHidden(view, c.field, !(e.target as HTMLInputElement).checked))}>
              ${title(c.field)}</label>
            <button type="button" aria-label=${`Move ${title(c.field)} up`} ?disabled=${i === 0}
              @click=${() => this.#setView(moveColumn(view, c.field, i - 1))}>↑</button>
            <button type="button" aria-label=${`Move ${title(c.field)} down`} ?disabled=${i === view.columns.length - 1}
              @click=${() => this.#setView(moveColumn(view, c.field, i + 1))}>↓</button>
          </li>`,
        )}
      </ul>
      <button type="button" class="aster-grid-panel-action" @click=${() => this.#reset()}>Reset to the page’s view</button>
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
      id=${`${this.#id}-views`} role="group" aria-label="Views"
      @keydown=${(e: KeyboardEvent) => this.#panelKey(e)}>
      <p class="aster-grid-panel-title">Saved views</p>
      ${names.length === 0 ? html`<p class="aster-grid-panel-note">None yet. Shape the grid, then save it here by name.</p>` : nothing}
      <ul>
        ${names.map(
          (n) => html`<li>
            <button type="button" class="aster-grid-panel-view" @click=${() => {
              this.#setView(reconcile(saved.named[n]!, this.#offered ?? view));
              this.#panel.value = undefined;
            }}>${n}</button>
            <button type="button" aria-label=${`Delete the view ${n}`} @click=${() => {
              const { [n]: _, ...rest } = saved.named;
              this.#saved.value = { ...saved, named: rest };
            }}>Delete</button>
          </li>`,
        )}
      </ul>
      <form class="aster-grid-panel-save" @submit=${(e: SubmitEvent) => (e.preventDefault(), save(e.currentTarget as HTMLFormElement))}>
        <label class="aster-field" data-ring-owner>
          <input aria-label="Name for this view" placeholder="Name this view">
        </label>
        <button type="submit" class="aster-grid-panel-action">Save</button>
      </form>
      <button type="button" class="aster-grid-panel-action" @click=${() => this.#reset()}>Reset to the page’s view</button>
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

  #header(column: GridColumn, field: Field | undefined, i: number, view: GridView, numeric: boolean, frozen: unknown, active: boolean): View {
    const sort = view.sort.findIndex((s) => s.field === column.field);
    const key = sort >= 0 ? view.sort[sort] : undefined;
    const ariaSort = sort === 0 ? (key!.descending ? "descending" : "ascending") : nothing;
    const title = field?.title ?? column.field;
    return html`<div class="aster-grid-cell aster-grid-header" role="columnheader" aria-colindex=${i + 1} id=${`${this.#id}-h-${i}`}
      aria-sort=${ariaSort} ?data-numeric=${numeric} ?data-frozen=${i < view.frozen} ?data-active=${active} style=${frozen}
      data-field=${column.field}>
      <button type="button" class="aster-grid-sort" tabindex="-1"
        title=${this.#sortable(column.field) ? `Sort by ${title}; Shift adds it to the sort; drag to move` : "Drag to move"}
        @pointerdown=${(e: PointerEvent) => this.#dragColumn(e, column.field)}
        @click=${(e: MouseEvent) => this.#sort(column.field, e.shiftKey)}>
        <span>${title}</span>
        ${key
          ? html`<svg class="aster-grid-sort-mark" viewBox="0 0 10 10" aria-hidden="true">
              <path d=${key.descending ? "M2 3.5 5 6.5l3-3" : "M2 6.5 5 3.5l3 3"}/></svg>
              ${view.sort.length > 1 ? html`<small>${sort + 1}</small>` : nothing}`
          : nothing}
      </button>
      <button type="button" class="aster-grid-header-menu" tabindex="-1" aria-label=${`${title} column options`}
        @click=${(e: MouseEvent) => this.#openMenu(column.field, e.currentTarget as HTMLElement)}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8l3-3"/></svg>
      </button>
      <span class="aster-grid-resize" aria-hidden="true" @pointerdown=${(e: PointerEvent) => this.#resize(e, column.field)}
        @dblclick=${() => this.#setView(setWidth(this.#view.peek()!, column.field, undefined))}></span>
    </div>`;
  }

  #menuItems(field: string): MenuItem[] {
    const view = this.#view.peek()!;
    const type = this.#collection!.type;
    const title = type.field(field)?.title ?? field;
    const sorted = view.sort.find((s) => s.field === field);
    const visible = view.columns.filter((c) => !c.hidden);
    const at = visible.findIndex((c) => c.field === field);
    const set = (v: GridView) => this.#setView(v);
    const width = (delta: number) => set(setWidth(view, field, (visible[at]?.width ?? this.#measuredWidth(field)) + delta));
    const frozenHere = at + 1 === view.frozen;
    const move = (to: number) => set(moveColumn(view, field, view.columns.findIndex((c) => c.field === visible[to]?.field)));
    return [
      ...(this.#sortable(field)
        ? [
            {
              kind: "group" as const,
              label: "Sort",
              items: [
                { kind: "radio" as const, label: "Ascending", checked: !!sorted && !sorted.descending, run: () => set(sortDirection(view, field, false, false)) },
                { kind: "radio" as const, label: "Descending", checked: !!sorted?.descending, run: () => set(sortDirection(view, field, true, false)) },
                { kind: "radio" as const, label: "Not sorted", checked: !sorted, run: () => set(removeSort(view, field)) },
                ...(view.sort.length > 0 && !sorted ? [{ label: "Add to the sort", run: () => set(sortDirection(view, field, false, true)) }] : []),
              ],
            },
            { kind: "separator" as const },
          ]
        : []),
      ...(this.#groupable(field)
        ? [{ kind: "check" as const, label: `Group by ${title}`, checked: groupFields(view).includes(field), run: () => set(setGroup(view, groupFields(view).includes(field) ? groupFields(view).filter((f) => f !== field) : [...groupFields(view), field])) }]
        : []),
      ...(at < visible.length - 1
        ? [{
            kind: "check" as const,
            label: `Freeze up to ${title}`,
            checked: frozenHere,
            run: () => set(frozenHere ? { ...view, frozen: 0 } : freezeThrough(view, field, (f) => this.#measuredWidth(f))),
          }]
        : []),
      {
        kind: "submenu",
        label: "Move",
        items: [
          { label: "Left", run: () => set(nudgeColumn(view, field, -1)), ...(at > 0 ? {} : { disabled: "It's the first column." }) },
          { label: "Right", run: () => set(nudgeColumn(view, field, 1)), ...(at < visible.length - 1 ? {} : { disabled: "It's the last column." }) },
          { label: "To the start", run: () => move(0), ...(at > 0 ? {} : { disabled: "It's the first column." }) },
          { label: "To the end", run: () => move(visible.length - 1), ...(at < visible.length - 1 ? {} : { disabled: "It's the last column." }) },
        ],
      },
      {
        kind: "submenu",
        label: "Width",
        items: [
          { label: "Wider", run: () => width(40) },
          { label: "Narrower", run: () => width(-40) },
          { label: "Fit the space", run: () => set(setWidth(view, field, undefined)) },
        ],
      },
      { kind: "separator" },
      ...(visible.length > 1 ? [{ label: `Hide ${title}`, run: () => set(setHidden(view, field, true)) }] : []),
      { label: "Columns…", run: () => (this.#panel.value = "columns") },
    ];
  }

  #openMenu(field: string, anchor: HTMLElement, returnTo: HTMLElement = anchor): void {
    const title = this.#collection?.type.field(field)?.title ?? field;
    this.querySelector<Menu>(".aster-grid-menu")?.openFrom(anchor, this.#menuItems(field), `${title} column`, returnTo);
  }

  /**
   * The row's menu: the page's actions for the record, then the column's
   * own options as a submenu. At the pointer, or under the active cell.
   */
  #openRowMenu(row: number, col: number, point?: { x: number; y: number }): void {
    const item = untracked(() => this.#layout()).at(row);
    const field = this.#view.peek()!.columns.filter((c) => !c.hidden)[col]?.field;
    if (!field) return;
    const title = this.#collection!.type.field(field)?.title ?? field;
    const key = item.kind === "row" ? item.key : undefined;
    const entity = key === undefined ? undefined : this.#ctx.peek()?.store.get(this.#collection!.query.set, key)?.entity;
    const actions = key !== undefined && entity ? this.#rowMenu.peek()(entity, key) : [];
    const items: MenuItem[] = [
      ...actions,
      ...(actions.length ? [{ kind: "separator" as const }] : []),
      { kind: "submenu", label: `${title} column`, items: this.#menuItems(field) },
    ];
    const cell = this.querySelector<HTMLElement>(`#${CSS.escape(`${this.#id}-${row}-${col}`)}`);
    const rect = cell?.getBoundingClientRect();
    const at = point ?? { x: rect?.left ?? 0, y: rect?.bottom ?? 0 };
    this.querySelector<Menu>(".aster-grid-menu")?.openAt(at, items, key !== undefined ? "Row" : `${title} column`, this.querySelector(".aster-grid-scroll"));
  }

  // ── filters ──

  #filter(column: GridColumn, field: Field | undefined, view: GridView): View {
    if (!field) return nothing;
    const title = field.title ?? column.field;
    const current = view.filters[column.field];
    const lookup = this.#lookups.value[column.field];
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
    const ranged = isNumeric(field) || field.type === "Edm.Date";
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
        <input .value=${live(text)} aria-label=${`Filter ${title}`} aria-invalid=${error ? "true" : nothing}
          aria-describedby=${error ? errorId : nothing}
          placeholder=${ranged ? (date ? ">=1 Oct 2026" : ">5 or 1..3") : "Contains"}
          @input=${(e: InputEvent) => this.#typeFilter(column.field, field, (e.target as HTMLInputElement).value, ranged)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.#flushFilter(column.field)}
          @blur=${() => this.#flushFilter(column.field)}>
        ${date
          ? html`<button type="button" class="aster-date-button" id=${button} aria-label=${`Choose a date to filter ${title}`}
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
        const { [name]: _, ...errors } = this.#filterErrors.peek();
        this.#filterErrors.value = parsed.error ? { ...errors, [name]: parsed.error } : errors;
        if (!parsed.error) this.#setView(setFilter(this.#view.peek()!, name, parsed.criteria));
    };
    this.#filterApply.set(name, apply);
    this.#filterTimers.set(name, setTimeout(apply, FILTER_DELAY));
  }

  #toggleFilters(view: GridView): void {
    const showing = this.#showFilters.peek() || Object.keys(view.filters).length > 0;
    if (showing && Object.keys(view.filters).length > 0) {
      this.#filterText.value = {};
      this.#filterErrors.value = {};
      this.#setView({ ...view, filters: {} });
    }
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

  #cell(column: GridColumn, field: Field | undefined, entity: Entity, key: KeyText, ctx: DataContext): View | string {
    const render = this.#renderers.value[column.field];
    if (render) return render(entity, key);
    const value: Value | undefined = entity[column.field];
    const formatter = this.#formatters.value[column.field];
    if (formatter) return formatter(value, entity, field);
    const lookup = this.#lookups.value[column.field];
    if (lookup && value !== null && value !== undefined) {
      const related = ctx.lookup(lookup.set, keyText([value])).value;
      return related ? String(related[lookup.display] ?? "") : html`<span class="aster-grid-skeleton"></span>`;
    }
    if (field?.type === "Edm.Boolean") return value ? "Yes" : "";
    if (field?.type === "Edm.Date" && typeof value === "string") return formatDate(value);
    if (field?.type === "Edm.DateTimeOffset" && typeof value === "string") return absoluteTime(value);
    return formatValue(field, value);
  }

  #external(): Collection | undefined {
    return this.#binding.value ?? this.#selection.value?.collection;
  }

  #syncBound(): void {
    const collection = this.#external();
    const view = this.#view.value;
    const base = this.#base.value;
    const paths = this.#sortPaths.value;
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
      const parts = [this.#boundBase, base, ...Object.values(view.filters)].filter((c): c is Criteria => c !== undefined);
      const filter = parts.length > 1 ? { op: "and" as const, args: parts } : parts[0];
      const projected = this.#query(query.set, { ...view, filters: {} }, filter, paths);
      if (JSON.stringify([query.filter, query.orderBy]) === JSON.stringify([projected.filter, projected.orderBy])) return;
      const { filter: _filter, orderBy: _orderBy, ...rest } = query;
      const next: Query = { ...rest, ...projected };
      this.#boundQuery = next;
      collection.setQuery(next);
    });
  }

  #recoverActive(): void {
    this.#version.value;
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

  #choose(key: KeyText, index: number, extend: boolean, toggle: boolean): void {
    if (!this.#selectable.peek()) return;
    const selection = this.#selection.peek();
    if (!selection) return;
    let accepted = true;
    if (extend && selection.multiple) {
      const anchor = this.#selectionAnchor;
      const slots = selection.collection.keys.peek();
      const loaded = anchor ? slots.indexOf(anchor.key) : -1;
      const from = loaded >= 0 ? loaded : anchor?.query === selection.collection.query ? anchor.index : index;
      const range = slots.slice(Math.min(from, index), Math.max(from, index) + 1).filter((k): k is KeyText => k !== undefined);
      accepted = selection.selectAll(range);
    } else {
      if (toggle || selection.ordered) accepted = selection.toggle(key);
      else selection.select(key);
      this.#selectionAnchor = { key, index, query: selection.collection.query };
    }
    this.#selectionNote.value = accepted ? "" : `Select at most ${selection.maxOrdered} ordered items. Deselect an item to add another.`;
  }

  #moveSelection(key: KeyText, delta: number): void {
    if (!this.#selectable.peek()) return;
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

  #setView(view: GridView): void {
    const request = ++this.#viewRequest;
    if (this.#editing.peek() && (JSON.stringify(groupFields(view)) !== JSON.stringify(groupFields(this.#view.peek())) || JSON.stringify(view.criteria) !== JSON.stringify(this.#view.peek()?.criteria))) {
      void this.#endEdit(true).then((saved) => {
        if (saved && this.isConnected && request === this.#viewRequest) this.#commitView(view);
      });
      return;
    }
    this.#commitView(view);
  }

  #commitView(view: GridView): void {
    const beforeGroups = groupFields(this.#view.peek());
    const afterGroups = groupFields(view);
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
    if (this.#collection?.query.set === set && (this.#ownsCollection || this.#tree)) return;
    const treeOptions = untracked(() => this.#treeOptions.value);
    if (treeOptions) {
      untracked(() => {
        this.#tree?.dispose();
        const filters = computed((): Criteria | undefined => {
          return this.#query(set, this.#view.value ?? { columns: [], sort: [], filters: {}, frozen: 0 }).filter;
        });
        this.#tree = new Tree(ctx, {
          set,
          ...treeOptions,
          base: computed(() => this.#base.value),
          filter: filters,
          orderBy: computed(() => viewQuery(set, this.#view.value ?? { columns: [], sort: [], filters: {}, frozen: 0 }, undefined, this.#sortPaths.value).orderBy ?? []),
        });
        this.#collection = this.#tree.level(undefined);
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
      this.#collection = ctx.collection(query, { pageSize: 100 });
      this.#ownsCollection = true;
      this.#version.value++;
    });
  }

  /** A new query (filter, sort, grouping, base) starts at the top, with its first row active. */
  #toTop(): void {
    const view = this.#view.value;
    // Before the view arrives there's no query to compare with.
    if (!view) return;
    const key = JSON.stringify([view.filters, view.criteria, view.sort, view.groupBy, this.#base.value, this.#external()?.query]);
    untracked(() => {
      if (this.#lastQuery !== undefined && this.#lastQuery !== key) {
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
    if (!collection) return;
    const layout = this.#layout();
    this.#heights.setKeys(layout.keys);
    const { start, end } = this.#heights.window(this.#top.value, this.#viewport.value, OVERSCAN);
    const wanted = new Map<Collection, { from: number; to: number }>();
    if (!groupFields(this.#view.value).length && !this.#tree) wanted.set(collection, { from: start, to: Math.max(end, 1) });
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
    if (!groupFields(view).length) {
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
    const path = item.path.map((value, i) => String(this.#groupLabel(groupFields(this.#view.value)[i]!, this.#collection!.type.field(groupFields(this.#view.value)[i]!), value))).join(" / ");
    return html`<div class="aster-grid-row aster-grid-group" role="row" aria-rowindex=${rowIndex} data-index=${index}
      data-key=${item.id} aria-level=${item.level} aria-posinset=${item.position} aria-setsize=${item.siblings}
      aria-expanded=${item.expanded ? "true" : "false"} aria-busy=${item.loading ? "true" : "false"} style=${`--level:${item.level - 1}`}>
      <div class="aster-grid-cell" role="gridcell" id=${`${this.#id}-${index}-0`} aria-colindex="1" aria-colspan=${columns}
        ?data-active=${active} @click=${(e: MouseEvent) => { if (!(e.target as Element).closest("button")) this.#toggleGroup(item.id); }}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3"/></svg>
        <span class="aster-sr-only">${field?.title ?? item.field}: </span>
        <span class="aster-grid-group-label">${label}</span>
        <span class="aster-grid-group-count">${new Intl.NumberFormat("en-GB").format(item.group.count)}</span>
        ${item.totalsAvailable ? this.#summaries.value.map((summary, i) => summary.method === "count" ? nothing : html`<span class="aster-grid-group-summary">${this.#summaryLabel(summary)}: ${this.#summaryValue(summary, item.group.totals[`s${i}`] ?? null)}</span>`) : nothing}
        ${item.loading ? html`<span class="aster-grid-group-loading" role="status">Loading…</span>` : nothing}
        ${item.error !== undefined ? html`<span class="aster-error" role="status">Couldn’t load group.</span>
          <button type="button" class="aster-grid-tool" aria-label=${`Retry group ${path}`} @click=${() => { this.#activate(index, 0); this.focus({ preventScroll: true }); void this.#grouping?.retry(item.id).catch(() => {}); }}>Retry</button>` : nothing}
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
    if (summary.method === "count") return "Rows";
    const title = this.#collection?.type.field(summary.field)?.title ?? summary.field;
    const names = { sum: "Sum", min: "Minimum", max: "Maximum", average: "Average", countdistinct: "Distinct" };
    return `${names[summary.method]} ${title}`;
  }

  #summaryValue(summary: GridSummary, value: Value): View | string {
    if (value === null) return "—";
    if (summary.method === "count" || summary.method === "countdistinct") return new Intl.NumberFormat("en-GB").format(Number(value));
    return formatValue(this.#collection?.type.field(summary.field), value);
  }

  #summaryView(): View {
    const summary = this.#summary;
    if (!summary) return nothing;
    const values = summary.values.value;
    const status = summary.status.value;
    return html`<section class="aster-grid-summary" aria-label=${`${this.#label.value} summaries`} aria-busy=${status === "loading" ? "true" : "false"}>
      <aster-progress-status class="aster-grid-summary-status" .busy=${status === "loading"}
        .error=${status === "error" ? "Couldn’t load summaries." : undefined} .progressPolicy=${this.#progressPolicy.value}
        .pendingText=${"Loading summaries…"} .completeText=${"Summaries updated"}></aster-progress-status>
      ${status === "error" ? html`<button type="button" class="aster-grid-tool" @click=${() => { this.focus({ preventScroll: true }); void summary.refresh(); }}>Retry summaries</button>` : nothing}
      ${values ? html`<dl>${this.#summaries.value.map((s, i) => html`<div><dt>${this.#summaryLabel(s)}</dt><dd>${this.#summaryValue(s, values[s.method === "count" ? "count" : `s${i}`] ?? null)}</dd></div>`)}</dl>` : nothing}
    </section>`;
  }

  #groupLabel(name: string, field: Field | undefined, value: Value): View | string {
    if (value === null) return "None";
    const lookup = this.#lookups.value[name];
    if (lookup) return String(this.#ctx.peek()!.lookup(lookup.set, keyText([value])).value?.[lookup.display] ?? "…");
    if (field?.type === "Edm.Boolean") return value ? "Yes" : "No";
    if (field?.type === "Edm.Date" && typeof value === "string") return formatDate(value);
    if (field?.type === "Edm.DateTimeOffset" && typeof value === "string") return absoluteTime(value);
    return formatValue(field, value);
  }

  #groupable(name: string): boolean {
    if (this.#tree || this.#external()) return false;
    const field = this.#collection?.type.field(name);
    if (!field) return false;
    return !(field.type === "Edm.String" && !field.allowedValues && (field.maxLength ?? 0) > 500);
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

  #reorderGroup(index: number, step: -1 | 1): void {
    const view = this.#view.peek();
    if (!view) return;
    const fields = [...groupFields(view)];
    const to = index + step;
    if (to < 0 || to >= fields.length) return;
    [fields[index], fields[to]] = [fields[to]!, fields[index]!];
    this.#setView(setGroup(view, fields));
  }

  #groupSummaryConfig: readonly GridSummary[] | undefined;
  #groupFieldsKey = "";
  #groupContext: DataContext | undefined;

  /** Grouping order creates the model; query signals update its open branches. */
  #group(): void {
    const ctx = this.#ctx.value;
    const set = this.set;
    const fields = this.#treeOptions.value ? [] : groupFields(this.#view.value);
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

  #frozenOffsets(columns: readonly GridColumn[], frozen: number): number[] {
    const out: number[] = [];
    let left = 0;
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
    return !this.#lookups.peek()[field] || this.#sortPaths.peek()[field] !== undefined;
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
    if (this.#dragged || !this.#sortable(field)) return;
    const view = this.#view.peek();
    if (view) this.#setView(sortBy(view, field, add));
  }

  /** Drag the right edge of a header; JS writes only the column's width. */
  #resize(e: PointerEvent, field: string): void {
    if (e.button !== 0) return;
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
    if (!tree || !this.#treeOptions.peek()?.draggable || e.button !== 0 || !this.#editable.peek()) return;
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
    const why = (to: KeyText | undefined): string | undefined => {
      for (let k = to; k !== undefined; ) {
        if (k === key) return "A row can’t move under itself or its own subtree.";
        const parent = tree.entity(k)?.[tree.options.parentField];
        k = parent === null || parent === undefined ? undefined : keyText([parent]);
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
        announce(`Picked up ${title}. Drop it on another row to move it under that row, or on Top level to move it to the top level.`);
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
      announce(`${title} not moved.`);
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
    if (row?.dataset.key && !this.emit("row-open", { key: row.dataset.key })) return;
    // With expansion, a double-click opens the row rather than editing it in
    // place, and closes it again unless it has unsaved changes.
    if (this.#expansion.peek() && row?.dataset.key && !(e.target as Element).closest("[data-editing]")) {
      const key = row.dataset.key;
      if (!this.#open.peek().includes(key)) this.expand(key);
      else if (!this.#editors.get(key)?.dirty?.peek()) void this.collapse(key);
      return;
    }
    if (!this.#editable.peek() || (e.target as Element).closest("[data-editing]")) return;
    const cell = (e.target as Element).closest<HTMLElement>('[role="gridcell"]');
    if (row?.dataset.key) this.#startEdit(row.dataset.key, Number(cell?.getAttribute("aria-colindex") ?? 1) - 1);
  }

  /**
   * Starts editing a row: an edit model with the grid's rules in a child
   * scope where the row is published as `row`. Any other row being edited
   * saves first, and stays if it can't.
   */
  async #startEdit(key: KeyText, col: number): Promise<void> {
    if (this.#editing.peek()?.key === key) return;
    if (!(await this.#endEdit(true))) return;
    const ctx = this.#ctx.peek()!;
    const set = this.#collection!.query.set;
    const edit = new EditModel(ctx, set, key);
    const scope = (scopeOf(this) ?? undefined)?.child();
    const withdraw = scope?.publish("row", editPublication(edit));
    const rules = this.#rules.peek();
    if (scope && Object.keys(rules).length) edit.applyRules(scope, `${this.#publish.peek() || "grid"}.row`, rules);
    this.#editing.value = { key, edit, stop: () => (withdraw?.(), edit.dispose()) };
    requestAnimationFrame(() => this.#focusEditor(key, col));
  }

  #focusEditor(key: KeyText, col: number): void {
    const row = this.querySelector<HTMLElement>(`.aster-grid-row[data-key="${CSS.escape(key)}"]`);
    // A user may choose another control before deferred initial focus runs.
    if (row?.contains(document.activeElement)) return;
    const cells = row ? [...row.querySelectorAll<HTMLElement>('[role="gridcell"]')] : [];
    const target =
      cells[col]?.querySelector<HTMLElement>("input:not([readonly]), textarea:not([readonly]), [role=combobox]:not([aria-readonly])") ??
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
      const saved = await editing.edit.save();
      if (!saved) {
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
    const col = Number(cell.getAttribute("aria-colindex")) - 1;
    this.#activate(index, col);
    this.#openRowMenu(index, col, { x: e.clientX, y: e.clientY });
  }

  #click(e: MouseEvent): void {
    const cell = (e.target as Element).closest<HTMLElement>('[role="gridcell"]');
    const row = cell?.closest<HTMLElement>('[role="row"][data-index]');
    if (!cell || !row) return;
    if ((e.target as Element).closest("button, input, select, textarea, a[href], [contenteditable], [data-editing]")) return;
    const index = Number(row.dataset.index);
    const item = untracked(() => this.#layout()).at(index);
    if (item.kind === "row" && item.key !== undefined) this.#choose(item.key, index, e.shiftKey, e.ctrlKey || e.metaKey);
    this.#activate(index, row.classList.contains("aster-grid-group") ? this.#active.peek().col : Number(cell.getAttribute("aria-colindex")) - 1);
  }

  #key(e: KeyboardEvent, columns: number): void {
    if ((e.target as Element).closest(".aster-grid-filters, .aster-grid-panel, .aster-grid-selection, [data-editing], .aster-grid-group button")) return;
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
      e.preventDefault(); this.#choose(item.key, row, e.shiftKey, this.#selection.peek()!.multiple); return;
    }
    const page = Math.max(1, Math.floor(this.#viewport.peek() / this.#heights.estimate) - 1);
    let next: { row: number; col: number };
    switch (e.key) {
      case "ArrowDown":
        next = { row: row + 1, col };
        break;
      case "ArrowUp":
        if (row === 0) {
          e.preventDefault();
          this.#active.value = { row: this.#filtersShown() ? FILTER_ROW : HEADER, col };
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
        if (e.key === "F2" && this.#selectable.peek() && this.#selection.peek() && (!this.#editable.peek() || e.shiftKey)) {
          e.preventDefault();
          this.#selectionInside.value = item.key;
          queueMicrotask(() => this.querySelector<HTMLElement>(`.aster-grid-row[data-key="${CSS.escape(item.key!)}"] .aster-grid-pick`)?.focus());
          return;
        }
        if (e.key === "Enter" && !this.emit("row-open", { key: item.key })) { e.preventDefault(); return; }
        // With expansion, Enter expands the row, as a double-click does; F2 still edits in place.
        if (e.key === "Enter" && this.#expansion.peek()) {
          e.preventDefault();
          this.expand(item.key);
          return;
        }
        if (!this.#editable.peek()) return;
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
      if (destination.kind === "row" && destination.key !== undefined) this.#choose(destination.key, target, true, false);
    }
    this.#activate(target, Math.max(0, Math.min(columns - 1, next.col)));
  }

  #sortText(view: GridView): string {
    const title = (f: string) => this.#collection?.type.field(f)?.title ?? f;
    if (!view.sort.length) return "Not sorted";
    return `Sorted by ${view.sort.map((k) => `${title(k.field)}, ${k.descending ? "descending" : "ascending"}`).join(", then ")}`;
  }

  /** The first column's indent and opener in a tree grid. */
  #treeLead(node: TreeRow): View {
    const folder = node.folder !== false && node.key !== undefined;
    return html`<span class="aster-grid-tree" style=${`--level:${node.level - 1}`}>${folder
      ? html`<button type="button" class="aster-grid-opener" tabindex="-1" aria-hidden="true" ?data-open=${node.open}
          @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
          @click=${(e: MouseEvent) => {
            e.stopPropagation();
            void this.#tree?.toggle(node.key!);
          }}><svg viewBox="0 0 10 10"><path d="M3.5 2 6.5 5l-3 3"/></svg></button>`
      : html`<span class="aster-grid-opener" aria-hidden="true"></span>`}</span>`;
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
    return this.#showFilters.peek() || Object.keys(this.#view.peek()?.filters ?? {}).length > 0;
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
    const field = this.#view.peek()!.columns.filter((c) => !c.hidden)[col]?.field;
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
        return row === FILTER_ROW ? move({ row: HEADER, col }) : undefined;
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
        if ((e.key === "F10" && !e.shiftKey) || row !== HEADER || !field) return;
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
    this.#active.value = { row: FILTER_ROW, col: Number(cell.getAttribute("aria-colindex")) - 1 };
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
      if (this.#selectable.peek() && !this.#selection.peek() && !this.#external()) this.#selected.value = item.key;
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
