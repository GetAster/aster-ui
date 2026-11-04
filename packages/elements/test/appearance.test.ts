import { describe, expect, test } from "bun:test";
import type { Entity, Field } from "@getaster/data";
import {
  GRID_LABEL_DEFAULTS,
  cellText,
  labelText,
  mappedValue,
  matchValue,
  styleCell,
  styleRow,
  validateGridLabels,
  validateGridPresentation,
  type CellStyleContext,
  type ColumnPresentation,
  type GridPresentation,
  type RowStyleContext,
} from "../src/grid/appearance.ts";

const entity = { id: 1, name: "Ada", status: "active", hours: "7.50", flag: true, note: null } as const;
const row: RowStyleContext = { entity, key: "[1]", index: 3 };
const cell: CellStyleContext = { ...row, field: "status", value: "active" };

const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({ name, type, nullable: true, ...extra }) as Field;

describe("appearance validation", () => {
  test("plain-data presentation shapes validate", () => {
    const value: GridPresentation = {
      columns: {
        name: { title: "Project", align: "center", cellClass: "project" },
        status: {
          valueMap: { active: "Active", paused: { label: "Paused", tone: "caution", class: "paused" } },
          format: { kind: "date", style: "short" },
          cellClass: [{ when: { field: "hours", op: "lt", value: 8 }, class: "short-day" }],
        },
        hours: { format: { kind: "number", style: "decimal", minimumFractionDigits: 2 } },
      },
      rowClass: [{ when: { field: "status", op: "eq", value: "active" }, class: "live" }],
      cellClass: ["grid-cell"],
      hilites: [
        { when: { field: "hours", op: "between", value: [0, 4] }, tone: "positive" },
        { scope: "cell", field: "status", when: { field: "status", op: "eq", value: "active" }, class: "ping" },
      ],
    };
    expect(() => validateGridPresentation(value)).not.toThrow();
  });

  test("the composition form rejects every function, with a path", () => {
    expect(() => validateGridPresentation({ rowClass: () => "x" })).toThrow("presentation.rowClass can’t be a function");
    expect(() => validateGridPresentation({ cellClass: [{ class: "x", test: () => true }] })).toThrow("presentation.cellClass[0].test can’t be a function");
    expect(() => validateGridPresentation({ columns: { name: { cellClass: () => "x" } } })).toThrow("presentation.columns[\"name\"].cellClass can’t be a function");
    expect(() => validateGridPresentation({ columns: { name: { cellClass: ["static", () => "x"] } } })).toThrow("presentation.columns[\"name\"].cellClass[1] can’t be a function");
    expect(() => validateGridPresentation({ hilites: [{ scope: "cell", field: "status", test: () => true }] })).toThrow("presentation.hilites[0].test can’t be a function");
  });

  test("the JavaScript form accepts the predicate hook", () => {
    expect(() => validateGridPresentation({ rowClass: (row: RowStyleContext) => row.entity.name === "Ada" }, true)).not.toThrow();
    expect(() => validateGridPresentation({ columns: { status: { cellClass: (cell: CellStyleContext) => cell.value === "active" ? "live" : undefined } } }, true)).not.toThrow();
    expect(() => validateGridPresentation({ columns: { status: { cellClass: ["static", { when: { field: "status", op: "eq", value: "active" }, class: "rule" }, (cell: CellStyleContext) => cell.value === "active" ? "predicate" : undefined] } } }, true)).not.toThrow();
    expect(() => validateGridPresentation({ hilites: [{ test: (entity: Entity) => entity.id === 1, tone: "positive" }] }, true)).not.toThrow();
  });

  test("invalid plain data is refused with a specific reason", () => {
    expect(() => validateGridPresentation(null)).toThrow("presentation must be an object");
    expect(() => validateGridPresentation({ columns: [] })).toThrow("presentation.columns must be an object");
    expect(() => validateGridPresentation({ columns: { name: { align: "middle" } } })).toThrow("must be one of start, center, end");
    expect(() => validateGridPresentation({ columns: { name: { format: { kind: "money" } } } })).toThrow('must be "date" or "number"');
    expect(() => validateGridPresentation({ columns: { name: { format: { kind: "number", style: "currency" } } } })).toThrow("currency is required");
    expect(() => validateGridPresentation({ columns: { name: { format: { kind: "number", minimumFractionDigits: -1 } } } })).toThrow("nonnegative integer");
    expect(() => validateGridPresentation({ columns: { name: { valueMap: { active: { label: "Active", tone: "loud" } } } } })).toThrow("must be one of neutral, positive, caution, negative");
    expect(() => validateGridPresentation({ columns: { name: { cellClass: [42] } } })).toThrow("must be a class name, a rule object or a predicate");
    expect(() => validateGridPresentation({ rowClass: [{ class: "x", when: { field: "status", op: "near", value: 1 } }] })).toThrow("must be one of eq");
    expect(() => validateGridPresentation({ rowClass: [{ class: "x", when: { field: "status", op: "between", value: [1] } }] })).toThrow("two-item array");
    expect(() => validateGridPresentation({ hilites: [{ scope: "cell", when: { field: "status", op: "eq", value: "active" } }] })).toThrow("is required when scope is \"cell\"");
    expect(() => validateGridPresentation({ unknown: true })).toThrow("presentation.unknown is not a known option");
  });

  test("labels are known keys with string values", () => {
    expect(() => validateGridLabels({ sort: "Order", rows: "{count} records" })).not.toThrow();
    expect(() => validateGridLabels({ sort: 3 })).toThrow("labels.sort must be a string");
    expect(() => validateGridLabels({ nonsense: "x" })).toThrow("labels.nonsense is not a known label");
    expect(() => validateGridLabels([])).toThrow("labels must be an object");
  });
});

