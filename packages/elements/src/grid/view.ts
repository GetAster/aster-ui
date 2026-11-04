import type { Criteria, EntityType, Field, Query, SortKey } from "@getaster/data";

export interface GridColumn {
  readonly field: string;
  /** Pixels; a column without a width shares the space left over. */
  readonly width?: number;
  readonly hidden?: boolean;
  /** Server field or navigation path used for ordering; display and filtering retain `field`. */
  readonly sortField?: string;
}

/**
 * Everything a person can shape about a grid, as data: it's saved, restored,
 * published to the page scope, and the collection's query follows it.
 */
export interface GridView {
  /** In display order. */
  readonly columns: readonly GridColumn[];
  readonly sort: readonly SortKey[];
  /** Criteria by column; all of them hold. */
  readonly filters: Readonly<Record<string, Criteria>>;
  /** An advanced expression, ANDed with column filters and the host's base. */
  readonly criteria?: Criteria;
  /** One field, or fields in outermost-to-innermost order. */
  readonly groupBy?: string | readonly string[];
  /** How many leading visible columns stay in place when scrolling sideways. */
  readonly frozen: number;
}

/**
 * Which view entries the grid can apply. A refused entry is a capability
 * the schema, the grid's structure or the page policy doesn't allow.
 */
export interface ViewCapabilities {
  readonly sortable?: (field: string) => boolean;
  readonly filterable?: (field: string) => boolean;
  readonly groupable?: (field: string) => boolean;
  readonly hideable?: (field: string) => boolean;
  readonly freezable?: (field: string) => boolean;
}

/** A view entry that the derived presentation leaves out, and why it was refused. */
export interface ViewRefusal {
  readonly kind: "sort" | "filter" | "criteria" | "group" | "hidden" | "frozen";
  readonly field: string;
}

/** Fields a criteria expression reads, at the level it filters; related-record clauses name the navigation. */
export function criteriaFields(criteria: Criteria): readonly string[] {
  if (!criteria || typeof criteria !== "object") return [];
  const node = criteria as { readonly op?: unknown; readonly args?: readonly Criteria[]; readonly arg?: Criteria; readonly field?: unknown; readonly other?: unknown };
  switch (node.op) {
    case "and":
    case "or":
      return Array.isArray(node.args) ? node.args.flatMap(criteriaFields) : [];
    case "not":
      return node.arg ? criteriaFields(node.arg) : [];
    default: {
      const fields: string[] = [];
      if (typeof node.field === "string") fields.push(node.field);
      // A field-to-field comparison reads both operands; each must pass capability checks.
      if (typeof node.other === "string") fields.push(node.other);
      return fields;
    }
  }
}

/** The view entries `allowed` refuses, for the drift note. The view itself is never rewritten. */
export function viewRefusals(view: GridView, allowed: ViewCapabilities): readonly ViewRefusal[] {
  const refusals: ViewRefusal[] = [];
  if (allowed.sortable) for (const key of view.sort) if (!allowed.sortable(key.field)) refusals.push({ kind: "sort", field: key.field });
  if (allowed.filterable) {
    for (const field of Object.keys(view.filters)) if (!allowed.filterable(field)) refusals.push({ kind: "filter", field });
    if (view.criteria) for (const field of new Set(criteriaFields(view.criteria))) if (!allowed.filterable(field)) refusals.push({ kind: "criteria", field });
  }
  if (allowed.groupable) for (const field of groupFields(view)) if (!allowed.groupable(field)) refusals.push({ kind: "group", field });
  if (allowed.hideable) for (const column of view.columns) if (column.hidden && !allowed.hideable(column.field)) refusals.push({ kind: "hidden", field: column.field });
  // Frozen columns are a prefix: the first one the page refuses ends the frozen run.
  if (allowed.freezable) {
    const visible = effectiveColumns(view, allowed.hideable);
    for (let i = 0; i < Math.min(view.frozen, visible.length); i++) {
      const field = visible[i]!.field;
      if (!allowed.freezable(field)) {
        refusals.push({ kind: "frozen", field });
        break;
      }
    }
  }
  return refusals;
}

/** The columns shown: a column the page forbids hiding stays visible. */
export function effectiveColumns(view: GridView, hideable?: (field: string) => boolean): readonly GridColumn[] {
  return view.columns.filter((column) => !column.hidden || (hideable !== undefined && !hideable(column.field)));
}

/** The frozen prefix, cut where the page forbids freezing a column. */
export function effectiveFrozen(view: GridView, visible: readonly GridColumn[], freezable?: (field: string) => boolean): number {
  const wanted = Math.min(view.frozen, visible.length);
  if (!freezable) return wanted;
  let frozen = 0;
  while (frozen < wanted && freezable(visible[frozen]!.field)) frozen++;
  return frozen;
}

