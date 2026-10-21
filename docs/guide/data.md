# Data core internals

This advanced guide explains the data core's implementation and detailed
contracts. For the main concepts and a practical starting point, read
[the shared data model](data-model.md), then
[connect a grid and form](connected-views.md).

Examples below use the public
[sample metadata](../lib/demo/metadata.json):
`Projects`, `Tasks` (a hierarchy through `parentId`), `People`, `Clients`,
`TimeEntries`, `Members`, `ShareLinks` and `Notes`. The record-edit and
page-rule examples add the M6 model, a questionnaire's `Fields`, their
`Answers` and rule `Clauses` (`fixtures/aster/model.ts`).

## The mental model

A `DataContext` is one client's view of one OData service. It owns one
`RecordStore`, which holds the only copy of each record, keyed by entity set
and key, with its ETag. A `Collection` is a query plus the positions of its
results; it holds keys, not records, so it's a live view. Every write goes
through the context, and when the store changes, every collection adds, moves
or removes the record. Uncommitted edits live in an `EditModel` (one record),
a `ListEdit` (a collection's rows) or a `RecordEdit` (a record with the
collections it owns), apart from the store, until a save. A save produces a
`ChangeSet`: plain data that can be inverted for Undo, stored and replayed.

Around a page there are more pieces. A `Selection` is the keys chosen in a
collection, as data. A `PageScope` is a map from keys to what components
publish: a list its selection, a form its values and flags. Rules are
criteria over paths into the scope (`project.values.health`), and their
results are signals that fields and buttons bind to. A collection's query can
be a signal over the scope, so a detail list follows a selection. A `Groups`
is the server's counts and totals by one field. A `Tree` is a
self-referencing set seen as levels, each one a collection, with open state of
its own.

Everything is plain TypeScript with signals (`@preact/signals-core`) and no
DOM. The examples assume:

```ts
import { DataContext, keyText, type Criteria } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import metadata from "../fixtures/aster/metadata.json";
import data from "../fixtures/aster/data.json";

const mock = await createMockService({ metadata, data });
const ctx = await DataContext.connect(mock.transport);
```

## Schema

**What it's for.** `parseCsdl` reads a CSDL JSON `$metadata` document into a
frozen `Schema`: entity sets, entity types, fields, keys, navigations and
annotations (`packages/data/src/schema/csdl.ts:211`). It's the only field
model. Validation, criteria checks, labels, form controls and the "what may I
send" filter all read from it.

| Metadata | Becomes | Used by |
|---|---|---|
| `$Type`, `$Nullable`, `$MaxLength`, `$Precision`, `$Scale` | `Field.type`, `nullable`, `maxLength`, … | Validation, `$filter` literals, comparisons, the control a form picks |
| `Core.Description`, `Core.LongDescription` | `Field.title`, `prompt` | Labels, error messages |
| `Core.Computed`, `Core.Immutable` | `Field.computed`, `immutable` | Read-only with a reason; left out of writes |
| `$DefaultValue` | `Field.defaultValue` | A create leaves out values equal to it (or null without one) |
| `AsterData.EmptyAsNull` | `Field.emptyAsNull` | Empty text entered is null (`EditModel.set`) |
| `AsterData.RootValue` on a parent field | `Field.rootValue` | A `Tree`'s root value when the app gives none (`tree/tree.ts:108`) |
| `Validation.Minimum`/`Maximum`/`Exclusive`, `Pattern`, `AllowedValues`; `AsterData.MinLength` | Field constraints | Validation; allowed values become a select |
| `Core.OptimisticConcurrency` on the set | `EntitySet.etag` | Says writes need `If-Match`; the client sends it whenever it holds an ETag regardless |
| `Capabilities.FilterRestrictions`, `SortRestrictions` | `nonFilterable`, `nonSortable` | Criteria rejected before they're sent |
| `AsterData.PluralTitle`, `AsterData.TitleField` | `pluralTitle`, `titleField` | Screens; the picker's display text |
| `$ReferentialConstraint`, `$Partner` | `Navigation.keys`, `partner` | Lookups |
| `AsterData.Owned` on a navigation | `Navigation.owned` | The collections a `RecordEdit` edits with its record, saved as one deep update |

**Invariants.**

- The schema is immutable; maps and sets throw on mutation (`schema/csdl.ts:45`).
- Annotation names are normalised to their alias (`schema/csdl.ts:138`).
- Values stay in OData JSON form with `IEEE754Compatible=true`: Int64 and
  Decimal are exact strings, dates are strings (`schema/model.ts:4`).
- A property it can't model (a stream, an untyped, complex or enum value, a
  collection) is left out and listed in `schema.skipped` with its JSON path;
  the rest of the schema stands (`schema/csdl.ts:488`, `:296`). A malformed document
  still fails with a `SchemaError` and a path.
- Types may span several schema namespaces; `schema.namespace` is the entity
  container's. A derived type (`$BaseType`) has its base's key and
  properties (`schema/csdl.ts:256`).
- A navigation is owned only through `AsterData.Owned` (`schema/csdl.ts:420`).
  A contained navigation (`$ContainsTarget`) isn't owned: the client doesn't
  read it.

## Criteria

**What it's for.** A typed AST for filters (`criteria/ast.ts:22`). The same
tree is compiled to `$filter` for the server and evaluated locally for sync,
aggregates and page rules. A comparison is property against literal or
property against another property of the same type (`other`,
`criteria/ast.ts:31`).

Operators: `and`, `or`, `not`, `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`,
`contains`/`startswith`/`endswith` with an optional `caseInsensitive` flag,
`any`/`all` over a to-many navigation, and `via` through a single related
record (below).

```ts
import { matches, toFilter } from "@getaster/data";

const overdue: Criteria = {
  op: "and",
  args: [
    { op: "eq", field: "done", value: false },
    { op: "lt", field: "due", value: "2026-10-15" },
  ],
};
const tasks = ctx.schema.set("Tasks");
toFilter(overdue, tasks.type, tasks);        // "done eq false and due lt 2026-10-15"
matches(overdue, { id: 9, done: false, due: null }, tasks.type);  // false

const overspent: Criteria = { op: "gt", field: "spent", other: "budget" };
toFilter(overspent, ctx.schema.set("Projects").type);             // "spent gt budget"
```

`compile.ts` formats literals by the field's Edm type (`criteria/compile.ts:8`)
and rejects unknown fields, wrong-typed values, and fields the set marks
non-filterable or non-sortable (`:29`, `:129`). A property comparison must
pair two fields of one type (`otherOf`, `:37`). `evaluate.ts` implements
OData's rules: `null` equals only `null`; an ordering comparison with a
`null` operand is false; string functions of `null` are unknown and exclude
the row, even under `not` (`criteria/evaluate.ts:81–108`). Strings compare by
code point, Decimal and Int64 exactly with bigints, DateTimeOffset by instant
(`criteria/values.ts:213`, `:238`).

**`any` and `all`.** `{ op: "any", field: "answers", where: … }` holds when
some related record matches `where`, `all` when every one does, so `all` over
no records holds (`criteria/ast.ts:50`). `field` is a to-many navigation and
`where` names the related records' own properties, including another `any`
or `all`. A lambda needs the schema to follow the navigation, so `toFilter`
takes it as a fourth argument; each level gets its own variable, `x0`, `x1`
and so on (`criteria/compile.ts:65–74`, `:115`). A navigation that isn't a
collection, or isn't there, is a `CriteriaError` (`:67–70`).

```ts
const fields = ctx.schema.set("Fields");
const offersOther: Criteria = { op: "any", field: "answers", where: { op: "eq", field: "key", value: "other" } };
toFilter(offersOther, fields.type, fields, ctx.schema);   // "answers/any(x0:x0/key eq 'other')"
```

Locally, `matches(criteria, entity, type, related)` reads the related records
as a list under the navigation's name in the entity, and `related` says each
navigation's record type (`Related`, `criteria/evaluate.ts:21`, `:47–57`);
without them it throws. A related record whose test is unknown counts as not
matching, as in OData. A page rule supplies both, from a repeating group
(see "PageScope and rules"). `tests/integration/page-rules-contract.test.ts:61`
checks that the engine's answers are the model data's.

