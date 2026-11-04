import { describe, expect, test } from "bun:test";
import {
  effectiveColumns,
  effectiveFrozen,
  effectiveGroups,
  freezeThrough,
  moveColumn,
  nudgeColumn,
  reconcile,
  setFilter,
  setHidden,
  setWidth,
  sortBy,
  sortDirection,
  viewQuery,
  viewRefusals,
  criteriaFields,
  groupFields,
  setGroup,
  type GridView,
} from "../src/grid/view.ts";

const view: GridView = {
  columns: [{ field: "a", width: 100 }, { field: "b" }, { field: "c" }, { field: "d" }],
  sort: [],
  filters: {},
  frozen: 0,
};

describe("grid views", () => {
  test("sorting: toggle, add, set a direction", () => {
    let v = sortBy(view, "a", false);
    expect(v.sort).toEqual([{ field: "a" }]);
    v = sortBy(v, "a", false);
    expect(v.sort).toEqual([{ field: "a", descending: true }]);
    v = sortBy(v, "b", true);
    expect(v.sort).toEqual([{ field: "a", descending: true }, { field: "b" }]);
    expect(sortDirection(v, "b", true, true).sort).toEqual([{ field: "a", descending: true }, { field: "b", descending: true }]);
    expect(sortDirection(v, "c", false, false).sort).toEqual([{ field: "c" }]);
  });

  test("columns: hide, move, nudge past hidden ones, resize", () => {
    expect(moveColumn(view, "d", 0).columns.map((c) => c.field)).toEqual(["d", "a", "b", "c"]);
    const hidden = setHidden(view, "b", true);
    expect(nudgeColumn(hidden, "c", -1).columns.map((c) => c.field)).toEqual(["c", "a", "b", "d"]);
    expect(setWidth(view, "b", 20).columns[1]).toEqual({ field: "b", width: 48 });
    expect(setWidth(view, "a", undefined).columns[0]).toEqual({ field: "a" });
  });

  test("freezing gives frozen columns fixed widths; hiding keeps one column free", () => {
    const frozen = freezeThrough(view, "b", () => 150);
    expect([frozen.frozen, frozen.columns[1]!.width]).toEqual([2, 150]);
    expect(setHidden({ ...view, frozen: 4 }, "d", true).frozen).toBe(2);
  });

  test("filters become the query, within the base criteria", () => {
    const v = setFilter(setFilter(view, "a", { op: "eq", field: "a", value: 1 }), "b", { op: "gt", field: "b", value: 2 });
    expect(viewQuery("S", { ...v, sort: [{ field: "a" }] }, { op: "eq", field: "c", value: true })).toEqual({
      set: "S",
      filter: {
        op: "and",
        args: [
          { op: "eq", field: "c", value: true },
          { op: "eq", field: "a", value: 1 },
          { op: "gt", field: "b", value: 2 },
        ],
      },
      orderBy: [{ field: "a" }],
    });
    expect(setFilter(v, "a", undefined).filters).toEqual({ b: { op: "gt", field: "b", value: 2 } });
  });

  test("a saved view survives columns being added and removed", () => {
    const stored: GridView = { ...view, columns: [{ field: "d" }, { field: "gone" }, { field: "a", width: 90 }], sort: [{ field: "gone" }], groupBy: "gone" };
    const v = reconcile(stored, view);
    expect(v.columns).toEqual([{ field: "d" }, { field: "a", width: 90 }, { field: "b", hidden: true }, { field: "c", hidden: true }]);
    expect([v.sort, v.groupBy]).toEqual([[], undefined]);
  });

  test("ordered grouping preserves legacy views and reconciles missing dimensions", () => {
    expect(groupFields({ ...view, groupBy: "a" })).toEqual(["a"]);
    const nested = setGroup(view, ["a", "c", "b"]);
    expect(nested.groupBy).toEqual(["a", "c", "b"]);
    expect(reconcile(nested, { ...view, columns: [{ field: "c" }, { field: "b" }] }).groupBy).toEqual(["c", "b"]);
    expect(setGroup(nested, ["b"]).groupBy).toBe("b");
    expect(setGroup(nested, []).groupBy).toBeUndefined();
    expect(() => setGroup(view, ["a", "a"])).toThrow();
    expect(() => setGroup(view, [""])).toThrow();
  });
});

test("advanced expression keeps boolean meaning within base and column filters, including saved missing fields", () => {
  const criteria = { op: "or", args: [{ op: "eq", field: "gone", value: 1 }, { op: "eq", field: "b", value: 2 }] } as const;
  const base = { op: "eq", field: "tenant", value: 3 } as const;
  const column = { op: "gt", field: "a", value: 5 } as const;
  const stored = { ...view, filters: { a: column }, criteria };
  expect(viewQuery("S", stored, base).filter).toEqual({ op: "and", args: [base, column, criteria] });
  expect(reconcile(stored, view).criteria).toEqual(criteria);
});

test("a display column can order by a server key without rewriting typed filters", () => {
  const typed: GridView = { ...view, columns: [{ field: "date", sortField: "receivedOrder" }, { field: "sender" }],
    sort: [{ field: "date", descending: true }, { field: "sender" }], filters: { date: { op: "gt", field: "date", value: "2026-10-01T00:00:00Z" } } };
  expect(viewQuery("Messages", typed)).toEqual({ set: "Messages",
    filter: { op: "gt", field: "date", value: "2026-10-01T00:00:00Z" },
    orderBy: [{ field: "receivedOrder", descending: true }, { field: "sender" }] });
  expect(viewQuery("Messages", typed, undefined, { date: "legacyPath" }).orderBy?.[0]?.field).toBe("receivedOrder");
});

