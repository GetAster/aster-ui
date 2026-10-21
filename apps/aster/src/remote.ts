import { fetchTransport, type ODataRequest } from "@getaster/data";
import type { ChangeEvent, MockClient } from "@getaster/mock";

/**
 * The demo over a live OData service (`?server=<service root>`), in the
 * mock's shape so the app needn't tell them apart. Requests go by `fetch`.
 * There is no realtime channel: only writes made through `external` (the
 * debug panel's "another user") are announced. Faults do nothing, `reset`
 * calls aster-server's `Reseed` action (`service.reseed_action`), and there
 * is no dump.
 */
export function remoteClient(serviceRoot: string): MockClient {
  const transport = fetchTransport(serviceRoot.replace(/\/$/, ""));
  const listeners = new Set<(change: ChangeEvent) => void>();
  return {
    transport,
    faults: { latencyMs: 0, writeLatencyMs: 0, failNext: () => {} },
    async external(request) {
      const needsMatch = request.method !== "GET" && request.method !== "POST" && !hasHeader(request, "if-match");
      const res = await transport(needsMatch ? { ...request, headers: { ...request.headers, "if-match": "*" } } : request);
      const change = res.status < 300 ? changeOf(request) : undefined;
      if (change) for (const l of [...listeners]) l(change);
      return res;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dump() {
      throw new Error("a live server has no dump");
    },
    async reset() {
      const res = await transport({ method: "POST", url: "Reseed" });
      if (res.status >= 300) throw new Error(`Reseed answered ${res.status}: ${res.body}`);
    },
    flush: async () => {},
  };
}

function hasHeader(request: ODataRequest, name: string): boolean {
  return Object.keys(request.headers ?? {}).some((k) => k.toLowerCase() === name);
}

/** The entity an update or delete by key names: `Projects(4)` is set `Projects`, key `4`. */
function changeOf(request: ODataRequest): ChangeEvent | undefined {
  const kind = request.method === "DELETE" ? "delete" : request.method === "PATCH" || request.method === "PUT" ? "update" : undefined;
  const m = /^([^/(?]+)\((.*)\)$/.exec(decodeURIComponent(request.url.split("?")[0] ?? ""));
  return kind && m ? { set: m[1]!, key: m[2]!, kind, external: true } : undefined;
}
