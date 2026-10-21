# Multi-level grouping

An owned grid accepts an ordered grouping hierarchy. Existing single-field views
remain valid. Each open intermediate group owns a server grouped query; only
final-level groups create record collections. The same data model is available
to other components through [[method:DataContext.grouping]].

```ts
grid.view = { ...grid.view!, groupBy: ["platform", "online", "site"] };
grid.summaries = [{ method: "count" }, { field: "cost", method: "sum" }];
```

The header menu adds or removes a field in the hierarchy. Toolbar buttons remove
or reorder dimensions, with visible earlier/later actions for touch and keyboard.
The order is part of the persisted view. A missing field is dropped when saved
views reconcile with offered columns, preserving the remaining order. Grouping
can use hidden columns.

Right on a closed group opens it; Right on an open group enters its first loaded
child. Left closes an open group, or returns a closed group to its parent. Left
in a record's first column returns to its final group; other record columns keep
cell navigation. Enter and Space toggle groups; Enter retries a failed branch.
Retry buttons also work through Tab. A collapsed or removed active descendant
returns to an available ancestor. Headers expose level, sibling position/count,
expansion and busy state; records expose their logical level and sibling indices.

Group summaries are computed independently by the service for every prefix.
Parent averages and distinct counts are never reconstructed by summing children.
Null is a separate group. Repeated labels under different parents have distinct
identities. Sorting follows the query's direction on each grouping field.

The grid retains at most four 100-record pages per open leaf, subject to the
collection's visible-page protection. Collapsing a parent releases its child
queries, leaf pages and descendant open state. Sort/filter changes follow the
query without rebuilding the model; groups that cease to exist are pruned.
Changing grouping fields/order creates a fresh collapsed model. Open paths are
local interaction state and are not saved with the view.

Grouping remains an owned-grid mode: borrowed collection/selection bindings and
self-referencing tree mode do not combine with grouping. CSV exports the captured
filtered records, excluding group headers, independent of which paths are open.
Group metadata is fetched completely per open branch (including server next
links); it is not a separate virtualized group-directory service. Choose fields
with useful group cardinality. Record DOM and leaf pages remain virtualized.

## class:Grouping

Composes grouped queries, expansion state and paged leaf collections without DOM
dependencies. Construct through [[method:DataContext.grouping]] and dispose when
the consuming component closes. All writes still go through the data context.

## method:DataContext.grouping

- `query`: a query or reactive query signal for one entity set.
- `fields`: distinct metadata property names in outer-to-inner order; nonempty.
- `aggregates`: server aggregate field/method/alias specifications, default `[]`.
- `options`: leaf collection paging options, default page size 100 and keep 20.

Returns a new [[class:Grouping]]. Counts and totals use the same filter, including
base/related criteria. Only opening final groups requests records. Numeric
aggregate validation follows [[method:DataContext.summary]]. Aggregate aliases
must not collide with grouping fields or the reserved `count` alias.

## attr:Grouping.fields

The grouping fields, copied at construction, in outer-to-inner order. Replace the
model to change their order or membership.

## attr:Grouping.root

The root [[class:Groups]] object. Its rows determine root sibling order and exact
record count. `status` and `error` describe root loading and failures.

## attr:Grouping.open

A signal holding the opaque IDs of open group headers. IDs belong to this model;
use IDs supplied in [[attr:Grouping.rows]], rather than constructing them.

## attr:Grouping.rows

A signal containing the flattened visible [[type:GroupingRow]] sequence.
Intermediate children appear after their grouped response. Final groups can
contain unloaded record positions using their exact server group count.

## attr:Grouping.total

Exact record count across root groups, undefined before the first root answer or
while a changed query is awaiting its first answer. During a save recount, the
previous count remains available while root status is loading.

## method:Grouping.expand

- `id`: the ID of a visible group header.

Opens the next grouped level or starts the first record page at a final level.
Resolves immediately for intermediate groups; watch the header's loading/error
state for completion. For a leaf, resolves after its first page or rejects on
failure. Reopening an already-open group or opening an unknown ID does nothing.

## method:Grouping.collapse

Releases the named branch and all descendants, closing their open state.
In-flight responses cannot recreate collapsed paths. Other open branches remain.

## method:Grouping.toggle

Opens or collapses the named visible header. Returns the expansion promise.

## method:Grouping.retry

- `id`: optional branch ID; omit to retry the root group list.

Retries the branch's group query or refreshes its visible leaf pages. Group
failures use signals; leaf refresh can reject. Retry does not change open state.

## method:Grouping.setAggregates

Validates and replaces aggregate specifications, recounting existing group
queries while retaining open paths and leaf collection identities. Does nothing
for equivalent specifications. Invalid specifications leave the model unchanged.

## method:Grouping.dispose

Unsubscribes grouped queries, releases all leaf collections and ignores later
expansion or retry requests. The consumer must stop using the disposed model.

## type:GroupingRow

A [[object:GroupingHeader]] or [[object:GroupingRecord]], discriminated by `kind`.

## object:GroupingHeader

A visible group header with its identity, hierarchy, exact server aggregates and
the state of its opened child branch.

## attr:GroupingHeader.kind

Always `"group"`.

## attr:GroupingHeader.id

Opaque stable identity for this complete group path in the model.

## attr:GroupingHeader.parent

The parent header ID; undefined for root groups.

## attr:GroupingHeader.path

Group values from root through this header, including null values.

## attr:GroupingHeader.field

The metadata field represented by this level.

## attr:GroupingHeader.level

Logical depth, starting at 1 for root groups.

## attr:GroupingHeader.position

One-based position among this header's sibling groups.

## attr:GroupingHeader.siblings

Number of sibling groups from the complete grouped response, not loaded records.

## attr:GroupingHeader.group

The [[object:GroupRow]] holding this path's value, exact record count and totals.

## attr:GroupingHeader.expanded

Whether this header has an open child branch.

## attr:GroupingHeader.loading

Whether its child grouped query or leaf record collection is loading.

## attr:GroupingHeader.error

The child branch's most recent error, or undefined. Retry with this header's ID.

## attr:GroupingHeader.totalsAvailable

True when the grouped query providing this header's totals is idle. Suppress old
totals during recount or failure rather than presenting them as current.

## object:GroupingRecord

A final group's record position. It can be a placeholder before its page loads.

## attr:GroupingRecord.kind

Always `"row"`.

## attr:GroupingRecord.key

The record key, or undefined for an unloaded placeholder. A placeholder cannot
be selected, edited or activated as a record.

## attr:GroupingRecord.parent

The ID of the containing final-level group header.

## attr:GroupingRecord.level

One deeper than the final grouping dimension.

## attr:GroupingRecord.position

One-based logical position within its containing group's records.

## attr:GroupingRecord.siblings

Exact record count of the final group, independent of page eviction.

## attr:GroupingRecord.collection

The leaf [[class:Collection]]. Use its `view` method to load a bounded range.

## attr:GroupingRecord.local

Zero-based position in the leaf collection for paging and record lookup.

## object:GroupingOptions

Leaf collection `pageSize` and `keepPages`, as described by
[[object:CollectionOptions]]. The budget is per open leaf; collapsing releases it.
