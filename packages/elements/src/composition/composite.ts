import { planCommands } from "./commands.ts";
import { computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import { render, nothing, type TemplateResult } from "lit-html";
import { Command, Lifetime, PageScope, SessionActivity, command, type DataContext, type Publication } from "@getaster/data";
import { provideScope } from "../base/element.ts";
import { CompositeError, defineComposite, deriveComposite, located, record, type CompositeChild, type CompositeDefinition, type CompositeLayout, type CompositeSources, type CompositeValue, type CompositeOverrides } from "./definition.ts";
import { checkContract, type CompositeResolver, type CompositeValues, type CompositeComponentType, type CompositeSession, type CompositeContract } from "./registry.ts";

import type { CompositeContractValues } from "./contracts.ts";

export type CompositePlacement = (place: (child?: string) => HTMLElement) => TemplateResult;
export interface CompositeOptions<I extends CompositeContract = CompositeContract> {
  readonly inputs?: CompositeContractValues<I>;
  readonly parentScope?: PageScope;
  readonly activity?: SessionActivity;
  /** Enables typed navigation in PageRules; inherited by nested scopes. */
  readonly ctx?: DataContext;
  readonly sources?: CompositeSources;
  readonly overrides?: CompositeOverrides;
  /** Optional semantic markup; the definition still controls activation and ownership. */
  readonly placement?: CompositePlacement;
}
type CompositeArguments<I extends CompositeContract> = {} extends CompositeContractValues<I>
  ? [options?: CompositeOptions<I>]
  : [options: CompositeOptions<I> & { readonly inputs: CompositeContractValues<I> }];
export interface CompositeChildHandle {
  readonly status: ReadonlySignal<"idle" | "loading" | "ready" | "error" | "suppressed" | "disposed">;
  readonly error: ReadonlySignal<Error | undefined>;
  /** Does not change placement/visibility; concurrent callers join one creation. */
  ensure(): Promise<HTMLElement>;
}
function isSignal(value: unknown): value is ReadonlySignal<unknown> {
  return !!value && typeof value === "object" && "peek" in value && "subscribe" in value;
}

/** A logical owner with a stable scope and independently activated named views. */
export class Composite<I extends CompositeContract = CompositeContract> {
  readonly element = document.createElement("div");
  readonly lifetime = new Lifetime();
  readonly scope: PageScope;
  readonly activity: SessionActivity;
  readonly commands: Readonly<Record<string, Command>>;
  readonly children: Readonly<Record<string, CompositeChildHandle>>;
  readonly model: CompositeValues;
  readonly definition: CompositeDefinition;
  readonly #refs = new Map<string, unknown>();
  readonly #sources: CompositeSources;

  constructor(definition: CompositeDefinition, readonly registry: CompositeResolver<I>, ...args: CompositeArguments<NoInfer<I>>) {
    const options: CompositeOptions = args[0] ?? {};
    this.#sources = options.sources ?? {};
    this.activity = this.lifetime.own(new SessionActivity(options.activity ? { parent: options.activity, inactive: "continue" } : {}));
    this.scope = new PageScope(options.parentScope, options.ctx ? { ctx: options.ctx } : {});
    this.element.className = "aster-composite";
    this.element.tabIndex = -1;
    provideScope(this.element, this.scope);
    try {
      if (registry.inputs) checkContract(options.inputs ?? {}, registry.inputs, "inputs");
      this.definition = options.overrides ? deriveComposite(definition, options.overrides) : defineComposite(definition);
      definition = this.definition;
      this.element.dataset.composite = definition.name;
      for (const [key, value] of Object.entries(options.inputs ?? {})) this.#refs.set(`inputs.${key}`, value);
      // Validate registration names before constructing the model or starting data work.
      for (const [key, child] of Object.entries(definition.children)) this.#component(child.type, `definition.children.${key}.type`);
      let type;
      try { type = registry.model(definition.model.type); }
      catch (error) { throw new CompositeError("definition.model.type", String(error)); }
      const inputs = this.#values(definition.model.inputs ?? {}, "definition.model.inputs");
      checkContract(inputs, type.inputs, "definition.model.inputs");
      const model = untracked(() => type.create(inputs, this.lifetime, this.activity));
      checkContract(model.values, type.exports, "definition.model.exports");
      this.model = model.values;
      for (const [key, value] of Object.entries(model.values)) this.#refs.set(`model.${key}`, value);
      for (const [key, value] of Object.entries(model.publications ?? {})) this.#refs.set(`model.publications.${key}`, value);
      for (const [key, value] of Object.entries(model.commands ?? {})) this.#refs.set(`model.commands.${key}`, value);
      for (const [key, spec] of Object.entries(definition.publish ?? {})) {
        const path = `definition.publish.${key}`;
        const publication = this.#ref(spec.ref, path) as Publication;
        if (!publication || !publication.values || !Object.values(publication.values).every(isSignal)) throw new CompositeError(path, "expected a publication");
        this.lifetime.defer(this.scope.publish(key, publication));
      }
      const commands: Record<string, Command> = Object.create(null);
      const plan = planCommands(definition.commands ?? {}, reference => this.#refs.get(reference) instanceof Command);
      if (plan.errors[0]) throw new CompositeError(plan.errors[0].path, plan.errors[0].message);
      for (const key of plan.order) {
        const spec = definition.commands![key]!;
        const path = `definition.commands.${key}`;
        const base = this.#ref(spec.use, `${path}.use`);
        if (!(base instanceof Command)) throw new CompositeError(path, "expected an exported Command");
        const rule = spec.enabledWhen;
        if (rule) {
          const errors = this.scope.checkRule(rule);
          if (errors.length) throw new CompositeError(`${path}.enabledWhen`, errors.join("; "));
        }
        const state = rule ? this.scope.state(`commands.${key}`, { enabled: { when: rule, ...(spec.reason ? { reason: spec.reason } : {}) } }, { availability: true }) : undefined;
        const allowed = computed(() => state?.value.enabled ?? true);
        const action = this.lifetime.own(command({
          label: base.label,
          enabled: () => base.enabled.value && allowed.value,
          reason: () => base.reason.value ?? spec.reason ?? "The page rule is not satisfied.",
          run: () => base.execute(),
        }));
        commands[key] = action;
        this.#refs.set(`commands.${key}`, action);
      }
      this.commands = Object.freeze(Object.fromEntries(Object.keys(definition.commands ?? {}).map(key => [key, commands[key]!]))) as Readonly<Record<string, Command>>;
      const children: Record<string, Child> = Object.create(null);
      // Resolve every public binding before starting lazy imports.
      for (const [key, spec] of Object.entries(definition.children)) {
        const path = `definition.children.${key}`;
        const entry = this.#component(spec.type, `${path}.type`);
        const props = this.#props(spec.props ?? {}, `${path}.props`);
        if (spec.enabled !== false) checkContract(this.#readProps(props), entry.props, `${path}.props`);
        children[key] = new Child(key, spec, entry, props, this);
      }
      this.children = children;
      const activations: (() => void)[] = [];
      this.#activation(definition.layout, children, () => true, "definition.layout", activations);
      if (options.placement) {
        const placed = new Set<string>();
        const template = options.placement(key => {
          if (key === undefined) {
            for (const name of Object.keys(children)) {
              if (placed.has(name)) throw new CompositeError("placement", `duplicate placement '${name}'`);
              placed.add(name);
            }
            return this.#layout(definition.layout, children);
          }
          if (!Object.hasOwn(children, key)) throw new CompositeError("placement", `unknown child '${key}'`);
          if (placed.has(key)) throw new CompositeError("placement", `duplicate placement '${key}'`);
          placed.add(key); return children[key]!.element;
        });
        render(template, this.element);
        this.lifetime.defer(() => render(nothing, this.element));
        for (const key of Object.keys(children)) if (!placed.has(key) || !this.element.contains(children[key]!.element)) throw new CompositeError("placement", `child '${key}' has no placement`);
      } else this.element.append(this.#layout(definition.layout, children));
      for (const activate of activations) activate();
    } catch (error) {
      this.lifetime.dispose();
      throw located(error, this.#sources);
    }
  }

  mount(target: HTMLElement): this {
    if (this.lifetime.disposed) throw new Error("Composite is disposed");
    target.append(this.element); return this;
  }

  /** The caller performs close/draft guards before unconditional teardown. */
  dispose(): void { try { this.lifetime.dispose(); } finally { this.element.remove(); } }

  #component(type: string, path: string): CompositeComponentType {
    try { return this.registry.component(type); }
    catch (error) { throw new CompositeError(path, String(error)); }
  }
  #ref(path: string, at: string): unknown {
    if (!this.#refs.has(path)) throw new CompositeError(at, `unknown public reference '${path}'`);
    return this.#refs.get(path);
  }
  #value(value: CompositeValue, path: string, property = ""): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item, i) => this.#value(item, `${path}.${i}`, property));
    const obj = record(value, path);
    for (const kind of ["ref", "bind", "renderer"]) if (Object.hasOwn(obj, kind)) {
      if (Object.keys(obj).length !== 1 || typeof obj[kind] !== "string") throw new CompositeError(path, `invalid ${kind} node`);
      if (kind === "renderer") {
        let renderer;
        try { renderer = this.registry.renderer(obj[kind]); } catch (error) { throw new CompositeError(path, String(error)); }
        if (!renderer.accepts(property)) throw new CompositeError(path, `renderer is not registered for '${property}'`);
        return renderer.render;
      }
      const result = this.#ref(obj[kind], path);
      if (kind === "bind") {
        if (!isSignal(result)) throw new CompositeError(path, "bind requires a signal");
        return result.value;
      }
      return result;
    }
    return Object.fromEntries(Object.entries(obj).map(([key, item]) => [key, this.#value(item as CompositeValue, `${path}.${key}`, property)]));
  }
  #values(values: Readonly<Record<string, CompositeValue>>, path: string): CompositeValues {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, this.#value(value, `${path}.${key}`, key)]));
  }
  #props(values: Readonly<Record<string, CompositeValue>>, path: string): ReadonlySignal<CompositeValues> {
    return computed(() => this.#values(values, path));
  }
  #readProps(props: ReadonlySignal<CompositeValues>): CompositeValues { return props.value; }

  #activation(spec: CompositeLayout, children: Record<string, Child>, active: () => boolean, path: string, activations: (() => void)[]): void {
    if ("child" in spec) {
      const child = children[spec.child]!;
      activations.push(() => this.lifetime.defer(effect(() => {
        const show = active();
        untracked(() => child.activate(show));
      })));
      return;
    }
    switch (spec.type) {
      case "stack":
        spec.items.forEach((item, i) => this.#activation(item, children, active, `${path}.items.${i}`, activations)); break;
      case "deck": {
        const current = computed(() => this.#value(spec.active, `${path}.active`));
        for (const [key, item] of Object.entries(spec.items)) this.#activation(item, children, () => active() && current.value === key, `${path}.items.${key}`, activations);
        break;
      }
      case "outlet": {
        const current = computed(() => this.#value(spec.active, `${path}.active`));
        this.#activation(spec.content, children, () => active() && current.value === true, `${path}.content`, activations); break;
      }
    }
  }

  #layout(spec: CompositeLayout, children: Record<string, Child>): HTMLElement {
    if ("child" in spec) return children[spec.child]!.element;
    const node = document.createElement("div");
    node.className = `aster-composite-${spec.type}`;
    switch (spec.type) {
      case "stack": spec.items.forEach(item => node.append(this.#layout(item, children))); break;
      case "deck": Object.values(spec.items).forEach(item => node.append(this.#layout(item, children))); break;
      case "outlet": node.append(this.#layout(spec.content, children)); break;
    }
    return node;
  }

  report(error: unknown): Error { return located(error, this.#sources); }
}

/** Use either a compiled YAML definition or a JS definition as a registered child. */
export function compositeComponent(definition: CompositeDefinition, registry: CompositeResolver, inputs: CompositeContract, sources?: CompositeSources): CompositeComponentType {
  return {
    props: inputs,
    create: ({ props, scope, activity }) => {
      const instance = new Composite(definition, registry, { inputs: props, parentScope: scope, ...(activity ? { activity } : {}), ...(sources ? { sources } : {}) });
      return { element: instance.element, scope: instance.scope, setActive: active => instance.activity.setActive(active), dispose: () => instance.dispose() };
    },
  };
}

class Child implements CompositeChildHandle {
  readonly element = document.createElement("div");
  readonly #status = signal<"idle" | "loading" | "ready" | "error" | "suppressed" | "disposed">("idle");
  readonly #error = signal<Error | undefined>(undefined);
  readonly status = this.#status;
  readonly error = this.#error;
  #lifetime: Lifetime | undefined;
  #pending: Promise<HTMLElement> | undefined;
  #session: CompositeSession | undefined;
  #generation = 0;
  readonly #activity: SessionActivity;

  constructor(readonly key: string, readonly spec: CompositeChild, readonly type: CompositeComponentType, readonly props: ReadonlySignal<CompositeValues>, readonly owner: Composite) {
    this.#activity = owner.lifetime.own(new SessionActivity({ parent: owner.activity, active: false }));
    this.element.className = "aster-composite-child";
    this.element.dataset.child = key;
    this.element.hidden = true;
    if (spec.enabled === false) this.#status.value = "suppressed";
    owner.lifetime.defer(() => { this.#reset(); this.#status.value = "disposed"; });
  }
  activate(active: boolean): void {
    if (this.spec.enabled === false) return;
    this.#activity.setActive(active);
    this.#session?.setActive?.(active);
    if (!active && this.element.contains(document.activeElement)) this.owner.element.focus();
    this.element.hidden = !active;
    this.element.inert = !active;
    if (!active && this.spec.retain === false) { this.#reset(); return; }
    if (active || this.spec.create !== "on-demand") {
      if (this.#status.peek() === "idle") void this.ensure().catch(() => {});
    }
  }
  ensure(): Promise<HTMLElement> {
    if (this.owner.lifetime.disposed) return Promise.reject(new Error("Composite is disposed"));
    if (this.spec.enabled === false) return Promise.reject(new Error(`Child '${this.key}' is suppressed`));
    if (this.#pending) return this.#pending;
    if (this.#session) return Promise.resolve(this.#session.element);
    const lifetime = this.#lifetime = new Lifetime();
    const generation = ++this.#generation;
    this.#status.value = "loading"; this.#error.value = undefined;
    this.element.setAttribute("aria-busy", "true");
    const status = document.createElement("p"); status.setAttribute("role", "status"); status.textContent = `Loading ${this.key}…`;
    this.element.replaceChildren(status);
    const pending = this.owner.registry.load(this.spec.type).then(async create => {
      lifetime.signal.throwIfAborted();
      const session = await create({ props: this.props.peek(), lifetime, scope: this.owner.scope, activity: this.#activity });
      lifetime.defer(() => { try { session.dispose?.(); } finally { session.element.remove(); } });
      lifetime.signal.throwIfAborted();
      if (generation !== this.#generation) throw new Error("Stale child creation");
      this.#session = session;
      session.setActive?.(this.#activity.active.peek());
      provideScope(session.element, session.scope ?? this.owner.scope);
      if (this.type.apply) {
        let initial = true;
        lifetime.defer(effect(() => {
          try {
            const props = this.props.value;
            checkContract(props, this.type.props, `definition.children.${this.key}.props`);
            untracked(() => this.type.apply!(session.element, props));
          } catch (error) {
            if (initial) throw error;
            queueMicrotask(() => this.#fail(error, generation, lifetime));
          }
        }));
        initial = false;
      }
      this.element.replaceChildren(session.element);
      this.element.removeAttribute("aria-busy");
      this.#status.value = "ready";
      return session.element;
    }).catch((error: unknown) => {
      this.#fail(error, generation, lifetime);
      throw error;
    }).finally(() => { if (generation === this.#generation) this.#pending = undefined; });
    this.#pending = pending;
    return pending;
  }
  #fail(error: unknown, generation: number, lifetime: Lifetime): void {
    if (generation !== this.#generation || this.owner.lifetime.disposed) return;
    try { lifetime.dispose(); } catch (cleanup) { error = new AggregateError([error, cleanup], "Child failed and cleanup reported an error"); }
    this.#session = undefined;
    this.#status.value = "error";
    const failure = this.owner.report(error instanceof CompositeError ? error : new CompositeError(`definition.children.${this.key}`, error instanceof Error ? error.message : String(error)));
    this.#error.value = failure;
    this.element.removeAttribute("aria-busy");
    const message = document.createElement("p"); message.setAttribute("role", "status"); message.textContent = `Could not load ${this.key}. ${failure.message}`;
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "aster-button"; retry.textContent = `Retry ${this.key}`;
    retry.addEventListener("click", () => void this.ensure().catch(() => {}), { signal: this.owner.lifetime.signal });
    this.element.replaceChildren(message, retry);
  }
  #reset(): void {
    ++this.#generation;
    this.#lifetime?.dispose(); this.#lifetime = undefined;
    this.#pending = undefined; this.#session = undefined;
    this.#status.value = "idle"; this.#error.value = undefined;
    this.element.replaceChildren(); this.element.removeAttribute("aria-busy");
  }
}
