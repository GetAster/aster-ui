import { expect, test } from "bun:test";
import { Command, Lifetime, command, valuesPublication } from "@getaster/data";
import { signal } from "@preact/signals-core";
import { compositeTypes as t, defineCompositeModel } from "../src/composition/contracts.ts";
import { compositeElement } from "../src/composition/registry.ts";
import { defineCompositeRegistry, defineCompositeRenderer } from "../src/composition/authoring.ts";
import { compatibility } from "../src/composition/schema.ts";

let creates = 0;
const model = defineCompositeModel({
  inputs: { label: t.string },
  exports: { dirty: t.signal(t.boolean), title: t.signal(t.string), plain: t.boolean, flags: t.array(t.boolean), maybe: t.signal(t.optional(t.boolean)) },
  commands: { save: t.instance(Command) }, publications: { editor: t.publication({ dirty: t.boolean }) },
  create: (_inputs, lifetime) => {
    creates++;
    return { values: { dirty: signal(false), title: signal("Ready"), plain: true, flags: [true], maybe: signal<boolean | undefined>(undefined) },
      commands: { save: lifetime.own(command({ label: "Save", run: () => {} })) }, publications: { editor: valuesPublication({ dirty: signal(false) }) } };
  },
});
const tools = defineCompositeRegistry({
  inputs: { label: t.string }, models: { editor: model },
  components: { Status: compositeElement("demo-status", { caption: t.optional(t.string), dirty: t.boolean, commands: t.optional(t.array(t.instance(Command))), flags: t.optional(t.array(t.boolean)), renderCard: t.optional(t.custom("card renderer", (value): value is (label: string) => string => typeof value === "function", { asterType: "function" })) }) },
  renderers: { card: defineCompositeRenderer(["renderCard"], (label: string) => label) },
});
const definition = { version: 1, name: "Editor", model: { type: "editor", inputs: { label: { ref: "inputs.label" } } },
  commands: { save: { use: "model.commands.save" } }, publish: { editor: { ref: "model.publications.editor" } },
  children: { status: { type: "Status", props: { dirty: { bind: "model.dirty" }, commands: [{ ref: "commands.save" }], renderCard: { renderer: "card" } } } }, layout: { child: "status" },
} as const;

test("typed catalog validates definitions without constructing a model or loading a component", () => {
  const count = creates;
  expect(tools.define(definition)).toEqual(definition);
  expect(tools.diagnostics(definition)).toEqual([]);
  expect(creates).toBe(count);
  expect(tools.registry.model("editor").inputs).toEqual(model.inputs);
});

test("preflight catches invalid names, incompatible refs, bind kinds and missing props", () => {
  const status = (props: object) => ({ ...definition, children: { status: { type: "Status", props } } });
  expect(tools.diagnostics(status({ dirty: { bind: "model.title" } }))[0]?.message).toContain("incompatible");
  expect(tools.diagnostics(status({ dirty: { ref: "model.dirty" } }))[0]?.message).toContain("incompatible");
  expect(tools.diagnostics(status({ dirty: { bind: "model.plain" } }))[0]?.message).toContain("requires a declared signal");
  expect(tools.diagnostics(status({ dirty: { bind: "model.typo" } }))[0]?.message).toContain("Unknown public reference");
  expect(tools.diagnostics(status({ dirty: { bind: "model.maybe" } }))[0]?.message).toContain("incompatible");
  expect(tools.diagnostics(status({ dirty: true, flags: { ref: "model.flags" } }))).toEqual([]);
  expect(tools.diagnostics(status({ dirty: true, caption: { renderer: "card" } }))[0]?.message).toContain("does not accept");
  expect(tools.diagnostics(status({ dirty: true, typo: 1 }))[0]?.path).toBe("definition.children.status.props.typo");
  expect(tools.diagnostics(status({}))[0]?.message).toContain("Required");
  expect(() => tools.validate(status({ dirty: 1 }), { "definition.children.status.props.dirty": { file: "editor.ui.yaml", line: 8, column: 3 } })).toThrow("editor.ui.yaml:8:3");
});

test("completion is registry-wide and filters binding targets by property type", () => {
  const names = (path: string) => tools.complete(definition, path).map(item => item.label);
  expect(names("definition.model.type")).toEqual(["editor"]);
  expect(names("definition.children.status.type")).toEqual(["Status"]);
  expect(names("definition.children.status.props")).toContain("dirty");
  expect(names("definition.children.status.props.dirty.bind")).toEqual(["model.dirty"]);
  expect(names("definition.children.status.props.dirty.ref")).toEqual(["model.plain"]);
  expect(names("definition.children.status.props.renderCard.renderer")).toEqual(["card"]);
  expect(names("definition.children.status.props.caption.renderer")).toEqual([]);
  expect(names("definition.commands.save.use")).toContain("model.commands.save");
  expect(names("definition.publish.editor.ref")).toEqual(["model.publications.editor"]);
});

test("schema export includes named component contracts, compatible refs and nested command arrays", () => {
  const schema = JSON.parse(JSON.stringify(tools.schema(definition)));
  expect(schema.$schema).toContain("2020-12");
  const component = schema.oneOf[0].properties.children.additionalProperties.oneOf[0];
  expect(component.properties.type.const).toBe("Status");
  const dirty = component.properties.props.properties.dirty;
  expect(dirty.anyOf[2].properties.bind.enum).toEqual(["model.dirty"]);
  const commands = component.properties.props.properties.commands;
  expect(JSON.stringify(commands)).toContain("commands.save");
  expect(schema.$defs.layout.oneOf[0].properties.child.enum).toEqual(["status"]);
});

