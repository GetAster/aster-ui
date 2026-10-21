import type { Condition } from "@getaster/data";

export type CompositeValue = null | boolean | number | string | readonly CompositeValue[] | { readonly [key: string]: CompositeValue };
export interface CompositeChild {
  readonly type: string;
  readonly props?: Readonly<Record<string, CompositeValue>>;
  readonly create?: "eager" | "on-demand";
  readonly retain?: boolean;
  /** Static suppression; does not construct or load this child. */
  readonly enabled?: boolean;
}
export interface CompositeChildCustomization {
  readonly props?: readonly string[];
  readonly replace?: readonly string[];
  readonly optional?: boolean;
  readonly lifecycle?: boolean;
}
export interface CompositeCustomization {
  readonly children?: Readonly<Record<string, CompositeChildCustomization>>;
  readonly modelInputs?: readonly string[];
  readonly layout?: boolean;
}
export type CompositeLayout =
  | { readonly child: string }
  | { readonly type: "stack"; readonly items: readonly CompositeLayout[] }
  | { readonly type: "deck"; readonly active: CompositeValue; readonly items: Readonly<Record<string, CompositeLayout>> }
  | { readonly type: "outlet"; readonly active: CompositeValue; readonly content: CompositeLayout };
export interface CompositeDefinition {
  readonly version: 1;
  readonly name: string;
  readonly model: { readonly type: string; readonly inputs?: Readonly<Record<string, CompositeValue>> };
  readonly publish?: Readonly<Record<string, { readonly ref: string }>>;
  readonly commands?: Readonly<Record<string, { readonly use: string; readonly enabledWhen?: Condition; readonly reason?: string }>>;
  readonly children: Readonly<Record<string, CompositeChild>>;
  readonly layout: CompositeLayout;
  readonly customize?: CompositeCustomization;
}
export type CompositeOverrides<D extends CompositeDefinition = CompositeDefinition> = {
  readonly name?: string;
  readonly modelInputs?: Readonly<Partial<Record<keyof NonNullable<D["model"]["inputs"]>, CompositeValue>>>;
  readonly children?: { readonly [K in keyof D["children"]]?: {
    readonly type?: string;
    readonly props?: Readonly<Partial<Record<keyof NonNullable<D["children"][K]["props"]>, CompositeValue>>>;
    readonly enabled?: boolean;
    readonly create?: "eager" | "on-demand";
    readonly retain?: boolean;
  } };
  readonly layout?: CompositeLayout;
};
export type CompositeVariant<D extends CompositeDefinition> = Omit<CompositeDefinition, "children"> & {
  readonly children: { readonly [K in keyof D["children"]]: CompositeChild };
};
export interface CompositeLocation { readonly file: string; readonly line: number; readonly column: number }
export type CompositeSources = Readonly<Record<string, CompositeLocation>>;

export class CompositeError extends Error {
  constructor(readonly path: string, message: string) { super(`${path}: ${message}`); this.name = "CompositeError"; }
}
export function located(error: unknown, sources: CompositeSources = {}): Error {
  if (!(error instanceof CompositeError)) return error instanceof Error ? error : new Error(String(error));
  let path = error.path;
  while (path && !sources[path]) path = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "";
  const at = sources[path];
  return at ? new Error(`${at.file}:${at.line}:${at.column}: ${error.message}`, { cause: error }) : error;
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new CompositeError(path, "expected a mapping");
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new CompositeError(`${path}.${key}`, "unknown property");
}
export function name(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z][\w-]*$/.test(value) || ["constructor", "prototype", "__proto__"].includes(value)) throw new CompositeError(path, "expected a safe name");
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.length) throw new CompositeError(path, "expected text");
}

function condition(value: unknown, path: string): void {
  if (typeof value === "string") { text(value, path); return; }
  const entry = record(value, path);
  switch (entry.op) {
    case "and": case "or":
      keys(entry, ["op", "args"], path);
      if (!Array.isArray(entry.args)) throw new CompositeError(`${path}.args`, "expected an array");
      entry.args.forEach((arg, i) => condition(arg, `${path}.args.${i}`)); return;
    case "not":
      keys(entry, ["op", "arg"], path); condition(entry.arg, `${path}.arg`); return;
    case "eq": case "ne": case "gt": case "ge": case "lt": case "le":
      keys(entry, ["op", "field", "value", "other"], path); text(entry.field, `${path}.field`);
      if (Object.hasOwn(entry, "value") === Object.hasOwn(entry, "other")) throw new CompositeError(path, "comparison needs exactly one value or other path");
      if (entry.other !== undefined) text(entry.other, `${path}.other`); return;
    case "contains": case "startswith": case "endswith":
      keys(entry, ["op", "field", "value", "caseInsensitive"], path);
      text(entry.field, `${path}.field`);
      if (typeof entry.value !== "string") throw new CompositeError(`${path}.value`, "expected text");
      if (entry.caseInsensitive !== undefined && typeof entry.caseInsensitive !== "boolean") throw new CompositeError(path, "caseInsensitive must be boolean"); return;
    case "in":
      keys(entry, ["op", "field", "values"], path); text(entry.field, `${path}.field`);
      if (!Array.isArray(entry.values)) throw new CompositeError(`${path}.values`, "expected an array"); return;
    case "any": case "all": case "via":
      keys(entry, ["op", "field", "where"], path); text(entry.field, `${path}.field`);
      if (typeof entry.where === "string") throw new CompositeError(`${path}.where`, "related criteria require an explicit comparison");
      condition(entry.where, `${path}.where`); return;
    default: throw new CompositeError(`${path}.op`, "unknown rule operator");
  }
}

