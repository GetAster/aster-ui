import { describe, expect, test } from "bun:test";
import { canonicalNumeric, compareNumeric, numericAligned, stepNumeric } from "./numeric.ts";

describe("exact numeric editing", () => {
  test("keeps large integers and decimal increments exact", () => {
    expect(stepNumeric("9007199254740993.25", 1, "0.05")).toBe("9007199254740993.3");
    expect(stepNumeric("9223372036854775806", 1, 1)).toBe("9223372036854775807");
    expect(stepNumeric("0.2", 1, "0.1")).toBe("0.3");
    expect(stepNumeric("-0.2", -1, "0.1")).toBe("-0.3");
    expect(compareNumeric("9007199254740993.0001", "9007199254740993")).toBe(1);
  });
  test("aligns off-grid positive and negative values in either direction", () => {
    expect(stepNumeric("1.1", 1, "0.5")).toBe("1.5");
    expect(stepNumeric("1.1", -1, "0.5")).toBe("1");
    expect(stepNumeric("-1.1", 1, "0.5")).toBe("-1");
    expect(stepNumeric("-1.1", -1, "0.5")).toBe("-1.5");
    expect(stepNumeric("1.2", 1, ".5", ".2")).toBe("1.7");
    expect(numericAligned("1.2", ".5", ".2")).toBe(true);
    expect(numericAligned("1.25", ".5", ".2")).toBe(false);
  });
  test("respects bounds without creating an off-grid endpoint", () => {
    expect(stepNumeric("0.8", 1, ".4", 0, 1)).toBeUndefined();
    expect(stepNumeric("2", -1, ".4", 0, 1)).toBe("0.8");
    expect(stepNumeric(null, 1, 1, 5, 10)).toBe("5");
    expect(stepNumeric(null, -1, 1, -10, -5)).toBe("-5");
    expect(stepNumeric("9", 1, 1, 0, 9)).toBeUndefined();
    expect(stepNumeric("0", -1, 1, 0, 9)).toBeUndefined();
  });
  test("canonicalizes exponent input without losing precision", () => {
    expect(canonicalNumeric("1e-3")).toBe("0.001");
    expect(canonicalNumeric("1.23e3")).toBe("1230");
    expect(canonicalNumeric("-0.000")).toBe("0");
    expect(canonicalNumeric("100.00")).toBe("100");
    expect(canonicalNumeric("100.10")).toBe("100.1");
    expect(() => canonicalNumeric("1e100000000")).toThrow();
    expect(() => canonicalNumeric("Infinity")).toThrow();
    expect(() => canonicalNumeric("1,000.5")).toThrow();
    expect(() => stepNumeric("1", 1, 0)).toThrow();
  });
});
