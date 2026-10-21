// The demo's OData service, in a worker: the engine's work stays off the
// page's main thread, as a real server's would. The page sends the options
// first; the worker answers `ready`, then serves requests (`exposeMock`).
import { createMockService, exposeMock, indexedDbStorage } from "@getaster/mock";
import metadata from "../../../../fixtures/aster/metadata.json";
import { demoData } from "../../../../fixtures/aster/demo.ts";
import { createClock, SEED_NOW } from "./clock.ts";

export interface WorkerOptions {
  readonly metadata?: object;
  readonly timeCount: number;
  readonly clientCount: number;
  readonly start: string;
  readonly frozen: boolean;
  readonly memory: boolean;
  readonly wasm: string;
  /** Counts become the server's estimates, this many times the real count (`MockServiceOptions.countEstimate`). */
  readonly countEstimate?: number;
}

addEventListener(
  "message",
  async (e: MessageEvent<{ options: WorkerOptions }>) => {
    const o = e.data.options;
    const clock = createClock(o.start, o.frozen);
    const mock = await createMockService({
      metadata: o.metadata ?? metadata,
      data: demoData({ clientCount: o.clientCount, timeCount: o.timeCount, today: SEED_NOW.slice(0, 10) }),
      wasm: new URL(o.wasm),
      ...(o.countEstimate ? { countEstimate: o.countEstimate } : {}),
      now: () => new Date(clock.now()).toISOString(),
      // The name changes when the seed's shape does, so stored data never lacks a set.
      ...(o.memory ? {} : { storage: indexedDbStorage("aster-demo-4") }),
    });
    exposeMock(mock, self as unknown as Parameters<typeof exposeMock>[1]);
    postMessage({ ready: true });
  },
  { once: true },
);
