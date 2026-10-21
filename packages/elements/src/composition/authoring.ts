import { planCommands, commandTargets } from "./commands.ts";
import { asSchema, schemaProperty, compatibility, literalSchema, type Schema } from "./schema.ts";
import type { ReadonlySignal } from "@preact/signals-core";
import type { Command, Publication } from "@getaster/data";
import { CompositeRegistry, snapshotContract, type CompositeResolver, type CompositeComponentType, type CompositeContract, type CompositeModelType, type CompositeProperty, type CompositeRenderer } from "./registry.ts";
import { type CompositeType, type CompositeTypes } from "./contracts.ts";
import { CompositeError, defineComposite, located, type CompositeDefinition, type CompositeSources } from "./definition.ts";
import type { TemplateResult } from "lit-html";
import type { CompositePlacement } from "./composite.ts";

type Value<S> = S extends CompositeType<infer T> ? T : unknown;
type Prefix<P extends string, C> = { [K in keyof C as K extends string ? `${P}.${K}` : never]: Value<C[K]> };
type Field<M, K extends PropertyKey> = K extends keyof M ? NonNullable<M[K]> : {};
type References<I, M, D extends CompositeDefinition> = Prefix<"inputs", I> & Prefix<"model", Field<M, "exports">> & Prefix<"model.commands", Field<M, "commands">> & Prefix<"model.publications", Field<M, "publications">> & {
  [K in keyof NonNullable<D["commands"]> as K extends string ? `commands.${K}` : never]: Command;
};
type FitsEach<V, S> = V extends Value<S> ? V extends undefined ? true
  : S extends { readonly fields: infer F } ? Exclude<keyof V, keyof F> extends never
    ? false extends { [K in keyof F]: K extends keyof V ? Fits<V[K], F[K]> : F[K] extends { optional: true } ? true : false }[keyof F] ? false : true
    : false
  : S extends { readonly item: infer Item } ? V extends readonly (infer E)[] ? Fits<E, Item> : false
  : S extends { readonly signalValue: infer Inner } ? V extends ReadonlySignal<infer E> ? Fits<E, Inner> : false
  : true : false;
type Fits<V, S> = false extends FitsEach<V, S> ? false : true;
type Compatible<R, T, S = CompositeType<T>> = { [K in keyof R]: unknown extends R[K] ? never : R[K] extends T ? Fits<R[K], S> extends true ? K : never : never }[keyof R] & string;
type Bound<R, T, S> = { [K in keyof R]: R[K] extends ReadonlySignal<infer V> ? V extends T ? Fits<V, S> extends true ? K : never : never : never }[keyof R] & string;
type Renderers<R, T, K extends string> = { [N in keyof R]: R[N] extends { render: infer F; properties: readonly (infer P)[] } ? K extends P ? F extends T ? N : never : never : never }[keyof R] & string;
type Input<T, R, F, K extends string, Depth extends readonly unknown[] = [], S = CompositeType<T>> =
  | { readonly ref: Compatible<R, T, S> }
  | { readonly bind: Bound<R, T, S> }
  | { readonly renderer: Renderers<F, T, K> }
  | (Depth["length"] extends 5 ? never : T extends string | number | boolean | null ? T
    : T extends (...args: never[]) => unknown ? never
    : T extends readonly (infer E)[] ? readonly Input<E, R, F, K, [...Depth, 0], S extends { readonly item: infer Item } ? Item : CompositeType<E>>[]
    : T extends object ? { readonly [P in keyof T]: Input<T[P], R, F, K, [...Depth, 0], S extends { readonly fields: infer Fields } ? P extends keyof Fields ? Fields[P] : CompositeType<T[P]> : CompositeType<T[P]>> } : never);
type Props<C extends CompositeContract, R, F> = {
  readonly [K in keyof C as C[K] extends { optional: true } ? never : K]: Input<Value<C[K]>, R, F, K & string, [], C[K]>;
} & {
  readonly [K in keyof C as C[K] extends { optional: true } ? K : never]?: Input<Value<C[K]>, R, F, K & string, [], C[K]>;
};
type CheckedProps<C extends CompositeContract, Given, R, F> = Props<C, R, F> & { [K in Exclude<keyof Given, keyof C>]: never };
type GivenProps<C extends CompositeContract, Given, R, F, K extends string> = {} extends Props<C, R, F>
  ? { readonly [P in K]?: CheckedProps<C, Given, R, F> }
  : { readonly [P in K]: CheckedProps<C, Given, R, F> };