/** Validate the JSON-compatible subset shared by YAML and JavaScript definitions. */
export function defineComposite<const D extends CompositeDefinition>(value: D): D;
export function defineComposite(value: unknown): CompositeDefinition;
export function defineComposite(value: unknown): CompositeDefinition {
  let nodes = 0;
  const seen = new Set<object>();
  function json(v: unknown, path: string, depth: number): void {
    if (++nodes > 10000 || depth > 40) throw new CompositeError(path, "definition exceeds size/depth limit");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return;
    if (!v || typeof v !== "object") throw new CompositeError(path, "expected JSON-compatible data");
    if (seen.has(v)) throw new CompositeError(path, "cyclic objects are not supported");
    seen.add(v);
    if (Array.isArray(v)) v.forEach((item, i) => json(item, `${path}.${i}`, depth + 1));
    else for (const [key, item] of Object.entries(record(v, path))) {
      if (["__proto__", "prototype", "constructor", "<<"].includes(key)) throw new CompositeError(`${path}.${key}`, "unsafe key");
      json(item, `${path}.${key}`, depth + 1);
    }
    seen.delete(v);
  }
  json(value, "definition", 0);
  const d = record(value, "definition");
  keys(d, ["version", "name", "model", "publish", "commands", "children", "layout", "customize"], "definition");
  if (d.version !== 1) throw new CompositeError("definition.version", "unsupported version");
  name(d.name, "definition.name");
  const model = record(d.model, "definition.model");
  keys(model, ["type", "inputs"], "definition.model"); name(model.type, "definition.model.type");
  if (model.inputs !== undefined) record(model.inputs, "definition.model.inputs");
  for (const [key, item] of Object.entries(record(d.publish ?? {}, "definition.publish"))) {
    name(key, `definition.publish.${key}`);
    const entry = record(item, `definition.publish.${key}`);
    keys(entry, ["ref"], `definition.publish.${key}`); text(entry.ref, `definition.publish.${key}.ref`);
  }
  for (const [key, item] of Object.entries(record(d.commands ?? {}, "definition.commands"))) {
    name(key, `definition.commands.${key}`);
    const path = `definition.commands.${key}`; const entry = record(item, path);
    keys(entry, ["use", "enabledWhen", "reason"], path); text(entry.use, `${path}.use`);
    if (entry.enabledWhen !== undefined) condition(entry.enabledWhen, `${path}.enabledWhen`);
    if (entry.reason !== undefined) text(entry.reason, `${path}.reason`);
  }
  const children = record(d.children, "definition.children");
  for (const [key, item] of Object.entries(children)) {
    name(key, `definition.children.${key}`);
    const path = `definition.children.${key}`; const entry = record(item, path);
    keys(entry, ["type", "props", "create", "retain", "enabled"], path); name(entry.type, `${path}.type`);
    if (entry.props !== undefined) record(entry.props, `${path}.props`);
    if (entry.create !== undefined && entry.create !== "eager" && entry.create !== "on-demand") throw new CompositeError(`${path}.create`, "expected eager or on-demand");
    if (entry.retain !== undefined && typeof entry.retain !== "boolean") throw new CompositeError(`${path}.retain`, "expected boolean");
    if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") throw new CompositeError(`${path}.enabled`, "expected boolean");
  }
  function names(v: unknown, path: string): void {
    if (!Array.isArray(v)) throw new CompositeError(path, "expected an array of names");
    v.forEach((item, i) => name(item, `${path}.${i}`));
  }
  if (d.customize !== undefined) {
    const c = record(d.customize, "definition.customize");
    keys(c, ["children", "modelInputs", "layout"], "definition.customize");
    if (c.layout !== undefined && typeof c.layout !== "boolean") throw new CompositeError("definition.customize.layout", "expected boolean");
    if (c.modelInputs !== undefined) {
      names(c.modelInputs, "definition.customize.modelInputs");
      for (const key of c.modelInputs as string[]) if (!Object.hasOwn(model.inputs ?? {}, key)) throw new CompositeError("definition.customize.modelInputs", `unknown model input '${key}'`);
    }
    for (const [key, value] of Object.entries(record(c.children ?? {}, "definition.customize.children"))) {
      const path = `definition.customize.children.${key}`;
      if (!Object.hasOwn(children, key)) throw new CompositeError(path, "unknown child");
      const spec = record(value, path); keys(spec, ["props", "replace", "optional", "lifecycle"], path);
      if (spec.props !== undefined) names(spec.props, `${path}.props`);
      if (spec.replace !== undefined) names(spec.replace, `${path}.replace`);
      for (const flag of ["optional", "lifecycle"]) if (spec[flag] !== undefined && typeof spec[flag] !== "boolean") throw new CompositeError(`${path}.${flag}`, "expected boolean");
    }
  }
  const placed = new Set<string>();
  function layout(v: unknown, path: string): void {
    const entry = record(v, path);
    if (entry.child !== undefined) {
      keys(entry, ["child"], path); name(entry.child, `${path}.child`);
      if (!Object.hasOwn(children, entry.child)) throw new CompositeError(path, `unknown child '${entry.child}'`);
      if (placed.has(entry.child)) throw new CompositeError(path, `duplicate placement '${entry.child}'`);
      placed.add(entry.child); return;
    }
    switch (entry.type) {
      case "stack":
        keys(entry, ["type", "items"], path);
        if (!Array.isArray(entry.items)) throw new CompositeError(`${path}.items`, "expected an array");
        entry.items.forEach((item, i) => layout(item, `${path}.items.${i}`)); break;
      case "deck":
        keys(entry, ["type", "active", "items"], path);
        if (entry.active === undefined) throw new CompositeError(`${path}.active`, "required");
        for (const [key, item] of Object.entries(record(entry.items, `${path}.items`))) { name(key, path); layout(item, `${path}.items.${key}`); } break;
      case "outlet":
        keys(entry, ["type", "active", "content"], path);
        if (entry.active === undefined) throw new CompositeError(`${path}.active`, "required");
        layout(entry.content, `${path}.content`); break;
      default: throw new CompositeError(path, "unknown layout type");
    }
  }
  layout(d.layout, "definition.layout");
  for (const key of Object.keys(children)) if (!placed.has(key)) throw new CompositeError(`definition.children.${key}`, "child has no placement");
  // Detach caller-owned objects and freeze every level of the public definition.
  const copy = JSON.parse(JSON.stringify(value)) as CompositeDefinition;
  const normalized: CompositeDefinition = copy.customize?.children ? { ...copy, customize: { ...copy.customize,
    children: Object.fromEntries(Object.entries(copy.customize.children).map(([key, spec]) => [key, spec.replace ? { ...spec, replace: [...new Set([copy.children[key]!.type, ...spec.replace])] } : spec])),
  } } : copy;
  function freeze(v: unknown): void {
    if (!v || typeof v !== "object") return;
    Object.values(v).forEach(freeze); Object.freeze(v);
  }
  freeze(normalized);
  return normalized;
}

