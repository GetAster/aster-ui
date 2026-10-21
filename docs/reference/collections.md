# Collections, groups, selections and trees

A [[class:Collection]] is a live window over a query: it holds the position of
each result, not the records, loads results a page at a time as a view asks for
them, and stays right as records change. The other classes on this page are
built on it or beside it: [[class:Groups]] counts a query by one field,
[[class:Selection]] remembers which rows of a collection are chosen, the
aggregate helpers total a collection that is fully loaded, and [[class:Tree]]
makes a collection per open level of a self-referencing set. None of them
touches the DOM; elements are views over them. The query a collection runs is
described in [[group:criteria]]. How changes reach a collection from the store
is in [[group:data]], and the elements that show trees are in
[[group:trees]].

All state is in [Preact signals](https://github.com/preactjs/signals), so a
view that reads a signal in an `effect` or `computed` follows it.

## How a collection loads

`keys` has one slot per result position. A slot holds a record's key once its
page has loaded and `undefined` before that (or after the page was forgotten).
`items` is the same list with each key replaced by the record's entity, read
from the store, so an edit shows without the collection doing anything.

A view asks for what it shows with [[method:Collection.view]]. Pages are
[[attr:Collection.pageSize]] records (100 by default). The collection loads the
pages that touch the range, plus the next page in the direction of travel, and
forgets the pages farthest from the view beyond [[attr:Collection.keepPages]].
Adjacent missing pages go in one request, up to five pages.

The collection's length is [[attr:Collection.count]], which depends on what the
server says:

| The server sends | `count` | `counted` | `estimated` |
|---|---|---|---|
| an exact `@odata.count` | the count | true | false |
| an estimate (`@AsterData.CountEstimated`) | the estimate, as the first answer's size only | false | true |
| no count | the rows loaded so far plus a page, while the last page came back full | false | false |

An estimate sizes the layout and no more: later estimates are ignored, so a
number that drifts never restarts the collection, and a short page replaces it
with the real end. A collection built with
[[attr:CollectionOptions.exactCount]] asks the server for an exact count where it
would estimate or leave it out. [[attr:Collection.complete]] is true when the
count is final and every position is loaded.

A collection that was never loaded has `count` `undefined`, `status` `"idle"`
and no keys. Nothing is requested until [[method:Collection.ensure]],
[[method:Collection.view]] or [[method:Collection.loadAll]] is called.

### A worked example

```ts
import { effect } from "@preact/signals-core";
import { DataContext, fetchTransport } from "@getaster/data";

const ctx = await DataContext.connect(fetchTransport("https://example.com/odata"));
const open = ctx.collection(
  { set: "Tasks", filter: { op: "eq", field: "done", value: false }, orderBy: [{ field: "due" }] },
  { pageSize: 50 },
);

effect(() => {
  // The first 20 rows, as far as they have loaded.
  const rows = open.items.value.slice(0, 20).map((t) => t?.title ?? "…");
  console.log(open.count.value, open.status.value, rows);
});

await open.view(0, 20);                 // loads page 0, and page 1 in the background
open.setQuery({ set: "Tasks", filter: { op: "eq", field: "done", value: false }, orderBy: [{ field: "due", descending: true }] });
                                        // the rows go at once; the first page loads again
ctx.release(open);                      // when the view goes away
```

## Limits

- A collection has no change feed. It follows changes made through its
  [[class:DataContext]]; another user's changes arrive when the app reloads the
  record or calls [[method:Collection.refresh]].
- With only part of its results loaded, a collection doesn't react to a change
  to a record outside its loaded rows, unless the change moves the record into
  the loaded range. Its count can differ from the server's until the next
  refresh.
- A filter with `any`, `all` or `via`, or a sort by a path through a navigation,
  can't be decided locally, so every change to the set (and, for a filter, to the
  related sets) makes the collection refetch what it shows.
- Groups recount after changes made through the context, and not after anything
  else. They don't recount for a change to a related set that their filter
  reads through `any`, `all` or `via`.
- A [[class:Selection]] keeps a key on a page that isn't loaded only if it was
  loaded under the current query. A key selected with
  [[method:Selection.select]] before its row was ever loaded drops out once the
  collection answers.
- A [[class:Tree]] needs a single-field key and loads a level when the view
  reads its `rows`, not when it is opened.

## class:Collection

Make one with [[method:DataContext.collection]], which subscribes it to the
store and gives it the context's clock. The constructor,
`new Collection(store, source, query, options)`, doesn't subscribe it: it would
not hear about changes, so use the context unless you are testing.

