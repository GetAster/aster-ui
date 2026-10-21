import { signal, type ReadonlySignal } from "@preact/signals-core";

/** The seed's world is set on Wednesday 7 October 2026, a little after 15:15. */
export const SEED_NOW = "2026-10-07T15:15:00Z";

export interface Clock {
  now(): number;
  /** Changes every 15 seconds, so relative times re-render. */
  readonly tick: ReadonlySignal<number>;
}

/**
 * Starts at `start` and runs in real time, or stays at `start` when
 * `frozen`, which keeps screenshots and tests stable.
 */
export function createClock(start: string, frozen: boolean): Clock {
  const origin = Date.parse(start);
  const began = Date.now();
  const now = () => (frozen ? origin : origin + (Date.now() - began));
  const tick = signal(now());
  if (!frozen) setInterval(() => (tick.value = now()), 15_000);
  return { now, tick };
}