test("declared commands and publications are validated when a model is created", () => {
  const bad = defineCompositeModel({ inputs: {}, exports: {}, commands: { save: t.instance(Command) }, publications: { editor: t.publication({ dirty: t.boolean }) }, create: () => ({ values: {} }) });
  const lifetime = new Lifetime();
  expect(() => bad.create({}, lifetime)).toThrow("model.commands.save");
  expect(t.publication({ dirty: t.boolean }).validate(valuesPublication({ dirty: signal("no") }))).toBe(false);
  expect(model.create({ label: "Ready" }, lifetime).commands?.save).toBeInstanceOf(Command);
  lifetime.dispose();
});

test("schema compatibility does not equate different arrays or optional values", () => {
  expect(compatibility({ type: "array", items: { type: "string" } }, { type: "array", items: { type: "boolean" } })).toBe(false);
  expect(compatibility(t.optional(t.boolean).schema!, t.boolean.schema!)).toBe(false);
  expect(compatibility({ asterType: "Model" }, {})).toBeUndefined();
});

test("catalog snapshots detach mutable registration maps and descriptors", () => {
  const fields = { dirty: { ...t.boolean } };
  const registrations = { Status: compositeElement("demo-status", fields) };
  const catalog = defineCompositeRegistry({ models: { editor: model }, components: registrations });
  fields.dirty.validate = (_): _ is boolean => true;
  registrations.Status = compositeElement("demo-other", { dirty: t.boolean });
  expect(catalog.catalog.components.Status.props.dirty.validate("wrong")).toBe(false);
  expect(Object.isFrozen(catalog.catalog.components.Status.props.dirty.schema)).toBe(true);
});

test("semantic checks resolve forward aliases, reject cycles and invalid nested containers", () => {
  const broken = { ...definition, commands: { ...definition.commands, first: { use: "commands.later" }, later: { use: "model.commands.save" } } };
  expect(tools.diagnostics(broken)).toEqual([]);
  const cycle = { ...definition, commands: { save: { use: "commands.later" }, later: { use: "commands.save" } } };
  expect(tools.diagnostics(cycle)[0]?.message).toContain("Command reference cycle");
  expect(tools.complete(broken, "definition.commands.first.use").map(item => item.label)).toContain("commands.later");
  const commandSchema = (tools.schema(broken) as any).oneOf[0].properties.commands;
  expect(commandSchema.properties.first.properties.use.enum).toContain("commands.later");
  expect(commandSchema.properties.later.properties.use.enum).not.toContain("commands.first");
  const nested = { ...definition, children: { status: { type: "Status", props: { dirty: { wrapper: { bind: "model.dirty" } } } } } };
  expect(tools.diagnostics(nested)[0]?.message).toContain("Binding container");
  expect(tools.complete(definition, "definition.children.status.props.commands.0.ref").map(item => item.label)).toContain("commands.save");
  expect(tools.complete(definition, "definition.commands.save.use").map(item => item.label)).not.toContain("commands.save");
});

test("instance metadata preserves assignability through class inheritance", () => {
  class SpecializedCommand extends Command {}
  expect(compatibility(t.instance(SpecializedCommand).schema!, t.instance(Command).schema!)).toBe(true);
  expect(compatibility(t.instance(Command).schema!, t.instance(SpecializedCommand).schema!)).toBe(false);
});


test("catalog registries reject additions through JavaScript as well as TypeScript", () => {
  expect(() => Reflect.apply(tools.registry.model, tools.registry, ["later", model])).toThrow("Registry is sealed");
  expect(() => Reflect.apply(tools.registry.component, tools.registry, ["Later", compositeElement("demo-later", {})])).toThrow("Registry is sealed");
  expect(() => Reflect.apply(tools.registry.renderer, tools.registry, ["later", defineCompositeRenderer(["caption"], () => "later")])).toThrow("Registry is sealed");
  expect(tools.complete(definition, "definition.model.type").map(item => item.label)).toEqual(["editor"]);
});

test("strict object references agree across preflight, completion, schema and validators", () => {
  const target = t.object({ allowed: t.string });
  const source = t.object({ allowed: t.string, extra: t.string });
  const strictTools = defineCompositeRegistry({
    models: { strict: defineCompositeModel({ inputs: {}, exports: { exact: target, loose: source }, create: () => ({ values: { exact: { allowed: "yes" }, loose: { allowed: "yes", extra: "no" } } }) }) },
    components: { Closed: compositeElement("demo-closed", { config: target }) },
  });
  const screen = { version: 1, name: "Strict", model: { type: "strict" }, children: { view: { type: "Closed", props: { config: { ref: "model.loose" } } } }, layout: { child: "view" } } as const;
  expect(strictTools.diagnostics(screen)[0]?.message).toContain("incompatible");
  expect(strictTools.complete(screen, "definition.children.view.props.config.ref").map(item => item.label)).toEqual(["model.exact"]);
  const schema = strictTools.schema(screen) as any;
  expect(schema.oneOf[0].properties.children.additionalProperties.oneOf[0].properties.props.properties.config.anyOf[1].properties.ref.enum).toEqual(["model.exact"]);
  expect(target.validate({ allowed: "yes", extra: "no" })).toBe(false);
  expect(compatibility({ type: "object", properties: { allowed: { type: "string" } }, required: ["allowed"] }, target.schema!)).toBeUndefined();
});