A collection stays on one entity set. Its rows are in the order of the query,
and each loaded position is a place in that order: [[attr:Collection.keys]] is
in sort order wherever it is loaded, and `keys.length` equals the server's count
whenever the count is known.

```ts
const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });
await people.loadAll();
people.items.value.map((p) => p?.name);
```

## attr:Collection.type

The [[object:EntityType]] of the set the collection is over. Plain, read only.

## attr:Collection.pageSize

Records per request unit: the first page is `[0, pageSize)`. From
[[attr:CollectionOptions.pageSize]], 100 by default. Plain number, fixed for the
life of the collection.

## attr:Collection.keepPages

How many loaded pages [[method:Collection.view]] keeps. From
[[attr:Collection.keepPages]], 20 by default. Plain number.

## attr:Collection.keys

Signal of an array with one entry per result position: the record's
[[type:KeyText]] where its page is loaded, `undefined` where it isn't. The array
is replaced (never changed in place) whenever a load, a removal or a placement
alters it. Empty until the first page arrives.

When key values and positions are unchanged, updates and refreshes preserve the
array identity. Individual record signals still notify readers of changed values.

## attr:Collection.count

Signal of the number of results, or `undefined` until the first page arrives.
It is the server's total when that is known and a working figure when it is
not; read [[attr:Collection.counted]] and [[attr:Collection.estimated]] to tell
which. A local removal or placement of a record changes it by one.

## attr:Collection.counted

Signal, `true` when [[attr:Collection.count]] is the real total, either because
the server said so or because a short page showed where the results end. When
`false`, more results may follow the last position.

## attr:Collection.estimated

Signal, `true` when `count` is the server's estimate: good for sizing a
scrollbar, not for stating as a fact. The count is exact again once a short page
shows the end. Always `false` with [[attr:CollectionOptions.exactCount]] against
a server that can count.

## attr:Collection.status

Signal: `"loading"` while any request is in flight, `"error"` when the last
request failed and nothing since has succeeded, otherwise `"idle"`. A
collection that has not been asked to load is `"idle"`. A success in any page
clears `"error"`.

## attr:Collection.error

Signal of the error from the last failed request (an [[class:ODataError]] for a
server answer, otherwise whatever the transport threw), or `undefined`. Cleared
by the next request that succeeds. A failure doesn't remove the rows already
loaded.

## attr:Collection.stale

Signal, `true` from the moment a change arrives whose position can't be decided
locally until the refresh it starts has been applied. While it is true the rows
may be out of date. A refresh that fails leaves it `true` and sets
[[attr:Collection.error]].

## attr:Collection.complete

Computed signal, `true` when [[attr:Collection.counted]] is true and every
position has a key. This is what [[staticMethod:aggregate]] waits for. It is
`false` for a collection that was not fully loaded, and a collection that was
trimmed by `keepPages` stops being complete.

## attr:Collection.items

Computed signal of the entities by position, `undefined` for a position that
isn't loaded. Reading it reads each record's own signal in the store, so an
effect follows edits to any row, from any component. The array is as long as
[[attr:Collection.keys]].

## attr:Collection.query

The current [[object:Query]]. A plain getter, not a signal: use
[[method:Collection.setQuery]] to change it, or give
[[method:DataContext.collection]] a signal of queries to follow.

Reading `query` is reactive: effects see query replacements together with the
cleared count/slots, before a new page arrives.

## method:Collection.has

- `key`: a record key.

Returns `true` for a loaded position or a cached record known to match, `false`
for known nonmembership/deletion, or `undefined` when count or needed fields are
unknown. Related/hidden/unloaded filter fields can prevent a local decision.
This does not fetch. Selection uses it to distinguish eviction from a cached
record that has stopped matching a filter.

## method:Collection.setQuery

- `query`: the new [[object:Query]]. Its `set` must be the collection's.

Replaces the query. The rows, count and `stale` are reset at once, in one batch,
so nothing from the old query shows as an answer to the new one, and answers
still in flight for the old query are dropped. If the collection had loaded, or
was loading, the first page loads again without waiting; a view then asks for
the rows it shows, as reloading what was loaded deep down would cost a request
per page. A failure of that reload doesn't throw: it sets
[[attr:Collection.error]].

Throws an `Error` (`a collection stays on Projects; got Tasks`) when the set
differs. Returns nothing, and sends at most one request.

```ts
c.setQuery({ ...c.query, orderBy: [{ field: "name", descending: true }] });
c.count.value;   // undefined: reset, until the first page comes back
```

## method:Collection.ensure

- `start`, `end`: the range of positions `[start, end)`. Clamped to the
  count; `Infinity` is fine for the end.

