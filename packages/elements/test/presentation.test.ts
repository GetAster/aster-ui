import { describe, expect, test } from "bun:test";
import type { Field } from "@getaster/data";
import { presentField, resolveFieldPresentation, validateFieldPresentations, fieldText } from "../src/field/presentation.ts";

const field = (semantic?: string): Field => ({ name: "email", type: "Edm.String", nullable: true, annotations: semantic ? { "AsterData.Type": semantic } : {} }) as Field;
const context = { name: "email", field: field(), value: "ada@example.com", entity: { email: "ada@example.com", secret: "hidden", number: "9007199254740993" }, key: "[1]" };

describe("shared field display", () => {
  test("metadata and explicit email treatment produce identical links without changing raw values", () => {
    const metadata = presentField(context, resolveFieldPresentation(field("email"), "email"));
    const explicit = presentField(context, resolveFieldPresentation(field(), "email", { fields: { email: { treatment: "email" } } }));
    expect(metadata).toEqual(explicit);
    expect(metadata).toMatchObject({ values: ["mailto:ada@example.com", "ada@example.com"] });
    expect(context.value).toBe("ada@example.com");
  });
  test("application semantic types are configurable and unknown metadata falls back", () => {
    expect(resolveFieldPresentation(field("Example.EmailAddress"), "email", { types: { "Example.EmailAddress": { treatment: "email" } } })).toEqual({ treatment: "email" });
    expect(presentField(context, resolveFieldPresentation(field("unknown"), "email"))).toBe(context.value);
  });
  test("missing members inherit and content precedence is renderer, formatter, map, typed text", () => {
    const renderer = () => "rendered";
    const formatter = () => "formatted";
    const descriptor = resolveFieldPresentation(field("email"), "email", { types: { email: { formatter, valueMap: { x: "mapped" } } }, fields: { email: { treatment: "text" } } }, { display: renderer });
    expect(descriptor).toEqual({ treatment: "text", formatter, valueMap: { x: "mapped" }, display: renderer });
    expect(presentField(context, descriptor)).toBe("rendered");
    expect(presentField(context, { formatter, valueMap: { [context.value]: "mapped" } })).toBe("formatted");
    expect(presentField(context, { valueMap: { [context.value]: "mapped" } })).toBe("mapped");
  });
  test("malformed and empty email stays readable text", () => {
    for (const value of ["", "not an address", "<a>@example.com", "a@example.com\nBcc:other"]) expect(presentField({ ...context, value }, { treatment: "email" })).toBe(value);
  });
  test("hidden and unloaded fields never invoke callbacks; other hidden fields are excluded", () => {
    let calls = 0;
    const renderer = (c: import("../src/field/presentation.ts").FieldPresentationContext) => { calls++; expect(c.entity).toEqual({ email: context.value, number: "9007199254740993" }); expect(Object.isFrozen(c.entity)).toBe(true); return "shown"; };
    presentField({ ...context, value: undefined }, { display: renderer });
    presentField({ ...context, hidden: new Set(["email"]) }, { display: renderer });
    presentField({ ...context, known: new Set(["number"]) }, { display: renderer });
    expect(calls).toBe(0);
    expect(presentField({ ...context, hidden: new Set(["secret"]) }, { display: renderer })).toBe("shown");
    expect(calls).toBe(1);
  });
  test("retained fields absent the known projection never reach callbacks", () => {
    expect(presentField({ ...context, known: new Set(["email"]) }, { display: c => { expect(c.entity).toEqual({ email: context.value }); return "safe"; } })).toBe("safe");
  });
  test("exact numeric formatting is shared unchanged", () => {
    const int = { ...field(), type: "Edm.Int64" as const };
    expect(fieldText(int, "9007199254740993", { kind: "number" })).toBe("9,007,199,254,740,993");
  });
  test("explicit invalid configuration reports its member path", () => {
    expect(() => validateFieldPresentations({ fields: { email: { treatment: "unknown" } } })).toThrow("fieldPresentation.fields.email.treatment");
    expect(() => validateFieldPresentations({ types: { Email: { display: "missing" } } })).toThrow("fieldPresentation.types.Email.display");
  });
});