**`via`: a single related record's fields.** `{ op: "via", field: "project",
where: … }` holds when the record that a single-valued navigation leads to
matches `where`, which names that record's own properties
(`criteria/ast.ts:57`). It compiles to a path, with brackets where the
precedence needs them, inside a lambda as well
(`criteria/compile.ts:75`):

```ts
const tasks = ctx.schema.set("Tasks");
const late: Criteria = { op: "via", field: "project", where: { op: "eq", field: "health", value: "behind" } };
toFilter(late, tasks.type, tasks, ctx.schema);    // "project/health eq 'behind'"
```

Locally, `matches` needs the related record under the navigation's name. With
none (`null`), its properties read as null, as on the server, so
`health eq null` holds. A record that isn't there at all throws
(`criteria/evaluate.ts:58`). A collection can't place a changed record from
the record alone, so it refreshes, as for `any` and `all`. It also refreshes
when the related set changes (see "Collection"). `tests/integration/via.test.ts`
checks that the engine's answers are the fixture's. The shared filter channel
uses nested `via` nodes for relationship paths.

**Relative dates.** A comparison on a date field may take a `RelativeDate`
instead of a literal (`criteria/ast.ts:9`): `{ relative: "today" | "now",
startOf?: "week" | "month", months?, weeks?, days? }`. This week is
`ge { relative: "today", startOf: "week" }` and `le { relative: "today",
startOf: "week", days: 6 }`. The start moves the date to Monday or the first
of the month, then months, then weeks and days are added, all in UTC
(`criteria/relative.ts:54–59`). A relative date stays symbolic in a query or
a published filter. `resolveRelative(criteria, type, now)` replaces each with
a literal typed by its field: a `YYYY-MM-DD` date for `Edm.Date`, an instant
for `Edm.DateTimeOffset`, a `CriteriaError` for any other type (`:29`, `:54`).
`hasRelative` and `isRelative` ask whether there are any (`:11`, `:7`). The
compiler and `matches` take resolved criteria only: an unresolved one reaches
`plain()` and throws (`criteria/values.ts:286`). Collections, groups and
rules resolve at each fetch or evaluation, against their clock (see
"Collection" and "PageScope and rules").

**The differential test.** `tests/integration/criteria-differential.test.ts`
runs every row of the truth table (`packages/data/test/truth-table.ts`) twice,
through `matches()` and as `$filter` through the WebAssembly build of
`aster-odata`'s engine; both must give the expected answer (`:35`). The
property-comparison rows (`truth-table.ts:143–153`) cover nulls on one or
both sides, `not` over a null comparison, decimals across scales and beyond
double precision, code-point order and instants across offsets. The same file
checks that `sortComparator` orders rows exactly as `$orderby` does (`:54`).

**Invariants.**

- `matches(c, e)` is true exactly when the server would return `e` for
  `$filter=toFilter(c)`. Unknown counts as excluded (`criteria/evaluate.ts:123`).
- Sorting appends the key properties as tie-breakers, as the server does
  (`criteria/compile.ts:120`).
- A criteria problem is a `CriteriaError`, thrown before any request is sent.

## Transport and ODataSource

A `Transport` is one function, request in and response out (`transport.ts:27`).
`fetchTransport(serviceRoot)` talks to a real server; the mock's transport
calls the WebAssembly engine in process. `ODataSource` speaks OData 4.01 over
either (`odata/source.ts:20`): `connect`, `query`, `aggregate`, `get`,
`create`, `update`, `delete`. Most code goes through `DataContext` instead.

`update(set, key, changes, etag, deltas)` can change owned collections in the
same request. `deltas` is a `Deltas` (`odata/source.ts:185`): by navigation,
the `DeltaEntry`s of that collection (`:180`). Each becomes an entry of
`<nav>@delta` in the PATCH body (`:98–112`):

| Entry | Sent as |
|---|---|
| `{ removed: key }` | `{ "@removed": { "reason": "deleted" }, "@id": "Answers(2)" }` (`:116`) |
| `{ values }` | The child's values. For an existing child they include its key properties and the changed ones |
| `{ values, nested }` | A new child, with its own new children under the navigation each is named by: `out[nav] = [...]` (`:119–122`) |

**Invariants.**

- Every failure is an `ODataError` with status, code, per-field details
  (`fieldErrors()`) and, on 412, the server's current ETag (`odata/errors.ts:11`).
- Writes send `If-Match` whenever an ETag is known, whatever `$metadata`
  declares; without one nothing is sent, so an ETag-bearing set answers 428
  instead of overwriting (`ifMatch`, `odata/source.ts:191`).
- A create sends only writable values that differ from what the server would
  store without them (`creatable`, `changes/changeset.ts:96`); an update
  sends only changed properties.
- A deep update is one request, and the server applies it all or not at all;
  errors in a child come back with a `target` such as `answers[2]/label`
  (`odata/errors.ts:6`).
- Error details carry the server's `message`, which is what's shown, and a
  stable `code` and `params` for localising it (`odata/errors.ts:2–8`). A
  duplicate key is a 409 (`isDuplicate`, `:42`).
- `query` follows `@odata.nextLink` until it has `top` records
  (`odata/source.ts:46`).
- A count marked `@AsterData.CountEstimated` comes back as `estimated` beside
  `count` (`:55`). `query(q, { count: true, exact: true })` sends
  `Prefer: aster.count=exact`, for an exact count where the server would
  estimate it or leave it out (`:52`).
- A record's `@AsterData.Hidden` (the fields the server hides from this caller
  on this record; they arrive as `null`) becomes its `hidden` set, on reads and
  on a write's answer alike (`toRecord`, `:219`).

## RecordStore

**What it's for.** One normalised, frozen copy of each record by set and key,
with its ETag (`store/store.ts:43`). Each record has its own signal, so
anything that reads it follows it.

```ts
const project = ctx.store.record("Projects", keyText([1]));   // keys are JSON arrays: '[1]'
const stop = ctx.store.subscribe((change) => {
  if (change.origin.kind === "external") console.log("someone else changed", change.set, change.key);
});
```

Every change is a `StoreChange` with `before`, `after` and an `Origin`
(`store/store.ts:21`): `fetch` (a read; the fetching collection doesn't
re-place it), `save` with `by` (the writer ignores its own echo), or
`external` (another user's change; edit models treat it as theirs).

**Partial records.** A `$select` result is merged into the stored record,
never blanking the fields it didn't fetch (`put`, `store/store.ts:70`;
`partial`, `:136`). Its `known` set lists the fields that are current
(`:14`). Stored fields stay current only when the ETag is the same version.
A collection whose filter or sort reads a field outside `known` refreshes
instead of guessing (`collection/collection.ts:250`).

**Hidden fields.** A field the server hides on one record is `null`, with the
record's `hidden` set naming it (`store/store.ts:25`). That `null` means "not
yours to see", not empty, so the store never counts a hidden field as known: a
whole record is known except its hidden fields (`whole`, `:150`), and a
`$select` result decides again for the fields it carries while the others stay
as last heard (`partial`, `:164`). A hidden field holds `null` even where an
older version had a value (`blanked`, `:182`). Everything that acts on a field
only when it's known follows: a collection filtered or sorted by it refetches,
page rules read it as unknown, and edit models leave it alone.

**Invariants.**

- Identity is `(set, keyText(key))`; equal keys give equal text (`store/keys.ts:19`).
- A `put` with the same values, ETag and known fields reports nothing
  (`store/store.ts:76`), so refetches don't cause churn.
- The record's signal and the listeners are updated in one `batch`
  (`store/store.ts:84`): collections have placed or removed the record before
  any view or aggregate reads either
  (`tests/integration/data-core.test.ts:213`).

## Collection

**What it's for.** A `Query` (set, filter, sort, select) and a window over
its results (`collection/collection.ts:25`). `keys[i]` is the record at server
position `i`, or `undefined` where nothing is loaded. Create collections
through `ctx.collection`, which subscribes them to the store.

| Member | Meaning |
|---|---|
| `pageSize` (option, default 100) | Rows per request |
| `keepPages` (option, default 20) | Loaded pages `view` keeps |
| `now` (option) | The clock relative dates in the filter resolve against, at each fetch and each local placement (`:18`). The context passes its own |
| `exactCount` (option) | Asks for an exact count (`Prefer: aster.count=exact`), for a figure that matters; it costs the server a full count (`:24`). A tree counts node positions this way (`tree/tree.ts:288`) |
| `ensure(start, end)` / `loadAll()` | Loads every page touching the range / everything. Missing pages that are next to each other load in one request |
| `view(start, end)` | Shows a range: loads it, prefetches a page ahead, forgets the farthest pages |
| `refresh()` | Refetches the pages in view, or every loaded page if `view` hasn't been used, adjacent pages together; current rows stay until answers arrive |
| `setQuery(query)` | Replaces the query on the same set; see "Queries that follow the page" |
| `keys`, `items` | Signals; `items` reads each record's signal, so edits show |
| `count`, `counted`, `complete` | The server's `$count`, or without one the rows loaded plus a page; whether that's the true total; counted and every position loaded |
| `estimated` | `count` is the server's estimate: right for sizing a scrollbar, not for stating as a fact (`:82`) |
| `status`, `error`, `stale` | `"idle"`, `"loading"` or `"error"`; a change whose position couldn't be decided, refresh running |

```ts
const active = ctx.collection({
  set: "Projects",
  filter: { op: "eq", field: "state", value: "active" },
  orderBy: [{ field: "updatedAt", descending: true }],
});
await active.ensure(0, 50);
await ctx.update("Projects", keyText([1]), { state: "paused" });
// Project 1 has left `active` and joined any loaded `paused` collection; both counts changed.
ctx.release(active);
```

**Viewed through a window.** A grid over 100,000 rows shows a range, not
everything it has loaded. `view(start, end)` (`collection/collection.ts:145`)
loads the pages touching the range, then, without waiting, the next page in
the direction of travel: the one below, or the one above when the range moved
up. It then forgets loaded pages beyond `keepPages`, the farthest from the
range first. A page in view or in flight is never forgotten. The count and
`keys.length` don't change; a forgotten position is `undefined` again and
loads when it's next viewed. `refresh()` reloads only the viewed pages and
forgets the others, which may be stale; a collection never viewed refreshes
everything it loaded. A collection that has forgotten pages isn't
`complete`, so an aggregate over it is `undefined`: aggregates belong on
collections loaded whole, or on `Groups`.
`tests/integration/windowed.test.ts` covers each case.

**Adjacent pages in one request.** A view that straddles two pages, or a
refresh of the pages in view, asks for the missing pages together. Pages that
are next to each other form a run of at most five, and a run is one request
with `$skip` at its first page and `$top` of the whole run (`runsOf`,
`collection/collection.ts:416`; `#loadPages`, `:314`; `#fetchPages`,
`:353–357`). Each page of the run counts as in flight until the answer lands,
so another `ensure` for one of them waits for that request instead of asking
again (`:134–136`, `:336`). Two pages cost one round trip, not two in turn
(`windowed.test.ts:71`, `:81`).