type CheckedLayout<L, N extends string, R, F> = L extends { child: unknown } ? { readonly child: N }
  : L extends { type: "stack"; items: infer Items extends readonly unknown[] } ? { readonly items: { [K in keyof Items]: CheckedLayout<Items[K], N, R, F> } }
  : L extends { type: "deck"; items: infer Items } ? { readonly active: Input<string, R, F, "active">; readonly items: { [K in keyof Items]: CheckedLayout<Items[K], N, R, F> } }
  : L extends { type: "outlet"; content: infer Content } ? { readonly active: Input<boolean, R, F, "active">; readonly content: CheckedLayout<Content, N, R, F> }
  : never;
type Checked<D extends CompositeDefinition, M extends Record<string, CompositeModelType>, C extends Record<string, CompositeComponentType>, F, I> = {
  readonly model: D["model"]["type"] extends keyof M ? {
    readonly type: D["model"]["type"];
  } & GivenProps<M[D["model"]["type"]]["inputs"], NonNullable<D["model"]["inputs"]>, Prefix<"inputs", I>, F, "inputs"> : never;
  readonly children: { [K in keyof D["children"]]: D["children"][K]["type"] extends keyof C ? {
    readonly type: D["children"][K]["type"];
  } & GivenProps<C[D["children"][K]["type"]]["props"], NonNullable<D["children"][K]["props"]>, References<I, M[D["model"]["type"]], D>, F, "props"> : never };
  readonly commands?: { [K in keyof NonNullable<D["commands"]>]: { readonly use: Compatible<References<I, M[D["model"]["type"]], D>, Command> } };
  readonly publish?: { [K in keyof NonNullable<D["publish"]>]: { readonly ref: Compatible<References<I, M[D["model"]["type"]], D>, Publication> } };
  readonly layout: CheckedLayout<D["layout"], keyof D["children"] & string, References<I, M[D["model"]["type"]], D>, F>;
};

export interface RegistryCatalog {
  readonly inputs?: CompositeTypes;
  readonly models: Readonly<Record<string, CompositeModelType>>;
  readonly components: Readonly<Record<string, CompositeComponentType>>;
  readonly renderers?: Readonly<Record<string, CompositeRenderer>>;
}
export interface CompositeDiagnostic { readonly path: string; readonly message: string }
export interface CompositeCompletion { readonly label: string; readonly description: string }

/** Renderer names, allowed properties and implementation share one declaration. */
export function defineCompositeRenderer<const P extends readonly string[], F extends (...args: never[]) => unknown>(properties: P, render: F): CompositeRenderer & { readonly properties: P; readonly render: F } {
  const names = Object.freeze([...properties]) as unknown as P;
  return Object.freeze({ properties: names, render, accepts: (property: string) => names.includes(property) });
}

/** Preserve registry types for static definitions and expose the same contracts to tools. */
export function defineCompositeRegistry<const S extends RegistryCatalog>(spec: S): CompositeAuthoring<S> {
  return new CompositeAuthoring(spec);
}

