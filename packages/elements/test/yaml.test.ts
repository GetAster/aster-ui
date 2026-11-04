import { expect, test } from "bun:test";
import { compileCompositeYaml } from "../src/yaml.ts";
import { defineComposite } from "../src/composition/definition.ts";

const screen = `version: 1
name: Example
model: { type: sample }
children:
  view:
    type: Grid
layout: { child: view }
`;

test("the package compiler returns the same detached definition as defineComposite", () => {
  const compiled = compileCompositeYaml(screen, "screen.yaml");
  expect(compiled.definition).toEqual(defineComposite({ version: 1, name: "Example", model: { type: "sample" }, children: { view: { type: "Grid" } }, layout: { child: "view" } }));
  expect(Object.isFrozen(compiled.definition.children.view)).toBe(true);
  expect(compiled.sources["definition.children.view.type"]).toEqual({ file: "screen.yaml", line: 6, column: 11 });
});

test("an invalid shape reports the file, line, column and definition path", () => {
  expect(() => compileCompositeYaml(screen.replace("type: Grid", "type: Grid\n    typo: true"), "screen.yaml"))
    .toThrow("screen.yaml:7:11: definition.children.view.typo");
});

test("executable YAML constructs are rejected with their location", () => {
  for (const invalid of [
    screen.replace("name: Example", "name: !!js/function >\n  function () { return 1; }"),
    screen.replace("name: Example", "name: &name Example\nmodel: { type: *name }"),
    screen.replace("type: Grid", "type: Grid\n    <<: {}"),
  ]) expect(() => compileCompositeYaml(invalid, "screen.yaml")).toThrow(/screen\.yaml:\d+:\d+:/);
});

test("multiple documents, duplicate keys and unsupported versions are rejected", () => {
  for (const invalid of [
    screen + "---\nname: Another\n",
    screen + "version: 1\n",
    screen.replace("version: 1", "%YAML 1.1\n---\nversion: 1"),
    screen + " ".repeat(262145),
  ]) expect(() => compileCompositeYaml(invalid, "screen.yaml")).toThrow();
});
