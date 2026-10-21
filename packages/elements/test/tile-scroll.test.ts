import { expect, test } from "bun:test";
import { TileScroll } from "../src/tile-grid/scroll.ts";

test("ordinary tile scroll keeps measured pixels, including a partial last viewport", () => {
  const scroll = new TileScroll(20, 400, 538, 16);
  expect(scroll.extent).toBe(7984);
  expect(scroll.logical(1200)).toBe(1200);
  expect(scroll.physical(1200)).toBe(1200);
  expect(scroll.rowTop(1600, 1200)).toBe(1600);
});

test("100k tall tiles retain both boundaries and local row spacing inside a safe extent", () => {
  const scroll = new TileScroll(100_000, 400, 538, 16);
  expect(scroll.extent).toBe(8_000_000);
  expect(scroll.logical(0)).toBe(0);
  const end = scroll.physical(Infinity);
  expect(scroll.logical(end)).toBe(39_999_446);
  for (const logical of [10_000, 20_000_000, 39_999_446]) {
    const physical = scroll.physical(logical);
    expect(scroll.logical(physical)).toBeCloseTo(logical, 5);
    const first = scroll.rowTop(logical, physical);
    const second = scroll.rowTop(logical + 400, physical);
    expect(second - first).toBeCloseTo(400, 5);
  }
  expect(scroll.rowTop(39_999_600, end) + 384).toBe(scroll.extent);
});

test("an empty or shorter-than-viewport collection cannot scroll", () => {
  for (const rows of [0, 1]) {
    const scroll = new TileScroll(rows, 400, 538, 16);
    expect(scroll.logical(200)).toBe(0);
    expect(scroll.physical(200)).toBe(0);
  }
});
