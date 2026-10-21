# The mock service

`@getaster/mock` is an OData 4.01 service that runs inside the page or the test
process. It is aster-odata's own engine, compiled to WebAssembly
(`wasm32-wasip1`, about 4 MB), so it answers as the real server does: the same
`$filter`, `$orderby`, `$apply` and paging, ETags and `If-Match`, validation
errors with their details, deep insert and deep update through owned
navigations, and `$batch`. Nothing on the wire is reimplemented in TypeScript.
The data core talks to it through a [[type:Transport]] that calls the engine
directly, so a [[class:DataContext]] over the mock behaves like one over a
network, without a server to start.

Use it for tests, demos and development against a `$metadata` and a seed you
control. A set of faults (latency, a failure on the next request) and
[[method:MockService.external]] (a write from another user) make the awkward
cases easy to produce. Tests in this repository run against it, and the demo
runs it in a worker with its data kept in IndexedDB.

What goes in: a CSDL JSON `$metadata` document and a seed, an object with each
entity set's name and an array of records in their JSON form. What comes out is
a [[object:MockService]] with a `transport`, the fault controls and the change
notifications.

### A worked example

```ts
import { DataContext, keyText } from "@getaster/data";
import { createMockService } from "@getaster/mock";

const mock = await createMockService({
  metadata,                                  // the service's $metadata, as parsed JSON
  data: { People: [{ id: 1, name: "Ada", email: "ada@example.com", hue: 45 }] },
  now: () => "2026-10-15T09:00:00Z",         // server-set time stamps and now() in queries
});
const ctx = await DataContext.connect(mock.transport);

const changes: string[] = [];
mock.onChange((c) => changes.push(`${c.kind} ${c.set}(${c.key})${c.external ? " by someone else" : ""}`));

await ctx.reload("People", keyText([1]));                                     // an update needs the record in the store
await ctx.update("People", keyText([1]), { hue: 50 });                       // "update People(1)"
await mock.external({ method: "PATCH", url: "People(1)", body: JSON.stringify({ hue: 60 }) });
                                                                              // "update People(1) by someone else"
mock.faults.failNext(503, { code: "Unavailable", message: "Try later." });
await ctx.update("People", keyText([1]), { hue: 70 }).catch((e) => e.status);  // 503, once
mock.dump().data.People;                                                     // the current records
await mock.reset();                                                           // back to the seed
```

## Limits

- It is a single process with all of the data in memory. Every request walks
  the engine, so a sort over a large set costs what it costs the engine: run it
  in a worker ([[staticMethod:exposeMock]]) to keep it off the page's main
  thread.
- The service has no users, roles or authorization: every request is the same caller.
- Faults apply to `transport` only. [[method:MockService.external]] is not
  delayed and is not failed.
- `reset()` doesn't tell anyone. No [[class:Collection]] is refreshed and no
  [[method:MockService.onChange]] listener is called; reload what's on screen.
- A stored dump replaces the seed as a whole. If the seed or the metadata
  changes, stored data keeps the old shape until `reset()` or until the storage
  name changes, as the demo does when its seed changes.
- Requests are relative to the service root without a leading slash
  (`Projects(1)`, `$metadata`), as for any [[type:Transport]]; an absolute URL is
  answered 404.
- The WebAssembly file is `packages/mock/wasm/odata_mock.wasm`. Rebuilding it is
  `packages/mock/scripts/build-wasm.ts`, which runs a build launcher at a fixed
  path on the author's machine; adjust it for another.

## staticMethod:createMockService

- `options`: [[object:MockServiceOptions]]. `metadata` and `data` are required.

Resolves to a [[object:MockService]] once the engine is instantiated and loaded
with data: the stored dump if `storage` has one, else `options.data`. Rejects with:

- an `Error` from reading the WebAssembly file: `Couldn't load <url>: <status>`
  for a failed fetch, or the file system's error (`ENOENT`) for a missing file;
- an `Error` `mock: <reason>` when the engine refuses the `metadata` or a record
  of the data (`mock: metadata has no $EntityContainer`, `mock: data.People[0]:
  id: must be a whole number`);
- whatever `storage.load()` rejects with.

The engine's clock is `options.now`, so a frozen clock freezes the time stamps it
sets and `now()` in a query. Side effects: when `storage` is given and the page
has `addEventListener`, a `pagehide` listener saves the dump.

