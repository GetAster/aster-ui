import { signal, type ReadonlySignal } from "@preact/signals-core";
import { Lifetime } from "./lifetime.ts";
import { SessionActivity, type InactivePolicy } from "./activity.ts";
import { PageScope } from "../scope/scope.ts";

export interface SessionDescriptor {
  readonly key: string;
  readonly type: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly lazy?: boolean;
  readonly inactive?: InactivePolicy;
}
export interface SessionResource {
  dispose?(): void;
  canClose?(signal: AbortSignal): boolean | Promise<boolean>;
  setActive?(active: boolean): void;
}
export interface SessionMount {
  readonly lifetime: Lifetime;
  readonly scope: PageScope;
  readonly activity: SessionActivity;
}
export interface KeyedSessionsOptions<D extends SessionDescriptor, T extends SessionResource> {
  readonly create: (descriptor: D, mount: SessionMount) => T | Promise<T>;
  readonly validate?: (descriptor: D) => void;
  /** Validate immutable identity before any reconciliation mutations. */
  readonly checkUpdate?: (previous: D, next: D) => void;
  readonly update?: (resource: T, previous: D, next: D) => void;
  readonly parentScope?: PageScope;
  readonly activity?: SessionActivity;
}
export type SessionStatus = "idle" | "loading" | "ready" | "error" | "disposed";

