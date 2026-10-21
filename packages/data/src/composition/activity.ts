import { computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import { Lifetime } from "./lifetime.ts";

export type InactivePolicy = "pause" | "continue";
export interface ActivityOptions {
  readonly parent?: SessionActivity;
  readonly inactive?: InactivePolicy;
  readonly active?: boolean;
}
export interface ActivityRun {
  readonly signal: AbortSignal;
  readonly refresh: boolean;
  /** Only the current, unaborted run can mark its refreshed data fresh. */
  readonly markFresh: () => void;
}

/** Logical data activity; a paused ancestor always constrains descendants. */
export class SessionActivity {
  readonly lifetime = new Lifetime();
  readonly #active = signal(true);
  readonly #disposed = signal(false);
  readonly active: ReadonlySignal<boolean> = this.#active;
  readonly running: ReadonlySignal<boolean>;
  constructor(options: ActivityOptions = {}) {
    this.lifetime.defer(() => { this.#disposed.value = true; });
    this.#active.value = options.active ?? true;
    this.running = computed(() => !this.#disposed.value && (options.parent?.running.value ?? true) && (this.#active.value || options.inactive === "continue"));
  }
  setActive(active: boolean): void { if (!this.lifetime.disposed) this.#active.value = active; }

  /** Start an owned subscription or task on each resume. Release late acquisitions too.
   * refresh is true after a pause or invalidate; successful refresh calls run.markFresh(). */
  run(start: (run: ActivityRun) => void | (() => void) | Promise<void | (() => void)>): ActivityTask {
    return this.lifetime.own(new ActivityTask(this, start));
  }
  dispose(): void { this.#disposed.value = true; this.lifetime.dispose(); }
}

export class ActivityTask {
  readonly #stale = signal(true);
  readonly #error = signal<unknown>(undefined);
  readonly #revision = signal(0);
  readonly lifetime = new Lifetime();
  readonly stale: ReadonlySignal<boolean> = this.#stale;
  readonly error: ReadonlySignal<unknown> = this.#error;
  constructor(activity: SessionActivity, start: (run: ActivityRun) => void | (() => void) | Promise<void | (() => void)>) {
    this.lifetime.defer(effect(() => {
      const running = activity.running.value; this.#revision.value;
      if (!running) { untracked(() => { this.#stale.value = true; }); return; }
      const attempt = new Lifetime();
      untracked(() => {
        this.#error.value = undefined;
        Promise.resolve().then(() => {
          attempt.signal.throwIfAborted();
          return start({ signal: attempt.signal, refresh: this.#stale.peek(), markFresh: () => { if (!attempt.disposed) this.#stale.value = false; } });
        }).then(cleanup => { if (cleanup) attempt.defer(cleanup); }).catch(error => {
          if (!attempt.disposed) this.#error.value = error;
        });
      });
      return () => attempt.dispose();
    }));
  }
  invalidate(): void { if (!this.lifetime.disposed) { this.#stale.value = true; this.#revision.value++; } }
  dispose(): void { this.lifetime.dispose(); }
}