Loads every page that touches the range and isn't loaded yet. Without a count it
loads page 0 first, so the range is clamped to what the server reports. Pages
already in flight are shared, not requested again, and neighbouring missing pages
go in one request. Resolves when they are in the collection. Rejects with the
error of a failed request ([[class:ODataError]], or the transport's), which is
also in [[attr:Collection.error]]. Pages that did load stay.

```ts
await c.ensure(0, 100);
c.keys.value.slice(0, 100).every((k) => k !== undefined); // true, if count >= 100
```

## method:Collection.view

- `start`, `end`: the positions the view shows, `[start, end)`.

Call it each time the visible range changes. It records the range as the one a
later [[method:Collection.refresh]] reloads, then does [[method:Collection.ensure]]
for it, then loads the next page in the direction of travel without waiting, and
forgets loaded pages beyond [[attr:Collection.keepPages]], farthest first
(never one in view, and never one in flight). Resolves when the range itself is
loaded; the read-ahead page's failure is swallowed (it is in
[[attr:Collection.error]]). Rejects as `ensure` does. If another `view` call
comes before this one finishes, this one stops without forgetting anything.

```ts
await grid.view(60, 70);
// With pageSize 25: pages 2 and 3 (positions 50 to 99) are loaded, page 3 as read-ahead.
```

An optional third argument, `retain: readonly number[]`, protects those logical
positions' pages from eviction while the viewport moves. Refresh also reloads
those pages. Use it for a bounded active navigation row; a page is protected only
while retained by the latest `view` call. Protected/visible pages can exceed
`keepPages` when the requested ranges themselves exceed that budget.
Read-ahead runs only when its additional pages fit beside the visible and retained
pages. A saturated cache does not fetch pages that it would immediately evict.

## method:Collection.loadAll

Loads every page, one `ensure` after another, until the count is final. With
a server count that is one pass; without one it goes page after page until a
short page comes back, which can be many requests for a large set. Resolves when
[[attr:Collection.counted]] is true. Rejects as `ensure` does. Not for large
sets: it stores every record. To total a large set use [[class:Groups]] or
[[method:ODataSource.aggregate]].

## method:Collection.refresh

Refetches what is shown: the pages of the last [[method:Collection.view]] range,
or, if `view` was never called, every loaded page (page 0 for a collection that
has none). The current rows stay visible until the answers arrive, then are
replaced in one step, with a new count, and `stale` is cleared. Loaded pages it
didn't refetch are forgotten, because they may be out of date.

Resolves when the answers are applied, or when a newer refresh or `setQuery`
has made them obsolete (they are then dropped). Rejects with the error of a
failed request, leaving the rows and `stale` as they were and setting
[[attr:Collection.error]]. A collection calls this itself when a change can't be
placed; changes that arrive together share one refresh. An exact-count change
found while loading another page also refreshes the visible window before
publishing new positions. It does not blank already loaded positions while
settling the new offsets.

```ts
mock.faults.failNext(503);
await c.refresh().catch(() => {});   // c.status.value is "error"; the old rows are still there
await c.refresh();                   // c.status.value is "idle"
```

## method:Collection.apply

- `change`: a [[object:StoreChange]].

The context calls this for every live collection on every store change; call it
yourself only in a test. It ignores changes to records this collection fetched
itself, and records that another collection fetched for the first time, unless
this one has them loaded. Otherwise:

- A change to another set only matters if the filter reaches that set through
  `any`, `all` or `via`; then the collection goes stale.
- A record that no longer matches the filter leaves, and the count falls by one.
- A record that matches is placed at its sort position if loaded neighbours prove
  where that is: its successor's predecessor is loaded too, or it is first or
  after the last loaded row. The count rises by one.
- Anything else, including a filter with a lambda, a sort by a path, and a record
  whose known fields lack one the filter or sort reads, sets
  [[attr:Collection.stale]] and starts a refresh in a microtask. A loaded row
  whose new sort position is uncertain keeps its confirmed position and count
  until the refresh commits. Confirmed deletions/filter departures still leave
  immediately.

Returns nothing and never throws; a refresh that fails is kept in `error`.

## object:CollectionOptions

The options of [[method:DataContext.collection]]. All optional.

## attr:CollectionOptions.pageSize

Records per request unit. 100 by default. Also the size of the page
[[method:Collection.setQuery]] reloads.

## attr:CollectionOptions.keepPages

Loaded pages that [[method:Collection.view]] keeps; the farthest from view are
forgotten beyond it. 20 by default. Raise it for a list that will be scrolled
back and forth, and don't set it below the number of pages one view can show.

