import { expect, test } from "bun:test";
import { compileCompositeYaml } from "../../scripts/composite-yaml.ts";
import { defineComposite, deriveComposite } from "../../packages/elements/src/composition/definition.ts";

const yaml = `version: 1
name: Example
model: { type: sample }
children:
  view:
    type: Grid
layout: { child: view }
`;

test("YAML and JS produce the same detached definition, with source positions", () => {
  const compiled = compileCompositeYaml(yaml, "screen.yaml");
  expect(compiled.definition).toEqual(defineComposite({ version: 1, name: "Example", model: { type: "sample" }, children: { view: { type: "Grid" } }, layout: { child: "view" } }));
  expect(compiled.sources["definition.children.view.type"]).toEqual({ file: "screen.yaml", line: 6, column: 11 });
});

test("YAML reports unknown properties with file, line, column and child path", () => {
  expect(() => compileCompositeYaml(yaml.replace("type: Grid", "type: Grid\n    typo: true"), "screen.yaml")).toThrow("screen.yaml:7:11: definition.children.view.typo");
});

test("YAML rejects aliases, tags, merges, duplicate keys and multiple documents", () => {
  for (const invalid of [
    yaml + "extra: &a [1]\nother: *a\n",
    yaml.replace("name: Example", "name: !!str Example"),
    yaml.replace("type: Grid", "type: Grid\n    <<: {}"),
    yaml + "name: Another\n",
    yaml + "---\nname: Another\n",
    yaml.replace("version: 1", "%YAML 1.1\n---\nversion: 1"),
  ]) expect(() => compileCompositeYaml(invalid)).toThrow();
});

test("definitions reject duplicate placements, unsafe keys and unbounded data", () => {
  expect(() => compileCompositeYaml(yaml.replace("layout: { child: view }", "layout: { type: stack, items: [{ child: view }, { child: view }] }"))).toThrow("duplicate placement");
  expect(() => compileCompositeYaml(yaml.replace("type: Grid", "type: Grid\n    props: { __proto__: {} }"))).toThrow("unsafe key");
  expect(() => compileCompositeYaml(yaml + " ".repeat(262145))).toThrow("256 KiB");
  expect(() => compileCompositeYaml(yaml.replace("type: Grid", "type: Grid\n    props: { number: .inf }"))).toThrow();
});

test("public variants are immutable and precedence is shallow, explicit and isolated", () => {
  const base = defineComposite({ version: 1, name: "Example", model: { type: "sample", inputs: { selection: { multiple: true } } },
    children: { table: { type: "Grid", props: { label: "Devices", view: { columns: ["name", "platform"] } } } },
    customize: { modelInputs: ["selection"], children: { table: { props: ["label", "view"], replace: ["CustomGrid"], optional: true } } },
    layout: { child: "table" } });
  const variant = deriveComposite(base, { name: "Variant", children: { table: { type: "CustomGrid", props: { label: "Fleet", view: { columns: ["owner"] } } } } });
  const instance = deriveComposite(variant, { children: { table: { type: "Grid", props: { label: "My fleet" } } } });
  expect(base.children.table.props.label).toBe("Devices");
  expect(variant.children.table.props?.label).toBe("Fleet");
  expect(instance.children.table.props?.label).toBe("My fleet");
  expect(instance.children.table.props?.view).toEqual({ columns: ["owner"] });
  expect(Object.isFrozen(base.children.table.props)).toBe(true);
  const suppressed = deriveComposite(base, { children: { table: { enabled: false } } });
  expect(suppressed.children.table.enabled).toBe(false);
});

test("variants cannot override private bindings, rules, types or lifecycle", () => {
  const base = defineComposite({ version: 1, name: "Example", model: { type: "sample" }, children: { table: { type: "Grid", props: { label: "Devices", selection: { ref: "model.selection" } } } }, customize: { children: { table: { props: ["label"] } } }, layout: { child: "table" } });
  const invalid: unknown[] = [
    { children: { missing: { enabled: false } } },
    { children: { table: { props: { selection: null } } } },
    { children: { table: { type: "Unexpected" } } },
    { children: { table: { enabled: false } } },
    { children: { table: { retain: false } } },
    { modelInputs: { ctx: null } },
    { commands: {} }, { layout: { child: "table" } },
  ];
  for (const patch of invalid) expect(() => deriveComposite(base, patch as never)).toThrow();
});