describe("matches and value maps", () => {
  test("every plain-data operator reads the record field", () => {
    expect(matchValue({ field: "hours", op: "eq", value: "7.50" }, entity)).toBe(true);
    expect(matchValue({ field: "hours", op: "ne", value: 8 }, entity)).toBe(true);
    expect(matchValue({ field: "hours", op: "lt", value: 8 }, entity)).toBe(true);
    expect(matchValue({ field: "hours", op: "lte", value: "7.50" }, entity)).toBe(true);
    expect(matchValue({ field: "hours", op: "gt", value: 7 }, entity)).toBe(true);
    expect(matchValue({ field: "hours", op: "gte", value: 8 }, entity)).toBe(false);
    expect(matchValue({ field: "status", op: "in", value: ["paused", "active"] }, entity)).toBe(true);
    expect(matchValue({ field: "hours", op: "between", value: [7, 8] }, entity)).toBe(true);
    expect(matchValue({ field: "name", op: "contains", value: "AD" }, entity)).toBe(true);
    expect(matchValue({ field: "note", op: "empty" }, entity)).toBe(true);
    expect(matchValue({ field: "name", op: "notEmpty" }, entity)).toBe(true);
    expect(matchValue({ field: "missing", op: "empty" }, entity)).toBe(true);
    expect(matchValue({ field: "hours", op: "in", value: [1, 2] }, entity)).toBe(false);
  });

  test("a value map is keyed by the raw value as text; an unknown value falls through", () => {
    const column = {
      valueMap: {
        active: "Active now",
        paused: { label: "On hold", tone: "caution" as const, class: "hold" },
        "7.50": "Seven and a half",
        null: "Unset",
      },
    };
    expect(mappedValue(column, "active")).toEqual({ label: "Active now" });
    expect(mappedValue(column, "paused")).toEqual({ label: "On hold", tone: "caution", class: "hold" });
    expect(mappedValue(column, "7.5")).toBeUndefined();
    expect(mappedValue(column, "7.50")).toEqual({ label: "Seven and a half" });
    expect(mappedValue(column, null)).toEqual({ label: "Unset" });
    expect(mappedValue(column, "archived")).toBeUndefined();
    expect(mappedValue({}, "active")).toBeUndefined();
  });
});