## attr:CollectionOptions.now

`() => number`, epoch milliseconds: the clock that [[object:RelativeDate]]s
in the filter resolve against at each fetch and each local placement.
[[method:DataContext.collection]] fills it with the context's clock; `Date.now`
otherwise.

## attr:CollectionOptions.exactCount

`true` to send `Prefer: aster.count=exact`, so the server returns an exact count
where it would estimate it or leave it out (past the set's
[[attr:EntitySet.countThreshold]]). It costs the server a full count, so use it
for a figure that matters, such as a total on a dashboard. Default `false`.

## type:CollectionStatus

`"idle" | "loading" | "error"`. See [[attr:Collection.status]].

## staticMethod:aggregate

- `collection`: the [[class:Collection]].
- `reduce`: `(items: readonly Entity[]) => T`, given every record.

Returns a computed signal of the reduction over the whole collection, or
`undefined` while it is not [[attr:Collection.complete]], so a figure is never
a partial answer shown as the whole. It recomputes when a record changes or one
joins or leaves. The collection has to be loaded, with [[method:Collection.loadAll]],
or the signal stays `undefined`. `reduce` may throw; the signal then throws when
read.

```ts
const paused = ctx.collection({ set: "Projects", filter: { op: "eq", field: "state", value: "paused" } });
const longest = aggregate(paused, (items) => Math.max(...items.map((p) => Number(p.behindDays ?? 0))));
await paused.loadAll();
longest.value;
```

## staticMethod:countWhere

- `collection`: the [[class:Collection]].
- `criteria`: a [[type:Criteria]], without relative dates.

Returns a signal of how many records satisfy it, evaluated locally with the
server's rules ([[staticMethod:matches]]), or `undefined` until the collection
is complete.

```ts
countWhere(paused, { op: "gt", field: "hue", value: 180 }).value;   // 15, once loaded
```

## staticMethod:countBy

- `collection`: the [[class:Collection]].
- `field`: a field name.

Returns a signal of a `Map` from each value of the field to the number of records
with it, nulls counted under `null`, in order of first appearance; `undefined`
until the collection is complete. Throws an `Error` (`Project has no field nope`)
at the call for a field the type doesn't have.

```ts
[...countBy(paused, "health").value!];  // [["onTrack", 12], ["behind", 7], ["notStarted", 4], ["needsReview", 4]]
```

## staticMethod:sum

- `collection`: the [[class:Collection]].
- `field`: a numeric field name.

Returns a signal of the total, skipping nulls, `undefined` until the collection
is complete. For `Decimal` and `Int64` fields the sum is exact and is text, as
the values are (see [[staticMethod:sumValues]]); for other numeric fields it is
a number. Throws an `Error` at the call for an unknown field.

```ts
sum(paused, "budget").value;   // "5897012.71"
```

## staticMethod:sumValues

- `values`: [[type:Value]]s, nulls allowed.
- `field`: the [[object:Field]] they belong to, which decides how they add.

Returns the sum without a collection. For `Edm.Decimal` and `Edm.Int64` it adds
exact decimals and returns text with the largest scale among the inputs, `"0"`
for none; any other field adds the numbers and ignores the rest. Throws an
`Error` when a Decimal or Int64 value isn't numeric text.

```ts
sumValues(["0.10", "0.20", null], budgetField);   // "0.30"
sumValues([1, 2, null], hueField);                // 3
```

## staticMethod:subtractExact

- `a`, `b`: exact numeric text or numbers.

Returns `a - b` as exact decimal text, keeping the larger scale. Use it to
compare or difference Decimal and Int64 values without a floating-point error.
Throws an `Error` for a value that isn't an exact number (`1e3` and `-2.50` are
allowed; `NaN` is not).

```ts
subtractExact("10", "0.25");   // "9.75"
```

## class:Groups

Counts and aggregates for the groups of a query by one field, computed by the
server with `$apply` in one request. Make it with [[method:DataContext.groups]],
which sends the first request at once. It follows the query when that is a
signal, and recounts after a change to its set that went through the context,
once per burst, 50 ms after the last. It doesn't hold records, so it is cheap
for a set too big to load.

```ts
const byHealth = ctx.groups({ set: "Projects" }, "health", [{ field: "budget", method: "sum", as: "budget" }]);
// a moment later:
byHealth.rows.value;
// [{ value: "behind", count: 39, totals: { budget: "7667519.45" } }, { value: "needsReview", … }, …]
byHealth.dispose();   // stop following
```

## attr:Groups.field

The field grouped by. Plain string, fixed.

