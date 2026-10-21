import type { ODataRequest, ODataResponse, Transport } from "@getaster/data";
import type { ChangeEvent, Faults, MockService } from "./service.ts";
import type { Dump } from "./storage.ts";

/**
 * A mock as the page sees it, wherever it runs. Running in a worker keeps
 * the engine's work (a sort over every row, per request) off the main
 * thread, as a real server's would be; then `dump` answers asynchronously.
 */
export interface MockClient {
  readonly transport: Transport;
  readonly faults: Faults;
  external(request: ODataRequest): Promise<ODataResponse>;
  onChange(listener: (change: ChangeEvent) => void): () => void;
  dump(): Dump | Promise<Dump>;
  reset(): Promise<void>;
  flush(): Promise<void>;
}

type Call =
  | { readonly op: "transport" | "external"; readonly request: ODataRequest }
  | { readonly op: "dump" | "reset" | "flush" }
  | { readonly op: "fault"; readonly latencyMs: number; readonly writeLatencyMs: number; readonly failNext?: { status: number; error?: { code: string; message: string } } };

type Message = { readonly id: number; readonly call: Call };
type Reply = { readonly id: number; readonly result?: unknown; readonly error?: string } | { readonly change: ChangeEvent };

interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
}

/** Inside the worker: answers the page's calls with `mock`, and tells it of every change. */
export function exposeMock(mock: MockService, port: Port): void {
  mock.onChange((change) => port.postMessage({ change } satisfies Reply));
  port.addEventListener("message", async (e: MessageEvent<Message>) => {
    const { id, call } = e.data;
    try {
      let result: unknown;
      switch (call.op) {
        case "transport":
          result = await mock.transport(call.request);
          break;
        case "external":
          result = await mock.external(call.request);
          break;
        case "dump":
          result = mock.dump();
          break;
        case "reset":
          result = await mock.reset();
          break;
        case "flush":
          result = await mock.flush();
          break;
        case "fault":
          mock.faults.latencyMs = call.latencyMs;
          mock.faults.writeLatencyMs = call.writeLatencyMs;
          if (call.failNext) mock.faults.failNext(call.failNext.status, call.failNext.error);
          break;
      }
      port.postMessage({ id, result } satisfies Reply);
    } catch (err) {
      port.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies Reply);
    }
  });
}

/**
 * On the page: a mock running in `worker`, which calls `exposeMock`. Faults
 * set here reach the worker before the next call.
 */
export function connectMockWorker(worker: Port): MockClient {
  let next = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(change: ChangeEvent) => void>();
  worker.addEventListener("message", (e: MessageEvent<Reply>) => {
    const reply = e.data;
    if ("change" in reply) {
      for (const listener of [...listeners]) listener(reply.change);
      return;
    }
    const w = waiting.get(reply.id);
    waiting.delete(reply.id);
    if (reply.error !== undefined) w?.reject(new Error(reply.error));
    else w?.resolve(reply.result);
  });
  const call = <T>(c: Call): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, call: c } satisfies Message);
    });
  const state = { latencyMs: 0, writeLatencyMs: 0 };
  const sendFaults = (failNext?: { status: number; error?: { code: string; message: string } }) =>
    void call({ op: "fault", ...state, ...(failNext ? { failNext } : {}) });
  const faults: Faults = {
    get latencyMs() {
      return state.latencyMs;
    },
    set latencyMs(v: number) {
      state.latencyMs = v;
      sendFaults();
    },
    get writeLatencyMs() {
      return state.writeLatencyMs;
    },
    set writeLatencyMs(v: number) {
      state.writeLatencyMs = v;
      sendFaults();
    },
    failNext(status, error) {
      sendFaults({ status, ...(error ? { error } : {}) });
    },
  };
  return {
    transport: (request) => call<ODataResponse>({ op: "transport", request }),
    external: (request) => call<ODataResponse>({ op: "external", request }),
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    faults,
    dump: () => call<Dump>({ op: "dump" }),
    reset: () => call<void>({ op: "reset" }),
    flush: () => call<void>({ op: "flush" }),
  };
}
