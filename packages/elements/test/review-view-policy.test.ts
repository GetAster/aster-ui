import { expect, test } from "bun:test";
import { viewQuery, viewRefusals, type GridView } from "../src/grid/view.ts";

test("a field comparison cannot filter through a forbidden right-hand field", () => {
  const view: GridView = {
    columns: [{ field: "name" }, { field: "owner" }],
    sort: [], filters: {}, frozen: 0,
    criteria: { op: "eq", field: "name", other: "owner" },
  };
  const allowed = { filterable: (field: string) => field !== "owner" };
  expect(viewQuery("Devices", view, undefined, {}, allowed).filter).toBeUndefined();
  expect(viewRefusals(view, allowed)).toEqual([{ kind: "criteria", field: "owner" }]);
  expect(view.criteria).toEqual({ op: "eq", field: "name", other: "owner" });
});

test("host base constraints remain active even when user filtering is forbidden", () => {
  const view: GridView = { columns: [{ field: "owner" }], sort: [], filters: {}, frozen: 0 };
  const base = { op: "eq" as const, field: "owner", value: "Ada" };
  expect(viewQuery("Devices", view, base, {}, { filterable: () => false }).filter).toEqual(base);
});
