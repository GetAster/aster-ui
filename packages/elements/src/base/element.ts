import { computed, effect, signal, untracked, type ReadonlySignal, type Signal } from "@preact/signals-core";
import type { PageScope } from "@getaster/data";
import { nothing, render, type TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";

export type View = TemplateResult | typeof nothing;

/** A plain value or a signal of one; elements read either. */
export type Bindable<T> = T | ReadonlySignal<T>;

export function read<T>(value: Bindable<T>): T {
  return isSignal(value) ? value.value : value;
}

function isSignal<T>(value: Bindable<T>): value is ReadonlySignal<T> {
  return typeof value === "object" && value !== null && "peek" in value && "subscribe" in value;
}

/**
 * The base of every Aster element: light DOM, rendered with lit-html from
 * `render()`. Any signal `render()` reads schedules a re-render.
 *
 * Only signals read while `render()` runs are tracked. Callbacks lit calls
 * later, during the commit (such as `repeat`'s template), are not, so keyed
 * lists use `each`, which builds every item's view first.
 *
 * Invariant: the template is computed synchronously when its signals change,
 * and committed to the DOM once per microtask, so a batch of changes costs
 * one commit. The first render on connect commits immediately.
 *
 * An element defined after it was created (a lazily loaded page) may have
 * had properties set while it was a plain element; on first connect they
 * are re-set through the class's setters.
 */
export abstract class AsterElement extends HTMLElement {
  #dispose: (() => void) | undefined;
  #queued = false;
  #view: ReadonlySignal<View> | undefined;
  readonly #cleanups: (() => void)[] = [];

  protected abstract render(): View;

  /** Runs after each commit; geometry reads belong here. */
  protected updated(): void {}

  connectedCallback(): void {
    this.#upgradeProperties();
    const view = computed(() => this.render());
    this.#view = view;
    let first = true;
    this.#dispose = effect(() => {
      view.value;
      if (first) {
        first = false;
        // Children connecting during the commit must not subscribe this effect.
        untracked(() => this.#commit());
      } else {
        this.#schedule();
      }
    });
  }

  disconnectedCallback(): void {
    this.#dispose?.();
    this.#dispose = undefined;
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
  }

  /** A signal-backed property: `#x = this.prop(1)` and get/set through it. */
  protected prop<T>(initial: T): Signal<T> {
    return signal(initial);
  }

  /** Disposed when the element disconnects. */
  protected onDisconnect(cleanup: () => void): void {
    this.#cleanups.push(cleanup);
  }

  /** Listens on `target` until the element disconnects. */
  protected listen<K extends keyof WindowEventMap>(
    target: EventTarget,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.onDisconnect(() => target.removeEventListener(type, handler as EventListener, options));
  }

  protected emit<T>(type: string, detail?: T): boolean {
    return this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, cancelable: true }));
  }

  #upgradeProperties(): void {
    for (const name of Object.keys(this)) {
      let proto: object | null = Object.getPrototypeOf(this);
      while (proto && proto !== HTMLElement.prototype && !Object.getOwnPropertyDescriptor(proto, name)?.set) {
        proto = Object.getPrototypeOf(proto);
      }
      if (!proto || proto === HTMLElement.prototype) continue;
      const value = (this as Record<string, unknown>)[name];
      delete (this as Record<string, unknown>)[name];
      (this as Record<string, unknown>)[name] = value;
    }
  }

  #schedule(): void {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (this.#dispose) this.#commit();
    });
  }

  #commit(): void {
    if (!this.#view) return;
    render(this.#view.peek(), this, { host: this });
    this.updated();
  }
}

export function define(name: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, ctor);
}

const SCOPE = Symbol("aster-scope");

/** Makes `scope` the page scope for `el` and everything inside it. */
export function provideScope(el: Element, scope: PageScope): void {
  (el as Element & { [SCOPE]?: PageScope })[SCOPE] = scope;
}

/** The page scope `el` is in: the nearest one provided on it or an ancestor. */
export function scopeOf(el: Element): PageScope | undefined {
  for (let n: Node | null = el; n; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null)) {
    const scope = (n as Node & { [SCOPE]?: PageScope })[SCOPE];
    if (scope) return scope;
  }
  return undefined;
}

let ids = 0;

/** A document-unique id for ARIA references. */
export function uid(prefix: string): string {
  return `${prefix}-${(ids++).toString(36)}`;
}

/**
 * A keyed list for templates. Each item's view is built now, inside the
 * caller's `render()`, so the signals it reads are tracked; lit then only
 * moves and updates the finished views.
 */
export function each<T>(items: readonly T[], key: (item: T) => string, view: (item: T) => View) {
  const built = items.map((item) => ({ key: key(item), view: view(item) }));
  return repeat(
    built,
    (b) => b.key,
    (b) => b.view,
  );
}
