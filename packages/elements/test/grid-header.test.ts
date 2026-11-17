import { expect, test } from "bun:test";
import { gridSortMenu } from "../src/grid/header.ts";
import type { GridView } from "../src/grid/view.ts";

const view: GridView = { columns: [{ field: "name" }, { field: "date" }], sort: [{ field: "date", descending: true }], filters: {}, frozen: 0 };

test("shared header sort menu replaces, appends and clears through normal view transforms", () => {
  const changed: GridView[] = [];
  const menu = gridSortMenu(view, "name", { multi: true, change: (next) => changed.push(next) });
  expect(menu.items.map((item) => "label" in item ? item.label : "")).toEqual(["Ascending", "Descending", "Not sorted", "Add to sort"]);
  for (const item of menu.items) if ("run" in item) item.run();
  expect(changed.map((next) => next.sort)).toEqual([
    [{ field: "name" }], [{ field: "name", descending: true }], [{ field: "date", descending: true }],
    [{ field: "date", descending: true }, { field: "name" }],
  ]);
  expect(view.sort).toEqual([{ field: "date", descending: true }]);
  expect(changed.every((next) => next.columns === view.columns && next.filters === view.filters)).toBe(true);
});

test("shared header menu preserves checked state, localization and multi-sort availability", () => {
  let changed: GridView | undefined;
  const menu = gridSortMenu(view, "date", { multi: true, labels: { sort: "Order", descending: "Newest first", notSorted: "Clear" }, change: (next) => { changed = next; } });
  expect(menu.label).toBe("Order");
  expect(menu.items.map((item) => "checked" in item ? item.checked : undefined)).toEqual([false, true, false]);
  expect(menu.items[1] && "label" in menu.items[1] ? menu.items[1].label : "").toBe("Newest first");
  const clear = menu.items[2]!;
  if ("run" in clear) clear.run();
  expect(changed?.sort).toEqual([]);
  expect(gridSortMenu(view, "name", { multi: false, change: () => {} }).items).toHaveLength(3);
  expect(gridSortMenu({ ...view, sort: [] }, "name", { multi: true, change: () => {} }).items).toHaveLength(3);
});
