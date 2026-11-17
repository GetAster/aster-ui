import { describe, expect, test } from "bun:test";
import type { Field } from "@getaster/data";
import { formatFigure, isNumericField, validateValueFormat } from "../src/format.ts";
import { formatValue } from "../src/field/values.ts";

const field = (type: string, extra: Partial<Field> = {}): Field => ({ name: "amount", type, nullable: false, computed: false, immutable: false, annotations: {}, ...extra }) as Field;
const money = field("Edm.Decimal", { precision: 14, scale: 2 });

describe("formatFigure without metadata", () => {
  test("number, currency, compact, unit and the real minus sign", () => {
    expect(formatFigure(6200, undefined)).toBe("6,200");
    expect(formatFigure(6200.456, undefined)).toBe("6,200.46");
    expect(formatFigure(6200, { style: "currency" })).toBe("£6,200");
    expect(formatFigure(6200.5, { style: "currency" })).toBe("£6,200.50");
    expect(formatFigure(41_200, { style: "currency", compact: true })).toBe("£41.2k");
    expect(formatFigure(-1_250_000, { style: "currency", compact: true })).toBe("−£1.3m");
    expect(formatFigure(41_200, { style: "currency", currency: "EUR", compact: true })).toBe("€41.2k");
    expect(formatFigure(12, { unit: "GB" })).toBe("12 GB");
    expect(formatFigure(-4, undefined)).toBe("−4");
    expect(formatFigure(1234.5, { maximumFractionDigits: 0 })).toBe("1,235");
    expect(formatFigure(1.5, { minimumFractionDigits: 3 })).toBe("1.500");
  });

  test("a locale decides the symbols; the default is en-GB", () => {
    expect(formatFigure(1234567.5, { locale: "de-DE" })).toBe("1.234.567,5");
    expect(formatFigure(1234.5, { style: "currency", currency: "EUR", locale: "de-DE" })).toBe("1.234,50\u00a0€");
    expect(formatFigure("1234567.50", { style: "currency", currency: "EUR", locale: "de-DE" }, { field: money })).toBe("1.234.567,50\u00a0€");
    expect(formatFigure(9, { style: "currency", currency: "EUR", locale: "en-IE" })).toBe("€9");
  });

  test("a percent is a fraction, or a position in the range it is read against", () => {
    expect(formatFigure(0.25, { style: "percent" })).toBe("25%");
    expect(formatFigure(62, { style: "percent" }, { range: { min: 0, max: 100 } })).toBe("62%");
    expect(formatFigure(25, { style: "percent" }, { range: { min: 0, max: 200 } })).toBe("13%");
  });

  test("a function says the value in its own words", () => {
    expect(formatFigure(3, (v, r) => `${v}/${r.max}`, { range: { min: 0, max: 9 } })).toBe("3/9");
    expect(formatFigure(3, (v, r) => `${v}/${r.max}`)).toBe("3/100");
  });

  test("text that is not a number is left as it is", () => {
    expect(formatFigure("12 apples", { style: "currency" })).toBe("12 apples");
    expect(formatFigure("", undefined)).toBe("");
    expect(formatFigure(Number.NaN, undefined)).toBe("NaN");
  });
});

describe("formatFigure with a field", () => {
  test("a Decimal's scale sets its places, and its text keeps every digit", () => {
    expect(formatFigure("1850.5", undefined, { field: money })).toBe("1,850.50");
    expect(formatFigure("1850", { style: "currency" }, { field: money })).toBe("£1,850.00");
    expect(formatFigure("-0.5", { style: "currency" }, { field: money })).toBe("−£0.50");
    expect(formatFigure("90071992547409.93", { style: "currency" }, { field: money })).toBe("£90,071,992,547,409.93");
    expect(formatFigure("12.5", { minimumFractionDigits: 3 }, { field: money })).toBe("12.500");
    expect(formatFigure("0.12345", { style: "percent" }, { field: money })).toBe("12%");
  });

  test("a whole-number type shows no places", () => {
    expect(formatFigure(1234, undefined, { field: field("Edm.Int32") })).toBe("1,234");
    expect(formatFigure("9007199254740993", undefined, { field: field("Edm.Int64") })).toBe("9,007,199,254,740,993");
    expect(formatFigure("99.5", { style: "integer" }, { field: money })).toBe("100");
  });

  test("a currency annotation names the currency; a format's own code wins", () => {
    const eur = field("Edm.Decimal", { scale: 2, annotations: { "Measures.ISOCurrency": "EUR" } });
    const long = field("Edm.Decimal", { scale: 2, annotations: { "Org.OData.Measures.V1.ISOCurrency": "usd" } });
    expect(formatFigure("12.5", { style: "currency" }, { field: eur })).toBe("€12.50");
    expect(formatFigure("12.5", { style: "currency" }, { field: long })).toBe("US$12.50");
    expect(formatFigure("12.5", { style: "currency", currency: "GBP" }, { field: eur })).toBe("£12.50");
    expect(formatFigure("12.5", { style: "currency" }, { field: money })).toBe("£12.50");
  });

  test("only numeric types take a format", () => {
    expect(isNumericField(money)).toBe(true);
    expect(isNumericField(field("Edm.String"))).toBe(false);
    expect(isNumericField(undefined)).toBe(false);
  });
});

describe("formatValue", () => {
  test("shows a Decimal's scale unformatted, for an editor", () => {
    expect(formatValue(money, "7.5")).toBe("7.50");
    expect(formatValue(money, "1850.5")).toBe("1850.50");
    expect(formatValue(money, "7.12345")).toBe("7.12345");
    expect(formatValue(money, "-7")).toBe("-7.00");
    expect(formatValue(money, "abc")).toBe("abc");
    expect(formatValue(field("Edm.Decimal"), "7.5")).toBe("7.5");
  });
});

