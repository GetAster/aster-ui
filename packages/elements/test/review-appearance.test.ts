import { describe, expect, test } from "bun:test";
import type { Field } from "@getaster/data";
import { cellText, mappedValue, matchValue, validateGridPresentation } from "../src/grid/appearance.ts";

const field = (type: string): Field => ({ name: "amount", type, nullable: false }) as Field;

describe("appearance review regressions", () => {
  test("unmapped values that name Object prototype members retain their default display", () => {
    const column = { valueMap: { active: "Active" } };
    for (const value of ["constructor", "toString", "__proto__"]) {
      expect(mappedValue(column, value)).toBeUndefined();
    }
  });

  test("explicit map entries may use names also present on Object.prototype", () => {
    const column = { valueMap: JSON.parse('{"constructor":"Constructor","__proto__":"Prototype"}') };
    expect(mappedValue(column, "constructor")).toEqual({ label: "Constructor" });
    expect(mappedValue(column, "__proto__")).toEqual({ label: "Prototype" });
  });

  test("integer presentation retains all digits of an Int64 string", () => {
    expect(cellText(field("Edm.Int64"), "9007199254740993", { kind: "number", style: "integer" }))
      .toBe("9,007,199,254,740,993");
  });

  test("currency presentation retains the cents of a large exact Decimal", () => {
    expect(cellText(field("Edm.Decimal"), "90071992547409.93", {
      kind: "number", style: "currency", currency: "GBP",
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })).toBe("£90,071,992,547,409.93");
  });

  test("hilite equality distinguishes adjacent exact integer strings", () => {
    expect(matchValue({ field: "amount", op: "eq", value: "9007199254740992" }, { amount: "9007199254740993" })).toBe(false);
  });

  test("hilite ordering distinguishes adjacent exact integer strings", () => {
    expect(matchValue({ field: "amount", op: "gt", value: "9007199254740992" }, { amount: "9007199254740993" })).toBe(true);
  });

  test("hilite range and set membership compare adjacent exact integer strings", () => {
    expect(matchValue({ field: "amount", op: "between", value: ["9007199254740992", "9007199254740994"] }, { amount: "9007199254740993" })).toBe(true);
    expect(matchValue({ field: "amount", op: "between", value: ["9007199254740993", "9007199254740994"] }, { amount: "9007199254740992" })).toBe(false);
    expect(matchValue({ field: "amount", op: "in", value: ["9007199254740992"] }, { amount: "9007199254740993" })).toBe(false);
  });

  test("rounding carries into the integer part without moving the decimal point", () => {
    expect(cellText(field("Edm.Decimal"), "99.5", { kind: "number", style: "integer" })).toBe("100");
    expect(cellText(field("Edm.Decimal"), "9.99", { kind: "number", minimumFractionDigits: 0, maximumFractionDigits: 1 })).toBe("10");
    expect(cellText(field("Edm.Decimal"), "999.995", {
      kind: "number", style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2,
    })).toBe("£1,000.00");
    expect(cellText(field("Edm.Decimal"), ".5", { kind: "number", style: "integer" })).toBe("1");
    expect(cellText(field("Edm.Decimal"), "-99.5", { kind: "number", style: "integer" })).toBe("-100");
  });

  test("default style bounds match the platform's resolved fraction digits", () => {
    expect(cellText(field("Edm.Decimal"), "0.12345", { kind: "number", style: "percent" })).toBe("12%");
    expect(cellText(field("Edm.Decimal"), "12.345", {
      kind: "number", style: "currency", currency: "GBP", maximumFractionDigits: 1,
    })).toBe("£12.3");
    expect(cellText(field("Edm.Decimal"), "12.5", {
      kind: "number", style: "currency", currency: "GBP", maximumFractionDigits: 0,
    })).toBe("£13");
  });

  test("fraction digit bounds are validated before a numeric cell renders", () => {
    expect(() => validateGridPresentation({ columns: { amount: { format: {
      kind: "number", minimumFractionDigits: 3, maximumFractionDigits: 2,
    } } } })).toThrow();
  });

  test("currency codes and digit bounds the platform cannot format are rejected", () => {
    expect(() => validateGridPresentation({ columns: { amount: { format: {
      kind: "number", style: "currency", currency: "NOPE",
    } } } })).toThrow(/currency/);
    expect(() => validateGridPresentation({ columns: { amount: { format: {
      kind: "number", maximumFractionDigits: 1000,
    } } } })).toThrow(/maximumFractionDigits/);
    expect(() => validateGridPresentation({ columns: { amount: { format: {
      kind: "number", style: "integer", minimumFractionDigits: 1,
    } } } })).toThrow(/minimumFractionDigits/);
    // A well-formed lowercase code and the platform's bounds still configure.
    expect(() => validateGridPresentation({ columns: { amount: { format: {
      kind: "number", style: "currency", currency: "gbp", minimumFractionDigits: 0, maximumFractionDigits: 2,
    } } } })).not.toThrow();
  });
});
