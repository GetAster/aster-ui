import type { ODataRequest, ODataResponse, Transport } from "@getaster/data";
import { instantiate, loadWasmBytes, type WasmSource } from "./engine.ts";
import type { Dump, MockStorage } from "./storage.ts";

export interface ChangeEvent {
  set: string;
  /** The key predicate text: `4`, `'abc'`, `a=1,b='x'`. */
  key: string;
  kind: "create" | "update" | "delete";
  /** True for writes made through `external`. */
  external: boolean;
}

export interface MockServiceOptions {
  metadata: object;
  data: Record<string, unknown[]>;
  serviceRoot?: string;
  maxPageSize?: number;
  /** The engine's clock: server-set time stamps (`createdAt`, `updatedAt`) and `now()` in queries. */
  now?: () => string;
  wasm?: WasmSource;
  storage?: MockStorage;
  /** How long a save waits for more writes to share it; 200 ms by default. */
  saveDelayMs?: number;
  /**
   * Counts become estimates, as a database planner's would: the exact count
   * times this factor, rounded up, marked `@AsterData.CountEstimated`. A
   * set's `AsterData.CountThreshold` then makes its count exact below the
   * threshold and leaves it out at or above it, as aster-server does.
   * `Prefer: aster.count=exact` still gets the exact count.
   */
  countEstimate?: number;
}

export interface Faults {
  latencyMs: number;
  /** Added to POST, PATCH, PUT and DELETE on `transport`, after `latencyMs`. */
  writeLatencyMs: number;
  /** Fails the next request on `transport` with this status and error. */
  failNext(status: number, error?: { code: string; message: string }): void;
}

export interface MockService {
  transport: Transport;
  faults: Faults;
  /** A write from another user: skips faults, and adds `If-Match: *` when a PATCH, PUT or DELETE has no If-Match. */
  external(request: ODataRequest): Promise<ODataResponse>;
  onChange(listener: (change: ChangeEvent) => void): () => void;
  dump(): Dump;
  /** Back to the original seed, discarding stored state. */
  reset(): Promise<void>;
  /** Resolves once every write so far is in storage. */
  flush(): Promise<void>;
}

const DEFAULT_WASM = new URL("../wasm/odata_mock.wasm", import.meta.url);

/** What `mock_handle` answers: the response, and the entities the request changed. */
interface Handled extends ODataResponse {
  changes?: { set: string; key: string; kind: ChangeEvent["kind"] }[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function createMockService(options: MockServiceOptions): Promise<MockService> {
  const now = options.now ?? (() => new Date().toISOString());
  const engine = await instantiate(await loadWasmBytes(options.wasm ?? DEFAULT_WASM), () => Date.parse(now()));
  const { storage } = options;

  const init = (from: { data: Record<string, unknown[]> }) =>
    engine.init({
      serviceRoot: options.serviceRoot,
      metadata: options.metadata,
      maxPageSize: options.maxPageSize,
      countEstimate: options.countEstimate,
      data: from.data,
    });

  init((await storage?.load()) ?? { data: options.data });

  // Storage holds the whole dataset, so writes close together share one
  // save, and a save supersedes a failed one before it: each runs once the
  // last has settled, and `saving` (what `flush()` returns) is the latest.
  // It's marked handled, as nothing may ever wait for it.
  let saving: Promise<void> = Promise.resolve();
  let queued = false;
  const persist = () => {
    if (!storage || queued) return;
    queued = true;
    saving = saving
      .catch(() => {})
      .then(async () => {
        await sleep(options.saveDelayMs ?? 200);
        queued = false;
        await storage.save(engine.dump() as Dump);
      });
    saving.catch(() => {});
  };
  if (storage && typeof addEventListener === "function") {
    addEventListener("pagehide", () => storage.save(engine.dump() as Dump).catch((e: unknown) => console.error(e)));
  }

  const listeners = new Set<(change: ChangeEvent) => void>();
  const failures: { status: number; error: { code: string; message: string } }[] = [];

  async function send(request: ODataRequest, external: boolean): Promise<ODataResponse> {
    const { changes, ...response } = engine.handle({
      method: request.method,
      url: request.url,
      headers: request.headers ?? {},
      body: request.body,
    }) as Handled;
    if (changes?.length) {
      persist();
      for (const c of changes) {
        const change: ChangeEvent = { set: c.set, key: c.key, kind: c.kind, external };
        for (const listener of [...listeners]) {
          try {
            listener(change);
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    return response;
  }

  const faults: Faults = {
    latencyMs: 0,
    writeLatencyMs: 0,
    failNext(status, error) {
      failures.push({ status, error: error ?? { code: "MockFault", message: "Injected failure." } });
    },
  };

  return {
    faults,
    async transport(request) {
      const delay = faults.latencyMs + (request.method === "GET" ? 0 : faults.writeLatencyMs);
      if (delay > 0) await sleep(delay);
      const failure = failures.shift();
      if (failure) {
        return {
          status: failure.status,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: failure.error }),
        };
      }
      return send(request, false);
    },
    async external(request) {
      const needsMatch = request.method !== "GET" && request.method !== "POST";
      const has = Object.keys(request.headers ?? {}).some((h) => h.toLowerCase() === "if-match");
      const headers = needsMatch && !has ? { ...request.headers, "If-Match": "*" } : request.headers;
      return send(headers ? { ...request, headers } : request, true);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dump: () => engine.dump() as Dump,
    async reset() {
      init({ data: options.data });
      persist();
      await saving;
    },
    flush: () => saving,
  };
}
