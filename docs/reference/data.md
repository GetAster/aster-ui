# The data core

`@getaster/data` is the part of Aster UI that talks to an OData 4.01 service
and keeps what the client has read consistent. It has no DOM and no
components: elements such as the grid and the form are views over it. This
page covers the context, the transport, the store and the errors. Queries
and filters are in [[group:criteria]], the field model in [[group:schema]],
collections, groups, selections and trees in [[group:collections]], and the
in-process test service in [[group:mock]].

## The pieces

| Piece | What it does |
|---|---|
| [[type:Transport]] | One function: an [[object:ODataRequest]] in, an [[object:ODataResponse]] out. [[staticMethod:fetchTransport]] uses `fetch`; the mock service's transport calls its engine in process. |
| [[class:ODataSource]] | Speaks OData over a transport: reads `$metadata`, queries, aggregates, and single-record reads and writes. Every non-2xx answer becomes an [[class:ODataError]]. |
| [[class:RecordStore]] | The client's only copy of each record, by entity set and key, with its ETag. Each record has its own signal. |
| [[class:Collection]] | A query and the positions of its results. It holds keys, not records, and reads the records from the store. |
| [[class:DataContext]] | The entry point. It owns the source and the store, makes collections and groups, and performs every write, so that every collection hears about it. |