/** A registry plus pre-mount definition checks and context-sensitive completion. */
export class CompositeAuthoring<S extends RegistryCatalog> {
  readonly registry: CompositeResolver<Field<S, "inputs">>;
  readonly catalog: S;
  constructor(spec: S) {
    const models = Object.fromEntries(Object.entries(spec.models).map(([name, model]) => [name, Object.freeze({ ...model, create: model.create.bind(model), inputs: snapshotContract(model.inputs), exports: snapshotContract(model.exports), ...(model.commands ? { commands: snapshotContract(model.commands) } : {}), ...(model.publications ? { publications: snapshotContract(model.publications) } : {}) })]));
    const components = Object.fromEntries(Object.entries(spec.components).map(([name, component]) => [name, Object.freeze({ ...component, props: snapshotContract(component.props) })]));
    const renderers = Object.fromEntries(Object.entries(spec.renderers ?? {}).map(([name, renderer]) => [name, Object.freeze({ ...renderer, ...(renderer.properties ? { properties: Object.freeze([...renderer.properties]) } : {}) })]));
    this.catalog = Object.freeze({ ...spec, inputs: snapshotContract(spec.inputs ?? {}), models: Object.freeze(models), components: Object.freeze(components), renderers: Object.freeze(renderers) }) as unknown as S;
    const registry = new CompositeRegistry();
    for (const [name, model] of Object.entries(models)) registry.model(name, model);
    for (const [name, component] of Object.entries(components)) registry.component(name, component);
    for (const [name, renderer] of Object.entries(renderers)) registry.renderer(name, renderer);
    this.registry = registry.seal(this.catalog.inputs ?? {}) as CompositeResolver<Field<S, "inputs">>;
  }
  /** Typed JS/TS definitions retain the exact same serializable runtime format. */
  define<const D extends CompositeDefinition>(definition: D & Checked<D, S["models"], S["components"], Field<S, "renderers">, Field<S, "inputs">>): D {
    return this.validate(definition) as D;
  }
  /** Typed placement of existing children; activation still follows the definition. */
  placement<D extends CompositeDefinition>(_definition: D, template: (place: (child?: keyof D["children"] & string) => HTMLElement) => TemplateResult): CompositePlacement {
    return template;
  }
  /** Check loaded YAML/JSON without constructing a model or starting data work. */
  validate(definition: unknown, sources: CompositeSources = {}): CompositeDefinition {
    const diagnostics = this.diagnostics(definition);
    const error = diagnostics[0];
    if (error) throw located(new CompositeError(error.path, error.message), sources);
    return defineComposite(definition);
  }
  diagnostics(definition: unknown): readonly CompositeDiagnostic[] {
    let d: CompositeDefinition;
    try { d = defineComposite(definition); }
    catch (error) { return [{ path: error instanceof CompositeError ? error.path : "definition", message: error instanceof Error ? error.message : String(error) }]; }
    const errors: CompositeDiagnostic[] = [];
    const fail = (path: string, message: string) => { errors.push({ path, message }); };
    const model = this.catalog.models[d.model.type];
    if (!model) { fail("definition.model.type", `Unknown model '${d.model.type}'`); return errors; }
    const refs = this.#references(d);
    errors.push(...planCommands(d.commands ?? {}, reference => {
      const target = refs[reference];
      return !reference.startsWith("commands.") && !!target && compatibility(target.schema ?? {}, { asterType: "Command" }) !== false;
    }).errors);
    const value = (v: unknown, expected: CompositeProperty | undefined, path: string, property: string, available = refs): void => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const node = v as Record<string, unknown>;
        const kind = ["ref", "bind", "renderer"].find(key => Object.hasOwn(node, key));
        if (kind) {
          if (Object.keys(node).length !== 1 || typeof node[kind] !== "string") { fail(path, `Invalid ${kind} node`); return; }
          const name = node[kind];
          if (kind === "renderer") {
            const renderer = this.catalog.renderers?.[name];
            if (!renderer) fail(path, `Unknown renderer '${name}'`);
            else if (!renderer.accepts(property)) fail(path, `Renderer '${name}' does not accept '${property}'`);
          } else {
            const target = available[name];
            if (!target) fail(path, `Unknown public reference '${name}'`);
            else {
              const schema = target.schema ?? {};
              if (kind === "bind" && schema.asterType !== "signal" && (schema.asterType || schema.type)) fail(path, "bind requires a declared signal");
              else if (expected && compatibility(kind === "bind" ? asSchema(schema.value) : schema, expected.schema ?? {}) === false) fail(path, `Reference '${name}' is incompatible with '${property}'`);
            }
          }
          return;
        }
      }
      if (hasNodes(v)) {
        const shape = containerSchema(expected?.schema ?? {});
        if (shape.type && shape.type !== (Array.isArray(v) ? "array" : "object") || shape.asterType) { fail(path, "Binding container does not match the property type"); return; }
        if (!Array.isArray(v) && shape.type === "object") {
          const fields = asSchema(shape.properties);
          for (const key of Object.keys(v as object)) if (shape.additionalProperties === false && !Object.hasOwn(fields, key)) fail(`${path}.${key}`, "Unknown input/property");
          if (Array.isArray(shape.required)) for (const key of shape.required) if (typeof key === "string" && !Object.hasOwn(v as object, key)) fail(`${path}.${key}`, "Required property is missing");
        }
        if (Array.isArray(v)) v.forEach((item, i) => value(item, schemaProperty(nestedSchema(expected?.schema ?? {}, "0")), `${path}.${i}`, property, available));
        else for (const [key, item] of Object.entries(v as object)) value(item, schemaProperty(nestedSchema(expected?.schema ?? {}, key)), `${path}.${key}`, property, available);
      } else if (expected && !expected.validate(v)) fail(path, `Expected ${expected.description ?? "a valid value"}`);
    };
    const props = (given: Readonly<Record<string, unknown>>, contract: CompositeContract, path: string, available = refs): void => {
      for (const [key, v] of Object.entries(given)) {
        if (!Object.hasOwn(contract, key)) fail(`${path}.${key}`, "Unknown input/property");
        else value(v, contract[key], `${path}.${key}`, key, available);
      }
      for (const [key, field] of Object.entries(contract)) if (!field.optional && !Object.hasOwn(given, key)) fail(`${path}.${key}`, "Required property is missing");
    };
    props(d.model.inputs ?? {}, model.inputs, "definition.model.inputs", prefix("inputs", this.catalog.inputs ?? {}));
    for (const [key, child] of Object.entries(d.children)) {
      const component = this.catalog.components[child.type];
      if (!component) fail(`definition.children.${key}.type`, `Unknown component '${child.type}'`);
      else if (child.enabled !== false) props(child.props ?? {}, component.props, `definition.children.${key}.props`);
    }
    for (const [key, publication] of Object.entries(d.publish ?? {})) {
      const target = refs[publication.ref];
      if (!target || compatibility(target.schema ?? {}, { asterType: "publication" }) === false) fail(`definition.publish.${key}.ref`, "Expected a declared publication reference");
    }
    const layout = (node: CompositeDefinition["layout"], path: string): void => {
      if ("child" in node) return;
      switch (node.type) {
        case "stack": node.items.forEach((item, i) => layout(item, `${path}.items.${i}`)); break;
        case "deck": value(node.active, schemaProperty({ type: "string" }), `${path}.active`, "active"); Object.entries(node.items).forEach(([key, item]) => layout(item, `${path}.items.${key}`)); break;
        case "outlet": value(node.active, schemaProperty({ type: "boolean" }), `${path}.active`, "active"); layout(node.content, `${path}.content`); break;
      }
    };
    layout(d.layout, "definition.layout");
    return errors;
  }
  /** Dotted paths use the same `definition.*` addresses as YAML diagnostics. */
  complete(definition: unknown, path: string): readonly CompositeCompletion[] {
    const d = definition && typeof definition === "object" ? definition as CompositeDefinition : undefined;
    const result = (entries: Readonly<Record<string, object>>): CompositeCompletion[] => Object.entries(entries).map(([label, spec]) => ({ label, description: "description" in spec && typeof spec.description === "string" ? spec.description : label }));
    if (path === "definition.model.type") return result(this.catalog.models);
    if (/^definition\.children\.[^.]+\.type$/.test(path)) return result(this.catalog.components);
    const parts = path.split(".");
    if (parts[0] !== "definition" || !d) return [];
    const model = this.catalog.models[d.model?.type];
    const child = d.children?.[parts[2] ?? ""];
    const contract = parts[1] === "children" ? this.catalog.components[child?.type ?? ""]?.props : parts[1] === "model" && parts[2] === "inputs" ? model?.inputs : undefined;
    const root = parts[1] === "children" ? 4 : 3;
    if (contract && parts.length === root) return result(contract);
    const kind = parts.at(-1);
    const refs = parts[1] === "model" ? prefix("inputs", this.catalog.inputs ?? {}) : this.#references(d);
    if (parts[1] === "commands" && kind === "use") {
      const base = Object.keys(filter(refs, field => isCommand(field))).filter(key => !key.startsWith("commands."));
      return result(Object.fromEntries(commandTargets(d.commands ?? {}, base, parts[2]).map(name => [name, refs[name] ?? {}])));
    }
    if (parts[1] === "publish" && kind === "ref") return result(filter(refs, field => field.schema?.asterType === "publication"));
    let expected = contract?.[parts[root] ?? ""];
    if (!expected) return [];
    for (const segment of parts.slice(root + 1, -1)) expected = schemaProperty(nestedSchema(expected.schema ?? {}, segment));
    if (kind === "renderer") return result(Object.fromEntries(Object.entries(this.catalog.renderers ?? {}).filter(([, renderer]) => renderer.accepts(parts[root] ?? "")).map(([name]) => [name, {}])));
    if (kind !== "ref" && kind !== "bind") return [];
    return result(filter(refs, field => {
      const schema = field.schema ?? {};
      if (kind === "bind" && schema.asterType !== "signal") return false;
      return compatibility(kind === "bind" ? asSchema(schema.value) : schema, expected.schema ?? {}) === true;
    }));
  }
  /** Export standard JSON Schema for YAML language-server associations. */
  schema(definition?: CompositeDefinition): Schema {
    const object = (properties: Record<string, unknown>, required: readonly string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
    const node = (kind: string, names: readonly string[]): Schema => names.length ? object({ [kind]: { type: "string", enum: names } }, [kind]) : { not: {} };
    const branches = Object.entries(this.catalog.models).map(([modelName, model]) => {
      const d = definition?.model.type === modelName ? definition : { version: 1 as const, name: "Schema", model: { type: modelName }, children: {}, layout: { type: "stack" as const, items: [] } };
      const refs = this.#references(d);
      const value = (field: CompositeProperty, property: string, available = refs): Schema => {
        const schema = field.schema ?? {};
        const compatible = (bind: boolean) => Object.entries(available).filter(([, target]) => {
          const source = target.schema ?? {};
          if (bind && source.asterType !== "signal") return false;
          // Unknown custom checks are offered only by explicit ref/bind nodes; runtime still checks them.
          return compatibility(bind ? asSchema(source.value) : source, schema) !== false;
        }).map(([name]) => name);
        const literal: Record<string, unknown> = { ...literalSchema(schema) };
        if (Array.isArray(schema.anyOf)) literal.anyOf = schema.anyOf.map(inner => value(schemaProperty(asSchema(inner)), property, available));
        if (schema.type === "array") literal.items = value(schemaProperty(asSchema(schema.items)), property, available);
        if (schema.type === "object") literal.properties = Object.fromEntries(Object.entries(asSchema(schema.properties)).map(([key, inner]) => [key, value(schemaProperty(asSchema(inner)), property, available)]));
        return { description: field.description ?? "", anyOf: [literal, node("ref", compatible(false)), node("bind", compatible(true)), node("renderer", Object.entries(this.catalog.renderers ?? {}).filter(([, renderer]) => renderer.accepts(property)).map(([name]) => name))] };
      };
      const contract = (fields: CompositeContract, available = refs): Schema => object(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, value(field, key, available)])), Object.keys(fields).filter(key => !fields[key]!.optional));
      const child = Object.entries(this.catalog.components).map(([name, component]) => object({ type: { const: name }, props: contract(component.props), create: { enum: ["eager", "on-demand"] }, retain: { type: "boolean" }, enabled: { type: "boolean" } }, Object.values(component.props).some(field => !field.optional) ? ["type", "props"] : ["type"]));
      const baseCommands = Object.keys(filter(refs, field => isCommand(field))).filter(key => !key.startsWith("commands."));
      const commandSchema = (destination?: string) => {
        const names = commandTargets(d.commands ?? {}, baseCommands, destination);
        return object({ use: names.length ? { enum: names } : { not: {} }, enabledWhen: {}, reason: { type: "string" } }, ["use"]);
      };
      const publications = Object.keys(filter(refs, field => field.schema?.asterType === "publication"));
      return object({
        version: { const: 1 }, name: { type: "string", pattern: "^[a-zA-Z][\\w-]*$" },
        model: object({ type: { const: modelName }, inputs: contract(model.inputs, prefix("inputs", this.catalog.inputs ?? {})) }, Object.values(model.inputs).some(field => !field.optional) ? ["type", "inputs"] : ["type"]),
        children: { type: "object", additionalProperties: child.length ? { oneOf: child } : false },
        commands: { type: "object", properties: Object.fromEntries(Object.keys(d.commands ?? {}).map(key => [key, commandSchema(key)])), additionalProperties: commandSchema() },
        publish: { type: "object", additionalProperties: object({ ref: publications.length ? { enum: publications } : { not: {} } }, ["ref"]) },
        customize: { type: "object" }, layout: { $ref: "#/$defs/layout" },
      }, ["version", "name", "model", "children", "layout"]);
    });
    return { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Aster workspace", ...(branches.length ? { oneOf: branches } : { not: {} }), $defs: { layout: {
      oneOf: [
        { type: "object", properties: { child: { type: "string", ...(definition ? { enum: Object.keys(definition.children) } : {}) } }, required: ["child"], additionalProperties: false },
        { type: "object", properties: { type: { const: "stack" }, items: { type: "array", items: { $ref: "#/$defs/layout" } } }, required: ["type", "items"], additionalProperties: false },
        { type: "object", properties: { type: { const: "deck" }, active: {}, items: { type: "object", additionalProperties: { $ref: "#/$defs/layout" } } }, required: ["type", "active", "items"], additionalProperties: false },
        { type: "object", properties: { type: { const: "outlet" }, active: {}, content: { $ref: "#/$defs/layout" } }, required: ["type", "active", "content"], additionalProperties: false },
      ],
    } } };
  }
  #references(d: CompositeDefinition): Record<string, CompositeProperty> {
    const model = this.catalog.models[d.model?.type];
    const refs = { ...prefix("inputs", this.catalog.inputs ?? {}), ...prefix("model", model?.exports ?? {}), ...prefix("model.commands", model?.commands ?? {}), ...prefix("model.publications", model?.publications ?? {}) };
    const plan = planCommands(d.commands ?? {}, reference => !!refs[reference] && compatibility(refs[reference]!.schema ?? {}, { asterType: "Command" }) !== false);
    for (const name of plan.order) refs[`commands.${name}`] = schemaProperty({ asterType: "Command" });
    return refs;
  }
}

