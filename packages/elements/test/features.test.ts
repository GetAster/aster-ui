import { describe, expect, test } from "bun:test";
import {
  editMode,
  feature,
  multiSort,
  paged,
  selectionAppearance,
  selectionColumn,
  validateFeatures,
  withFeature,
  withoutFeature,
  type GridFeature,
} from "../src/grid/features.ts";

describe("grid features", () => {
  test("absent descriptors take today's behaviour", () => {
    expect(multiSort([])).toBe(true);
    expect(editMode([])).toBe("row");
    expect(selectionAppearance([])).toBe("row");
    expect(selectionColumn([])).toBe(false);
    expect(paged([])).toBe(false);
    expect(feature([], "page")).toBeUndefined();
  });

  test("a descriptor says how one capability behaves", () => {
    const features: GridFeature[] = [
      { kind: "sort", multi: false },
      { kind: "edit", mode: "cell" },
      { kind: "select", appearance: "cell", column: true },
      { kind: "page" },
    ];
    expect(multiSort(features)).toBe(false);
    expect(editMode(features)).toBe("cell");
    expect(selectionAppearance(features)).toBe("cell");
    expect(selectionColumn(features)).toBe(true);
    expect(paged(features)).toBe(true);
    expect(feature(features, "sort")).toEqual({ kind: "sort", multi: false });
  });

  test("writing one descriptor leaves the others alone, and removes only its own kind", () => {
    const before: GridFeature[] = [{ kind: "edit", mode: "cell" }, { kind: "select", column: true }];
    const next = withFeature(before, { kind: "select", appearance: "cell", column: true });
    expect(next).toEqual([{ kind: "edit", mode: "cell" }, { kind: "select", appearance: "cell", column: true }]);
    expect(withoutFeature(next, "edit")).toEqual([{ kind: "select", appearance: "cell", column: true }]);
    expect(before).toHaveLength(2);
  });

  test("invalid descriptors are refused with a specific reason", () => {
    expect(() => validateFeatures({})).toThrow("features must be an array");
    expect(() => validateFeatures([null])).toThrow("each feature must be a plain object");
    expect(() => validateFeatures([{ kind: "resize" }])).toThrow("unknown feature kind");
    expect(() => validateFeatures([{ kind: "page" }, { kind: "page" }])).toThrow("appears more than once");
    expect(() => validateFeatures([{ kind: "sort", multi: "yes" }])).toThrow("sort.multi must be a boolean");
    expect(() => validateFeatures([{ kind: "edit", mode: "form" }])).toThrow('edit.mode must be "row" or "cell"');
    expect(() => validateFeatures([{ kind: "select", appearance: "checkbox" }])).toThrow('select.appearance must be "row" or "cell"');
    expect(() => validateFeatures([{ kind: "select", column: "yes" }])).toThrow("select.column must be a boolean");
    expect(() => validateFeatures([{ kind: "sort" }, { kind: "edit" }, { kind: "page" }])).not.toThrow();
  });
});
