import { describe, expect, test } from "bun:test";
import { parseCsdl } from "@getaster/data";
import { parseRange, rangeText } from "../src/grid/filters.ts";

const metadata = await Bun.file(new URL("../../../fixtures/aster/metadata.json", import.meta.url)).json();
const type = parseCsdl(metadata).set("TimeEntries").type;
const hours = type.field("hours")!;
const date = type.field("date")!;

describe("range filters", () => {
  test("numbers, comparisons and ranges round-trip to text", () => {
    for (const text of ["2.5", ">2.5", ">=8", "<1", "<=0.75", "1..3"]) {
      const { criteria } = parseRange(hours, text);
      expect(rangeText(criteria)).toBe(text);
    }
    expect(parseRange(hours, "=4").criteria).toEqual({ op: "eq", field: "hours", value: "4" });
    expect(parseRange(hours, "")).toEqual({});
  });

  test("dates, and what's wrong in words", () => {
    expect(parseRange(date, ">=2026-10-01").criteria).toEqual({ op: "ge", field: "date", value: "2026-10-01" });
    expect(parseRange(date, "last week").error).toContain("a date like 1 Oct 2026");
    expect(parseRange(hours, "1..x").error).toContain("both sides");
  });
});