function prefix(name: string, contract: CompositeContract): Record<string, CompositeProperty> { return Object.fromEntries(Object.entries(contract).map(([key, spec]) => [`${name}.${key}`, spec])); }
function filter<T>(values: Readonly<Record<string, T>>, accept: (value: T) => boolean): Record<string, T> { return Object.fromEntries(Object.entries(values).filter(([, value]) => accept(value))); }
function hasNodes(value: unknown): boolean { return !!value && typeof value === "object" && (Object.keys(value).some(key => ["ref", "bind", "renderer"].includes(key)) || Object.values(value).some(hasNodes)); }

function nestedSchema(schema: Schema, key: string): Schema {
  if (Array.isArray(schema.anyOf)) return { anyOf: schema.anyOf.filter(branch => asSchema(branch).asterType !== "undefined").map(branch => nestedSchema(asSchema(branch), key)) };
  const shape = containerSchema(schema);
  return /^\d+$/.test(key) ? asSchema(shape.items) : asSchema(asSchema(shape.properties)[key]);
}

function containerSchema(schema: Schema): Schema {
  if (schema.type || schema.asterType) return schema;
  for (const key of ["allOf", "anyOf"]) if (Array.isArray(schema[key])) {
    const found = schema[key].map(item => containerSchema(asSchema(item))).find(item => item.type || item.asterType && item.asterType !== "undefined");
    if (found) return found;
  }
  return schema;
}

function isCommand(field: CompositeProperty): boolean { return compatibility(field.schema ?? {}, { asterType: "Command" }) === true; }