```ts
const mock = await createMockService({ metadata, data: seed, now: () => "2026-10-15T09:00:00Z", maxPageSize: 50 });
const r = await mock.transport({ method: "GET", url: "Projects?$top=2&$count=true&$orderby=id", headers: {} });
r.status;                      // 200
JSON.parse(r.body)["@odata.count"];
```

## object:MockServiceOptions

The options of [[staticMethod:createMockService]]. `metadata` and `data` are
required.

## attr:MockServiceOptions.metadata

The service's `$metadata` as a parsed CSDL JSON object, not text. The same
document [[staticMethod:parseCsdl]] reads. The engine rejects a document it
can't use at creation.

## attr:MockServiceOptions.data

The seed: an object from entity set name to an array of records, each in the JSON
form the service sends (`Decimal` as a string, timestamps with an offset).
Server-set values (keys from a sequence, time stamps, ETags) are produced by the
engine where the seed omits them. [[method:MockService.reset]] returns to this
object. A set missing from it starts empty.

## attr:MockServiceOptions.serviceRoot

The URL the service claims to be at, in `@odata.context`, `Location` and next
links. `http://localhost/odata/` by default. Requests to the transport are
relative to it and don't use it.

## attr:MockServiceOptions.maxPageSize

The most records the service returns in one response. Beyond it a response has
`@odata.nextLink`, which the client follows until it has the `$top` it asked for.
Left out, the engine's own default applies. Set it to make a test of paging
cheap.

## attr:MockServiceOptions.now

`() => string`: the engine's clock as an RFC 3339 timestamp
(`"2026-10-15T09:00:00Z"`). It gives the server-set time stamps (`createdAt`,
`updatedAt`) and `now()` in queries. Default is the real time at each call. Give
the same clock to [[attr:DataContext.now]] if relative dates are to agree with
the server's.

## attr:MockServiceOptions.wasm