describe("validateValueFormat", () => {
  test("a format is plain data and unknown keys are refused", () => {
    expect(validateValueFormat({ style: "currency", currency: "USD" })).toEqual({ style: "currency", currency: "USD" });
    expect(() => validateValueFormat({ style: "money" })).toThrow("format.style must be one of decimal, integer, percent, currency");
    expect(() => validateValueFormat({ currency: "pounds" })).toThrow("three-letter");
    expect(() => validateValueFormat({ maximumFractionDigits: 99 })).toThrow("format.maximumFractionDigits must be a nonnegative integer up to 20");
    expect(() => validateValueFormat({ minimumFractionDigits: 3, maximumFractionDigits: 1 })).toThrow("cannot exceed");
    expect(() => validateValueFormat({ locale: "not a tag" })).toThrow("BCP 47");
    expect(() => validateValueFormat({ colour: "red" })).toThrow("format.colour is not a known option");
    expect(() => validateValueFormat([])).toThrow("must be a plain object");
  });

  test("a host names the path and the keys it adds", () => {
    expect(() => validateValueFormat({ kind: "number", unit: 3 }, "columns.price.format", ["kind"])).toThrow("columns.price.format.unit must be a string");
    expect(() => validateValueFormat({ kind: "number" }, "format")).toThrow("format.kind is not a known option");
  });
});


describe("formatFigure significant small values", () => {
  const format = { minimumFractionDigits: 0, maximumFractionDigits: 2, smallValues: "significant" } as const;

  test("ordinary values retain configured precision and exact large integer digits", () => {
    expect(formatFigure("2.250081234567890123", format)).toBe("2.25");
    expect(formatFigure("9007199254740993.25", format)).toBe("9,007,199,254,740,993.25");
    expect(formatFigure("-9007199254740993.25", format)).toBe("−9,007,199,254,740,993.25");
    expect(formatFigure("0", format)).toBe("0");
    expect(formatFigure("0.0000", format)).toBe("0");
    expect(formatFigure(0, format)).toBe("0");
    expect(formatFigure("0.00499", { maximumFractionDigits: 2 })).toBe("0");
    expect(formatFigure("0.005", format)).toBe("0.01");
    expect(formatFigure("0.005", { ...format, maximumFractionDigits: 0 })).toBe("0.005");
  });

  test("tiny positive and negative text and numbers retain up to two significant digits", () => {
    for (const value of ["0.00003123456789", 0.00003123456789]) expect(formatFigure(value, format)).toBe("0.000031");
    for (const value of ["-0.00003123456789", -0.00003123456789]) expect(formatFigure(value, format)).toBe("−0.000031");
    expect(formatFigure("0.0000300000", format)).toBe("0.00003");
    expect(formatFigure("0.00009999", format)).toBe("0.0001");
    expect(formatFigure("0.004999", format)).toBe("0.005");
    expect(formatFigure("0.000031", { ...format, minimumFractionDigits: 2 })).toBe("0.000031");
  });

  test("exact decimals beyond twenty places and double underflow remain nonzero", () => {
    const zeros = "0".repeat(400);
    expect(formatFigure(`0.${zeros}1234567890123456789`, format)).toBe(`0.${zeros}12`);
    expect(formatFigure(`-0.${zeros}9999`, format)).toBe(`−0.${"0".repeat(399)}1`);
    expect(formatFigure(`0.${zeros}0000`, format)).toBe("0");
    expect(formatFigure(`0.${zeros}123456789`, { ...format, locale: "ar-EG" })).toBe(`٠٫${"٠".repeat(400)}١٢`);
    expect(formatFigure(1e-30, format)).toBe(`0.${"0".repeat(29)}1`);
  });

  test("currency, locale and units retain their meaning", () => {
    expect(formatFigure("0.000031234", { ...format, style: "currency", currency: "EUR", locale: "de-DE", unit: "each" })).toBe("0,000031 € each");
    expect(formatFigure(-0.000031234, { ...format, style: "currency", currency: "EUR", locale: "de-DE" })).toBe("−0,000031 €");
    expect(formatFigure("0.000031234", { ...format, locale: "de-DE", unit: "kg" })).toBe("0,000031 kg");
    expect(formatFigure("0.000031234", { ...format, style: "currency" }, { field: money })).toBe("£0.000031");
  });

  test("percent scaling precedes zero detection for text and number values", () => {
    expect(formatFigure("0.000031234", { ...format, style: "percent" })).toBe("0.0031%");
    expect(formatFigure(0.000031234, { ...format, style: "percent" })).toBe("0.0031%");
    expect(formatFigure("0.00009", { ...format, style: "percent" })).toBe("0.01%");
    expect(formatFigure("-0.00000031234", { ...format, style: "percent", locale: "de-DE" })).toBe("−0,000031 %");
    expect(formatFigure(0.0031234, { ...format, style: "percent" }, { range: { min: 0, max: 100 } })).toBe("0.0031%");
    expect(formatFigure("0.000031", { ...format, compact: true })).toBe(formatFigure("0.000031", { maximumFractionDigits: 2, compact: true }));
  });

  test("the small values option validates as plain data", () => {
    expect(validateValueFormat(format)).toEqual(format);
    for (const smallValues of [true, false, "scientific", 2, null]) expect(() => validateValueFormat({ smallValues })).toThrow('smallValues must be "significant"');
  });
});
