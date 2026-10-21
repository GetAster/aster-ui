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

/** The query a view describes, within `base` (such as "this project only"). */
/** `sortPaths` maps a column to what it sorts by, for a lookup column the related record's display field. */
export function viewQuery(set: string, view: GridView, base?: Criteria, sortPaths: Readonly<Record<string, string>> = {}): Query {
  const parts = [...(base ? [base] : []), ...Object.values(view.filters), ...(view.criteria ? [view.criteria] : [])];
  const filter: Criteria | undefined = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", args: parts };
  const paths = { ...sortPaths, ...Object.fromEntries(view.columns.filter(c => c.sortField).map(c => [c.field, c.sortField!])) };
  const orderBy = view.sort.map((k) => (paths[k.field] ? { ...k, field: paths[k.field]! } : k));
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
