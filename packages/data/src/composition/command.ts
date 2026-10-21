import { computed, signal, type ReadonlySignal } from "@preact/signals-core";
import { Lifetime } from "./lifetime.ts";

export interface CommandOptions<T> {
  readonly label: string;
  readonly enabled?: () => boolean;
  readonly reason?: () => string | undefined;
  readonly run: (signal: AbortSignal) => T | Promise<T>;
}

/** One guarded action shared by buttons, menus, shortcuts and direct callers. */
export class Command<T = unknown> {
  readonly #lifetime = new Lifetime();
  readonly #busy = signal(false);
  readonly #error = signal<unknown>(undefined);
  readonly #result = signal<T | undefined>(undefined);
  readonly #disposed = signal(false);
  readonly #options: CommandOptions<T>;
  #pending: Promise<T> | undefined;
  readonly label: string;
  readonly enabled: ReadonlySignal<boolean>;
  readonly reason: ReadonlySignal<string | undefined>;
  readonly busy: ReadonlySignal<boolean> = this.#busy;
  readonly error: ReadonlySignal<unknown> = this.#error;
  readonly result: ReadonlySignal<T | undefined> = this.#result;

  constructor(options: CommandOptions<T>) {
    this.#options = options;
    this.label = options.label;
    this.enabled = computed(() => !this.#disposed.value && !this.#busy.value && (options.enabled?.() ?? true));
    this.reason = computed(() => this.#disposed.value ? "This action is closed." : this.#busy.value ? "Working…" : this.enabled.value ? undefined : options.reason?.() ?? "This action is unavailable.");
  }

  /** Concurrent callers join the same invocation; unavailable actions reject. */
  execute(): Promise<T> {
    if (this.#disposed.peek()) return Promise.reject(new Error("This action is closed."));
    if (this.#pending) return this.#pending;
    if (!this.enabled.value) return Promise.reject(new Error(this.reason.value));
    this.#busy.value = true;
    this.#error.value = undefined;
    const pending = Promise.resolve().then(() => {
      this.#lifetime.signal.throwIfAborted();
      return this.#options.run(this.#lifetime.signal);
    }).then(value => {
      if (!this.#lifetime.disposed) this.#result.value = value;
      return value;
    }).catch((error: unknown) => {
      if (!this.#lifetime.disposed) this.#error.value = error;
      throw error;
    }).finally(() => {
      this.#pending = undefined;
      this.#busy.value = false;
    });
    this.#pending = pending;
    return pending;
  }

  dispose(): void {
    this.#disposed.value = true;
    this.#lifetime.dispose();
  }
}

export function command<T>(options: CommandOptions<T>): Command<T> { return new Command(options); }
