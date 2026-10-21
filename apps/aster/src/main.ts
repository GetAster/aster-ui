import { DataContext, keyText, type KeyText } from "@getaster/data";
import { setClock } from "@getaster/elements";
import { connectMockWorker, type ChangeEvent, type MockClient } from "@getaster/mock";
import { createClock, SEED_NOW } from "./clock.ts";
import type { WorkerOptions } from "./mock-worker.ts";
import { createModel } from "./model.ts";
import { AsterDemo } from "./app.ts";
import { remoteClient } from "./remote.ts";
import { applyTheme, storedTheme } from "./themes.ts";

// `?time=<n>` sets how many time entries to seed; `?now=<ISO time>` freezes the clock; `?memory` keeps data in memory only;
// `?debug` shows the simulation panel; `?identity=harbour` (or another theme) overrides the chosen theme;
// `?server=<service root>` uses a live OData service (aster-server: `bun scripts/demo-server.ts`) instead of the mock.
const params = new URLSearchParams(location.search);
applyTheme(params.get("identity") ?? storedTheme());
const clock = createClock(params.get("now") ?? SEED_NOW, params.has("now"));
setClock(clock.now);
// `?time=<n>` seeds n time entries instead of 100,000 (tests that don't need the volume).
const timeCount = Number(params.get("time") ?? 100_000);
// With `?debug`, a page can supply its own `$metadata` first (tests change
// titles, lengths and allowed values to show the form follows them).
const override = params.has("debug") ? (globalThis as { asterMetadata?: object }).asterMetadata : undefined;
const server = params.get("server");
const mock: MockClient = server ? remoteClient(server) : await startMock();

/** The mock, in a worker (built beside the page as mock-worker.js). */
async function startMock(): Promise<MockClient> {
  const worker = new Worker(new URL("mock-worker.js", document.baseURI), { type: "module" });
  const ready = new Promise((resolve) => worker.addEventListener("message", resolve, { once: true }));
  const options: WorkerOptions = {
    ...(override ? { metadata: override } : {}),
    timeCount,
    // `?clients=<n>` seeds n clients instead of 100,000.
    clientCount: Number(params.get("clients") ?? 100_000),
    start: params.get("now") ?? SEED_NOW,
    frozen: params.has("now"),
    memory: params.has("memory"),
    wasm: new URL("odata_mock.wasm", document.baseURI).href,
    // `?estimate=<factor>` makes counts estimates, as a database's would be.
    ...(params.has("estimate") ? { countEstimate: Number(params.get("estimate")) } : {}),
  };
  worker.postMessage({ options });
  await ready;
  return connectMockWorker(worker);
}

const ctx = await DataContext.connect(mock.transport, { now: clock.now });
const model = createModel(ctx, clock);

// Stands in for the realtime channel: another user's write reaches the store.
mock.onChange((change: ChangeEvent) => {
  if (change.external) void ctx.reload(change.set, keyOf(change.key), "external");
});

// With `?debug`, tests and the console can reach the data layer.
if (params.has("debug")) Object.assign(globalThis, { aster: { ctx, mock, scope: model.scope } });

const app = new AsterDemo();
app.setup({ ctx, mock, clock, model, debug: params.has("debug") });
document.body.prepend(app);

/** The mock's key predicate (`4`, `'abc'`) as a store key; the demo's keys are single integers or strings. */
function keyOf(predicate: string): KeyText {
  const text = /^'(.*)'$/.exec(predicate);
  return keyText([text ? text[1]!.replaceAll("''", "'") : Number(predicate)]);
}