**Relative dates.** A filter may hold relative dates (see "Criteria"). The
collection keeps the query symbolic, `collection.query.filter` unchanged, and
resolves it against its `now` for each request and each local placement
(`#resolved`, `collection/collection.ts:379`). A collection built by the
context has the context's clock, `DataContext.connect(transport, { now })`
(`context.ts:36`, `:61`), so a refresh a week later asks for the new week
(`tests/integration/page-rules-contract.test.ts:100`).

**Sort keys that are paths.** A sort key can be a path through single-valued
navigations, `person/name` (`criteria/compile.ts:129`, `:154`). It's checked
against the schema: an unknown navigation, a collection-valued one ("a path can
only follow single records") and a binary field are `CriteriaError`s. It's sent
as `$orderby=person/name`, so the server orders by the related value. The
client can't: the related values aren't in the collection's records, so there's
no comparator (`collection.ts:431`). A record that changes can't be placed
with certainty, so the collection goes stale and refreshes rather than guess
(`:256–260`). Key tie-breakers are appended as for any sort. The grid uses a path
for a lookup column, `personId` sorting by `person/name`.

**How it stays in sync** (`apply`, `collection/collection.ts:223`). For each
store change on its set, a collection ignores records it fetched itself and
does nothing before its first page. If the change lacks a field the query
reads, it refreshes. Otherwise it takes the record out if it was there, and
puts it back if it now matches the filter, at its sort position when that's
certain from loaded neighbours (`#certainPosition`, `:273`). When it isn't,
the collection marks itself `stale` and refreshes its loaded pages. A fully
loaded collection is always certain, so it never refetches. A filter with
`any`, `all` or `via` is the exception: whether a record belongs depends on
related records that aren't in it, so every change to the set makes the
collection stale, loaded or not (`:241–244`, `hasLambda`, `:436`). A save to
one of those related sets does too, since it can move records in or out
(`:225`, `relatedSets`, `:454`); a fetch there doesn't.
`tests/integration/data-core.test.ts:70–114` covers each case.

**Invariants.**

- Loaded positions are in the query's sort order, and `keys.length` equals
  the count whenever the count is known (`collection/collection.ts:22`).
- A server may leave the count out above a set's threshold. The collection
  then lays out a page past the last full page, `counted` stays false until
  a short page shows the end, and `loadAll` loads page after page until it
  does (`#settle`, `:419`; `loadAll`, `:192`). The grid shows "N+ rows" and an
  `aria-rowcount` of -1 (`grid/grid.ts:154`, `:638`).
- A server may instead estimate it (`estimated`). The estimate lays out the
  query's first page; later pages' estimates are never compared with it, so
  one that drifts doesn't start the collection over, while two exact counts
  that differ still do (`:335`). A short page replaces the estimate with the
  real end. Pages that run past an estimate that was too low turn it into a
  progressive count, and an empty page far past the end of one too high
  shrinks it to what's loaded plus a page (`#settle`, `:419`). A save placed
  into the collection moves the estimate by one, as it would a count. The
  grid shows "About 12,000 rows", rounded to two figures, with an
  `aria-rowcount` of -1 and the total as the grid's description
  (`grid/grid.ts:154`). `packages/data/test/markers.test.ts` covers each case
  with a stub transport.
- Responses from before a `refresh` or `setQuery` are dropped (generation
  counter, `:49`).
- A failed refresh leaves `stale` and `error` set, with nothing unhandled
  (`#goStale`, `:289`; `#fetchPages`, `:360`; `data-core.test.ts:344`).

## Aggregates and lookups

`aggregate`, `countWhere`, `countBy`, `sum` and `subtractExact`
(`collection/aggregate.ts`) are computed signals over a collection. Each is
`undefined` until its collection is `complete` (`:14`), so a figure never
shows a partial answer as the whole one. Decimal and Int64 sums are exact,
with bigints, at the largest scale seen (`:47`). For totals over a set too big to
load, `Groups` asks the server.

`ctx.lookup(set, key)` returns a signal of one record, for a foreign key's
display value (`context.ts:92`). Missing records asked for in the same task
share one `in` request per set (`:185`); the answer goes into the store as
an ordinary `fetch`, and a failed request is asked again by a later lookup
(`:200`).

## Groups

**What it's for.** The groups of a query by one field, each with a count and
any aggregates, computed by the server in one `$apply` request
(`collection/groups.ts:25`). Group headers in the grid use it, so do a tree's
child counts, and so does the project page's list of who has logged time.
`ctx.groups(query or signal, field, aggregates)` makes one (`context.ts:76`).

```ts
const byHealth = ctx.groups(
  { set: "Projects", filter: { op: "ne", field: "state", value: "archived" } },
  "health",
  [{ field: "budget", method: "sum", as: "budget" }],
);
byHealth.rows.value;   // undefined until the first answer, then one row per group:
// [{ value: "behind", count: 3, totals: { budget: "120000.00" } }, …]
byHealth.dispose();
```

A `GroupRow` is `value` (null is a group of its own), `count` and `totals` by
alias. An `Aggregate` is `{ field, method, as }`, with `method` one of `sum`,
`min`, `max`, `average` or `countdistinct`. The request is
`$apply=filter(…)/groupby((health),aggregate($count as count,budget with sum as budget))`
(`criteria/compile.ts:200`, `ODataSource.aggregate`). Rows come in the group
value's order, descending when the query's sort has that field descending.
The query can be a signal: a change replaces it, sets `rows` back to
`undefined` and counts again. Any save or external change to the set recounts
after 50 ms, once for a burst (`:18`, `:117`), so an edit that moves a record
between groups changes the counts without any collection being loaded. A
relative date in the query resolves against the context's clock for each
count (`:94`). `error` holds a failed request.

**Invariants.**

- An answer to an older query or an earlier recount is dropped (`:100`).
- A read doesn't recount: only changes whose origin isn't `fetch` do (`:59`).
- A field the set doesn't have throws when the groups are made.
- Decimal and Int64 totals arrive as exact strings, in OData JSON form.
- `dispose()` stops following the store and the query.
- `data-core.test.ts:375` covers counts, totals, order and a recount after a
  change.

## Selection

**What it's for.** The keys chosen in a collection, as data in the core
rather than a signal the UI keeps valid (`selection/selection.ts:26`). Any
view can read it, and a listbox or a rule can follow it.

```ts
import { Selection } from "@getaster/data";

const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });
const chosen = new Selection(ctx.store, people);   // single, with fallback
await people.loadAll();
chosen.key.value;            // the first row's key: nothing chosen yet, so it falls back
chosen.select(keyText([4]));
chosen.selected.value?.name; // live from the store: an edit to person 4 shows at once
```

| Member | Meaning |
|---|---|
| `keys`, `key` | Selected keys / the first one |
| `records`, `selected` | The selected records / the first one, read from the store |
| `count`, `any`, `many` | Flags that rules read |
| `select(key)`, `toggle(key)`, `selectAll(keys)`, `clear()` | Writes |
| option `multiple` | Several keys; `toggle` adds and removes |
| option `fallback` | On by default for single selection |

The collection can be a signal (`:45`). The app's project selection follows
the current tab's collection (`apps/aster/src/model.ts:120`).

**Invariants.**

- `keys` is derived and never written back (`:49–73`). Chosen keys that have
  left the collection drop out as soon as it changes. A key seen loaded under
  the current query stays while its page is unloaded, as long as the store
  holds the record; `setQuery` swaps the query object, which forgets what was
  seen.
- With fallback, when nothing chosen is loaded, the first loaded row is
  selected, so a detail view always has a record. Before the collection's
  first page, chosen keys are kept as they are (`:56`).
- `records` reads each record's signal, so edits to selected records show
  without reselecting (`page-rules.test.ts:52`).

## EditModel

**What it's for.** Uncommitted values for one record, apart from the store
(`edit/edit-model.ts:60`). It tracks the baseline (the stored record the edit
started from, or the defaults for a new one), values, errors, a form-level
error, busy, conflicts and deletion. Construct it with `(ctx, set, key?,
defaults?, { rules? })`.

```ts
import { EditModel } from "@getaster/data";

const edit = new EditModel(ctx, "Projects", keyText([2]));
edit.set("name", "");
edit.valid.value;                   // false, and nothing shown yet
edit.validate();                    // false; errors are shown now
edit.errors.value.name;             // ["Project can't be blank."]
edit.set("name", "Brand refresh 2027");
edit.errors.value.name;             // undefined: the error followed the value
edit.pending("name").value;         // true
edit.state("updatedAt").value;      // { readOnly: true, reasons: { readOnly: "Updated is set by the server." }, … }

const saved = await edit.save();    // Saved, or undefined with the reason in errors, formError, conflict or deleted
edit.dispose();
```

An app rule is a function from values to messages by field, as the project
page's "Spent can't be more than the budget" (`apps/aster/src/pages/project.ts:203`).

**Field state** (`state(name)`, `:349`). A `FieldState` signal: `visible`,
`enabled`, `readOnly`, `required` and a reason for each that isn't the
default. It combines the field's page rules (below) with what metadata and the
record say: computed fields are read-only ("set by the server"), immutable
ones once saved, every field of a deleted record; a non-nullable,
non-computed field is required (`:357–369`).

**Hidden values.** A field the server hides on the record (`hidden`, `:101`;
see "RecordStore") is read-only with the reason "You can't see Budget on this
record." (`:383–385`). It's never pending, even when forced, never
validated, and never sent: every diff the model takes leaves it out
(`#diff`, `:621`), so neither `dirty`, `changes()` nor a save can act on its
`null`. The server would write a hidden field it was sent, so this matters.
A field that becomes hidden while it's edited here is a conflict, since its
value moved to `null`; `rebase()` then drops the edit (`#theirs`). A
deleted record's change set leaves its hidden fields out, so an undo
doesn't write `null` back (`context.ts`, `list-edit.ts`).

**Page rules on fields.** `applyRules(scope, target, rules)` (`:262`) takes
`visible`, `enabled`, `readOnly` and `required` conditions per field, each
optionally with a reason, and registers them in the scope as
`<target>.<field>` for `explain`. `edit.explain(name)` returns them with what
they read now (`:276`). The model applies these states as follows:

- **Required** is part of validation, for every ruled field (`#check`, `:433–438`).
- **Read-only** blocks `set()` and shows the reason as the field's error
  (`:223–226`). A value changed before the field became read-only stays pending
  and is sent (decision 2).
- **Hidden** fields keep their values, are sent, and aren't validated on the
  client (`:447–449`). With `clearWhenHidden`, a change from shown to hidden sets
  the value to null, and that null is the change (decision 1). A field that
  starts hidden keeps its value, whatever order the page was set up in
  (`:252–257`).
- **Derived** values (`derived` in a field's rules: cases for `scope.select`,
  or a signal computed in code, in the field's JSON form) are described under
  "PageScope and rules".

**Validation.** `validate()` shows errors; `valid` is the same check as a
signal, with nothing shown (`:102`). The check (`#check`, `:429`) runs the
metadata validators (on update, changed fields only), required-by-rule, then
app rules, whose messages win. Once a field shows an error, the error follows
the value: `set()` replaces it with the current problem or clears it
(`:228–233`). Errors first appear only on validate or save.

**Conflicts and deletion.** The model watches the store for its record
(`:121`). Another change (`#theirs`, `:560`) is followed when there are no
local edits, rebased under them when it touched other fields, and raised as
`conflict = { theirs, fields }` when it touched the same ones; then `save()`
refuses until `rebase()` (keep mine) or `discard()` (take theirs). A removal
sets `deleted` and a form error, makes every field read-only, and `save()`
refuses (`:125–130`, `:471`).

**Save** (`:470`) validates, then creates, or sends only the changed fields
with the baseline's ETag. Server field errors land on their fields; other
failures go to `formError`. On a 412 the context reloads the record; if that
rebased silently, the save is validated and sent once more (`:479–489`), so a
change to other fields doesn't stop the save. If it raised a conflict,
`conflict` says so. Values typed while the save was in flight stay, on top of the
saved record, and remain pending.

**Empty text.** `set()` turns `""` into null on a field marked
`AsterData.EmptyAsNull`; on other fields the text is kept (`:221`).

**Saved elsewhere.** `accept(saved?)` takes a save made elsewhere, such as a
parent's deep update, as the new starting point: the saved record if given,
otherwise the current values. It clears forced pending, errors and the form
error (`:157`). `etag` is the ETag of the version the edit started from
(`:149`). `showErrors(errors)` puts errors the server gave for this record on
its fields, replacing the ones shown; it's how a deep update's error on a
child reaches the child's row (`:174`).

**Drafts.** `draft()` is the working state as plain data: the key, baseline,
values, ETag and the fields forced pending (`:179`). `resume(draft)` takes it
up, and throws for a draft of another record (`:196`). If the stored record
has moved on since the draft was made, that's handled as any external change:
followed where nothing was edited here, rebased under the edits when the
other change touched other fields, a `conflict` when it touched the same
ones (`:204–206`, `#theirs`, `:560`). A draft survives `JSON.stringify`, so
storing it is the app's to do; the demo keeps them in IndexedDB
(`apps/aster/src/drafts.ts:14`).

**Replay.** `EditModel.replay(ctx, set, before, after, forced?)` shows a past
change: `before` is the baseline and `after` the values, so `pending` marks
exactly the fields that differ, and those in `forced` (`:140`). Every field is
read-only with the reason "This is a past change." (`:357–359`) and `save()`
returns `undefined` (`:471`). It's built as a record with no key, so `isNew` is
true: a replayed field has no Revert, and the bound field draws it as pending
but doesn't describe it as changed in words.

**Invariants.**

- The store is never written until the server accepts the save.
- The baseline is always a version of the stored record, and the ETag sent is
  that version's.
- The model ignores the store echo of its own save (`origin.by === this`, `:134`).
- A field hidden on the record is never sent (`#diff`, `:621`).
- `save()` returning `undefined` always leaves the reason in `errors`,
  `formError`, `conflict` or `deleted`.

## PageScope and rules

**What it's for.** How components on a page react to each other without
references to each other (`scope/scope.ts:130`). A component publishes named
signals under a key; anything reads them by path, `key.name.property`.

| Member | Does |
|---|---|
| `publish(key, publication)` | Adds a publication; returns the function that withdraws it (`:150`) |
| `child()` | A scope whose keys shadow the parent's and whose misses fall through (`:145`) |
| `value(path)` | A signal of the path's value; `undefined` while the key is unpublished. From a typed record it follows single-valued navigations (below) (`:215`) |
| `select(cases)` | A derived value: the first case whose rule holds (below) (`:241`) |
| `field(path)` | The CSDL field a path reads, when the publication gives the record type (`:271`) |
| `when(condition)` | Whether a condition holds, as a signal (`:287`) |
| `state(target, rules)` | A `FieldState` signal with reasons, registered under `target` (`:304`) |
| `explain(target)`, `readers(path)`, `keys()` | Which rules decided and what they read; which targets read a path; who published what (`:334`, `:347`, `:165`) |
| `schema()` | Every published key's names as plain data: where a publication gives a record type, the type's name and its fields' CSDL types. For rule builders and tools (`:175`) |
| `check(path)` | Why a path can't be read, or `undefined`: nothing published under the key, no such name, no such field on the record type, a path that goes past a field (`:194`) |
| `now` | The clock relative dates in rules resolve against: `new PageScope(parent?, { now })`; a child has its parent's (`:133`, `:141`) |
| `ctx` | The `DataContext` paths through related records read from: `new PageScope(parent?, { ctx })`; a child has its parent's (`:136`) |

A `Condition` (`:25`) is criteria whose fields are paths, or a bare path
meaning "is true", combined with `and`, `or` and `not` at any depth.
`toCriteria` spells it out as plain criteria (`:32`), so rules are evaluated
by the same `matches()` as queries. A path into a publication that gives its
record type is typed by its CSDL field; otherwise by its value, or, while
it's null, by what the rule compares it with (`#ruleType`, `:419`). A
comparison between two paths uses `other`.

A field hidden on the record a publication holds is unknown to a rule, not
`null`. A publication says which fields are hidden through `hidden`, by name
(`selectionPublication`, `editPublication` and `inputPublication` do). Any
test of such a field is unknown, so `eq null` doesn't hold and neither does
its `not`; a rule holds only when it's true, as a filter does (`when`,
`:216`; `#hidden`, `:234`; `matches(c, e, type, related, unknown)`,
`criteria/evaluate.ts:120`). `explain` lists those paths as `unknown`.
Rows that `any` and `all` range over aren't checked for hidden fields.

**Standard publications** (`scope/publications.ts`) give every component of a
kind the same names:

| Function | Publishes |
|---|---|
| `selectionPublication` (`:14`) | `selected`, `records`, `keys`, `key`, `count`, `any`, `many`; `selected` is typed |
| `editPublication` (`:30`) | `values`, `record` (as saved), `dirty`, `valid`, `errors`, `mode`, `busy`, `deleted`; `values` and `record` are typed |
| `collectionPublication` (`:47`) | `total`, `loading`, `complete`, `stale` |
| `listPublication` (`:62`) | A repeating group: `rows`, the values of a `ListEdit`'s rows that aren't being removed, typed by the list's record type; and `count` |
| `inputPublication` (`:72`) | A page's input: `key`, plain text, and `record`, looked up from it and typed |
| `valuesPublication` (`:77`) | App signals under names the app chooses |

**The project page's rules** (`apps/aster/src/pages/project.ts:34–36`,
`:216–241`): Days behind shows and is required while Status is Behind; an
archived project is read-only, with its reason; Save is enabled while the
project or its tasks have changes.