Where the engine is: a `BufferSource` with the bytes, a `URL`, or a string (a
URL, resolved against the package's module). By default the file next to the
package, `wasm/odata_mock.wasm`. A `file:` URL is read from disk under Bun;
anything else is fetched, so a page must serve the file and a non-200 answer
rejects the creation.

## attr:MockServiceOptions.storage

A [[object:MockStorage]] to keep the data in. At creation its dump replaces
`data` if it has one. After writes it is saved to, once for a burst
([[attr:MockServiceOptions.saveDelayMs]]), and on `pagehide`. Without it the data
lives only as long as the service. [[staticMethod:indexedDbStorage]] is one for
browsers.

## attr:MockServiceOptions.saveDelayMs

How long, in milliseconds, a save waits for more writes to share it. 200 by
default. Storage holds the whole dataset, so writes close together make one save.
A write doesn't wait for the save; [[method:MockService.flush]] does.

## attr:MockServiceOptions.countEstimate

A factor that makes counts estimates, as a database planner's would be: the exact
count times the factor, rounded up, marked `@AsterData.CountEstimated`. With
`200` projects and `1.5`, the first answer says 300 and a collection has
[[attr:Collection.estimated]] true and [[attr:Collection.counted]] false. A set's
[[attr:EntitySet.countThreshold]] then makes its count exact below the threshold
and leaves it out at or above it, as aster-server does. A request with
`Prefer: aster.count=exact` ([[attr:CollectionOptions.exactCount]]) still gets the
exact count. Absent, counts are exact.

## object:MockService

What [[staticMethod:createMockService]] resolves to: the transport, the faults,
and controls for another user's writes, notifications, and the stored data. In a
worker, the page sees it as a [[object:MockClient]].

## attr:MockService.transport

The [[type:Transport]] for a [[class:DataContext]] or [[class:ODataSource]]. For
each request it waits [[attr:Faults.latencyMs]] (plus
[[attr:Faults.writeLatencyMs]] for anything but `GET`), then answers the next
queued failure if there is one, else the engine's answer. It resolves with every
status, including errors; it rejects only if the engine itself fails, with an
`Error` `mock: <reason>`. A successful write notifies the
[[method:MockService.onChange]] listeners before it resolves.

## attr:MockService.faults

The [[object:Faults]] to inject on `transport`. Plain object; set its properties
at any time, and they apply from the next request.

## method:MockService.external

- `request`: an [[object:ODataRequest]].

Makes a write as another user would: it skips the faults and the latency, and
a `PATCH`, `PUT` or `DELETE` with no `If-Match` header (in any case) gets
`If-Match: *`, so it doesn't need the record's ETag. `GET` and `POST` are sent as
they are. Resolves to the [[object:ODataResponse]], with errors as statuses, not
rejections. The listeners are called with `external: true`. The record's ETag
changes, so a save by the client afterwards is answered 412. The client doesn't
see the change until the app reloads the record
([[method:DataContext.reload]] with origin `"external"`), which is what an
`onChange` listener is for.

```ts
mock.onChange((c) => c.external && ctx.reload(c.set, keyText([Number(c.key)]), "external"));
await mock.external({ method: "PATCH", url: "Projects(3)", body: JSON.stringify({ name: "Billing v3" }) });
```

## method:MockService.onChange

- `listener`: `(change: ChangeEvent) => void`, called once for each entity a
  successful write created, updated or deleted, after the request is applied.
  One request can produce several, such as a deep update or a batch. A failed write
  produces none.

Returns a function that removes the listener. A listener that throws is logged
with `console.error` and doesn't stop the others or the request. The event is for
the app to refresh on, so it describes the change and carries no record.

```ts
const off = mock.onChange((c) => console.log(c.kind, c.set, c.key, c.external));
off();
```

## method:MockService.dump

Returns the current data as a [[object:Dump]], read at once from the engine:
every entity set, every record. The result is a copy; changing it changes
nothing. For a [[object:MockClient]] in a worker it returns a promise.

```ts
mock.dump().data.Projects!.length;   // 200, after a seed of 200 and no creates or deletes
```

## method:MockService.reset

Reloads the engine with `options.data`, discarding every write and any stored
state, and, with `storage`, saves the seed in its place. Resolves when that save is
done. ETags return to the seed's. It doesn't call the `onChange` listeners and no
collection hears of it, so refresh what's shown. Rejects if the save fails.

## method:MockService.flush

Resolves once every write so far is in storage, so a reload of the page or a
second service over the same storage sees it. Resolves at once without
`storage`. Rejects if the latest save failed; the next write saves again, and a
save that succeeds holds everything before it.

```ts
await ctx.update("People", keyText([1]), { hue: 70 });
await mock.flush();   // the change is in storage
```

## object:ChangeEvent

What an [[method:MockService.onChange]] listener receives. Plain data.

## attr:ChangeEvent.set

The entity set's name.

## attr:ChangeEvent.key

The record's key as it appears in a URL, a key predicate: `4`, `'abc'`, or
`a=1,b='x'` for a composite key. It isn't a [[type:KeyText]]: convert with
[[staticMethod:keyText]] (for a numeric single key, `keyText([Number(change.key)])`).

## attr:ChangeEvent.kind

`"create"`, `"update"` or `"delete"`.

## attr:ChangeEvent.external

`true` for a write made through [[method:MockService.external]], `false` for one
through `transport`, which the writer's own [[class:DataContext]] already knows.
Reload only external changes, to avoid fetching what you just saved.

## object:Faults

The conditions to inject on [[attr:MockService.transport]]. Plain object.

## attr:Faults.latencyMs

Milliseconds to wait before answering any request on `transport`. 0 by default.
Doesn't apply to [[method:MockService.external]].

## attr:Faults.writeLatencyMs

Milliseconds added, after `latencyMs`, to `POST`, `PATCH`, `PUT` and `DELETE`
on `transport`, so saves are slower than reads. 0 by default.

## method:Faults.failNext

- `status`: the HTTP status to answer.
- `error`: optional `{ code, message }`; `MockFault` and `Injected failure.` by
  default.

Queues one failure: the next request on `transport`, whatever it is, gets that
status and the body `{"error":{"code":…,"message":…}}`, after the latency and
without reaching the engine, so no state changes. Calls queue, each used once, in
order. [[method:MockService.external]] doesn't take them. The client turns the
answer into an [[class:ODataError]]. Returns nothing.

```ts
mock.faults.failNext(500);
mock.faults.failNext(404, { code: "NotFound", message: "Gone." });
// the next request fails with 500; the one after that with 404; then the engine answers again
```

## object:Dump

The mock's data: `{ data }`. Plain, JSON-safe, and what a [[object:MockStorage]]
keeps.

## attr:Dump.data

An object from entity set name to the array of its records, in the JSON form the
service sends.

## object:MockStorage

Where the mock keeps its data between runs. Implement it for a store of your own;
[[staticMethod:indexedDbStorage]] is one. Both methods may reject, and a rejection
of `save` rejects [[method:MockService.flush]].

## method:MockStorage.load

Resolves to the stored [[object:Dump]], or `undefined` when nothing is stored, in
which case the seed is used. Called once, by [[staticMethod:createMockService]].

## method:MockStorage.save

- `dump`: the [[object:Dump]] to keep, replacing the previous one.

Resolves when it is stored. Called after writes (once for a burst) and on
`pagehide`, and by [[method:MockService.reset]]. A rejection fails that save
only: [[method:MockService.flush]] and `reset` reject until a later save
succeeds, and the next write saves the whole dataset again. A rejection on
`pagehide` is logged to the console.

## staticMethod:indexedDbStorage

- `name`: the IndexedDB database's name.

Returns a [[object:MockStorage]] that keeps the dump in one record of a database of
that name, opening and closing it on each call. Only in a browser (or anything with
`indexedDB`); in other places `load` rejects with a `ReferenceError`. Use a new name
when the seed or the metadata changes shape, because a stored dump replaces the seed.

```ts
const mock = await createMockService({ metadata, data, storage: indexedDbStorage("my-app-mock-1") });
```

## object:MockClient

A mock as the page sees it, wherever it runs. It has the members of
[[object:MockService]] except that `dump` may be asynchronous, and that nothing
about the engine is local. Make one with [[staticMethod:connectMockWorker]]. In a
worker the engine's work stays off the main thread, as a real server's does.

## attr:MockClient.transport

A [[type:Transport]] that sends each request to the worker and resolves with its
answer. The worker applies the faults. Rejects with an `Error` carrying the
worker's message if the worker's call throws.

## attr:MockClient.faults

The [[object:Faults]] for the worker's mock. Setting `latencyMs` or
`writeLatencyMs`, or calling `failNext`, posts a message to the worker, and
messages arrive in order, so a fault set before a request reaches the worker
before it. Reading `latencyMs` returns what this side last set.

## method:MockClient.external

- `request`: an [[object:ODataRequest]].

As [[method:MockService.external]], run in the worker. Resolves to the response.

## method:MockClient.onChange

- `listener`: called with each [[object:ChangeEvent]] the worker's mock reports.

Returns a function that removes the listener. Changes are sent as they happen,
whoever made the write.

## method:MockClient.dump

Resolves to the worker's [[object:Dump]]. A copy is posted across, so it is the
data as of the call.

## method:MockClient.reset

As [[method:MockService.reset]], in the worker. Resolves when it is done.

## method:MockClient.flush

As [[method:MockService.flush]], in the worker. Resolves when it is done.

## staticMethod:exposeMock

- `mock`: a [[object:MockService]] made in the worker.
- `port`: where the page's messages arrive: anything with `postMessage` and
  `addEventListener("message", …)`, such as the worker's `self`.

Serves the page's calls with `mock`, answers each with its result or the error's
message, and posts every change. Call it once, after the service is created. It
sends nothing until the page does, and the page can't call before it is set up,
so have the worker tell the page when it is ready. The demo has the page send
the options first, and the worker answer `{ ready: true }`.

```ts
// mock-worker.ts
import { createMockService, exposeMock } from "@getaster/mock";

const mock = await createMockService({ metadata, data });
exposeMock(mock, self as unknown as Parameters<typeof exposeMock>[1]);
postMessage({ ready: true });
```

## staticMethod:connectMockWorker

- `worker`: the `Worker` (or any port with `postMessage` and
  `addEventListener("message", …)`) running [[staticMethod:exposeMock]].

Returns a [[object:MockClient]]. Wait for the worker's ready message before the
first call.

```ts
import { DataContext } from "@getaster/data";
import { connectMockWorker } from "@getaster/mock";

const worker = new Worker(new URL("./mock-worker.js", document.baseURI), { type: "module" });
await new Promise<void>((resolve) => worker.addEventListener("message", () => resolve(), { once: true }));
const mock = connectMockWorker(worker);
const ctx = await DataContext.connect(mock.transport);
```
