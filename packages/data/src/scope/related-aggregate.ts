import { computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { DataContext } from "../context.ts";
import type { Criteria } from "../criteria/ast.ts";
import type { Entity, Navigation, Value } from "../schema/model.ts";

/** An aggregate over the whole related set, including rows the client hasn't loaded. */
export function relatedAggregate(ctx: DataContext, parent: ReadonlySignal<unknown>, nav: Navigation, method: "min" | "max" | "average", field: string) {
  const result = signal<Value | undefined>(undefined);
  const error = signal<unknown>(undefined);
  let generation = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const filter = computed<Criteria | null | undefined>(() => {
    const record = parent.value as Entity | null | undefined;
    if (record === undefined) return undefined;
    if (record === null || nav.keys.some(([mine]) => record[mine] === null || record[mine] === undefined)) return null;
    const parts: Criteria[] = nav.keys.map(([mine, theirs]) => ({ op: "eq", field: theirs, value: record[mine]! }));
    return parts.length === 1 ? parts[0]! : { op: "and", args: parts };
  });
  const refresh = async () => {
    const ticket = ++generation;
    const where = filter.peek();
    result.value = undefined;
    error.value = undefined;
    if (where === undefined || where === null) {
      result.value = where;
      return;
    }
    try {
      const rows = await ctx.source.aggregate(nav.target, { filter: where, aggregates: [{ field, method, as: "result" }] });
      if (!disposed && ticket === generation) result.value = rows[0]?.result ?? null;
    } catch (e) {
      if (!disposed && ticket === generation) error.value = e;
    }
  };
  let last: string | undefined;
  const stop = effect(() => {
    // Key-equivalent parent edits don't change the query.
    const key = JSON.stringify(filter.value);
    untracked(() => {
      if (key !== last) {
        last = key;
        void refresh();
      }
    });
  });
  const unsubscribe = ctx.store.subscribe((change) => {
    if (change.set !== nav.target || change.origin.kind === "fetch") return;
    ++generation;
    result.value = undefined;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 50);
  });
  return {
    value: result as ReadonlySignal<Value | undefined>,
    error: error as ReadonlySignal<unknown>,
    dispose: () => {
      disposed = true;
      ++generation;
      clearTimeout(timer);
      stop();
      unsubscribe();
    },
  };
}