```ts
const BEHIND: Condition = { op: "eq", field: "project.values.health", value: "behind" };
const ARCHIVED: Condition = { op: "eq", field: "project.record.state", value: "archived" };
const LOCKED = { when: ARCHIVED, reason: "Archived projects can't be edited. Set State to Active to restore it." };

scope.publish("project", editPublication(edit));
edit.applyRules(scope, "project", {
  name: { readOnly: LOCKED },
  behindDays: { visible: BEHIND, required: BEHIND, readOnly: LOCKED, clearWhenHidden: true },
  // leadId, health, budget, spent: { readOnly: LOCKED }
});
scope.publish("tasks", valuesPublication({ dirty: tasks.dirty, valid: tasks.valid }));
const save = scope.state("save", {
  enabled: { when: { op: "or", args: ["project.dirty", "tasks.dirty"] }, reason: "No changes to save." },
});
```

`ARCHIVED` reads `record`, the saved values, so changing State in the form
doesn't unlock the other fields until the change is saved. `scope.explain("project.behindDays")`
returns each rule with `holds` and `reads` such as
`{ "project.values.health": "onTrack" }`; the demo's `?debug` panel shows it
for the focused field (`apps/aster/src/debug.ts:25`).

**Invariants.**

- A key has one publisher per scope. Publishing a taken key throws, and so
  does a key with a dot (`:131–133`).
- Reading is order-free: an unpublished key reads as `undefined`, and a rule
  re-evaluates when it's published. Mount order and lazy panes don't matter
  (`page-rules.test.ts:201`).
- Rules can't write to the scope, so they have no order and can't loop.
  Dependencies are the signals each `computed` read, not path matching.