## attr:Groups.rows

Signal of the groups, or `undefined` until the first answer (and again when the
query signal gives a new query, until its answer arrives). Ascending by the
group value, or descending when the query's `orderBy` has a descending key on
that field; a null value is a group of its own. A failed request leaves the old
rows in place. Same-query refreshes also retain rows while loading. Unchanged
groups keep their object identities; if every group is unchanged and in the same
order, the array identity is preserved too. Read rows independently of loading
status when rendering an existing view.

## attr:Groups.error

Signal of the error from the last request if it failed, else `undefined`. The
next successful answer clears it.

## attr:Groups.query

The query being counted, a plain getter. Its filter limits which records are
counted; its sort matters only for the grouped field's direction.

## method:Groups.refresh

Sends the `$apply` request again and replaces the rows. Resolves when the rows are
set. Never rejects: a failure goes to [[attr:Groups.error]]. An answer that has
been overtaken by a newer refresh is dropped. Called for you after changes and
query changes; call it to recount after a change the context didn't see.

## method:Groups.dispose

Stops following the query signal and the store, and cancels a pending recount.
The rows stay as they were. Needed because [[method:DataContext.release]] doesn't
apply to groups; a [[class:Tree]] disposes its own.

## object:GroupRow

One group. Plain data.

## attr:GroupRow.value

The group's value of the grouped field, in its JSON form. `null` is the group of
records where it is null.

## attr:GroupRow.count

The number of records in the group, from the `count` the request asks for.

## attr:GroupRow.totals

Each requested [[object:Aggregate]] by its alias ([[attr:Aggregate.as]]), `null`
where the server has no value (the sum of nothing). Sums of `Decimal` and
`Int64` are exact text. Empty when no aggregates were requested.

## class:Selection

The keys chosen in a collection, kept as data so any view can read them and a
page rule can follow them. The constructor is
`new Selection(store, collection, options)`; `collection` may be a signal of
collections, which is how a page follows whichever list is current.

`keys` is derived and never written back. A chosen key drops out as soon as
the collection changes and it isn't in a loaded position, unless it was loaded
under the current query and its page has since been unloaded (scrolled far
away, beyond [[attr:Collection.keepPages]]) while the store still holds
the record. Sorting or changing only `$select` preserves picks and their order.
A changed membership query (set/filter), a removed record, or a fully loaded
collection without the key drops it. A cached record known locally to stop
matching the filter also drops out, even when its page is evicted. With the fallback on, if none is left, the first loaded row is
selected. Before the collection has answered, the chosen keys are kept as they
are.

Publish one to the page with [[staticMethod:selectionPublication]].

```ts
import { Selection, keyText } from "@getaster/data";

const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });
const chosen = new Selection(ctx.store, people);   // single, with the fallback
await people.loadAll();
chosen.key.value;             // the first row's key: nothing chosen, so it falls back
chosen.select(keyText([4]));
chosen.selected.value?.name;  // live from the store

const many = new Selection(ctx.store, people, { multiple: true });
many.toggle(keyText([2]));
many.toggle(keyText([5]));
many.count.value;             // 2
```

## attr:Selection.multiple

`true` when several keys can be selected. Plain boolean from the options.

## attr:Selection.ordered

Whether pick order is meaningful and [[method:Selection.move]] is enabled.
Default `false`. Requires `multiple: true`.

## attr:Selection.maxOrdered

Optional positive safe integer limit for ordered selection. Default `undefined`
means unlimited. Removing or reordering remains available at the limit.

## attr:Selection.keys

Computed signal of the selected keys, in selection order (for `selectAll`, in the
order given). An empty array when nothing is selected. See the class text for how
keys drop out and the fallback.

## attr:Selection.key

Computed signal of the first selected key, or `undefined`.

## attr:Selection.records

Computed signal of the selected records' entities, from the store, so edits show
without reselecting. A selected key whose record isn't in the store is left out,
so it can be shorter than `keys`.

## attr:Selection.selected

Computed signal of the first selected record's entity, or `undefined`. What a
detail view or a rule reads.

## attr:Selection.hidden

Computed signal of the set of field names hidden on the first selected record
([[attr:StoredRecord.hidden]]); an empty set when there is none or nothing is
selected.

## attr:Selection.count

Computed signal of how many keys are selected.

## attr:Selection.any

Computed signal, `true` when at least one key is selected.

## attr:Selection.many

Computed signal, `true` when more than one key is selected.

## attr:Selection.collection

The collection the selection is in. Reading it reads the signal the selection
was given, so a view that reads it follows a selection whose collection changes.

## method:Selection.select