/** The grouping levels in force: stored levels the page refuses are left out. */
export function effectiveGroups(view: GridView | undefined, groupable?: (field: string) => boolean): readonly string[] {
  const fields = groupFields(view);
  return groupable ? fields.filter((field) => groupable(field)) : fields;
}

/**
 * The query a view describes, within `base` (such as "this project only").
 * Entries `allowed` refuses are left out of the derived query while the view
 * keeps them, so a person's intent resumes when the page allows it again.
 */
/** `sortPaths` maps a column to what it sorts by, for a lookup column the related record's display field. */
export function viewQuery(set: string, view: GridView, base?: Criteria, sortPaths: Readonly<Record<string, string>> = {}, allowed: ViewCapabilities = {}): Query {
  const sort = allowed.sortable ? view.sort.filter((key) => allowed.sortable!(key.field)) : view.sort;
  const filters = Object.entries(view.filters).filter(([field]) => !allowed.filterable || allowed.filterable(field));
  const criteria = view.criteria && (!allowed.filterable || criteriaFields(view.criteria).every(allowed.filterable)) ? view.criteria : undefined;
  const parts = [...(base ? [base] : []), ...filters.map(([, filter]) => filter), ...(criteria ? [criteria] : [])];
  const filter: Criteria | undefined = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", args: parts };
  const paths = { ...sortPaths, ...Object.fromEntries(view.columns.filter(c => c.sortField).map(c => [c.field, c.sortField!])) };
  const orderBy = sort.map((k) => (paths[k.field] ? { ...k, field: paths[k.field]! } : k));
  return { set, ...(filter ? { filter } : {}), ...(orderBy.length ? { orderBy } : {}) };
}

/** Every field of `type` that has a value to show, in declaration order, the key last. */
export function defaultView(type: EntityType): GridView {
  const fields = type.fields.filter((f) => !type.key.includes(f.name)).map((f) => ({ field: f.name }));
  return { columns: fields, sort: [], filters: {}, frozen: 0 };
}

/** The column's track: its width, or a share of the space with a floor that suits its type. */
export function track(column: GridColumn, field: Field | undefined): string {
  if (column.width !== undefined) return `${column.width}px`;
  const prose = field?.type === "Edm.String" && !field.allowedValues && (field.maxLength ?? 0) > 500;
  return prose ? "minmax(260px, 3fr)" : `minmax(${naturalWidth(field)}px, 1fr)`;
}

export function naturalWidth(field: Field | undefined): number {
  switch (field?.type) {
    case "Edm.Boolean":
      return 80;
    case "Edm.Date":
      return 110;
    case "Edm.DateTimeOffset":
      return 150;
    case "Edm.Byte":
    case "Edm.SByte":
    case "Edm.Int16":
    case "Edm.Int32":
    case "Edm.Int64":
    case "Edm.Decimal":
    case "Edm.Double":
    case "Edm.Single":
      return 90;
    default:
      return field?.allowedValues ? 110 : 160;
  }
}

/** Numbers line up on their right edge. */
export function isNumeric(field: Field | undefined): boolean {
  return naturalWidth(field) === 90;
}

/** The view with one sort key set: alone, or added to the others when `add`. */
export function sortBy(view: GridView, field: string, add: boolean): GridView {
  const current = view.sort.find((s) => s.field === field);
  const next: SortKey = { field, ...(current && !current.descending ? { descending: true } : {}) };
  const rest = add ? view.sort.filter((s) => s.field !== field) : [];
  return { ...view, sort: current && add ? view.sort.map((s) => (s.field === field ? next : s)) : [...rest, next] };
}

export function removeSort(view: GridView, field: string): GridView {
  return { ...view, sort: view.sort.filter((s) => s.field !== field) };
}

/** Sets one direction for a column, alone or added to the sort. */
export function sortDirection(view: GridView, field: string, descending: boolean, add: boolean): GridView {
  const key = { field, ...(descending ? { descending } : {}) };
  if (!add) return { ...view, sort: [key] };
  const at = view.sort.findIndex((s) => s.field === field);
  return { ...view, sort: at >= 0 ? view.sort.map((s, i) => (i === at ? key : s)) : [...view.sort, key] };
}

export function setHidden(view: GridView, field: string, hidden: boolean): GridView {
  const columns = view.columns.map((c) => (c.field === field ? { ...c, hidden } : c));
  const visible = columns.filter((c) => !c.hidden);
  return { ...view, columns, frozen: Math.min(view.frozen, Math.max(0, visible.length - 1)) };
}