test("capability refusals leave a view untouched but drop their entries from the query", () => {
  const criteria = { op: "or", args: [{ op: "eq", field: "c", value: 1 }, { op: "not", arg: { op: "gt", field: "a", value: 2 } }] } as const;
  const stored: GridView = {
    ...view,
    sort: [{ field: "a", descending: true }, { field: "b" }],
    filters: { a: { op: "eq", field: "a", value: 1 }, b: { op: "gt", field: "b", value: 2 } },
    criteria,
  };
  const allowed = { sortable: (field: string) => field !== "a", filterable: (field: string) => field === "b" };
  expect(criteriaFields(criteria)).toEqual(["c", "a"]);
  expect(viewRefusals(stored, allowed)).toEqual([
    { kind: "sort", field: "a" },
    { kind: "filter", field: "a" },
    { kind: "criteria", field: "c" },
    { kind: "criteria", field: "a" },
  ]);
  expect(viewQuery("S", stored, { op: "eq", field: "tenant", value: 3 }, {}, allowed)).toEqual({
    set: "S",
    filter: { op: "and", args: [{ op: "eq", field: "tenant", value: 3 }, { op: "gt", field: "b", value: 2 }] },
    orderBy: [{ field: "b" }],
  });
  // The stored view is the person's intent and is never rewritten by a refusal.
  expect(stored.sort).toHaveLength(2);
  expect(Object.keys(stored.filters)).toEqual(["a", "b"]);
  expect(stored.criteria).toBe(criteria);
  expect(viewQuery("S", stored)).toEqual({
    set: "S",
    filter: { op: "and", args: [stored.filters.a!, stored.filters.b!, criteria] },
    orderBy: stored.sort,
  });
});

test("a refused advanced expression is identified by its fields", () => {
  expect(criteriaFields({ op: "and", args: [] })).toEqual([]);
  expect(criteriaFields({ op: "via", field: "project", where: { op: "eq", field: "health", value: "behind" } })).toEqual(["project"]);
});

test("a field-to-field comparison counts both operands for capability checks", () => {
  const pair = { op: "eq", field: "name", other: "owner" } as const;
  expect(criteriaFields(pair)).toEqual(["name", "owner"]);
  const stored: GridView = { ...view, filters: { name: { op: "eq", field: "name", value: "Ada" } }, criteria: pair };
  const allowed = { filterable: (field: string) => field === "name" };
  // Refusing the right operand refuses the whole comparison, not just that side.
  expect(viewRefusals(stored, allowed)).toEqual([{ kind: "criteria", field: "owner" }]);
  expect(viewQuery("S", stored, undefined, {}, allowed).filter).toEqual({ op: "eq", field: "name", value: "Ada" });
  // With both operands allowed, the comparison returns.
  expect(viewQuery("S", stored).filter).toEqual({
    op: "and",
    args: [{ op: "eq", field: "name", value: "Ada" }, pair],
  });
});

test("saved column layout keeps the application's current server sort mapping", () => {
  const offered: GridView = { ...view, columns: [{ field: "a", sortField: "normalized" }, { field: "b" }] };
  const saved: GridView = { ...view, columns: [{ field: "a", sortField: "obsolete", width: 220 }, { field: "b", sortField: "stale" }] };
  expect(reconcile(saved, offered).columns).toEqual([{ field: "a", width: 220, sortField: "normalized" }, { field: "b" }]);
});

test("a refused group, hidden column and frozen column are reported by their field", () => {
  const stored: GridView = {
    ...view,
    columns: [{ field: "a" }, { field: "b", hidden: true }, { field: "c" }, { field: "d" }],
    frozen: 3,
    sort: [],
    filters: {},
    groupBy: ["a", "b"],
  };
  const allowed = {
    groupable: (field: string) => field !== "b",
    hideable: (field: string) => field !== "b",
    freezable: (field: string) => field !== "c",
  };
  expect(viewRefusals(stored, allowed)).toEqual([
    { kind: "group", field: "b" },
    { kind: "hidden", field: "b" },
    { kind: "frozen", field: "c" },
  ]);
  // The view is untouched; the derived presentation leaves the entries out.
  expect(stored.columns[1]!.hidden).toBe(true);
  expect(stored.frozen).toBe(3);
  expect(effectiveColumns(stored, allowed.hideable).map((c) => c.field)).toEqual(["a", "b", "c", "d"]);
  expect(effectiveFrozen(stored, effectiveColumns(stored, allowed.hideable), allowed.freezable)).toBe(2);
  expect(effectiveGroups(stored, allowed.groupable)).toEqual(["a"]);
});

test("the effective frozen run stops at the first column the page refuses", () => {
  const stored: GridView = { ...view, frozen: 4 };
  expect(effectiveFrozen(stored, view.columns)).toBe(4);
  expect(effectiveFrozen(stored, view.columns, (field) => field !== "b")).toBe(1);
  expect(effectiveFrozen(stored, view.columns, (field) => field !== "a")).toBe(0);
  expect(effectiveFrozen({ ...view, frozen: 9 }, view.columns)).toBe(4);
});
