import { expect, test } from "bun:test";
import { signal } from "@preact/signals-core";
import { Lifetime, selectionOptionsError } from "@getaster/data";
import { compositeTypes as t, defineCompositeModel, describeCompositeContract } from "../src/composition/contracts.ts";

test("one typed contract validates model inputs and narrows exports", () => {
  const model = defineCompositeModel({
    inputs: { title: t.string, enabled: t.optional(t.boolean) },
    exports: { length: t.number, enabled: t.boolean },
    create: ({ title, enabled }) => ({ values: { length: title.length, enabled: enabled ?? true } }),
  });
  const owner = new Lifetime();
  expect(model.read(model.create({ title: "Devices" }, owner).values)).toEqual({ length: 7, enabled: true });
  expect(() => model.create({ title: 42 }, owner)).toThrow("expected string");
  expect(() => model.create({ title: "Devices", typo: true }, owner)).toThrow("unknown input");
  expect(() => model.read({ length: "seven", enabled: true })).toThrow("expected finite number");
  owner.dispose();
});

test("reusable contracts validate nested configuration and describe it for tools", () => {
  const selection = t.refine(t.object({ multiple: t.boolean, ordered: t.optional(t.boolean), maxOrdered: t.optional(t.positiveInteger) }), "selection policy", value => selectionOptionsError(value) === undefined, {});
  expect(selection.validate({ multiple: true })).toBe(true);
  expect(selection.validate({ multiple: true, ordered: true, maxOrdered: 3 })).toBe(true);
  expect(selection.validate({ multiple: true, maxOrdered: 3 })).toBe(false);
  expect(selection.validate({ multiple: false, ordered: true })).toBe(false);
  expect(selection.validate({ multiple: true, maxOrdered: 0 })).toBe(false);
  expect(selection.validate({ multiple: true, typo: true })).toBe(false);
  const description = describeCompositeContract({ selection });
  expect(description.selection).toMatchObject({ schema: { allOf: [{ type: "object", required: ["multiple"], additionalProperties: false }, {}] } });
  expect(t.signal(t.string).validate(signal("Ready"))).toBe(true);
  expect(t.signal(t.string).validate(signal(42))).toBe(false);
  expect(t.array(t.boolean).validate([true, false])).toBe(true);
});

test("object contracts detach caller-owned members and schema metadata", () => {
  const fields = { label: { ...t.string } };
  const object = t.object(fields);
  fields.label.validate = (_: unknown): _ is string => true;
  expect(object.validate({ label: 42 })).toBe(false);
  expect(object.schema).toMatchObject({ properties: { label: { type: "string" } } });
  expect(Object.isFrozen(object.schema!.properties)).toBe(true);
});