All state is held in [Preact signals](https://github.com/preactjs/signals)
(`@preact/signals-core`). A view that reads a signal inside `effect` or
`computed` follows it; reading `.peek()` doesn't.

## One store, many collections

A record is stored once, under `(set, keyText(key))`. Two collections that
both contain project 3 hold the same key, and both read the same record
signal, so an edit shows in both without either refetching. Keys are
[[type:KeyText]] strings: the key values in key order as JSON, `'[3]'` for a
single integer key. Build them with [[staticMethod:keyText]] rather than by
hand.

Every change to the store is a [[object:StoreChange]] with the record before
and after and an [[type:Origin]]: `fetch` (a read), `save` (a write through
the context) or `external` (someone else's change, which the app reports by
calling [[method:DataContext.reload]] with origin `"external"`). The context
passes each change to every live collection, which then does one of three
things:

- The record leaves the collection if it was there and no longer matches the
  filter.
- The record moves or joins at its sort position, if the loaded rows on
  either side prove where that is.
- Otherwise the collection marks itself [[attr:Collection.stale]] and
  refetches the pages it shows. Changes that arrive together share one
  refresh.

A collection ignores the records it fetched itself, since the server put them
where they are. Placement uses the same filter and sort semantics as the
server ([[staticMethod:matches]], [[staticMethod:sortComparator]]), which a
differential test checks against aster-odata's engine.

Writes are pessimistic: the store changes only after the server accepts the
write, and the answer, with its new ETag, is what's stored. There is no
optimistic update and no rollback to manage.

## What the client sends and reads

| On the wire | What the data core does with it |
|---|---|
| `Accept: application/json;odata.metadata=minimal;IEEE754Compatible=true` | Sent on every request, so Int64 and Decimal values arrive as exact strings |
| `$metadata` in CSDL JSON | Read once by [[classMethod:ODataSource.connect]] and parsed by [[staticMethod:parseCsdl]] |
| `$filter`, `$orderby`, `$select`, `$skip`, `$top`, `$count=true` | Built from a [[object:Query]]; `$orderby` always ends with the key properties |
| `@odata.count`, `@odata.nextLink` | The total for a collection; next links are followed until the requested `$top` is reached |
| `@odata.etag`, or the `ETag` header | Kept with the record and sent back as `If-Match` on update and delete |
| `@AsterData.CountEstimated` | Marks the count as an estimate ([[attr:Page.estimated]], [[attr:Collection.estimated]]) |
| `Prefer: aster.count=exact` | Sent when a collection asks for an exact count ([[attr:CollectionOptions.exactCount]]) |
| `@AsterData.Hidden` on a record | The fields the server hides from this caller on this record ([[attr:StoredRecord.hidden]]) |
| `Prefer: return=representation` | Sent on create and update, so the answer is the stored record |
| `<navigation>@delta` | A deep update of owned child collections, in the same PATCH |
| `error` object with `details` | Read into [[class:ODataError]] and its [[object:ErrorDetail]] list |

The `AsterData` terms are aster-odata's vocabulary (`Aster.Data.V1`). A
server that doesn't send them works too: counts are then taken as exact and no
field is hidden.

## A worked example

```ts
import { DataContext, ODataError, fetchTransport, keyText } from "@getaster/data";

const ctx = await DataContext.connect(fetchTransport("https://example.com/odata"));

// A live list of active projects, newest first. Nothing loads until asked.
const active = ctx.collection({
  set: "Projects",
  filter: { op: "eq", field: "state", value: "active" },
  orderBy: [{ field: "updatedAt", descending: true }],
});
await active.ensure(0, 50);
active.count.value;          // the server's total
active.items.value[0]?.name; // the first project, read from the store

// A write through the context reaches every collection.
try {
  const saved = await ctx.update("Projects", keyText([1]), { state: "paused" });
  // Project 1 has left `active`; a loaded "paused" list has gained it.
  await ctx.undo(saved);     // pinned to the version this save produced
} catch (e) {
  if (e instanceof ODataError && e.isConflict) {
    // Someone changed project 1 first. The store already holds their version.
  } else throw e;
}

ctx.release(active);         // stop syncing it
```

## Limits

- There is no change feed. Writes made through this context reach every
  collection; another user's writes reach the store only when the app reads
  the record again ([[method:DataContext.reload]] with origin `"external"`)
  or refreshes. The demo does this from the mock's
  [[method:MockService.onChange]].
- A collection that has loaded only part of its results doesn't react to a
  change to a record outside its loaded rows, unless the change moves the
  record into the loaded range. Its count can then differ from the server's
  until the next [[method:Collection.refresh]].
- Writes are one record per request, apart from a deep update of the
  collections a record owns. The client sends no `$batch`.
- The client doesn't `$expand` navigations. Related records are read with
  their own queries or [[method:DataContext.lookup]].
- Only OData 4.01 JSON is read. Atom, CSDL XML and `odata.metadata=full`
  aren't.

## class:DataContext

Construct one with [[classMethod:DataContext.connect]], or with
`new DataContext(source, { now })` when you already have an
[[class:ODataSource]]. Use one context per service and user: it is the
single place that knows every live collection, so writes made around it (for
example straight through [[class:ODataSource]]) won't reach the views.

```ts
import { DataContext, keyText } from "@getaster/data";
import { createMockService } from "@getaster/mock";

const mock = await createMockService({ metadata, data });
const ctx = await DataContext.connect(mock.transport, { now: () => Date.parse("2026-10-15T09:00:00Z") });

const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });
await people.loadAll();
const saved = await ctx.update("People", keyText([4]), { email: "ada@example.com" });
```

## attr:DataContext.source

The [[class:ODataSource]] the context reads and writes through. Plain, read
only. Use it for requests the context doesn't offer, such as an aggregate
over a set ([[method:ODataSource.aggregate]]); writes made through it
directly bypass the store and every collection.

## attr:DataContext.store

The context's [[class:RecordStore]]. Plain, read only. Read records from it
by key, or subscribe to its changes; write through the context's methods
instead of `store.put`, so the server sees the change first.

```ts
const project = ctx.store.record("Projects", keyText([1]));   // a signal
effect(() => console.log(project.value?.entity.name));
```

## attr:DataContext.now

A plain function returning epoch milliseconds, `Date.now` unless
`connect` or the constructor was given `now`. Every collection and
[[class:Groups]] the context makes resolves [[object:RelativeDate]]s in its
filter against it at each request. A frozen clock makes "today" stable in
tests and demos.

## classMethod:DataContext.connect

Reads `$metadata` through the transport and returns a context over it.

- `transport`: how to reach the service ([[type:Transport]]).
- `options.now`: the clock for relative dates; `Date.now` by default.

Resolves to the new context. Rejects with an [[class:ODataError]] when
`$metadata` doesn't answer 200, and with a [[class:SchemaError]] when the
document isn't CSDL JSON the parser can read. One request is sent.

```ts
const ctx = await DataContext.connect(fetchTransport("https://example.com/odata"));
ctx.schema.set("Projects").type.key;   // ["id"]
```

## attr:DataContext.schema

The parsed [[object:Schema]], the same object as `source.schema`. Plain and
immutable. Read entity sets with [[method:Schema.set]].

## method:DataContext.collection

Makes a [[class:Collection]] and subscribes it to the store. It sends nothing
yet: load it with [[method:Collection.ensure]], [[method:Collection.view]] or
[[method:Collection.loadAll]].

- `query`: a [[object:Query]], or a `ReadonlySignal<Query>` to follow.
- `options`: [[object:CollectionOptions]]. `now` defaults to the context's
  clock.

Given a signal, each new query value that differs from the current one (by
content, not identity) goes through [[method:Collection.setQuery]]: the rows
are dropped at once and, if the collection had loaded, the first page loads
again. The signal must stay on one entity set; a query on another set throws.
Call [[method:DataContext.release]] when the view goes away.

```ts
import { computed, signal } from "@preact/signals-core";

const personId = signal(4);
const leads = ctx.collection(
  computed(() => ({ set: "Projects", filter: { op: "eq", field: "leadId", value: personId.value }, orderBy: [{ field: "name" }] })),
);
await leads.loadAll();
personId.value = 7;   // rows cleared; the first page of person 7's projects loads
```

## method:DataContext.groups

Makes a [[class:Groups]] and sends its first `$apply` request at once.

- `query`: a [[object:Query]] or a signal of one. Its `filter` limits the
  records counted; a sort on `field` sets the groups' direction.
- `field`: the field to group by.
- `aggregates`: [[object:Aggregate]]s computed per group; none by default.

Throws an `Error` when the set has no field `field`. The groups recount after
every save or external change to the set. [[method:DataContext.release]]
doesn't apply to them: call [[method:Groups.dispose]].

```ts
const byHealth = ctx.groups({ set: "Projects" }, "health", [{ field: "budget", method: "sum", as: "budget" }]);
```

## method:DataContext.release

After release the collection keeps the rows it has but no longer moves records
in or out, and no longer follows its query signal. Releasing a collection that
isn't live does nothing.

## method:DataContext.lookup

- `set`: the entity set.
- `key`: the record's [[type:KeyText]].

Returns a computed signal of the record's entity, `undefined` until it's in
the store. A record already in the store sends nothing. For a single-property
key, the keys missing from one set within the same microtask are fetched in
one request, `$filter=<key> in (...)`; a composite key costs one request per
record. The answer goes into the store as a `fetch`. If the request fails, a
later lookup of the same key asks again; a key the server doesn't have stays
`undefined` and isn't asked for again.

```ts
const lead = ctx.lookup("People", keyText([project.leadId as number]));
html`<span>${computed(() => lead.value?.name ?? "")}</span>`;
```

## method:DataContext.create

- `set`: the entity set.
- `values`: the new record's properties.
- `by`: optional; the writer, passed on as the change's `origin.by`, so it can
  recognise and ignore the echo of its own save.

Sends only what the server needs: computed fields, unknown fields, and values
equal to the field's `$DefaultValue` (or `null` when it has none) are left
out ([[staticMethod:creatable]]). Resolves to a [[object:Saved]] once the
server's answer is in the store, so every collection the record belongs to
has it. Rejects with an [[class:ODataError]]: a 400 with
[[method:ODataError.fieldErrors]] for invalid values, a 409
([[attr:ODataError.isDuplicate]]) for a key that's taken.

```ts
const saved = await ctx.create("Projects", { name: "Website refresh", state: "active", leadId: 4, budget: "25000.00" });
saved.key;                  // '[201]': the key the server assigned
saved.record.entity.id;     // 201
```

## method:DataContext.update

- `set`, `key`: the record to change. It must be in the store.
- `changes`: the properties to send, and only those. Leave out computed
  fields yourself ([[staticMethod:writable]]).
- `by`: optional; the writer, as for [[method:DataContext.create]].
- `ifMatch`: optional; an ETag to send instead of the stored record's.
- `deltas`: optional; changes to owned child collections by navigation name,
  sent in the same PATCH as `<navigation>@delta`. Each entry is
  `{ removed: keyValues }`, `{ values }` for an existing child (its key and
  changed properties) or a new one, or `{ values, nested }` for a new child
  with new children of its own.

Resolves to a [[object:Saved]] whose `change` records each sent field's old
and new value. Rejects with an `Error` when the record isn't loaded, and with
an [[class:ODataError]] from the server. On a 412 (someone else saved first)
or a 404 (it was deleted), the record is read again into the store with
origin `external` before the error is rethrown, so open edit models see the
server's version and can offer to rebase.

```ts
const saved = await ctx.update("Projects", keyText([2]), { health: "behind", behindDays: 3 });
saved.change;   // { kind: "update", set: "Projects", key: [2], changes: { health: { from: "on-track", to: "behind" }, … } }
```

## method:DataContext.remove

- `set`, `key`: the record to delete. It must be in the store.
- `by`: optional; the writer.
- `ifMatch`: optional; an ETag to send instead of the stored record's.

Sends `DELETE` with `If-Match`, then removes the record from the store and so
from every collection. Resolves to the `delete` [[type:ChangeSet]], whose
values are the record as it was, without its hidden fields, so undoing it
doesn't write their `null` back. Errors are as for
[[method:DataContext.update]], including the reload on 412 and 404.

```ts
const deleted = await ctx.remove("Notes", keyText([2]));
await ctx.undo(deleted);   // creates it again, without its computed fields
```

## method:DataContext.reload

- `set`, `key`: the record.
- `origin`: `"fetch"` (default), or `"external"` when you're reloading because
  someone else changed it; edit models treat an external change as theirs to
  merge or raise as a conflict.

Resolves to the stored record, or `undefined` after a 404, in which case the
record is removed from the store. Other failures reject with an
[[class:ODataError]] and leave the store alone.

```ts
mock.onChange((c) => {
  if (c.external) void ctx.reload(c.set, keyText([Number(c.key)]), "external");
});
```

## method:DataContext.run

- `change`: a [[type:ChangeSet]].
- `by`: optional; the writer.
- `ifMatch`: optional; pins an update or delete to that ETag.

A `create` runs [[method:DataContext.create]] with its values, an `update`
sends each field's `to` value (computed fields left out), and a `delete`
removes the record. An update's `owned` changes are ignored. Resolves to what
that method resolves to: a [[object:Saved]] for create and update, the delete
[[type:ChangeSet]] for delete. Use it to replay a stored change.

## method:DataContext.undo

- `saved`: the [[object:Saved]] a create or update resolved to, or a
  [[type:ChangeSet]].
- `by`: optional; the writer.

Runs the inverse change. Given a `Saved`, the inverse carries that save's
ETag, so if anyone has changed the record since, the server answers 412 and
nothing is overwritten. Undoing a create needs the `Saved`, which holds the
key the server assigned; given only the create's change set it throws. An
update with `owned` changes can't be undone this way.

```ts
const saved = await ctx.update("Projects", keyText([1]), { state: "paused" });
await ctx.undo(saved);   // state is "active" again, or a 412 if someone saved in between
```

## object:Saved

What [[method:DataContext.create]] and [[method:DataContext.update]] resolve
to. Keep it to undo the save ([[method:DataContext.undo]]) or to log it.

## attr:Saved.key

The record's [[type:KeyText]], including a key the server assigned on create.

## attr:Saved.record

The record as the server returned it and as it is now stored, with its new
ETag.

## attr:Saved.change

A [[type:ChangeSet]]: plain data that survives `JSON.stringify`. A create
holds the values sent; an update holds `{ from, to }` for each field sent.

## type:Method

The HTTP methods the source sends. The data core itself never sends `PUT`; it
is in the type for transports and the mock, which accept it.

## object:ODataRequest

What a [[type:Transport]] receives. Write a transport of your own to add
authentication headers, log traffic or route requests, then delegate:

```ts
const base = fetchTransport("https://example.com/odata");
const withAuth: Transport = (request) =>
  base({ ...request, headers: { ...request.headers, authorization: `Bearer ${token()}` } });
const ctx = await DataContext.connect(withAuth);
```

## attr:ODataRequest.method

One of [[type:Method]].

## attr:ODataRequest.url

A transport prefixes it with the service root and a slash. A next link the
server sends as an absolute URL is cut back to this relative form before it's
sent.

## attr:ODataRequest.headers

The data core sends lower-case names: `accept` always, `content-type` with a
body, `if-match`, and `prefer` (`return=representation`, or
`aster.count=exact`).

## attr:ODataRequest.body

JSON text, present on `POST` and `PATCH`.

## attr:ODataRequest.signal

Optional AbortSignal. FetchTransport honours it during the HTTP request;
Authentication also uses it while waiting for recovery. Custom transports should
honour it. Cancelling a dispatched write does not undo server work.

## object:ODataResponse

What a [[type:Transport]] resolves to. A status of 400 or more makes the
source throw an [[class:ODataError]] built from the body.

## attr:ODataResponse.status

The HTTP status code.

## attr:ODataResponse.headers

The source reads `etag` from here when the body has no `@odata.etag`, and
passes it to an [[class:ODataError]] on failure ([[attr:ODataError.etag]]).

## attr:ODataResponse.body

The response text, JSON for everything the source reads. An error body that
isn't JSON still becomes an [[class:ODataError]], with the status as its code.

## type:Transport

Any function of this shape works: the data core never depends on `fetch`
directly. [[staticMethod:fetchTransport]] is the one for a real server, and
[[attr:MockService.transport]] the one for tests. A transport should resolve
with the response for every HTTP status and reject only when no response
came back (a network failure); a rejection reaches the caller as it is, not
as an [[class:ODataError]].

```ts
// Records every request a test makes.
const sent: string[] = [];
const ctx = await DataContext.connect((r) => {
  sent.push(`${r.method} ${r.url}`);
  return mock.transport(r);
});
```

## staticMethod:fetchTransport

- `serviceRoot`: the service's root URL, such as
  `https://example.com/odata`. Requests go to `<serviceRoot>/<url>`.
- `init`: optional `RequestInit` merged into every request, for options such
  as `credentials: "include"` or `mode`.

Returns a [[type:Transport]]. Response header names are lower-cased. A
network failure rejects with `fetch`'s own error.

`init.headers` and request headers are merged case-insensitively; request values
take precedence. Request and configured abort signals are combined. For changing
credentials and session recovery, wrap the transport with [[class:Authentication]].

```ts
const transport = fetchTransport("https://example.com/odata", { credentials: "include" });
const ctx = await DataContext.connect(transport);
```

## class:ODataError

`message` is the server's error message, which is meant for people. Branch on
`status` and `code`, not on the message.

```ts
try {
  await ctx.update("Projects", keyText([2]), { name: "" });
} catch (e) {
  if (!(e instanceof ODataError)) throw e;
  if (e.isConflict) showConflict(ctx.store.get("Projects", keyText([2])));
  else if (e.status === 400) showFieldErrors(e.fieldErrors());   // { name: ["Project can't be blank."] }
  else showBanner(e.message);
}
```

## attr:ODataError.status

The HTTP status. The ones the data core and its edit models treat specially
are 404 (gone), 409 ([[attr:ODataError.isDuplicate]]), 412
([[attr:ODataError.isConflict]]) and 428 (an update or delete without
`If-Match` on a set that needs one).

## attr:ODataError.code

The service's error code, such as `ServiceUnavailable`. When the body had no
error object, the status as text (`"503"`).

## attr:ODataError.target

The error object's `target`, when the server named what the error is about.
Per-field problems are usually in [[attr:ODataError.details]] instead.

## attr:ODataError.details

The error object's `details`, in order; empty when there were none. See
[[object:ErrorDetail]] and [[method:ODataError.fieldErrors]].

## attr:ODataError.etag

Read from the response's `ETag` header. `undefined` on other statuses and
when the server sent none.

## method:ODataError.fieldErrors

Returns an object from each `target` to its messages, in the order the server
listed them. For a deep update, targets name the child, such as
`answers[2]/label`.

```ts
e.fieldErrors();   // { name: ["Project can't be blank."], "answers[2]/label": ["Label is too long."] }
```

## attr:ODataError.isConflict

`true` when `status` is 412. After [[method:DataContext.update]] or
[[method:DataContext.remove]] fails this way, the store already holds the
server's current version.

## attr:ODataError.isDuplicate

`true` when `status` is 409.

## object:ErrorDetail

One entry of the server's `error.details`. aster-odata sends one per broken
validation rule, targeted at its field.

## attr:ErrorDetail.code

A stable code for the problem, for translating the message.

## attr:ErrorDetail.message

The server's message, written for the person who made the change.

## attr:ErrorDetail.target

Absent when the problem isn't about one field; such details are left out of
[[method:ODataError.fieldErrors]].

## attr:ErrorDetail.params

Values for a translated message, such as the limit that was broken. Absent
when the server sent none, or sent something other than an object.

## class:ODataSource

Most code goes through [[class:DataContext]] instead, which keeps the store
and collections in step. Use the source directly for one-off reads that
shouldn't touch the store, or in tools. It is stateless apart from its schema
and transport: `new ODataSource(schema, transport)` builds one from a schema
you already have.

Every failure the server reports is an [[class:ODataError]]. Problems found
before a request is sent are thrown as they are: a [[class:CriteriaError]] for
a bad filter, sort or `$select`, a [[class:SchemaError]] for an unknown entity
set, and an `Error` for a missing key value or an unknown navigation in
`deltas`.

```ts
const source = await ODataSource.connect(fetchTransport("https://example.com/odata"));
const page = await source.query({ set: "Projects", orderBy: [{ field: "name" }] }, { top: 20, count: true });
page.records.length;   // up to 20
page.count;            // the total, if the server gave one
```

## attr:ODataSource.schema

The [[object:Schema]] the source builds URLs and literals from. Plain and
immutable.

## classMethod:ODataSource.connect

- `transport`: how to reach the service.

Sends `GET $metadata` with `Accept: application/json` and parses the answer
with [[staticMethod:parseCsdl]]. Rejects with an [[class:ODataError]] for a
status other than 200 and a [[class:SchemaError]] for a document it can't
read.

## method:ODataSource.query

- `query`: the [[object:Query]]. Its filter must have no unresolved relative
  dates ([[staticMethod:resolveRelative]]).
- `range.skip`: rows to skip; `$skip` is sent only when it's above 0.
- `range.top`: the most rows wanted. Without it, every row is read, following
  next links to the end.
- `range.count`: ask for `$count=true`.
- `range.exact`: with `count`, send `Prefer: aster.count=exact`.

Resolves to a [[object:Page]]. When the server pages its answer, the source
follows `@odata.nextLink` until it has `top` rows, so one call can be several
requests. Records are not put in any store.

```ts
const page = await source.query(
  { set: "Tasks", filter: { op: "eq", field: "done", value: false }, select: ["id", "title"] },
  { skip: 100, top: 100, count: true },
);
// GET Tasks?$filter=done%20eq%20false&$orderby=id&$select=id%2Ctitle&$skip=100&$top=100&$count=true
```

## method:ODataSource.aggregate

- `set`: the entity set.
- `request.filter`: optional [[type:Criteria]], resolved.
- `request.groupBy`: fields to group by; none means one row over the whole
  set.
- `request.aggregates`: [[object:Aggregate]]s; each row also always has
  `count`.
- `request.orderBy`: optional sort of the rows. These keys aren't checked
  against the schema.

Resolves to the rows, plain objects in OData JSON form, so a Decimal sum is
a string. One request: `$apply` built by [[staticMethod:toApply]]. Throws a
[[class:CriteriaError]] before sending for an unknown or non-filterable
field. [[class:Groups]] is the live version of this.

```ts
const rows = await ctx.source.aggregate("TimeEntries", {
  filter: { op: "eq", field: "billable", value: true },
  groupBy: ["projectId"],
  aggregates: [{ field: "hours", method: "sum", as: "hours" }],
});
// [{ projectId: 1, count: 412, hours: "1630.50" }, …]
```

## method:ODataSource.get

- `set`: the entity set.
- `key`: the key's values in key order ([[type:KeyValues]]).

Resolves to the record with its ETag and hidden fields. Rejects with an
[[class:ODataError]] with status 404 when there is no such record.

```ts
const record = await source.get("Projects", [3]);
record.etag;   // W/"…"
```

## method:ODataSource.create

- `set`: the entity set.
- `values`: the properties to send, as given. [[method:DataContext.create]]
  filters them first; this method doesn't.

Sends `POST` with `Prefer: return=representation` and resolves to the created
record as the server stored it.

## method:ODataSource.update

- `set`, `key`: the record ([[type:KeyValues]]).
- `changes`: the properties to send.
- `etag`: sent as `If-Match`. With `undefined` no `If-Match` is sent, and a
  set that requires one answers 428.
- `deltas`: optional owned-collection changes by navigation name, as
  described under [[method:DataContext.update]]. A navigation the type
  doesn't have throws an `Error`.

Resolves to the record as the server stored it. A deep update is one request,
which the server applies entirely or not at all.

```ts
await source.update("Fields", [12], { label: "Colour" }, etag, {
  answers: [
    { removed: [40] },
    { values: { id: 41, label: "Red" } },
    { values: { fieldId: 12, key: "blue", label: "Blue", position: 3 } },
  ],
});
// PATCH Fields(12) with { "label": "Colour", "answers@delta": [{ "@removed": { "reason": "deleted" }, "@id": "Answers(40)" }, …] }
```

## method:ODataSource.delete

- `set`, `key`: the record ([[type:KeyValues]]).
- `etag`: sent as `If-Match` when given.

Resolves with nothing once the server answers 2xx.

## object:Page

What [[method:ODataSource.query]] resolves to.

## attr:Page.records

The rows in server order, each with its entity, ETag and hidden fields. At
most `top` of them.

## attr:Page.count

`@odata.count` as a number. A server may leave it out for a large result,
even when asked; see [[attr:Collection.counted]] for how a collection copes.

## attr:Page.estimated

Present, and `true`, only when the count is an estimate. Without `exact`, a
server that estimates counts for large sets sends an estimate instead of the
true total.

## staticMethod:keyOf

- `type`: the entity type.
- `entity`: a record holding every key property.

Returns its [[type:KeyText]]. Throws an `Error` when a key property is
missing or null.

```ts
keyOf(ctx.schema.set("Projects").type, { id: 7, name: "Billing" });   // '[7]'
```

## staticMethod:keyText

- `key`: the key's values in key order.

Returns `JSON.stringify(key)`. Values must be in their OData JSON form: an
Int32 key is a number and an Int64 key a string, so `keyText([1])` and
`keyText(["1"])` are different keys.

```ts
keyText([1]);            // '[1]'
keyText(["EU", 2026]);   // '["EU",2026]'
```

## staticMethod:keyValues

- `type`: the entity type.
- `entity`: a record holding every key property.

Returns the key values in `type.key` order. Throws an `Error` when one is
missing or null, such as a new record before the server has assigned its key.

## staticMethod:keyFromText

- `text`: a [[type:KeyText]].

Returns the key values, for building a URL or a filter on the key. Throws a
`SyntaxError` for text that isn't JSON.

```ts
const [id] = keyFromText(selection.key.value!);
```

## type:KeyText

The text form of a [[type:KeyValues]]: a JSON array. Use it as a map key,
as a [[class:Selection]] key and with every store and context method. Make
it with [[staticMethod:keyText]] or [[staticMethod:keyOf]]; read it back
with [[staticMethod:keyFromText]].

## type:KeyValues

In the order of [[attr:EntityType.key]], in OData JSON form.

## class:RecordStore

[[class:DataContext]] makes one and owns it; you rarely construct one
(`new RecordStore(schema)`). Records are frozen. Each `(set, key)` has one
signal for the lifetime of the store, so a view can hold a record's signal
before the record arrives and after it's deleted.

A record's signal and the change listeners are updated in one batch, so
collections have placed or removed a record before any view reacts to either.

```ts
const stop = ctx.store.subscribe((change) => {
  if (change.origin.kind === "external") toast(`${change.set} ${change.key} changed elsewhere`);
});
```

## method:RecordStore.record

- `set`: the entity set; an unknown one throws a [[class:SchemaError]].
- `key`: the record's [[type:KeyText]].

Returns a read-only signal of the [[object:StoredRecord]]. Reading it inside
`effect` or `computed` follows the record's edits, its removal and its
arrival. It doesn't fetch anything; see [[method:DataContext.lookup]] for
that.

## method:RecordStore.get

The record now, without following it (the signal's `peek()`), or
`undefined` if it isn't stored. Use it in event handlers and other code that
shouldn't subscribe.

## method:RecordStore.put

- `set`: the entity set.
- `record`: the record, with its ETag and hidden fields.
- `origin`: where it came from ([[type:Origin]]).
- `fields`: optional; the `$select` it was read with.

Returns the record's key. Without `fields` the record replaces what was
stored. With `fields` it is merged over the stored record, so a narrow read
never blanks fields it didn't fetch; [[attr:StoredRecord.known]] then says
which fields are current. Throws when the set is unknown or a key property is
missing.

Data read or written through the context is stored for you. Call `put` for
records that arrive another way, such as a push from your own server, and
choose the origin that says where they came from.

## method:RecordStore.putAll

Same parameters as [[method:RecordStore.put]], with an array of records.
Returns their keys in order. Listeners hear each change only after every
record is in place, so a collection placing the first record sees the rest.

## method:RecordStore.remove

- `set`, `key`: the record.
- `origin`: where the removal came from.

Sets the record's signal to `undefined` and reports the change. Does nothing
when the record isn't stored.

## method:RecordStore.subscribe

- `listener`: called with each [[object:StoreChange]], synchronously, inside
  the batch that changes the record.

Returns a function that unsubscribes. A listener that writes to signals is
fine; one that awaits sees the batch already applied.

## attr:RecordStore.schema

The [[object:Schema]] the store keys records by.

## object:StoredRecord

What the store holds for each record, and what reads and writes resolve to.
All of it is frozen.

```ts
const stored = ctx.store.get("Projects", keyText([2]))!;
stored.entity.name;          // "Brand refresh"
stored.etag;                 // W/"…"
stored.hidden?.has("budget"); // true if the server hides the budget from this user
```

## attr:StoredRecord.entity

The record's properties in OData JSON form ([[type:Entity]]). A hidden field
holds `null` here, which means "not yours to see", not empty.

## attr:StoredRecord.etag

The version the server gave. Update and delete send it as `If-Match`.

## attr:StoredRecord.known

Collections whose filter or sort reads a field outside `known` refresh rather
than place the record on stale data. Key fields are always known. Stored
fields count as current when the new read has the same ETag, or when the set
has no ETags at all.

## attr:StoredRecord.hidden

A record with hidden fields always has `known`, and a hidden field is never
in it, so collections, page rules and edit models treat the field as unknown
and never send its `null` back.

## object:StoreChange

What [[method:RecordStore.subscribe]] listeners receive. A record that is new
to the store has no `before`; a removed one has no `after`.

## attr:StoreChange.set

The entity set's name.

## attr:StoreChange.key

The record's [[type:KeyText]].

## attr:StoreChange.before

The record before the change; `undefined` when it wasn't stored.

## attr:StoreChange.after

The record after the change; `undefined` when it was removed.

## attr:StoreChange.origin

See [[type:Origin]].

## type:Origin

- `fetch`: a read. `collection` is the collection that fetched it, which
  doesn't re-place it. A record new to the store from another query is placed
  only where it's a loaded row, since the server's count already included it.
- `save`: a write through the context. `by` is the writer passed to
  `create`, `update` or `remove`, so an edit model can ignore the echo of its
  own save.
- `external`: someone else's change, reported with
  [[method:DataContext.reload]]. Edit models compare it with their unsaved
  values and raise a conflict where both changed a field.

Groups recount on `save` and `external`, not on `fetch`.
