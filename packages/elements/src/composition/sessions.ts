import { effect } from "@preact/signals-core";
import { KeyedSessions, type PageScope, type SessionActivity, type SessionDescriptor } from "@getaster/data";
import { provideScope } from "../base/element.ts";
import { checkContract, type CompositeResolver, type CompositeSession } from "./registry.ts";

export interface CompositeSessionsOptions {
  readonly parentScope?: PageScope;
  readonly activity?: SessionActivity;
}
export interface CompositeKeyedSession extends CompositeSession {
  /** Stable host for placement in Tabs, renderers or ordinary DOM. */
  readonly element: HTMLElement;
}

/** Keyed registered components, including compiled composites via compositeComponent.
 * Definitions consume this through ordinary model references and renderer bindings. */
export class CompositeSessions extends KeyedSessions<SessionDescriptor, CompositeKeyedSession> {
  constructor(registry: CompositeResolver, options: CompositeSessionsOptions = {}) {
    super({
      ...options,
      validate: descriptor => {
        const type = registry.component(descriptor.type);
        if (type.mutableInputs?.length && !type.apply) throw new Error(`Component '${descriptor.type}' needs apply for mutable inputs`);
        for (const key of type.mutableInputs ?? []) if (!Object.hasOwn(type.props, key)) throw new Error(`Unknown mutable input '${key}'`);
        checkContract(descriptor.inputs ?? {}, type.props, `sessions.${descriptor.key}.inputs`);
      },
      checkUpdate: (previous, next) => {
        const mutable = new Set(registry.component(next.type).mutableInputs ?? []);
        for (const key of new Set([...Object.keys(previous.inputs ?? {}), ...Object.keys(next.inputs ?? {})])) {
          if (!mutable.has(key) && !Object.is(previous.inputs?.[key], next.inputs?.[key])) throw new Error(`Session '${next.key}' cannot change immutable input '${key}'`);
        }
        if (previous.inactive !== next.inactive) throw new Error(`Session '${next.key}' cannot change inactive policy`);
      },
      create: async (descriptor, mount) => {
        const type = registry.component(descriptor.type);
        const create = await registry.load(descriptor.type);
        mount.lifetime.signal.throwIfAborted();
        const session = await create({ props: descriptor.inputs ?? {}, ...mount });
        mount.lifetime.defer(() => session.dispose?.());
        mount.lifetime.signal.throwIfAborted();
        const element = document.createElement("div");
        element.className = "aster-composite-session";
        element.dataset.session = descriptor.key;
        provideScope(element, session.scope ?? mount.scope);
        element.append(session.element);
        mount.lifetime.defer(effect(() => {
          const active = mount.activity.active.value;
          if (!active && element.contains(document.activeElement)) {
            const target = element.parentElement?.closest<HTMLElement>('[tabindex]'); target?.focus();
          }
          element.hidden = !active; element.inert = !active;
        }));
        return { element, ...(session.scope ? { scope: session.scope } : {}),
          ...(session.canClose ? { canClose: signal => session.canClose!(signal) } : {}),
          ...(session.setActive ? { setActive: active => session.setActive!(active) } : {}),
          dispose: () => element.remove(),
        };
      },
      update: (resource, _previous, next) => {
        const type = registry.component(next.type);
        type.apply?.(resource.element.firstElementChild as HTMLElement, next.inputs ?? {});
      },
    });
  }
}