/** A bounded collection: only descriptors in the current reconciliation are retained. */
export class KeyedSessions<D extends SessionDescriptor, T extends SessionResource> {
  readonly lifetime = new Lifetime();
  readonly #entries = new Map<string, KeyedSession<D, T>>();
  readonly #sessions = signal<readonly KeyedSession<D, T>[]>([]);
  readonly sessions: ReadonlySignal<readonly KeyedSession<D, T>[]> = this.#sessions;
  #active: string | undefined;
  constructor(readonly options: KeyedSessionsOptions<D, T>) {
    this.lifetime.defer(() => {
      const cleanup = new Lifetime();
      for (const entry of this.#entries.values()) cleanup.defer(() => entry.dispose());
      this.#entries.clear(); this.#sessions.value = []; cleanup.dispose();
    });
  }
  get(key: string): KeyedSession<D, T> | undefined { return this.#entries.get(key); }
  reconcile(descriptors: readonly D[]): void {
    if (this.lifetime.disposed) throw new Error("Sessions are disposed");
    for (const descriptor of descriptors) {
      if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) throw new TypeError("Session descriptor must be a record");
      if (typeof descriptor.key !== "string" || !descriptor.key.trim()) throw new TypeError("Session key must be a nonempty string");
      if (typeof descriptor.type !== "string" || !descriptor.type.trim()) throw new TypeError("Session type must be a nonempty string");
      if (descriptor.lazy !== undefined && typeof descriptor.lazy !== "boolean") throw new TypeError("Session lazy must be a boolean");
      if (descriptor.inactive !== undefined && descriptor.inactive !== "pause" && descriptor.inactive !== "continue") throw new TypeError("Session inactive must be pause or continue");
      if (descriptor.inputs !== undefined) {
        const inputs = descriptor.inputs;
        if (!inputs || typeof inputs !== "object" || (Object.getPrototypeOf(inputs) !== Object.prototype && Object.getPrototypeOf(inputs) !== null)) throw new TypeError("Session inputs must be an ordinary record");
      }
    }
    descriptors = descriptors.map(descriptor => Object.freeze({ ...descriptor, ...(descriptor.inputs ? { inputs: Object.freeze({ ...descriptor.inputs }) } : {}) }) as D);
    const keys = new Set<string>();
    for (const descriptor of descriptors) {
      if (!descriptor.key || keys.has(descriptor.key)) throw new Error(`Duplicate or empty session key '${descriptor.key}'`);
      keys.add(descriptor.key); this.options.validate?.(descriptor);
      const previous = this.#entries.get(descriptor.key)?.descriptor;
      if (previous) {
        if (previous.type !== descriptor.type) throw new Error(`Session '${descriptor.key}' cannot change type`);
        if (previous.inactive !== descriptor.inactive) throw new Error(`Session '${descriptor.key}' cannot change inactive policy`);
        if (this.options.checkUpdate) this.options.checkUpdate(previous, descriptor);
        else for (const key of new Set([...Object.keys(previous.inputs ?? {}), ...Object.keys(descriptor.inputs ?? {})])) {
          if (!Object.is(previous.inputs?.[key], descriptor.inputs?.[key])) throw new Error(`Session '${descriptor.key}' cannot change immutable input '${key}'`);
        }
      }
    }
    for (const key of this.#entries.keys()) if (!keys.has(key)) this.remove(key);
    const ordered = descriptors.map(descriptor => {
      let entry = this.#entries.get(descriptor.key);
      if (entry) entry.update(descriptor);
      else { entry = new KeyedSession(descriptor, this.options); this.#entries.set(descriptor.key, entry); }
      return entry;
    });
    this.#sessions.value = ordered;
    for (const entry of ordered) {
      entry.activate(entry.descriptor.key === this.#active);
      if (entry.descriptor.lazy === false) void entry.ensure().catch(() => {});
    }
  }
  ensure(key: string): Promise<T> {
    const entry = this.#entries.get(key);
    return entry ? entry.ensure() : Promise.reject(new Error(`Unknown session '${key}'`));
  }
  activate(key: string | undefined): void {
    if (key !== undefined && !this.#entries.has(key)) throw new Error(`Unknown session '${key}'`);
    this.#active = key;
    for (const entry of this.#entries.values()) entry.activate(entry.descriptor.key === key);
  }
  async requestClose(key: string): Promise<boolean> {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    if (!await entry.requestClose()) return false;
    if (this.#entries.get(key) !== entry) return false;
    this.remove(key); return true;
  }
  /** Descriptor removal and owner disposal are unconditional, unlike user close. */
  remove(key: string): void {
    const entry = this.#entries.get(key); if (!entry) return;
    this.#entries.delete(key);
    if (this.#active === key) this.#active = undefined;
    this.#sessions.value = this.#sessions.peek().filter(item => item !== entry);
    entry.dispose();
  }
  dispose(): void { this.lifetime.dispose(); }
}

export class KeyedSession<D extends SessionDescriptor, T extends SessionResource> {
  readonly lifetime = new Lifetime();
  readonly scope: PageScope;
  readonly activity: SessionActivity;
  readonly #status = signal<SessionStatus>("idle");
  readonly #value = signal<T | undefined>(undefined);
  readonly #error = signal<unknown>(undefined);
  readonly status: ReadonlySignal<SessionStatus> = this.#status;
  readonly value: ReadonlySignal<T | undefined> = this.#value;
  readonly error: ReadonlySignal<unknown> = this.#error;
  #descriptor: D;
  #pending: Promise<T> | undefined;
  #closing: Promise<boolean> | undefined;
  #attempt: Lifetime | undefined;
  get descriptor(): D { return this.#descriptor; }
  constructor(descriptor: D, readonly options: KeyedSessionsOptions<D, T>) {
    this.#descriptor = descriptor;
    this.lifetime.defer(() => {
      this.#status.value = "disposed"; this.#value.value = undefined; this.#attempt?.dispose();
    });
    this.scope = new PageScope(options.parentScope);
    this.activity = this.lifetime.own(new SessionActivity({ ...(options.activity ? { parent: options.activity } : {}), inactive: descriptor.inactive ?? "pause", active: false }));
  }
  update(descriptor: D): void {
    const previous = this.#descriptor;
    if (this.#value.peek()) this.options.update?.(this.#value.peek()!, previous, descriptor);
    this.#descriptor = descriptor;
  }
  activate(active: boolean): void {
    this.activity.setActive(active); this.#value.peek()?.setActive?.(active);
    if (active) void this.ensure().catch(() => {});
  }
  ensure(): Promise<T> {
    if (this.lifetime.disposed) return Promise.reject(new Error("Session is disposed"));
    if (this.#pending) return this.#pending;
    if (this.#value.peek()) return Promise.resolve(this.#value.peek()!);
    const attempt = this.#attempt = new Lifetime();
    this.#status.value = "loading"; this.#error.value = undefined;
    const initial = this.#descriptor;
    const pending = Promise.resolve().then(() => {
      attempt.signal.throwIfAborted();
      return this.options.create(initial, { lifetime: attempt, scope: this.scope, activity: this.activity });
    }).then(resource => {
      attempt.defer(() => resource.dispose?.());
      attempt.signal.throwIfAborted();
      this.options.update?.(resource, initial, this.#descriptor);
      resource.setActive?.(this.activity.active.peek());
      this.#value.value = resource; this.#status.value = "ready"; return resource;
    }).catch(error => {
      attempt.dispose();
      if (!this.lifetime.disposed) { this.#error.value = error; this.#status.value = "error"; }
      throw error;
    }).finally(() => { this.#pending = undefined; });
    this.#pending = pending; return pending;
  }
  requestClose(): Promise<boolean> {
    if (this.#closing) return this.#closing;
    const pending = Promise.resolve().then(async () => {
      if (this.lifetime.disposed) return false;
      // A started factory must finish before its resource's guard can be consulted.
      const resource = this.#pending ? await this.#pending : this.#value.peek();
      const accepted = await resource?.canClose?.(this.lifetime.signal) ?? true;
      return accepted && !this.lifetime.disposed;
    }).finally(() => { this.#closing = undefined; });
    this.#closing = pending; return pending;
  }
  dispose(): void { this.lifetime.dispose(); }
}
