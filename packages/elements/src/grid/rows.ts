import type { KeyText } from "@getaster/data";

/**
 * Row offsets for a virtualized list whose rows have different heights.
 * Heights are measured by key, so a measured row keeps its height when
 * rows move; rows not measured yet (or not loaded) count as `estimate`.
 *
 * Offsets are prefix sums, rebuilt lazily after a change: O(rows) once per
 * change, O(log rows) per lookup.
 */
export class RowHeights {
  estimate: number;
  readonly #measured = new Map<KeyText, number>();
  #keys: readonly (KeyText | undefined)[] = [];
  #prefix: Float64Array = new Float64Array(1);
  #dirty = true;

  constructor(estimate: number) {
    this.estimate = estimate;
  }

  /** The rows, in order; `undefined` where a row isn't loaded. */
  setKeys(keys: readonly (KeyText | undefined)[]): void {
    this.#keys = keys;
    this.#dirty = true;
  }

  get count(): number {
    return this.#keys.length;
  }

  /** Whether a row's height has been measured. */
  has(key: KeyText): boolean {
    return this.#measured.has(key);
  }

  /** Records a row's height; returns whether it changed. */
  measure(key: KeyText, height: number): boolean {
    if (this.#measured.get(key) === height) return false;
    this.#measured.set(key, height);
    this.#dirty = true;
    return true;
  }

  height(index: number): number {
    const key = this.#keys[index];
    return (key !== undefined ? this.#measured.get(key) : undefined) ?? this.estimate;
  }

  /** The top of row `index`; `offset(count)` is the total height. */
  offset(index: number): number {
    this.#build();
    return this.#prefix[Math.max(0, Math.min(index, this.#keys.length))]!;
  }

  total(): number {
    return this.offset(this.#keys.length);
  }

  /** The row at `y`: the last row whose top is at or above it. */
  indexAt(y: number): number {
    this.#build();
    const n = this.#keys.length;
    if (n === 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#prefix[mid]! <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The rows to render for a viewport, with `overscan` pixels either side. */
  window(top: number, height: number, overscan: number): { start: number; end: number } {
    if (this.#keys.length === 0) return { start: 0, end: 0 };
    const start = this.indexAt(Math.max(0, top - overscan));
    const end = Math.min(this.#keys.length, this.indexAt(top + height + overscan) + 1);
    return { start, end };
  }

  #build(): void {
    if (!this.#dirty) return;
    const n = this.#keys.length;
    if (this.#prefix.length !== n + 1) this.#prefix = new Float64Array(n + 1);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      this.#prefix[i] = sum;
      sum += this.height(i);
    }
    this.#prefix[n] = sum;
    this.#dirty = false;
  }
}