- `key`: a [[type:KeyText]], or `undefined`.

Selects only `key`, replacing whatever was selected, or nothing for `undefined`.
Works with multiple selection too. A key that isn't among the collection's loaded
positions drops out as soon as the collection has a count. With the fallback and
nothing selected, the first row is selected.

## method:Selection.toggle

- `key`: a [[type:KeyText]].

With `multiple`, adds the key if it isn't selected and removes it if it is. A row
selected only by the fallback counts as selected. For single selection it
selects `key` alone and never deselects: use [[method:Selection.clear]]. Returns
`true` on success, `false` when an addition would exceed `maxOrdered`. A rejected
addition leaves existing picks and order unchanged. New picks append to the end.

## method:Selection.selectAll

- `keys`: the keys to select, in order.

Deduplicates keys, preserving their supplied order. Returns `false` without any
change if the resulting selection would exceed `maxOrdered`; otherwise `true`.
With `multiple`, replaces the selection with `keys`. For single selection it keeps
only the first. Pass the collection's loaded keys, with `undefined` positions
left out, for "select all"; keys in unloaded positions can't be kept.

```ts
many.selectAll(people.keys.value.filter((k): k is string => k !== undefined));
```

## method:Selection.move

- `key`: a selected key.
- `index`: the desired zero-based position in the selection.

Moves the key without changing membership, returning `true`. Returns `false`
without changing anything when ordering is disabled, the key is absent, or the
index is not an integer within the current selection. Removing a pick compacts
the remaining order; picking it again appends it. Query sort order does not
reorder picks. Views can expose one-based ordinals from `keys`.

## method:Selection.clear

Selects nothing. With the fallback, the first loaded row is selected again at
once, so a single selection with fallback is never empty while the collection
has rows; pass `fallback: false` for a selection that can be.

## object:SelectionOptions

The options of [[class:Selection]]. All optional.

## attr:SelectionOptions.multiple

`true` to allow several keys at once. Default `false`. It also turns the
fallback's default off.

## attr:SelectionOptions.ordered

`true` to enable meaningful pick order and explicit reordering. Default `false`.
Requires `multiple: true`; invalid combinations throw at construction.

## attr:SelectionOptions.maxOrdered

Optional maximum number of ordered picks. Omit for unlimited selection. Requires
`ordered: true` and a positive safe integer; invalid values throw. Bulk selection
rejects an over-limit change atomically rather than silently truncating it.

```ts
const queue = new Selection(ctx.store, people, {
  multiple: true, ordered: true, maxOrdered: 3,
});
queue.toggle(keyText([5]));
queue.toggle(keyText([2]));
queue.move(keyText([2]), 0);
```

## attr:SelectionOptions.fallback

When nothing chosen is in the collection, select its first loaded row, so a
detail view always has a record. Default `true` for single selection and `false`
for multiple. Set `false` for a list that can have no selection.

## class:Tree

A tree over a self-referencing entity set (tasks and subtasks, folders), as one
[[class:Collection]] per open level. A level's query is the parent criterion,
the optional `base` and the view's filter, so levels load by page and follow the
store like any collection: a node whose parent changes leaves one level and joins
another. Child counts come from one [[class:Groups]] request per level.

The open state is a set of keys, kept apart from the records, so it survives
reloads and filter changes, and two trees over the same data keep their own.
Make one with `new Tree(ctx, options)` ([[object:TreeOptions]]) and call
[[method:Tree.dispose]] when the view goes away.

A view reads [[attr:Tree.rows]] in an effect. Reading creates the levels it
shows and loads the first page of an open level that hasn't answered; a level
that is never read is never loaded.

```ts
import { computed, effect } from "@preact/signals-core";
import { Tree, keyText } from "@getaster/data";

const tree = new Tree(ctx, {
  set: "Tasks",
  parentField: "parentId",
  base: computed(() => ({ op: "eq", field: "projectId", value: 4 })),
  orderBy: computed(() => [{ field: "id" }]),
});
effect(() => console.log(tree.rows.value.map((r) => `${"  ".repeat(r.level - 1)}${r.key ?? "…"}${r.folder ? (r.open ? " -" : " +") : ""}`)));
const first = tree.rows.value[0]!.key!;
await tree.expand(first);              // its children appear in rows, one level in
const deepKey = keyText([2734]);
await tree.reveal(deepKey);            // opens every folder on the way and loads until it's there
await tree.move(deepKey, undefined);   // makes it a top-level node
tree.dispose();
```

## attr:Tree.type

The [[object:EntityType]] of the set. Plain, read only.

## attr:Tree.key

