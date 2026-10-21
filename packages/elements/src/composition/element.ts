import { signal } from "@preact/signals-core";
import { AsterElement, define, type View } from "../base/element.ts";
import type { CompositeType } from "./contracts.ts";

export interface ElementProperty<T, C extends CompositeType<T> = CompositeType<T>> {
  readonly type: C;
  /** Called separately for each element; mutable defaults must be newly created. */
  readonly initial: () => T;
  readonly description: string;
}
export type ElementProperties = Readonly<Record<string, ElementProperty<unknown>>>;
export type ElementValues<P extends ElementProperties> = {
  -readonly [K in keyof P]: P[K] extends ElementProperty<infer T> ? T : never;
};
export type ElementContract<P extends ElementProperties> = {
  readonly [K in keyof P]: P[K]["type"] & { readonly optional: true };
};
export interface DeclaredElement<P extends ElementProperties> {
  new(): AsterElement & ElementValues<P>;
  readonly tag: string;
  readonly properties: P;
  readonly contract: ElementContract<P>;
}

/** Declare a validated property, its per-instance default and its documentation once. */
export function elementProperty<const C extends CompositeType<unknown>>(type: C, initial: () => C extends CompositeType<infer T> ? T : never, description: string): { readonly type: C; readonly initial: typeof initial; readonly description: string } {
  return Object.freeze({ type: Object.freeze({ ...type }), initial, description });
}

/** Define a light-DOM element with reactive accessors and an inferred YAML contract. */
export function defineElement<const P extends ElementProperties>(spec: {
  readonly tag: string;
  readonly properties: P;
  readonly render: (props: Readonly<ElementValues<P>>, element: AsterElement & ElementValues<P>) => View;
}): DeclaredElement<P> {
  const { tag, render } = spec;
  if (customElements.get(tag)) throw new Error(`Element '${tag}' is already defined`);
  const properties = Object.freeze(Object.fromEntries(Object.entries(spec.properties).map(([key, property]) => {
    // Native DOM capabilities and lifecycle hooks cannot become YAML inputs.
    if (key in AsterElement.prototype || ["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Reserved element property '${key}'`);
    return [key, Object.freeze({ ...property, type: Object.freeze({ ...property.type }) })];
  }))) as P;
  const contract = Object.freeze(Object.fromEntries(Object.entries(properties).map(([key, property]) => [key,
    Object.freeze({ ...property.type, optional: true, description: property.description }),
  ])));
  class Element extends AsterElement {
    static readonly tag = tag;
    static readonly properties = properties;
    static readonly contract = contract;
    constructor() {
      super();
      for (const [key, property] of Object.entries(properties)) {
        // Upgrade pre-definition assignments before installing our own accessors.
        const initial = Object.hasOwn(this, key) ? Reflect.get(this, key) : property.initial();
        const validate = (value: unknown): void => {
          if (!property.type.validate(value)) throw new TypeError(`${tag}.${key}: expected ${property.type.description ?? property.description}`);
        };
        validate(initial);
        const state = signal(initial);
        Object.defineProperty(this, key, {
          enumerable: true, configurable: false,
          get: () => state.value,
          set: (value: unknown) => { validate(value); state.value = value; },
        });
      }
    }
    protected render(): View {
      const element = this as AsterElement & ElementValues<P>;
      return render(element, element);
    }
  }
  // Accessors belong to each newly constructed instance; existing prototypes are untouched.
  define(tag, Element);
  return Element as DeclaredElement<P>;
}
