# Summaries and CSV export

Server summaries and CSV export use a query independently of a collection's
loaded pages. Neither loads the entire collection into the record store or moves
its virtual viewport. The [reporting playground](../../apps/showcase/src/examples/reporting/reporting.html)
demonstrates filtering, ordered picks, group totals, retries and downloads.

```ts
grid.summaries = [
  { method: "count", label: "Devices" },
  { field: "cost", method: "sum", label: "Total cost" },
  { field: "platform", method: "countdistinct", label: "Platforms" },
];
const csv = await grid.exportCsv({ scope: "selection", maxRows: 1000 });
// The host chooses a filename and downloads the returned CSV as a Blob.
```

Totals reflect committed server records. Draft edits and unsaved expansion
editors do not contribute to them. The service controls aggregate permissions;
the client never reconstructs hidden amounts from cached records.

## class:Summary

Exact server aggregates over a query's full filtered result. Created with
[[method:DataContext.summary]]. Includes `count` and the aliases of the requested
aggregates. Uses one `$apply=filter(...)/aggregate(...)` request per refresh,
regardless of collection paging or estimated counts.

Query signals follow set/filter changes. Sort and `$select` changes do not
recount, since they cannot affect membership. Saved or external changes in the
set or sets referenced by its filter invalidate totals immediately and recount
after a short debounce. Fetching pages does not trigger recounts. Relative dates
are resolved with the context clock when each refresh starts.

## method:DataContext.summary

- `query`: a query or query signal.
- `aggregates`: field/method/alias specifications, default `[]` for count only.

Returns a new [[class:Summary]]. Call `dispose()` when its consumer closes.
Aliases must be unique identifiers, and cannot be `count`. `sum` and `average`
require numeric fields. The server determines supported aggregation operations.

```ts
import { computed } from "@preact/signals-core";
const summary = ctx.summary(computed(() => collection.query), [
  { field: "cost", method: "sum", as: "totalCost" },
]);
// Read summary.values.value in a reactive consumer.
// Later: summary.dispose().
```

## attr:Summary.values

A signal holding `count` and each aggregate by alias. Undefined while loading,
invalidated or failed; a previous query's total is never presented as current.
Decimal and Int64 aggregates retain the service's exact numeric text. Null
aggregates remain null, and the count of an empty result is zero.

## attr:Summary.status

A signal of `"loading"`, `"idle"` or `"error"`.

## attr:Summary.error

The latest request error, cleared on retry. Refresh failures are reported through
these signals rather than rejected promises.

## method:Summary.refresh

Recounts or retries. Invalidates the previous answer first; a newer request
supersedes an older answer. Returns a promise that settles when this request ends.

## method:Summary.dispose

Unsubscribes changes, cancels scheduled recounts and ignores in-flight answers.
Subsequent refresh calls do nothing.

## staticMethod:exportCsv

- `ctx`: the data context providing schema and source.
- `query`: the query to capture for this export.
- `columns`: metadata fields and optional header titles, in output order.
- `options`: paging, row limit, selection, cancellation and progress.

Returns a promise of UTF-8 CSV text with BOM, quoted cells, escaped quotes and
CRLF row separators. Multiline values remain multiline; null, hidden and
unselected projection fields produce empty cells. Values retain OData form:
exact Decimal/Int64 text, booleans and ISO dates. Text cells and headers that
could be spreadsheet formulas receive a leading apostrophe. Numeric negatives
remain numeric text.

By default exports every result of the captured filter and sort, including
unloaded rows. Supplied keys instead export those records in supplied order;
duplicate keys are removed. Selection records are fetched afresh by key,
independently of the filter. Deletion or any fetch failure rejects the export.
The query, columns and keys are captured synchronously; later view changes
cannot redirect an export. Relative dates are resolved once at its start.

Page requests are bounded. The returned CSV still occupies memory proportional
to its output size; this is not a streaming file writer. Paged reads do not
provide a database snapshot: concurrent inserts, deletes or sort changes can
cause duplicate or missing rows unless the service supplies snapshot consistency.
Use a service export job for atomic or very large exports.

## object:ExportColumn

A direct metadata `field` and optional `title` for the CSV header. The column
array determines output order. Unknown fields and an empty array are errors.
DOM renderers, lookup display labels and group header rows are not exported.

## object:CsvOptions

Configuration for [[staticMethod:exportCsv]].

## attr:CsvOptions.keys

Optional record keys in output order. Omit for query export. An empty array
exports only headers. Does not change selection or load the collection window.

## attr:CsvOptions.pageSize

Positive safe integer. Default `500`. Limits each query page request.

## attr:CsvOptions.maxRows

Nonnegative safe integer below `Number.MAX_SAFE_INTEGER`. Default `100000`.
An extra row detects overflow without relying on a count. Overflow rejects the
whole operation; it never silently truncates or returns partial CSV.

## attr:CsvOptions.signal

Optional `AbortSignal`. Checked before and after each request; an already running
transport request finishes, then its response is discarded. Cancellation rejects
without returning partial text.

## attr:CsvOptions.onProgress

Called with the number of records read after each page or selected record.
No estimated percentage is inferred. A callback exception also rejects export.