- A rule compares plain values only; a path to an object or array throws a
  `CriteriaError` (`:419`).
- `reasons` holds a reason only for an effect that isn't at its default
  (`:248`).

**Rules over a repeating group.** A list's rows are published with
`listPublication`, and a rule ranges over them with `any` and `all`. The rule
names the list by its path, `<key>.rows`, and `where` names the rows'
properties:

```ts
scope.publish("answers", listPublication(answersList));          // a ListEdit of a field's answers
const hasOther = scope.when({ op: "any", field: "answers.rows", where: { op: "eq", field: "key", value: "other" } });
const allLabelled = scope.when({ op: "all", field: "answers.rows", where: { op: "ne", field: "label", value: "" } });
answersList.add({ key: "other", label: "" });                    // hasOther: true; allLabelled: false
```

The scope hands `matches` the rows as a list and tells it their type from the
publication (`when`, `scope/scope.ts:292–299`). The rule follows edits: a new
row counts as soon as it's added, a row marked for removal stops counting
(`publications.ts:63`). The list's path must be one the publication types
(`rows` is), or the rule throws; so does a path that isn't a list
(`scope.ts:540`). The scope can type only the lists it publishes, so an `any`
inside an `any` works in a query and throws in a rule (`scope.ts:299`).
`tests/integration/page-rules-contract.test.ts:73` covers a single level.

**Relative dates in rules.** A rule with a relative date resolves it against
the scope's `now` each time the rule is evaluated (`scope.ts:298`), which is when
something it reads changes. Nothing re-evaluates a rule because the clock
moved. `scope.check("task.values.due")` and the typed `scope.schema()` tell a
rule builder which paths exist before a rule is written.

**Criteria validators.** `criteriaRule(type, field, validator, now?)` makes an
`EditModel` rule from criteria (`validate/criteria-rule.ts:30`).
The value passes while `passWhen` holds, or fails while `failWhen` does;
exactly one is given (`:32`). A test without a `field` is about the validated
field itself, and one that names fields reads the record (`OwnCriteria`,
`:11`; `own`, `:41`). A null value isn't checked: required is its own rule
(`:35`). Relative dates resolve against `now`, which defaults to the wall
clock, so pass the context's.

```ts
const type = ctx.schema.set("Tasks").type;
const rules = [
  criteriaRule(type, "title", { failWhen: { op: "startswith", value: "TODO" }, message: "Give it a real title." }),
  criteriaRule(type, "due", { passWhen: { op: "ge", value: { relative: "today", days: -365 } }, message: "Due dates go back a year at most." }, ctx.now),
  criteriaRule(type, "assigneeId", { failWhen: { op: "and", args: [{ op: "eq", field: "done", value: true }, { op: "eq", value: 12 }] }, message: "Ken can't hold done tasks." }),
];
const edit = new EditModel(ctx, "Tasks", key, {}, { rules });   // the message lands on the field, and wins over metadata's
```

**Templates.** `parseTemplate("{name} ({count == 1 ? 'one task' : count})")`
(`template/template.ts:39`) parses display text with values in it. Inside
braces it reads paths (`project.name`), string, number and boolean literals,
`null`, `== != < <= > >=`, `&&`, `||`, `!`, the conditional `a ? b : c` and
parentheses; `{{` and `}}` are literal braces (`:1–9`). The result is a tree,
walked by `render(lookup)`; nothing is compiled, so text from an untrusted
source can't run code and a strict CSP holds. Anything else, a call, `+`, `;`,
an unclosed brace, is a `TemplateError` with its offset (`:30`, `:35`).
`template.paths` lists what it reads, to follow them in the scope
(`:12`). A null or missing value renders as nothing (`:204`); `==` is strict,
so `"1"` doesn't equal `1`; ordering compares numbers with numbers and text
with text and is false otherwise (`:185`, `:189–194`). A `}` can't appear in a
string literal, and there are no negative literals (`:56`, `:37`).

**Paths through related records.** From a publication that gives its record
type, a path step that names a single-valued navigation reads the related
record from the store: `task.values.project.lead.name` follows the task's
project and then its lead (`value`, `scope.ts:215`; `#steps`, `:358`;
`#related`, `:382`). The scope needs a data context for that,
`new PageScope(parent, { ctx })`; the demo's root scope has one. A record that
isn't loaded is fetched through `ctx.lookup`, batched, and the path reads
`undefined` until it arrives. A missing foreign key is no related record, so
the path reads `null`. The path follows the foreign key as it changes. It's
typed at the end, so `scope.field("task.values.project.createdAt")` is the
project's `Edm.DateTimeOffset` field, and a rule compares it as one. A path
follows at most `MAX_HOPS` (3) navigations (`:93`). `check(path)` names the
problem with a bad one: an unknown field, a to-many navigation (use `any` or
`all`), a step past a field, too many hops, or no data context.
Related lists support aggregate cases in `scope.select`:

```ts
const lowest = scope.select([
  { aggregate: "min", path: "task.values.project.tasks", field: "id" },
], "lowestTask");
// Read lowest.value; dispose when the consumer goes away.
lowest.dispose();
```

`min`, `max` and `average` query the entire related list through `$apply`,
including unloaded rows. A path follows at most three navigations and ends
on a list with foreign keys. `average` needs a numeric field; `min` and `max`
also accept text and temporal fields. Nulls are ignored, an empty or absent
list yields null, and loading yields undefined. Parent key changes invalidate
old answers immediately; writes to the target set trigger a recount. Request
errors leave the value undecided and appear in `scope.explain(target)`.
An edit model owns and disposes the signals for its case-based derived fields.

**Derived values.** `scope.select(cases)` (`:241`) gives the value of the
first case whose `when` holds, and a case without `when` is the default. A
case's value is a literal (`value`), another path (`path`), or a template
(`template`, parsed as below). The result is `undefined` when no case applies.
It's also `undefined` while a path it needs reads `undefined` (an unpublished
key, a related record still loading), so nothing is decided on data that
isn't there yet. A template waits for all its paths the same way. A null still
counts as a value.

```ts
const label = scope.select([
  { when: { op: "eq", field: "p.health", value: "behind" }, template: "{p.days == 1 ? 'A day' : p.days} behind" },
  { when: { op: "eq", field: "p.health", value: "atRisk" }, value: "At risk" },
  { path: "p.health" },
]);
```

On an edit-model field, `derived` in `applyRules` takes cases or a signal
(`edit-model.ts:247`). The design's rule:

- A **read-only** field always takes its derived value, and takes it again if
  something puts another value there, such as `revert()`. On an existing
  record that can make the record dirty on open: the derived value is the
  truth.
- An **editable** field takes it as a **suggestion**: on a new record from
  the start, and on any record whenever the derived value changes, until the
  person changes the field with `set()`. Their value sticks after that. On an
  existing record the stored value stands until the derived value first
  changes, so opening a record never changes it (`#derive`, `:306`).
- `edit.derived(name)` says whether the field holds its derived value, not
  typed over (`:284`). `revert(name)` clears the typed mark, so the next change
  suggests again (`:403`). Bound controls show “Suggested value” visibly and
  in their accessible description until the user overrides it. `draft()` keeps the typed fields (`typed`), and
  `resume` takes them up.
- A value typed before the field became read-only stays (decision 2). A
  server-set (`Core.Computed`) field can't have a derived value.
- Derived values that feed each other and never settle (A is B + 1, B is
  A + 1) throw a `CriteriaError` naming the fields, from the write that
  started it (`#write`, `:329`). Ones that agree settle.

The demo's Time grid suggests billable from the entry's project
(`apps/aster/src/pages/time.ts:37`):

```ts
billable: { derived: [{ when: { op: "eq", field: "row.values.project.clientId", value: null }, value: false }, { value: true }] },
```

`edit.explain(name)` also shows derived cases, their zero-based selected case,
input paths, result, current field value and whether the user overrode it.
The demo debug panel shows this alongside state rules.

`tests/integration/derived-values.test.ts` covers the cases, both kinds of
field, existing records, drafts, loops and related paths.

**Page inputs.** `inputPublication(ctx, set, key)` publishes the record a page
was opened with as `key` and `record` (`publications.ts:72`). The key is plain
text, so a page opened in another tab or window from the same address has the
same input (`page-rules-contract.test.ts:197`).

## ListEdit

**What it's for.** Editing a collection's rows together: changes to existing
rows, new rows and rows marked for deletion are all pending until `save()`
(`edit/list-edit.ts:63`). The project page's task list uses it, and a
`RecordEdit` holds one for each collection its record owns.

```ts
import { ListEdit } from "@getaster/data";

const rows = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "projectId", value: 3 } });
await rows.loadAll();
const tasks = new ListEdit(ctx, rows, { defaults: () => ({ projectId: 3, title: "", done: false }) });
tasks.rows.value[0]!.edit.set("done", true);   // an ordinary EditModel per row
const added = tasks.add({ title: "Write the brief" });
tasks.remove(tasks.rows.value[1]!.id);         // marked, not deleted
tasks.changes();                               // [delete, update, create] change sets
const { saved, failed } = await tasks.save();
```

`rows` lists existing rows in the collection's order, then new rows in the
order added; each is `{ id, edit, isNew, removing, links? }` (`:10`). `dirty`,
`valid` and `busy` are signals; `restore(id)` takes back a pending deletion,
and `revert()` throws away everything (`:229`). `set` and `type` say which
entity the rows are (`:64–65`).

**Order.** With a `positionField` (`:30`) the rows are shown in that field's
order, ties in the collection's order, and `ordered` is true (`:85`,
`:121–124`). `add` gives a new row the next place: the number of rows not
being removed, plus one (`:173`). `move(id, index)` puts a row at `index`
among the rows not being removed and renumbers the field from 1, as ordinary
edits to each row whose number changed (`:202–211`), so a reorder is
pending, revertible and in the change set like any other edit.