/** Immutable public customization: base → derived definition → instance overrides. */
export function deriveComposite<D extends CompositeDefinition>(base: D, overrides: CompositeOverrides<NoInfer<D>>): CompositeVariant<D> {
  const definition = defineComposite(base);
  const patch = record(overrides, "overrides");
  keys(patch, ["name", "modelInputs", "children", "layout"], "overrides");
  const customize = definition.customize;
  const children = { ...definition.children };
  for (const [key, value] of Object.entries(record(patch.children ?? {}, "overrides.children"))) {
    const path = `overrides.children.${key}`;
    const child = children[key];
    const permission = customize?.children?.[key];
    if (!child || !permission) throw new CompositeError(path, "child is not a public customization point");
    const next = record(value, path); keys(next, ["type", "props", "enabled", "create", "retain"], path);
    if (next.type !== undefined && next.type !== child.type && !permission.replace?.includes(String(next.type))) throw new CompositeError(`${path}.type`, "replacement type is not permitted");
    if (next.enabled !== undefined && !permission.optional) throw new CompositeError(`${path}.enabled`, "child suppression is not public");
    if ((next.create !== undefined || next.retain !== undefined) && !permission.lifecycle) throw new CompositeError(path, "lifecycle policy is not public");
    const props = record(next.props ?? {}, `${path}.props`);
    for (const property of Object.keys(props)) if (!permission.props?.includes(property)) throw new CompositeError(`${path}.props.${property}`, "property is not public");
    children[key] = { ...child, ...next, props: { ...child.props, ...props } } as CompositeChild;
  }
  const modelInputs = record(patch.modelInputs ?? {}, "overrides.modelInputs");
  for (const key of Object.keys(modelInputs)) if (!customize?.modelInputs?.includes(key)) throw new CompositeError(`overrides.modelInputs.${key}`, "model input is not public");
  if (patch.layout !== undefined && !customize?.layout) throw new CompositeError("overrides.layout", "placement is not public");
  return defineComposite({
    ...definition,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    model: { ...definition.model, inputs: { ...definition.model.inputs, ...modelInputs } },
    children,
    ...(patch.layout !== undefined ? { layout: patch.layout } : {}),
  }) as CompositeVariant<D>;
}
