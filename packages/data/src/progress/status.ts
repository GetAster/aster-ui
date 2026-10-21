import { batch, computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";

export interface ProgressPolicy {
  /** Milliseconds before a busy operation becomes visually visible. */
  readonly delayMs?: number;
  /** Minimum total visible time, including any completion message. */
  readonly minVisibleMs?: number;
}
export const DEFAULT_PROGRESS_POLICY = Object.freeze({ delayMs: 250, minVisibleMs: 400 });
export type ProgressPhase = "idle" | "waiting" | "working" | "complete" | "error";
export interface ProgressWork {
  readonly busy: boolean;
  readonly error?: unknown;
}

/** Validate and snapshot presentation timing without changing the source operation. */
export function progressPolicy(options: ProgressPolicy = {}): Readonly<Required<ProgressPolicy>> {
  if (!options || typeof options !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new TypeError("Progress policy must be a plain object");
  for (const [key, value] of Object.entries(options)) {
    if (!["delayMs", "minVisibleMs"].includes(key)) throw new TypeError(`Unknown progress policy '${key}'`);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new RangeError(`${key} must be an integer between 0 and 2147483647`);
  }
  return Object.freeze({ ...DEFAULT_PROGRESS_POLICY, ...options });
}

/** Delayed presentation of borrowed work; actual busy/error values remain immediate. */
export class ProgressState {
  readonly #busy = signal(false);
  readonly #error = signal<unknown>(undefined);
  readonly #phase = signal<ProgressPhase>("idle");
  readonly busy: ReadonlySignal<boolean> = this.#busy;
  readonly error: ReadonlySignal<unknown> = this.#error;
  readonly phase: ReadonlySignal<ProgressPhase> = this.#phase;
  readonly visible = computed(() => ["working", "complete", "error"].includes(this.phase.value));
  readonly #stop: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #revision = 0;
  #disposed = false;
  #started: number | undefined;
  #shown: number | undefined;
  #work: ProgressWork = { busy: false };
  #policy: Readonly<Required<ProgressPolicy>> = DEFAULT_PROGRESS_POLICY;

  constructor(source: () => ProgressWork, policy: ProgressPolicy | (() => ProgressPolicy) = {}) {
    const fixed = typeof policy === "function" ? DEFAULT_PROGRESS_POLICY : progressPolicy(policy);
    const readPolicy = typeof policy === "function" ? policy : () => fixed;
    this.#stop = effect(() => {
      const work = source();
      if (!work || typeof work.busy !== "boolean") throw new TypeError("Progress work must expose a boolean busy value");
      const settings = progressPolicy(readPolicy());
      untracked(() => this.#update(work, settings));
    });
  }

  #update(work: ProgressWork, policy: Readonly<Required<ProgressPolicy>>): void {
    if (this.#disposed) return;
    this.#cancel();
    const now = performance.now();
    if (work.busy && !this.#busy.peek()) this.#started = now;
    this.#work = { busy: work.busy, error: work.error }; this.#policy = policy;
    batch(() => {
      this.#busy.value = work.busy;
      this.#error.value = work.error;
      if (work.error !== undefined && work.error !== null) {
        this.#shown = undefined; this.#phase.value = "error"; return;
      }
      if (work.busy) {
        if (this.#shown !== undefined) { this.#phase.value = "working"; return; }
        const remaining = policy.delayMs - (now - (this.#started ?? now));
        if (remaining > 0) { this.#phase.value = "waiting"; this.#schedule(remaining); }
        else { this.#shown = now; this.#phase.value = "working"; }
        return;
      }
      this.#started = undefined;
      const remaining = this.#shown === undefined ? 0 : policy.minVisibleMs - (now - this.#shown);
      if (remaining > 0) { this.#phase.value = "complete"; this.#schedule(remaining); }
      else { this.#shown = undefined; this.#phase.value = "idle"; }
    });
  }

  #schedule(ms: number): void {
    const revision = this.#revision;
    this.#timer = setTimeout(() => {
      if (!this.#disposed && revision === this.#revision) this.#update(this.#work, this.#policy);
    }, ms);
  }
  #cancel(): void { this.#revision++; clearTimeout(this.#timer); this.#timer = undefined; }
  /** Stops timers/subscriptions; never cancels or completes the borrowed operation. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true; this.#cancel(); this.#stop(); this.#phase.value = "idle";
  }
}