**Links between new rows.** `add(values, links)` takes `links`: by field, the
id of another new row whose key that field takes (`:170`). `save()` creates
the rows in the order added and sets the field from the key the other row got
(`:265–279`). A `RecordEdit` doesn't create them in turn: it sends the child
inside its parent's entry (see "RecordEdit").

**Saved elsewhere.** `accept()` takes the list's state as saved by something
else, such as a deep update of the parent: changed rows keep their values as
the new baseline, new rows and pending deletions are dropped, and the
collection's refresh brings the saved rows (`:293`).

**Drafts and replay.** `draft()` and `resume(draft)` keep the new rows (with
their links), pending deletions and edited rows as plain data (`ListDraft`,
`:40`, `:304`, `:316`); rows a draft names that are no longer in the list are
dropped. `ListEdit.replay(ctx, set, before, changes)` shows past changes over
the rows as they were: updated rows pending in the fields that changed,
removed rows marked for removal, added rows pending in full (`:137`). A replay
is read-only: `add` throws, the others do nothing (`:171`, `:182`, `:244`),
and it has no `collection` (`:67`).

**Invariants.**

- An existing row keeps one edit model while it's in the collection
  (`#editFor`, `:350`), so its edits survive re-sorting and refreshes.
- A new row is pending in every non-computed field (`#newEdit`, `:337`).
  Removing it discards it; removing an existing row only marks it (`:181–190`).
- `save()` applies deletions, then updates, then creations, one write at a
  time (`:243`). A failed write leaves its row pending and the rest still go;
  `failed` lists them. It isn't atomic. A record and the collections it owns
  save atomically through `RecordEdit`.

## RecordEdit

**What it's for.** Editing a record together with the collections it owns
(`edit/record-edit.ts:57`). A navigation marked `AsterData.Owned`, such as a
field's answers or rules, holds children that can't exist without the parent.
So the record and its children are edited as one thing: one change set, one
validation, one save, one conflict check. The owned collections come from
`$metadata`; nothing is written per record type.

```ts
import { RecordEdit } from "@getaster/data";

await ctx.collection({ set: "Fields", filter: { op: "eq", field: "id", value: 4 } }).ensure(0, 1);   // the record must be in the store
const field = new RecordEdit(ctx, "Fields", keyText([4]), { owned: { answers: { positionField: "position" } } });
await field.ready;                                   // its answers and clauses have loaded
field.edit.set("label", "Type of client");           // the record's fields: an EditModel
const answers = field.owned.answers!;                // a ListEdit for each owned collection
answers.remove(answers.rows.value[0]!.id);
answers.add({ key: "club", label: "Club" });
field.changes();     // one update: changes.label, and owned.answers = [delete, create]
field.problems();    // { record: [], owned: {} }
const result = await field.save();   // one PATCH; { ok: true, change, before, failed: [] }
```

| Member | Meaning |
|---|---|
| `edit` | The record's own fields, an `EditModel` (`:60`) |
| `owned` | A `ListEdit` for each owned collection, by navigation name. Its rows are the target's rows whose foreign key is the record's, in `positionField` order or by key, and a new row's foreign key is the record's (`:92–100`, `:314–325`). `options.owned` gives each list its `ListEditOptions` (`:25`) |
| `ready` | Settles when every owned collection has loaded (`:103`) |
| `dirty`, `valid` | The record or any list has changes; the record and every list are valid (`:106–107`) |
| `changes()` | The change a save would make, or `undefined` (`:143`) |
| `problems()` | What fails validation (`:161`) |
| `snapshot()` | The record and its existing owned rows as they were when editing began (`:134`) |
| `revert()`, `dispose()` | Throws away every change; releases the owned collections (`:282`, `:307`) |
| `failure` | Why the last save failed, when it isn't about a field (`:280`) |

**One change set.** `changes()` is a single `update` change set: the record's
field changes, and `owned`, the child change sets of each list that has any,
by navigation name. A list's are in the order it saves them: removals,
updates, creations (`:143–158`; `list-edit.ts:214`). A child is identified by
its key, not its position.

**Validation.** `problems()` validates every field of the record and of every
row not being removed, shown or not, so a tab nobody opened can still be
named. It shows the errors it finds and returns the record's field names and,
for each owned collection, the failing rows by `ListRow.id` with their field
names (`:161–169`).

**Saving.** `save()` (`:180`) returns `undefined` for a replay, when nothing
changed, and when `problems()` finds anything. Otherwise it sends one PATCH
with the record's changed fields and `<navigation>@delta` for each list that
changed (`#deltas`, `:211`), with `If-Match` set from the record's ETag:

- a removed row is `{ removed: key }` and a changed row its key and changed
  values (`:220–230`);
- a new row is its values that differ from the defaults (`creatable`, `:224`);
- a new row linked to another new row (`ListEdit.add(values, links)`) goes
  inside that row's entry, under the navigation of the child type whose
  foreign key is the link's field, and the link field is left out. This nests
  to any depth, whatever the order the rows were added in (`:233–247`).

The server applies the whole request or none of it
(`tests/integration/record-edit.test.ts:174`). On success the record takes the
response as its baseline and ETag, each list `accept`s, and the collections
refresh to bring the new rows' keys (`:191–195`). The `RecordSave` has `ok`,
`change` (what was sent; new rows have no key yet), `before` (the snapshot
taken before) and `failed` (`:31`). On a refusal `ok` is false, nothing is
saved and everything stays pending.

**Errors land on rows.** A detail whose `target` is `answers[2]/label` is the
third `answers` entry of the request, its `label`: it is shown on that row
(`EditModel.showErrors`). A bare name goes to the record's own field. If no
detail lands on a row or the record, `failure` is the server's message
(`#showErrors`, `:257–276`).

**412.** `ctx.update` reloads the record on a 412 as an external change, so the
edit model follows it, or raises `edit.conflict` when it touched the same
fields (`context.ts:215`; `edit-model.ts:560`). With no conflict, `save()`
sends once more with the new ETag; with one, it returns `ok: false` and
`conflict` says so (`record-edit.ts:199`).

**Replay.** `RecordEdit.replay(ctx, before, change)` shows a saved change over
the record and rows as they were: the record's fields and each list as
replays, read-only, pending marking exactly what the change did (`:115`).
`before` is a `RecordSnapshot` and both it and `change` are plain data, so a
log can keep them as JSON. A delete shows every owned row as removed; a
create shows only the values (`:123–126`). `save()` on a replay returns
`undefined` (`:181`).

**Drafts.** `draft()` is the working copy as plain data, the record's
`EditDraft` and a `ListDraft` for each list (`:289`). `resume(draft)` waits for
`ready`, then takes each up; a stored record that moved on since is followed
or becomes a conflict, as in `EditModel.resume` (`:296–305`).

**The model screen** uses it for a field: Definition, Answers, Visibility and
Messages are one `RecordEdit` (`apps/aster/src/pages/field-editor.ts:119`).
It logs a save only when `ok` is true, with `before` and `change` as JSON
(`apps/aster/src/pages/infomodel.ts:213`); the log's replay is `RecordEdit.replay`
(`:485–489`).

**Invariants.**

- A save is one request, and the store changes only after the server accepts
  it. A refused child saves none of it, and the rest stays pending
  (`record-edit.test.ts:174`).
- The change set holds exactly what changed, by key: the record's fields, and
  each child's add, update or removal; a field changed back by hand drops out
  (`record-edit.test.ts:42`).
- A draft survives `JSON.stringify` and resumes onto a fresh context
  (`record-edit.test.ts:133`).
- A replay never saves and has nothing pending but what the change did
  (`record-edit.test.ts:104`).

## Queries that follow the page

**What it's for.** A list whose query depends on something else on the page,
such as the selected person. `ctx.collection` takes a `ReadonlySignal<Query>`
as well as a query (`context.ts:55`). The collection follows it: each new
query goes through `setQuery`, which drops the rows at once, so nothing from
the old query shows as an answer to the new one, and reloads the first page if
the collection had loaded (`collection/collection.ts:89`). The People page
calls `loadAll()` again when the selection changes.

The People page's detail lists follow the selection through the scope
(`apps/aster/src/pages/people.ts:154–167`):

```ts
const personId = scope.value("people.selected.id");
const follow = (build: (id: number) => Query) => computed(() => build((personId.value as number | undefined) ?? -1));
const leads = ctx.collection(
  follow((id) => ({ set: "Projects", filter: { op: "eq", field: "leadId", value: id }, orderBy: [{ field: "name" }] })),
  { pageSize: 200 },
);
```

The listbox publishes `people`; the lists don't know it exists.
`page-rules.test.ts:223` checks that a detail list never shows the last
person's rows.

**Invariants.**

- A collection stays on one entity set; `setQuery` to another throws (`:87`).
- Responses to the old query are dropped by the generation counter.
- `ctx.release(c)` stops both store sync and following (`context.ts:77`).

## Shared filters

**What it's for.** Dashboards: a period, a chart's bar or a list's selection
narrows other lists on the page without wiring them together
(`scope/filters.ts:90`). A `SharedFilters` holds named contributions, and
collections opt in to combining them with their own query. Nothing
contributes or consumes by default. See the
[dashboard guide](dashboard-widgets.md) for a complete application pattern.