The name of the set's single key property, as a string. A tree needs exactly one.

## attr:Tree.options

The [[object:TreeOptions]] it was made with. The signals in them are the
caller's; the tree follows them.

## attr:Tree.rootValue

The parent value that top-level nodes hold: [[attr:TreeOptions.rootValue]] if
given, else the parent field's [[attr:Field.rootValue]], else `null`.

## attr:Tree.open

Signal of the set of open folders' keys. Replace it with
[[method:Tree.setOpen]]; [[method:Tree.expand]] and [[method:Tree.collapse]] change
it one at a time. A key in it for a node that doesn't exist or isn't a folder is
never shown.

## attr:Tree.searching

Signal, `true` while keep-ancestors filtering is finding where the matches are.
Always `false` in `strict` mode and with no filter.

## attr:Tree.tooBroad

Signal, `true` when the filter has more matches than
[[attr:TreeOptions.matchLimit]], so keep-ancestors gave up: no ancestors are
added, and the levels show only matching nodes, as `strict` does. Show "narrow the
filter". Cleared when the next filter's matches are within the limit, or when
the filter is cleared.

## attr:Tree.error

Signal of the error from finding the matches' paths, else `undefined`. The rows
that were shown stay as they were. The next filter clears it. Errors of loading
a level are in that level's [[attr:Collection.error]].

## attr:Tree.rows

Computed signal of the lines shown, top to bottom, depth first: for each level
open on the way, one [[object:TreeRow]] per position of the level's count,
with a row whose key is `undefined` for a position not yet loaded. A node's
children follow it when it is open and not known to be empty. Reading the signal
creates the levels it needs and starts loading an open level that has not
answered yet; it follows each level's keys and counts, the open set and the
child counts.

## method:Tree.level

- `parent`: the parent node's [[type:KeyText]], or `undefined` for the top level.

Returns the [[class:Collection]] of that node's children, creating it on first
use. The collection is subscribed to the store through the context and released
by [[method:Tree.dispose]]. Its query follows `base`, `filter` and `orderBy`.
Use it to load by page: `tree.level(parent).view(0, 50)`. It sends nothing until
asked.

## method:Tree.entity

- `key`: a node's [[type:KeyText]].

Returns the node's record from the store, or `undefined` if it isn't there.
Reads the record's signal, so an effect follows edits.

## method:Tree.isOpen

- `key`: a node's key.

Returns whether the key is in the open set. Doesn't track the signal.

## method:Tree.expand

- `key`: a node's key.

Adds it to the open set and loads the first page of its children, resolving
when that page is in. Does nothing if it is already open. Rejects with the load
error, though the node stays open.

## method:Tree.collapse

- `key`: a node's key.

Removes it from the open set. Its descendants stay open underneath, and the
levels already loaded are kept, so opening it again is immediate. Does nothing
if it's closed.

## method:Tree.toggle

- `key`: a node's key.

Collapses an open node and returns a resolved promise; expands a closed one and
returns [[method:Tree.expand]]'s promise.

## method:Tree.setOpen

- `keys`: the open set to use.

Replaces the whole set at once, to restore a saved open state. No level loads
until [[attr:Tree.rows]] is read. Keys for nodes that don't exist are never
shown.

## method:Tree.hasChildren

- `key`: the node.
- `parent`: the node's parent key, or `undefined` for a top-level node.

Returns `true` or `false` from the level's child counts, or `undefined` while
that level's counts haven't arrived. The same answer is in [[attr:TreeRow.folder]].

## method:Tree.ancestors

- `key`: a node.

Resolves to the keys from the top level down to the node's parent, an empty array
for a top-level node or one that isn't found. It reads each record's parent field
and loads records the store doesn't have. Rejects with the load error, and with
an `Error` (`Tasks has a cycle at [5]`) if the data has a cycle.

```ts
await tree.ancestors(keyText([2734]));   // ["[113]"]
```

## method:Tree.reveal

- `key`: a node.

Opens every folder on the way to the node and loads each level's pages until it is
in. Where the sort can be written as a filter, the node's place in its level is
counted by the server, so a node last among thousands loads one page around it;
otherwise it loads page by page. Resolves to the node's index in
[[attr:Tree.rows]], or -1 if the node isn't in this tree (filtered out, or in
another project). Rejects with the load error.

## method:Tree.descendants

- `key`: a node.

Resolves to every record under the node, nearest first (children, then
grandchildren), reading a level of children per request in chunks of 200 keys.
Use it to list a subtree before removing or moving it. The records go in the
store. It doesn't include the node itself and loads the subtree whole, so it is
not for a very large one. Rejects with the load error.