describe("class and hilite composition", () => {
  test("rows add the hook, then row hilites in declared order; the last tone wins", () => {
    const presentation: GridPresentation = {
      rowClass: [{ when: { field: "status", op: "eq", value: "active" }, class: ["live", "row"] }],
      hilites: [
        { when: { field: "hours", op: "lt", value: 8 }, class: "short", tone: "caution" },
        { when: { field: "flag", op: "eq", value: true }, class: "flagged", tone: "positive" },
      ],
    } as GridPresentation;
    expect(styleRow(presentation, row)).toEqual({ classes: ["live", "row", "short", "flagged"], tone: "positive" });
  });

  test("cells layer the grid hook, column hook, value map and cell hilites", () => {
    const presentation: GridPresentation = {
      cellClass: ["grid"],
      hilites: [
        { scope: "cell", field: "status", when: { field: "status", op: "eq", value: "active" }, class: "ping", tone: "negative" },
        { scope: "row", when: { field: "status", op: "eq", value: "active" }, class: "row-live" },
      ],
    };
    const column: ColumnPresentation = {
      cellClass: [{ when: { field: "hours", op: "lt", value: 8 }, class: ["column", "grid"] }],
    };
    expect(styleCell(presentation, column, cell, { label: "Active", class: "mapped", tone: "caution" })).toEqual({
      classes: ["grid", "column", "mapped", "ping"],
      tone: "negative",
    });
  });

  test("predicates receive the row and cell context and combine with when", () => {
    const seen: string[] = [];
    const presentation: GridPresentation = {
      rowClass: (context) => {
        seen.push(`${context.entity.name}:${context.index}`);
        return "seen";
      },
      cellClass: [{ when: { field: "status", op: "eq", value: "active" }, test: (context) => context.value === "active", class: "both" }],
    };
    expect(styleRow(presentation, row).classes).toEqual(["seen"]);
    expect(seen).toEqual(["Ada:3"]);
    expect(styleCell(presentation, undefined, cell).classes).toEqual(["both"]);
  });
});

describe("display text", () => {
  test("formats dates and numbers, and leaves other fields to formatValue", () => {
    const date = field("due", "Edm.Date");
    expect(cellText(date, "2026-10-07", { kind: "date", style: "iso" })).toBe("2026-10-07");
    expect(cellText(date, "2026-10-07", { kind: "date", style: "short" })).toBe("7 Oct 26");
    expect(cellText(date, "2026-10-07")).toBe("7 Oct 2026");
    const decimal = field("hours", "Edm.Decimal", { scale: 2 });
    expect(cellText(decimal, "7.5")).toBe("7.50");
    expect(cellText(decimal, "7.5", { kind: "number", style: "decimal", minimumFractionDigits: 2 })).toBe("7.50");
    expect(cellText(field("count", "Edm.Int32"), 1234, { kind: "number" })).toBe("1,234");
    expect(cellText(field("rate", "Edm.Double"), 0.25, { kind: "number", style: "percent" })).toBe("25%");
    expect(cellText(field("price", "Edm.Decimal"), "12.5", { kind: "number", style: "currency", currency: "GBP" })).toBe("£12.50");
  });

  test("allowed values stay the base, and an ignored format changes nothing", () => {
    const status = field("status", "Edm.String", { allowedValues: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] });
    expect(cellText(status, "active")).toBe("Active");
    expect(cellText(status, "archived")).toBe("archived");
    expect(cellText(field("name", "Edm.String"), "Ada", { kind: "number" })).toBe("Ada");
    expect(cellText(field("flag", "Edm.Boolean"), true)).toBe("Yes");
    expect(cellText(field("stamp", "Edm.DateTimeOffset"), "2026-10-07T09:00:00Z")).toContain("7 Oct 2026");
  });
});

describe("labels", () => {
  test("a missing label is today's string; placeholders are filled", () => {
    expect(labelText({}, "rows", { count: 12 })).toBe("12 rows");
    expect(labelText({ rows: "{count} records" }, "rows", { count: 12 })).toBe("12 records");
    expect(labelText({ groupsFailed: "No groups" }, "groupsFailed")).toBe("No groups");
    expect(labelText({ pageOf: "Page {page}/{pages}" }, "pageOf", { page: 2, pages: 5 })).toBe("Page 2/5");
    expect(Object.keys(GRID_LABEL_DEFAULTS).every((key) => typeof GRID_LABEL_DEFAULTS[key as keyof typeof GRID_LABEL_DEFAULTS] === "string")).toBe(true);
  });
});
