/** An explicit owner; borrowed resources are never registered here. */
export class Lifetime {
  readonly #abort = new AbortController();
  readonly #cleanups: (() => void)[] = [];
  get signal(): AbortSignal { return this.#abort.signal; }
  get disposed(): boolean { return this.signal.aborted; }

  defer(cleanup: () => void): void {
    if (this.disposed) cleanup();
    else this.#cleanups.push(cleanup);
  }

  own<T extends { dispose(): void }>(resource: T): T {
    this.defer(() => resource.dispose());
    return resource;
  }

  dispose(): void {
    if (this.disposed) return;
    this.#abort.abort();
    const errors: unknown[] = [];
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Resource cleanup failed");
  }
}