## method:Tree.move

- `key`: the node to move.
- `parent`: its new parent's key, or `undefined` for the top level.

Saves the new parent through [[method:DataContext.update]], which sends the
parent field's new value (the root value for the top level). The store's sync
moves the node out of its old level and into the new one, and it keeps its open
state. Throws an `Error` for a move into the node itself (`A node can't be
moved into itself.`) or into its own subtree (`A node can't be moved into its own
subtree.`) before anything is sent. Rejects with the [[class:ODataError]] of
the save.

## method:Tree.refresh

Refreshes every level's viewed pages ([[method:Collection.refresh]]), keeping the
open state. Resolves when all have answered; rejects with the first failure.

## method:Tree.dispose

Stops following the filter, releases every level's collection and disposes the
child counts. After it the tree isn't used again. Call it when the view goes away.

## object:TreeOptions

The options of `new Tree(ctx, options)`. `set` and `parentField` are required.
The signals are read, never written.

## attr:TreeOptions.set

The entity set. Must have a single-property key; otherwise the constructor
throws (`a tree needs a single-field key; Tasks has 2`).

## attr:TreeOptions.parentField

The field holding the parent's key. Must be a field of the set, else the
constructor throws (`Tasks has no field nope`). Its value is the parent's key
property, or the root value for a top-level node.

## attr:TreeOptions.rootValue

The parent value of top-level nodes. Defaults to the parent field's
[[attr:Field.rootValue]], else `null`.

## attr:TreeOptions.base

Signal of a [[type:Criteria]] that limits the whole tree, such as one project's
tasks. Included in every level and every count. `undefined` is no limit.

## attr:TreeOptions.filter

Signal of the view's filter, applied as [[attr:TreeOptions.filterMode]] says.
`undefined` is no filter. A change reloads the first page of every level that has loaded.

## attr:TreeOptions.orderBy

Signal of the [[object:SortKey]]s that order siblings within each parent. The key
is added as a tie-breaker.

## attr:TreeOptions.filterMode

[[type:FilterMode]]. `"keepAncestors"` by default.

## attr:TreeOptions.pageSize

The page size of each level's collection. 100 by default.

## attr:TreeOptions.matchLimit

In keep-ancestors mode, the most matches (and ancestors) the tree will walk
before it gives up and sets [[attr:Tree.tooBroad]]. 8,000 by default.

## attr:TreeOptions.openLimit

In keep-ancestors mode, the most folders opened to show where the matches are,
nearest the top first. 200 by default. Folders it didn't open can still be
opened by hand.

## object:TreeRow

One line of [[attr:Tree.rows]]: a node, or the placeholder for a position whose
page isn't loaded yet. Plain data; a new array of new objects is made whenever the
rows change.

## attr:TreeRow.key

The node's [[type:KeyText]], or `undefined` for a placeholder. Load it with
`row.collection.view(row.index, row.index + 1)`.

## attr:TreeRow.parent

The parent's key, or `undefined` at the top level.

## attr:TreeRow.level

1 for a top-level node, 2 for its children, and so on. Use it for indentation
and `aria-level`.

## attr:TreeRow.position

The node's place among its siblings, starting at 1. For `aria-posinset`.

## attr:TreeRow.siblings

How many siblings the level has, including this node: the level's count, or the
number of keys loaded while the count is unknown. For `aria-setsize`.

## attr:TreeRow.folder

`true` if the node has children, `false` if the counts say it has none,
`undefined` while they haven't arrived or for a placeholder. Show an opener for
anything but `false`.

## attr:TreeRow.open

`true` when the node is open and children are shown under it. `false` for a
placeholder, for a closed node and for one known to have no children.

## attr:TreeRow.collection

The [[class:Collection]] of this row's level, for loading by page.

## attr:TreeRow.index

The row's position in `collection`, from 0: pass it to
[[method:Collection.view]] when the row scrolls into sight.

## type:FilterMode

How the view's filter treats a node whose parent doesn't match.
`"keepAncestors"` shows each match with the path to it, opened, so a match is
never hidden by a parent that doesn't itself match; finding the paths takes a
request per level of the tree. `"strict"` applies the filter at every level, so a
parent that doesn't match is hidden and everything under it with it.

## method:Collection.recordAt

- `index`: a zero-based collection position.

Returns the loaded `StoredRecord`, including hidden-field markers, or `undefined`
for an unloaded or absent position. Reads that record's signal, so renderers and
effects follow changes without constructing the whole `items` array. It starts
no fetch; call `ensure` or `view` through the owning screen when needed.