| Member | Does |
|---|---|
| `set(contribution)` | Adds or replaces the contributor's entry, in place. Criteria on a set are checked against it at once (`:103`) |
| `remove(by)`, `clear()`, `removable(by)` | Withdraws one entry, or all that can be removed (`:113`, `:128`, `:123`) |
| `share(by, source, clear?)` | Follows a signal of a contribution; `undefined` withdraws. `clear` is how the contributor withdraws when someone else removes it (`:139`) |
| `consume(set, options)` | How the contributions apply to a collection on `set`: `criteria` (ANDed), `applied` and `skipped` with reasons (`:155`) |
| `query(base, options)` | `base` (a query or a signal of one) with the applied criteria ANDed on, for `ctx.collection` or `ctx.groups` (`:176`) |
| `contributions` | The entries, as a signal |

A `Contribution` (`:20`) has `by` (the contributor's name), `label` (said in
words, for chips: "Status: Approved"), `criteria`, and optionally `set`,
`related`, `fields`, `only` and `kind`.

```ts
const filters = new SharedFilters(ctx.schema);
scope.publish("filters", filtersPublication(filters));   // filters.any, filters.count, filters.labels for rules and labels
filters.set({ by: "health", label: "Project health: Behind", set: "Projects", criteria: { op: "eq", field: "health", value: "behind" } });
filters.set({ by: "period", label: "Last 30 days", set: "TimeEntries", criteria: { op: "ge", field: "date", value: { relative: "today", days: -29 } } });
const entries = ctx.collection(filters.query({ set: "TimeEntries", orderBy: [{ field: "date", descending: true }] }));
// $filter=project/health eq 'behind' and date ge 2026-09-08
```

**Matching** (`#match`, `:208`):

- **On a set.** A contribution with `set` applies to collections on that set
  as written. Otherwise it follows a unique shortest path of up to three
  single-valued navigations, through nested `via` nodes: a time entry's
  `project.client`. Collection and reverse hops are excluded, as are cycles. A test of
  the related record's key alone (`id in (1, 2)`) becomes a test of the
  foreign key (`projectId in (1, 2)`), which a collection can place locally
  (`throughKey`). Equally short paths are ambiguous and skipped; a shorter
  direct path takes precedence. An unreachable set is skipped. With `related: false` the
  contribution stays on its own set.
- **By field name.** A contribution without `set` applies wherever the
  collection's set has every field it names, each with a compatible type
  (`byName`; `compatible`, `:280`): the same type, an integer into any number
  (converted to text for `Edm.Int64` and `Edm.Decimal`), or a relative date
  into a date or a timestamp. The types come from `fields` where given,
  otherwise from the literals: a boolean, an integer, a number, or text. So a
  date given as text needs `fields: { date: "Edm.Date" }`. A lambda or `via`
  needs a set.
- **A mismatch skips that contribution for that collection only**, with the
  reason in `skipped` ("People.status is Edm.Int32, not Edm.String"). The
  contribution still applies wherever it fits, and the collection still takes
  every other contribution.
- **Scoping.** `only: ["People"]` limits a contribution to collections on those
  sets.
- **Replacement.** A contributor's new contribution replaces only its own
  entry, keeping its place. All applied contributions are ANDed. The
  collection's own filter stays apart: `query` ANDs it with the shared part,
  so clearing one leaves the other.

**Loops.** A component that publishes and consumes could feed itself. The
rules that stop it:

- A consumer names its own contributions (`self`), and never consumes them. The
  Reports chart follows everything but its own bar.
