import { describe, expect, test } from "bun:test";
import { RowHeights } from "../src/grid/rows.ts";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `[${i}]`);

describe("RowHeights", () => {
  test("estimates until measured, by key", () => {
    const rows = new RowHeights(30);
    rows.setKeys(keys(4));
    expect(rows.total()).toBe(120);
    rows.measure("[1]", 50);
    expect([rows.offset(1), rows.offset(2), rows.total()]).toEqual([30, 80, 140]);
    rows.setKeys(["[1]", "[0]", undefined, "[3]"]);
    expect([rows.offset(1), rows.total()]).toEqual([50, 140]);
  });

  test("finds the row at a position and the window around a viewport", () => {
    const rows = new RowHeights(20);
    rows.setKeys(keys(100_000));
    expect(rows.indexAt(0)).toBe(0);
    expect(rows.indexAt(19.9)).toBe(0);
    expect(rows.indexAt(20)).toBe(1);
    expect(rows.indexAt(1e9)).toBe(99_999);
    expect(rows.window(2000, 400, 100)).toEqual({ start: 95, end: 126 });
  });

  test("100,000 rows rebuild quickly after a change", () => {
    const rows = new RowHeights(28);
    rows.setKeys(keys(100_000));
    rows.total();
    const t = performance.now();
    for (let i = 0; i < 20; i++) {
      rows.measure(`[${i * 1000}]`, 40 + i);
      rows.total();
    }
    expect((performance.now() - t) / 20).toBeLessThan(5);
  });
});
