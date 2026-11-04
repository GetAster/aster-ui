/**
 * How a permitted capability behaves. A descriptor says how, never whether:
 * switching a capability off is [[object:GridPolicy]]'s job, and whether it
 * is shown is chrome's. Plain data, so a composition catalog can carry it.
 */
export type GridFeature =
  | { readonly kind: "sort"; readonly multi?: boolean }
  | { readonly kind: "edit"; readonly mode?: "row" | "cell" }
  | { readonly kind: "select"; readonly appearance?: "row" | "cell"; readonly column?: boolean }
  | { readonly kind: "page" };


/** One descriptor of `kind`, if the page gave one. */
export function feature<K extends GridFeature["kind"]>(features: readonly GridFeature[] | undefined, kind: K): Extract<GridFeature, { kind: K }> | undefined {
  return features?.find((entry): entry is Extract<GridFeature, { kind: K }> => entry.kind === kind);
}

/** The features with `next` replacing the first descriptor of its kind, or appended. */
export function withFeature(features: readonly GridFeature[] | undefined, next: GridFeature): GridFeature[] {
  const list = [...(features ?? [])];
  const at = list.findIndex((entry) => entry.kind === next.kind);
  if (at < 0) list.push(next);
  else list[at] = next;
  return list;
}

/** The features without the descriptor of `kind`. */
export function withoutFeature(features: readonly GridFeature[] | undefined, kind: GridFeature["kind"]): GridFeature[] {
  return (features ?? []).filter((entry) => entry.kind !== kind);
}

/** Whether the grid loads a page at a time instead of scrolling through the whole set. */
export function paged(features: readonly GridFeature[] | undefined): boolean {
  return feature(features, "page") !== undefined;
}

/** The sort descriptor's multi-key setting, on by default. */
export function multiSort(features: readonly GridFeature[] | undefined): boolean {
  return feature(features, "sort")?.multi ?? true;
}

/** The edit descriptor's mode, row editing by default. */
export function editMode(features: readonly GridFeature[] | undefined): "row" | "cell" {
  return feature(features, "edit")?.mode ?? "row";
}

/** How selected records are highlighted, the whole row by default. */
export function selectionAppearance(features: readonly GridFeature[] | undefined): "row" | "cell" {
  return feature(features, "select")?.appearance ?? "row";
}

/** Whether selection gets a checkbox column of its own, off by default. */
export function selectionColumn(features: readonly GridFeature[] | undefined): boolean {
  return feature(features, "select")?.column ?? false;
}

/** Checks a features value: known kinds, plain fields and valid unions. */
export function validateFeatures(value: unknown): asserts value is readonly GridFeature[] {
  if (!Array.isArray(value)) throw new TypeError("features must be an array");
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("each feature must be a plain object");
    const kind = (entry as { kind?: unknown }).kind;
    if (kind !== "sort" && kind !== "edit" && kind !== "select" && kind !== "page") throw new TypeError(`unknown feature kind: ${String(kind)}`);
    if (seen.has(kind)) throw new TypeError(`feature "${kind}" appears more than once`);
    seen.add(kind);
    switch (kind) {
      case "sort": {
        const multi = (entry as { multi?: unknown }).multi;
        if (multi !== undefined && typeof multi !== "boolean") throw new TypeError("sort.multi must be a boolean");
        break;
      }
      case "edit": {
        const mode = (entry as { mode?: unknown }).mode;
        if (mode !== undefined && mode !== "row" && mode !== "cell") throw new TypeError('edit.mode must be "row" or "cell"');
        break;
      }
      case "select": {
        const { appearance, column } = entry as { appearance?: unknown; column?: unknown };
        if (appearance !== undefined && appearance !== "row" && appearance !== "cell") throw new TypeError('select.appearance must be "row" or "cell"');
        if (column !== undefined && typeof column !== "boolean") throw new TypeError("select.column must be a boolean");
        break;
      }
      case "page":
        break;
    }
  }
}