- A contribution's `kind` is `filter` (a slice), `selection` (records by
  identity, "these keys") or `value` (a value picked from data, "status is
  approved"). A list ignores an identity selection on its own set, which would
  only copy its peer's selection. A KPI that totals selected rows passes
  `sameSetSelections: true`. A value selection narrows a list on the same set.
- `from: [...]` limits which contributors' selections and values drive a
  consumer. Filters always apply, so `from: []` follows slices only.
- `selectionShare(selection, label)` (`:251`) makes a selection a contribution
  that's withdrawn when nothing is selected. A selection drops keys that leave
  its collection, so a slice that removes the selected row withdraws the
  selection's narrowing in the same step.
- A name has one follower at a time (`share` twice throws), and a followed
  name can't also be `set` by hand.

**Relative dates** stay symbolic in the channel: `contributions` holds
`{ relative: "today", days: -29 }`. Each collection resolves them at each
fetch against its clock, through a hop too (`project/createdAt ge …`).

**Invariants.**

- A contribution applies to a collection whole or not at all.
- One entry per contributor.
- `consume` and `query` are signals: a contribution arriving, changing or
  leaving refetches only the collections it changes the query of.

`tests/integration/shared-filters.test.ts` covers each rule. The demo's
Reports page uses it with an `aster-slicer` ([elements.md](elements.md)).

### Saving shared filters with a screen

`filters.snapshot()` returns `{ version: 1, contributions }` as plain data.
Save it with the screen, then pass it to `filters.restore(snapshot)` before
opening its collections. Relative dates remain symbolic. Snapshots exclude
identity selections and signal-following contributors, whose state belongs
to their owners. Restore validates every set-scoped criterion before replacing
manual slices; a failed restore leaves the channel untouched. Live owners are
preserved and a saved entry cannot overwrite one.

Reports uses the browser key `aster-screen:reports:filters`, restores before
querying, and saves changes including Clear all. Storage failures leave the
current screen usable. This is browser-local screen state.


## Tree

**What it's for.** A self-referencing set seen as a hierarchy: tasks under
tasks by `parentId` (`tree/tree.ts:72`). The grid's tree mode and the drill-down
navigator are two views of one `Tree`, and two trees over the same data keep
their own state. It needs a single-field key and a parent field; otherwise the
constructor throws.

```ts
import { Tree } from "@getaster/data";

const tree = new Tree(ctx, {
  set: "Tasks",
  parentField: "parentId",
  base: computed((): Criteria => ({ op: "eq", field: "projectId", value: 3 })),
  orderBy: computed(() => [{ field: "id" }]),
});
tree.level(undefined);                          // the top level: a Collection
await tree.expand(keyText([12]));               // open task 12, load its first page
tree.rows.value;                                // the lines shown, top to bottom
await tree.reveal(keyText([40]));               // open the path to task 40; its row index
await tree.move(keyText([40]), keyText([7]));   // put task 40 under task 7
tree.dispose();
```

| Option | Meaning |
|---|---|
| `set`, `parentField`, `rootValue` | The set, the field holding a parent's key, and the parent value of top-level nodes: the parent field's `AsterData.RootValue` when the app gives none, else null (`:15–16`, `:108`) |
| `base` | A signal of criteria limiting the whole tree, such as one project's tasks |
| `filter`, `filterMode` | A signal of criteria, and how it applies (below) |
| `orderBy` | A signal of the sort among siblings |
| `pageSize` | Rows per request in a level (100) |
| `matchLimit`, `openLimit` | Matches beyond which keep-ancestors gives up (8,000), and folders opened to show where matches are (200) |

**Levels are collections.** Each level is a `Collection` of the nodes under one
parent: the parent criterion (the root value for the top), the view's filter,
`base` and `orderBy` (`#levelQuery`, `:329`). `level(parent)` makes it on first
use (`:129`) and returns the same one after. A level loads by page and follows
the store's sync rules like any collection, so a node whose parent changes
leaves one level and joins another, and an insert, update or delete reaches
every open level of every tree. `rows` lays the open levels out as lines from
the top (`:362`). A `TreeRow` has `key` (undefined for a placeholder not loaded
yet), `parent`, `level` (1 at the top), `position` and `siblings`, `folder`,
`open`, and its level's `collection` and `index`, so a view can load by page.

**Open state.** A set of keys, apart from the records: `open`, `expand(key)`,
`collapse(key)`, `toggle(key)` and `setOpen(keys)` (`:152`, `:175`). It survives
reloads, refresh and filter changes, and each tree has its own. `expand` opens
the folder and loads the level's first page. A key that no longer exists is
simply never shown, and a row is shown open only if it's a folder.

**Child counts.** Each level has a `Groups` of its loaded nodes by the parent
field, under the same filter as the level, so one request per level says which
nodes have children (`#countsFor`, `:346`). A row's `folder` is `true`, `false`
or `undefined` before the counts arrive; `hasChildren(key, parent)` is the same
answer. A leaf that gains a child becomes a folder when the counts follow the
change.

**Filtering.** `filter` is a signal, a grid's filter row for example. `base`
always applies.

- `keepAncestors` (the default) shows each match with the path to it. The tree
  fetches the matches (key and parent only), then walks up a level of parents
  per request, in chunks of 200 keys, until it reaches the root
  (`#findAncestors`, `:395`). Each level then shows its matches and the
  ancestors that sit under it, and the paths to matches are opened, nearest
  the top first, up to `openLimit`. `searching` is true meanwhile.
- `strict` applies the filter at every level, so a parent that doesn't match is
  hidden, and everything under it with it, since its level never opens.
- Past `matchLimit` (`:407`), keep-ancestors gives up: `tooBroad` is true, no
  ancestors are shown, and the levels show only matching nodes, as `strict`
  does. The owner says "narrow the filter".

**`ancestors`, `reveal` and `descendants`.**
`ancestors(key)` is the keys from the top down to the node's parent, reading
each record's parent field and loading records it doesn't have; a cycle in the
data throws instead of looping (`:188`, `:196`). `reveal(key)` (`:209`) opens
every folder on that path and loads each level's pages until the node is in
it, resolving to the node's row index, or -1 if the node isn't in this tree
(filtered out, or elsewhere). A node's place in its level is counted by the
server: the siblings that sort before it, as a filter built from the sort keys
(`#position`, `:271`). So a deep link to the last of 3,000 siblings loads one
page around it, not every page before. Where the sort can't be written as a
filter, a path into a related record or a null in a sort value, it loads page
by page until the node is in. `descendants(key)` (`:238`) lists every node
under a key, nearest first, with one request per level (in chunks of 200
parents), so a subtree can be shown before it's removed or moved.

**`move`.** `move(key, parent)` (`:303`) sets the parent field with `ctx.update`:
a node's key, or `undefined` for the top level. It refuses a move into the node
itself or its own subtree, by throwing. The store's sync takes the node out of
the old level and into the new one, and it keeps its open state. A move is one
write with the record's ETag, so a conflict is a 412 like any other. Moving
doesn't reorder: siblings stay in the sort's order. The Tasks page undoes a move
by moving back.

**Sync.** Because levels are collections over the store, a tree needs no
change feed of its own. `refresh()` reloads every level's viewed pages and keeps
the open folders open (`:313`); `dispose()` releases every collection and
count (`:317`).

**Invariants.**

- Open state and records are separate: collapsing and reopening a folder shows
  the same level, and a filter change never closes a folder by itself.
- The tree's lines are the open levels' keys in order, so a view that loads
  each `TreeRow`'s `collection` by its `index` loads exactly what's shown.
- A node is in one level at a time, the one under its current parent, however
  it got there (`tests/integration/tree.test.ts`, with a run of random creates,
  moves and deletes checked against the server).
- Counts are asked under the level's own filter, so an opener means there is
  something to show.

## ChangeSet

What a save changed, as plain serialisable data (`changes/changeset.ts:17`):
`create` (values), `update` (key plus `{ from, to }` per field, and optionally
`owned`) or `delete` (key plus the old values). Every `DataContext` write and
`EditModel.changes()` returns one.

```ts
import { invert, merge } from "@getaster/data";

const saved = await ctx.update("Projects", keyText([1]), { state: "paused" });
saved.change;   // { kind: "update", set: "Projects", key: [1], changes: { state: { from: "active", to: "paused" } } }
invert(saved.change, ctx.schema.set("Projects").type);   // state: paused → active
merge({ name: { from: "A", to: "B" } }, { name: { from: "B", to: "A" } });  // {}: ended where it began
```

`invert` of a delete is a create of the old values minus computed fields
(`:52–65`); `merge` keeps the first `from` and last `to` (`:69`); `writable`
removes computed properties before anything is sent (`:83`). `creatable`
(`:96`) is what a create sends: the writable values that differ from the
field's `$DefaultValue`, or from null without one.

**Owned changes.** An `update` can carry `owned` (`OwnedChanges`, `:10`,
`:24`): by navigation name, the change sets of that collection's children, each
a `create` with its values, an `update` with its key and field changes, or a
`delete` with its key and old values. `RecordEdit.changes()` builds one, so a
record's edit across its nested editors is a single change set that can be
stored and replayed by key (`RecordEdit.replay`). `diff`, `apply` and `merge`
work on a record's own fields and leave `owned` alone. `invert` of an update
that has `owned` throws: undo each child by itself (`:60`). `DataContext.run`
of an update runs its field changes and nothing else (`context.ts:161–167`).

## DataContext

**What it's for.** The entry point (`context.ts:25`). It holds the source,
the store and every live collection, and all writes go through it so sync
sees them.

| Method | Does |
|---|---|
| `DataContext.connect(transport, { now })` | Reads `$metadata` and builds the context. `now` is the clock relative dates resolve against, `Date.now` by default; the collections and groups it makes use it (`:36`, `:47`, `:61`, `:77`) |
| `collection(query or signal, options)` / `release(c)` | A live collection, following the signal if given / stops it |
| `groups(query or signal, field, aggregates)` | The query's groups by a field; see Groups |
| `lookup(set, key)` | See above |
| `create`, `update`, `remove` (each with an optional `by`) | Writes; `update` sends only the changes, with the stored ETag or the `ifMatch` it's given, and takes `deltas` to change owned collections in the same request (`:108`, `:120`, `:131`) |
| `reload(set, key, origin?)` | Reads one record again; removes it if it's gone |
| `run(change)` / `undo(saved)` | Runs a change set / its inverse |

**Invariants.**

- Writes are pessimistic: the store changes only after the server answers.
- On 412 or 404, the record is reloaded with origin `external` before the
  error is rethrown (`#guard`, `:211`), so open edit models see the server's
  version.
- Undo of a `Saved` is pinned to the version that save produced (`:178`), so
  a change someone made since is a 412, not overwritten
  (`data-core.test.ts:311`).

## Against aster-server

The data core talks to aster-odata's HTTP server through `fetchTransport`,
as it talks to the mock through the mock's transport; nothing else changes.

- `bun run test:http [memory|postgres|mariadb] [files]` runs
  `tests/integration` against a live server (`scripts/test-http.ts`). It uses
  aster-odata's harness (`harness/aster-ui`) in place: `@getaster/mock` is
  replaced by a module that converts the fixture to DataSources and starts a
  fresh server for each mock a test creates. `ASTER_ODATA_DIR` is the
  aster-odata checkout (`../aster-odata` by default) and `ASTER_SERVER_BIN`
  the server (its `target/debug/aster-server`; a release build is steadier on
  a loaded machine). The SQL backends take `ASTER_SERVER_POSTGRES_URL` or
  `ASTER_SERVER_MARIADB_URL`, scratch databases only: the run drops and
  creates its tables. `OUT` gets `test.log`, `summary.txt`, every request and
  response in `requests.jsonl`, and `server.log`. The harness converts
  `ViewableWhen` into server rules and `CountThreshold` into per-set
  thresholds. `countEstimate` selects a test-only server estimate factor;
  the marker tests run over HTTP too. The client accepts exact, omitted and
  explicitly marked estimated counts; the production service controls which
  it returns.
- `bun scripts/demo-server.ts [--port 8080]` serves the demo's whole seed
  (`fixtures/aster/demo.ts`) from aster-server in memory, with CORS open and
  `Reseed`. The demo opened with `?server=http://127.0.0.1:8080/odata` then
  uses it instead of the mock (`apps/aster/src/remote.ts`). This remote demo
  adapter does not subscribe to a production realtime channel: only the debug
  panel's "another user" writes are announced, and its faults do nothing.
  WebTransport with SSE fallback is the agreed direction; client integration
  awaits the server event and reconnect contract.

These repository commands are integration-test tooling. They do not establish
production readiness for an application or its identity provider.

## Implementation boundaries

The following boundaries apply to the client and demo tooling described here.
They are not a roadmap for the server:

- **Range-level staleness.** A stale collection refreshes the pages in view
  (or all it loaded, if it was never viewed); it doesn't work out which rows
  changed. A filter with `any`, `all` or `via` makes every change to the set,
  and every save to the related sets, stale.
  The engine caching a query's sorted order, so `$skip` pages are slices, is
  a request to aster-odata.
- **Hidden fields further down.** Only a record's own `@AsterData.Hidden`
  is read: the client doesn't `$expand`, and the rows `any` and `all` range
  over in a page rule aren't checked for hidden fields.
- **Rules over a grid's columns.** The grid's `rules` apply to a row's cells,
  in a scope per row; the grid publishes selection, view and total, not what
  it's editing.
- **Grouping APIs.** `Groups` is the single-field aggregate query. `Grouping`
  supplies lazy multi-level groups with per-level totals. See
  [filtering, grouping and export](filter-group-export.md).
- **Trees beyond the first cut** (v1): cascading selection, folders sorted
  apart from leaves, saved open state, reordering among siblings. Ancestors in one
  request and child counts by `$expand` wait on aster-odata; today it's a
  request per level.
- **Validation `applyWhen`** from the design isn't built.
- **Derived values, what's left.** A rule (`when`) can't use `via`; read
  through the navigation with a path instead. Paths follow single records
  only; aggregate cases handle related lists. The change set does not carry
  suggested-value provenance; `edit.derived(name)` and bound controls do.
- **Running authored rules.** The model screen edits a field's rules as
  `Clauses` rows, with a dependency viewer and an impact list built from
  queries over them. Nothing turns those rows into `Condition`s for a
  `PageScope`.
- **Atomic writes beyond a record and what it owns.** `RecordEdit` saves one
  record with its owned collections in one request. The client sends no
  `$batch`, so `ListEdit.save` on its own and the model screen's cascading
  remove (`apps/aster/src/pages/infomodel.ts:311`) write one record at a time.
  Unbound actions (spike scope).
- **Undo for owned changes.** `invert` of an update with `owned` throws, and
  `DataContext.run` ignores `owned` (`changes/changeset.ts:60`,
  `context.ts:161`).
- **A drafts store in the library.** `draft()` and `resume()` are in the edit
  models; where a draft lives is the app's (the demo uses IndexedDB,
  `apps/aster/src/drafts.ts`). The change log is the demo's `Changes` set.
- **Server-enforced rules** (v1): required, read-only and visibility as
  annotation expressions in `$metadata`, enforced by aster-odata, translated
  to criteria on load (decision 3). Today rules are client-side only.
- **Shared filters, what's left.** A time-of-day value doesn't filter a timestamp's time part (criteria have no
  `time()`). The reverse hop (a project list narrowed by a filter on its
  tasks) is not followed automatically; `any`
  written by hand covers the second. Two contributors with one name can't
  clash, as names are explicit, but nothing warns about two buttons sharing
  one.
- **Optimistic saves**, navigation `$expand` and an offline write queue are
  not supplied by the current client. Production realtime integration awaits
  the server contract; the mock demo reloads on its simulated notice. A general
  criteria editor is available as FilterBuilder and through Grid Advanced filter.
- **Server capabilities:** estimated-count and hidden-field markers are
  implemented. `AsterData.CascadeDelete` describes cascade policy, with client
  preview/delete adoption still pending. The integration suite and demo can
  run over HTTP as described above.
