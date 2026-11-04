/** How many sections may be open: one at a time (`"mutex"`, the default) or any number. */
export type VisibilityMode = "multiple" | "mutex";

/** The structured form of the existing `multiple` shorthand. */
export function visibilityModeFromMultiple(multiple: boolean): VisibilityMode {
  return multiple ? "multiple" : "mutex";
}

/** A close control exists only when the section permits closing and chrome asks for it. */
export function closeShown(canClose: boolean, chromeClose: boolean | undefined): boolean {
  return canClose && chromeClose === true;
}

/** The item order after moving `from` to `to`, for the `reorder` request. */
export function reorderIds(ids: readonly string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) throw new RangeError("reorder indexes are out of range");
  const order = [...ids];
  const [id] = order.splice(from, 1);
  order.splice(to, 0, id!);
  return order;
}
