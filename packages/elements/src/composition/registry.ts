import type { Command, Lifetime, PageScope, Publication, SessionActivity } from "@getaster/data";
import { CompositeError } from "./definition.ts";

export type CompositeValues = Readonly<Record<string, unknown>>;
export interface CompositeProperty {
  readonly validate: (value: unknown) => boolean;
  readonly optional?: boolean;
  readonly description?: string;
  readonly schema?: Readonly<Record<string, unknown>>;
}
export type CompositeContract = Readonly<Record<string, CompositeProperty>>;
export function snapshotContract<C extends CompositeContract>(contract: C): C {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(freeze); Object.freeze(value);
  };
  return Object.freeze(Object.fromEntries(Object.entries(contract).map(([key, field]) => {
    const schema = structuredClone(field.schema ?? {}); freeze(schema);
    return [key, Object.freeze({ ...field, schema })];
  }))) as C;
}
export function checkContract(values: CompositeValues, contract: CompositeContract, path: string): void {
  for (const key of Object.keys(values)) if (!Object.hasOwn(contract, key)) throw new CompositeError(`${path}.${key}`, "unknown input/property");
  for (const [key, spec] of Object.entries(contract)) {
    if (!Object.hasOwn(values, key) && spec.optional) continue;
    if (!spec.validate(values[key])) throw new CompositeError(`${path}.${key}`, spec.description ? `expected ${spec.description}` : "value does not match the registered contract");
  }
}

export interface CompositeModel {
  readonly values: CompositeValues;
  readonly publications?: Readonly<Record<string, Publication>>;
  readonly commands?: Readonly<Record<string, Command>>;
}
export interface CompositeModelType {
  readonly inputs: CompositeContract;
  readonly exports: CompositeContract;
  readonly commands?: CompositeContract;
  readonly publications?: CompositeContract;
  /** Register owned work with lifetime; inputs are borrowed. */
  readonly create: (inputs: CompositeValues, lifetime: Lifetime, activity?: SessionActivity) => CompositeModel;
}
export interface CompositeMount {
  readonly activity?: SessionActivity;
  readonly props: CompositeValues;
  readonly lifetime: Lifetime;
  readonly scope: PageScope;
}
export interface CompositeSession {
  readonly setActive?: (active: boolean) => void;
  readonly canClose?: (signal: AbortSignal) => boolean | Promise<boolean>;
  readonly element: HTMLElement;
  readonly dispose?: () => void;
  /** A nested composite's local namespace, preserved when it is placed. */
  readonly scope?: PageScope;
}
export type CompositeFactory = (mount: CompositeMount) => CompositeSession | Promise<CompositeSession>;
export interface CompositeComponentType {
  /** Only these inputs may change while a keyed session retains its identity. */
  readonly mutableInputs?: readonly string[];
  readonly props: CompositeContract;
  readonly create?: CompositeFactory;
  readonly load?: () => Promise<CompositeFactory>;
  /** Custom composites can consume props themselves; ordinary elements receive property bindings. */
  readonly apply?: (element: HTMLElement, props: CompositeValues) => void;
}
export interface CompositeRenderer {
  readonly render: (...args: never[]) => unknown;
  readonly accepts: (property: string) => boolean;
  readonly properties?: readonly string[];
}

/** Runtime lookup capabilities; registration is complete before a catalog is exposed. */
export interface CompositeResolver<C extends CompositeContract = CompositeContract> {
  readonly inputs: C | undefined;
  model(name: string): CompositeModelType;
  component(name: string): CompositeComponentType;
  renderer(name: string): CompositeRenderer;
  load(name: string): Promise<CompositeFactory>;
}

/** A host-owned allowlist; definitions can use only these capabilities. */
export class CompositeRegistry {
  readonly #models = new Map<string, CompositeModelType>();
  readonly #components = new Map<string, CompositeComponentType>();
  readonly #renderers = new Map<string, CompositeRenderer>();
  readonly #loads = new Map<string, Promise<CompositeFactory>>();
  #sealed = false;
  #inputs: CompositeContract | undefined;
  get inputs(): CompositeContract | undefined { return this.#inputs; }

  /** Seal registrations and optionally carry a host input contract into mounting. */
  seal(): CompositeResolver;
  seal<const C extends CompositeContract>(inputs: C): CompositeResolver<C>;
  seal(inputs?: CompositeContract): CompositeResolver {
    if (this.#sealed) throw new Error("Registry is already sealed");
    this.#inputs = inputs ? snapshotContract(inputs) : undefined;
    this.#sealed = true;
    return this;
  }

  model(name: string, entry?: CompositeModelType): CompositeModelType {
    if (entry) this.#add(this.#models, name, entry);
    const value = this.#models.get(name);
    if (!value) throw new Error(`Unknown model '${name}'`);
    return value;
  }
  component(name: string, entry?: CompositeComponentType): CompositeComponentType {
    if (entry) {
      if (!!entry.create === !!entry.load) throw new Error(`Component '${name}' needs exactly one create or load factory`);
      this.#add(this.#components, name, entry);
    }
    const value = this.#components.get(name);
    if (!value) throw new Error(`Unknown component '${name}'`);
    return value;
  }
  renderer(name: string, entry?: CompositeRenderer): CompositeRenderer {
    if (entry) this.#add(this.#renderers, name, entry);
    const value = this.#renderers.get(name);
    if (!value) throw new Error(`Unknown renderer '${name}'`);
    return value;
  }
  load(name: string): Promise<CompositeFactory> {
    const entry = this.component(name);
    if (entry.create) return Promise.resolve(entry.create);
    let pending = this.#loads.get(name);
    if (!pending) {
      pending = Promise.resolve().then(() => entry.load!()).catch(error => { this.#loads.delete(name); throw error; });
      this.#loads.set(name, pending);
    }
    return pending;
  }
  #add<T>(map: Map<string, T>, name: string, entry: T): void {
    if (this.#sealed) throw new Error("Registry is sealed; declare capabilities in the catalog before creating it");
    if (map.has(name)) throw new Error(`Duplicate registration '${name}'`);
    map.set(name, entry);
  }
}

/** Adapter for existing public custom-element property APIs. */
export function compositeElement<const C extends CompositeContract>(element: { readonly tag: string; readonly contract: C }): Omit<CompositeComponentType, "props"> & { readonly props: C };
export function compositeElement<const C extends CompositeContract>(tag: string, props: C): Omit<CompositeComponentType, "props"> & { readonly props: C };
export function compositeElement(element: string | { readonly tag: string; readonly contract: CompositeContract }, contract?: CompositeContract): CompositeComponentType {
  const tag = typeof element === "string" ? element : element.tag;
  const props = typeof element === "string" ? contract! : element.contract;
  return {
    props,
    create: () => ({ element: document.createElement(tag) }),
    apply: (element, values) => {
      for (const [key, value] of Object.entries(values)) Reflect.set(element, key, value);
    },
  };
}
