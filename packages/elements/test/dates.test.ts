import { describe, expect, test } from "bun:test";
import { formatDate, isIsoDate, monthWeeks, parseDate, shift, weekBounds } from "../src/date/dates.ts";

describe("dates", () => {
  test("typed dates in the forms people write them", () => {
    for (const [text, want] of [
      ["2026-10-07", "2026-10-07"],
      ["7/10/2026", "2026-10-07"],
      ["07.10.26", "2026-10-07"],
      ["7 Oct 2026", "2026-10-07"],
      ["7 october", "2026-10-07"],
      ["Oct 7, 2026", "2026-10-07"],
      ["31/2/2026", undefined],
      ["soon", undefined],
    ] as const) {
      expect([text, parseDate(text, 2026)]).toEqual([text, want]);
    }
    expect(formatDate("2026-10-07")).toBe("7 Oct 2026");
    expect(formatDate("2026-10-07", "short")).toBe("7 Oct 26");
    expect(formatDate("2026-10-07", "iso")).toBe("2026-10-07");
    expect(formatDate("not a date", "short")).toBe("not a date");
  });

  test("only real YYYY-MM-DD text is an ISO date", () => {
    expect(isIsoDate("2026-10-07")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("7 Oct 2026")).toBe(false);
  });

  test("moving by days, months (clamped) and years; weeks start on Monday", () => {
    expect(shift("2026-01-31", { months: 1 })).toBe("2026-02-28");
    expect(shift("2024-02-29", { years: 1 })).toBe("2025-02-28");
    expect(shift("2026-12-31", { days: 1 })).toBe("2027-01-01");
    expect(weekBounds("2026-10-07")).toEqual(["2026-10-05", "2026-10-11"]);
    const weeks = monthWeeks("2026-10-15");
    expect([weeks[0]![0], weeks.at(-1)![6], weeks.length]).toEqual(["2026-09-28", "2026-11-01", 5]);
  });
});
