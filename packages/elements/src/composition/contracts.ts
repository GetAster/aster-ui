import type { SessionActivity } from "@getaster/data";
import type { ReadonlySignal } from "@preact/signals-core";
import type { Lifetime, Publication } from "@getaster/data";
import { Command } from "@getaster/data";
import { checkContract, snapshotContract, type CompositeContract, type CompositeModel, type CompositeModelType, type CompositeProperty, type CompositeValues } from "./registry.ts";

export interface CompositeType<T> extends CompositeProperty {
  readonly validate: (value: unknown) => value is T;
}
export type CompositeTypes = Readonly<Record<string, CompositeType<unknown>>>;
type TypeValue<T> = T extends CompositeType<infer V> ? V : unknown;
export type CompositeContractValues<C extends CompositeContract> = {
  readonly [K in keyof C as C[K] extends { readonly optional: true } ? never : K]: TypeValue<C[K]>;
} & {
  readonly [K in keyof C as C[K] extends { readonly optional: true } ? K : never]?: Exclude<TypeValue<C[K]>, undefined>;
};

function type<T>(description: string, validate: (value: unknown) => value is T, schema: Readonly<Record<string, unknown>> = {}): CompositeType<T> {
  const metadata = structuredClone(schema);
  function freeze(value: unknown): void {
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  freeze(metadata);
  return Object.freeze({ description, validate, schema: metadata });
}

/** Reusable runtime checks, inferred TS values and discoverable contract metadata. */
export const compositeTypes = Object.freeze({
  string: type("string", (value): value is string => typeof value === "string", { type: "string" }),
  boolean: type("boolean", (value): value is boolean => typeof value === "boolean", { type: "boolean" }),
  number: type("finite number", (value): value is number => typeof value === "number" && Number.isFinite(value), { type: "number" }),
  positiveInteger: type("positive safe integer", (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0, { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  custom: type,
  refine<const C extends CompositeType<unknown>>(inner: C, description: string, accepts: (value: TypeValue<C>) => boolean, schema: Readonly<Record<string, unknown>>): C {
    const validate = inner.validate;
    return Object.freeze({ ...inner, ...type(description, (value): value is TypeValue<C> => validate(value) && accepts(value as TypeValue<C>), { allOf: [inner.schema ?? {}, schema] }) }) as C;
  },
  instance<T>(ctor: abstract new (...args: never[]) => T): CompositeType<T> {
    const name = Object.is(ctor, Command) ? "Command" : ctor.name;
    const bases: string[] = [];
    for (let base = Object.getPrototypeOf(ctor) as { name?: string } | null; base && base !== Function.prototype; base = Object.getPrototypeOf(base)) {
      if (base.name) bases.push(Object.is(base, Command) ? "Command" : base.name);
    }
    return type(name, (value): value is T => value instanceof ctor, { asterType: name, asterBases: bases });
  },
  optional<const C extends CompositeType<unknown>>(inner: C): Omit<C, "validate"> & CompositeType<TypeValue<C> | undefined> & { readonly optional: true } {
    return Object.freeze({ ...inner, schema: Object.freeze({ anyOf: Object.freeze([inner.schema ?? {}, Object.freeze({ asterType: "undefined" })]) }), optional: true, validate: (value: unknown): value is TypeValue<C> | undefined => value === undefined || inner.validate(value) }) as Omit<C, "validate"> & CompositeType<TypeValue<C> | undefined> & { readonly optional: true };
  },
  array<const C extends CompositeType<unknown>>(inner: C): CompositeType<readonly TypeValue<C>[]> & { readonly item: C } {
    return Object.freeze({ ...type(`array of ${inner.description}`, (value): value is readonly TypeValue<C>[] => Array.isArray(value) && value.every(item => inner.validate(item)), { type: "array", items: inner.schema ?? {} }), item: inner });
  },
  signal<const C extends CompositeType<unknown>>(inner: C): CompositeType<ReadonlySignal<TypeValue<C>>> & { readonly signalValue: C } {
    return Object.freeze({ ...type(`signal of ${inner.description}`, (value): value is ReadonlySignal<TypeValue<C>> => {
      if (!value || typeof value !== "object" || !("peek" in value) || typeof value.peek !== "function" || !("subscribe" in value) || typeof value.subscribe !== "function") return false;
      return inner.validate(value.peek());
    }, { asterType: "signal", value: inner.schema ?? {} }), signalValue: inner });
  },
  publication<const C extends CompositeTypes>(fields: C): CompositeType<Publication> {
    const members = snapshotContract(fields);
    return type("publication", (value): value is Publication => {
      if (!value || typeof value !== "object" || !("values" in value) || !value.values || typeof value.values !== "object") return false;
      const values = value.values as Record<string, unknown>;
      return Object.entries(members).every(([key, spec]) => compositeTypes.signal(spec).validate(values[key]));
    }, { asterType: "publication", properties: Object.fromEntries(Object.entries(members).map(([key, spec]) => [key, spec.schema ?? {}])) });
  },
  object<const C extends CompositeTypes>(fields: C): CompositeType<CompositeContractValues<C>> & { readonly fields: C } {
    const members = Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, Object.freeze({ ...spec })])));
    const required = Object.keys(members).filter(key => !members[key]!.optional);
    return Object.freeze({ ...type("object", (value): value is CompositeContractValues<C> => {
      if (!value || typeof value !== "object" || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return false;
      const values = value as CompositeValues;
      return Object.keys(values).every(key => Object.hasOwn(members, key)) && Object.entries(members).every(([key, spec]) => spec.validate(values[key]));
    }, { type: "object", properties: Object.fromEntries(Object.entries(members).map(([key, spec]) => [key, spec.schema ?? {}])), required, additionalProperties: false }), fields: members as C });
  },
});

export interface TypedCompositeModel<I extends CompositeTypes, E extends CompositeTypes, C extends CompositeTypes = {}, P extends CompositeTypes = {}> extends CompositeModelType {
  readonly inputs: I;
  readonly exports: E;
  readonly commands: C;
  readonly publications: P;
  /** Validate and narrow public exports without an application-side cast. */
  read(values: CompositeValues): CompositeContractValues<E>;
}

/** One contract drives runtime validation and contextual typing of model code. */
export function defineCompositeModel<const I extends CompositeTypes, const E extends CompositeTypes, const C extends CompositeTypes = {}, const P extends CompositeTypes = {}>(spec: {
  readonly inputs: I;
  readonly exports: E;
  readonly commands?: C;
  readonly publications?: P;
  readonly create: (inputs: CompositeContractValues<I>, lifetime: Lifetime, activity?: SessionActivity) => Omit<CompositeModel, "values"> & { readonly values: CompositeContractValues<E> };
}): TypedCompositeModel<I, E, C, P> {
  const inputsContract = snapshotContract(spec.inputs);
  const exports = snapshotContract(spec.exports);
  const commands = snapshotContract(spec.commands ?? {}) as C;
  const publications = snapshotContract(spec.publications ?? {}) as P;
  const create = spec.create;
  return {
    inputs: inputsContract,
    exports,
    commands,
    publications,
    create: (inputs, lifetime, activity) => {
      checkContract(inputs, inputsContract, "model.inputs");
      const model = create(inputs as CompositeContractValues<I>, lifetime, activity);
      if (spec.commands) checkContract(model.commands ?? {}, commands, "model.commands");
      if (spec.publications) checkContract(model.publications ?? {}, publications, "model.publications");
      return model;
    },
    read: values => {
      checkContract(values, exports, "model.exports");
      return values as CompositeContractValues<E>;
    },
  };
}

/** JSON-compatible metadata; identity and signal checks still require the runtime. */
export function describeCompositeContract(contract: CompositeContract): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(contract).map(([key, spec]) => [key, { description: spec.description ?? "Custom validator", optional: spec.optional ?? false, schema: spec.schema ?? {} }]));
}