/** Moves a column to `to`, an index among all columns (hidden ones included). */
export function moveColumn(view: GridView, field: string, to: number): GridView {
  const from = view.columns.findIndex((c) => c.field === field);
  if (from < 0) return view;
  const columns = [...view.columns];
  const [column] = columns.splice(from, 1);
  columns.splice(Math.max(0, Math.min(columns.length, to)), 0, column!);
  return { ...view, columns };
}

/** Moves a column one place among the visible columns. */
export function nudgeColumn(view: GridView, field: string, step: -1 | 1): GridView {
  const visible = view.columns.filter((c) => !c.hidden);
  const at = visible.findIndex((c) => c.field === field);
  const neighbour = visible[at + step];
  if (at < 0 || !neighbour) return view;
  return moveColumn(view, field, view.columns.findIndex((c) => c.field === neighbour.field));
}

export function setWidth(view: GridView, field: string, width: number | undefined): GridView {
  return {
    ...view,
    columns: view.columns.map((c) => {
      if (c.field !== field) return c;
      const { width: _, ...rest } = c;
      return width === undefined ? rest : { ...rest, width: Math.round(Math.max(48, width)) };
    }),
  };
}

/**
 * Freezes the visible columns up to and including `field`. Frozen columns
 * need fixed widths, so any without one take `fallback(field)`.
 */
export function freezeThrough(view: GridView, field: string, fallback: (field: string) => number): GridView {
  const visible = view.columns.filter((c) => !c.hidden);
  const at = visible.findIndex((c) => c.field === field);
  if (at < 0) return view;
  const fixed = new Set(visible.slice(0, at + 1).map((c) => c.field));
  return {
    ...view,
    frozen: at + 1,
    columns: view.columns.map((c) => (fixed.has(c.field) && c.width === undefined ? { ...c, width: fallback(c.field) } : c)),
  };
}

export function setFilter(view: GridView, field: string, criteria: Criteria | undefined): GridView {
  const { [field]: _, ...rest } = view.filters;
  return { ...view, filters: criteria ? { ...rest, [field]: criteria } : rest };
}

export function groupFields(view: GridView | undefined): readonly string[] {
  const value = view?.groupBy;
  if (value === undefined) return [];
  const fields = typeof value === "string" ? [value] : value;
  if (!Array.isArray(fields) || fields.some((f) => typeof f !== "string" || !f) || new Set(fields).size !== fields.length) throw new Error("Grouping needs distinct nonempty fields");
  return fields;
}

export function setGroup(view: GridView, field: string | readonly string[] | undefined): GridView {
  const { groupBy: _, ...rest } = view;
  const fields = groupFields({ ...rest, ...(field === undefined ? {} : { groupBy: field }) });
  if (!fields.length) return rest;
  return { ...rest, groupBy: fields.length === 1 ? fields[0]! : [...fields] };
}

/** A person's views for one grid: the one in use, and any saved by name. */
export interface SavedViews {
  readonly current?: GridView;
  readonly named: Readonly<Record<string, GridView>>;
}

/** Read from this browser; empty when storage is unavailable or holds something else. */
export function loadViews(key: string): SavedViews {
  try {
    const raw = localStorage.getItem(`aster-grid:${key}`);
    const parsed = raw ? (JSON.parse(raw) as SavedViews) : undefined;
    return parsed && typeof parsed.named === "object" ? parsed : { named: {} };
  } catch {
    return { named: {} };
  }
}

export function storeViews(key: string, views: SavedViews): void {
  try {
    localStorage.setItem(`aster-grid:${key}`, JSON.stringify(views));
  } catch {
    // Not kept; the view still applies until the page closes.
  }
}

/**
 * A stored view against the columns the grid offers now: unknown columns
 * drop out and new ones join at the end, hidden, so a change to the page
 * never breaks a saved view.
 */
export function reconcile(stored: GridView, offered: GridView): GridView {
  const known = new Set(offered.columns.map((c) => c.field));
  const kept = stored.columns.filter((c) => known.has(c.field)).map(({ sortField: _, ...column }) => {
    const sortField = offered.columns.find(c => c.field === column.field)?.sortField;
    return sortField ? { ...column, sortField } : column;
  });
  const have = new Set(kept.map((c) => c.field));
  const added = offered.columns.filter((c) => !have.has(c.field)).map((c) => ({ ...c, hidden: true }));
  const filters = Object.fromEntries(Object.entries(stored.filters).filter(([f]) => known.has(f)));
  const sort = stored.sort.filter((s) => known.has(s.field));
  const view: GridView = { ...stored, columns: [...kept, ...added], filters, sort };
  return setGroup(view, groupFields(view).filter((field) => known.has(field)));
}
