import { describe, expect, test } from "bun:test";
import { parseCsdl, subtractExact, validateEntity, validateField } from "../src/index.ts";

const fixture = await Bun.file(new URL("../../../fixtures/aster/metadata.json", import.meta.url)).json();

function schema(edit: (j: typeof fixture) => void = () => {}) {
  const j = structuredClone(fixture);
  edit(j);
  return parseCsdl(j);
}

describe("validation", () => {
  test("an immutable field can be set on create but not changed on update", () => {
    const type = schema((j) => {
      j.AsterDemo.Project.leadId["@Core.Immutable"] = true;
    }).set("Projects").type;
    expect(validateEntity(type, { leadId: 2 }, "update").leadId).toEqual(["Lead can't be changed once it's set."]);
    expect(validateEntity(type, { name: "Renamed" }, "update")).toEqual({});
    expect(validateEntity(type, { leadId: 2 }, "create").leadId).toBeUndefined();
  });

  test("allowed values compare by type: Decimal 1.0 is 1", () => {
    const type = schema((j) => {
      j.AsterDemo.Project.budget["@Validation.AllowedValues"] = [{ Value: "1" }, { Value: "2.5" }];
    }).set("Projects").type;
    const budget = type.field("budget")!;
    expect(validateField(budget, "1.0")).toEqual([]);
    expect(validateField(budget, "2.50")).toEqual([]);
    expect(validateField(budget, "3")).toHaveLength(1);
  });

  test("a date is a real calendar date", () => {
    const date = schema().set("TimeEntries").type.field("date")!;
    expect(validateField(date, "2026-10-07")).toEqual([]);
    expect(validateField(date, "2026-02-30")).toEqual(["Date must be a date, like 7 Oct 2026."]);
    expect(validateField(date, "next week")).toHaveLength(1);
  });

  test("decimals may use an exponent; the scale counts it", () => {
    const budget = schema().set("Projects").type.field("budget")!;
    expect(validateField(budget, "1.25e2")).toEqual([]);
    expect(validateField(budget, "1.2345e1")).toEqual(["Budget can have at most 2 decimal places."]);
    expect(subtractExact("1e3", "1.5")).toBe("998.5");
    expect(subtractExact("2.5E-1", "0")).toBe("0.25");
  });
});
