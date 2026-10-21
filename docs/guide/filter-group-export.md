# Filter, group and export a collection

A report should apply the same criteria to its rows, totals and download. Aster
keeps those operations on the query, so scrolling through a few pages does not
silently turn a report into a calculation over just the loaded records.

Use the [expression example](../playground/filtering.html) to build a nested
filter, or the [reporting example](../playground/reporting.html) to group device
costs and download CSV. Both use a simulated service with paged data.

## Combine simple filters and expressions

Every Grid has an **Advanced filter** action. Its editor takes field names,
types, allowed values and supported operators from metadata. Users can combine
“All” and “Any” groups without writing OData syntax. Applying a draft updates the
view; cancelling leaves its existing expression intact.

You can supply the same expression in code. Here `grid` is an already connected
Grid over Devices, with `platform` and `online` in its metadata:

```ts
import type { Grid } from "@getaster/elements";

declare const grid: Grid;
grid.view = {
  ...grid.view!,
  criteria: {
    op: "and",
    args: [
      { op: "or", args: [
        { op: "eq", field: "platform", value: "Linux" },
        { op: "eq", field: "platform", value: "Windows" },
      ] },
      { op: "eq", field: "online", value: true },
    ],
  },
};
```

The expression combines with column filters and the page's base constraints.
Clearing the advanced expression clears only that expression. Client filters
are not authorization: the service must enforce permissions independently.

In the expression example, choose **Load nested example**, open Advanced
filter, and change a group from All to Any. Platform's “is one of” offers the
metadata choices; numeric fields offer numeric comparisons. Switch to tiles to
see the same filtered collection and selection in another presentation.

Invalid saved expressions are reported rather than silently discarded. When
metadata changes, let the user repair or clear the expression instead of showing
an unexpectedly broader result.

## Put the editor elsewhere

FilterBuilder can also sit in a page or sidebar. Its FilterDraft is separate
from the applied query. This small binding assumes a read-only grid:

```ts
import { FilterDraft } from "@getaster/data";
import type { Criteria, DataContext } from "@getaster/data";
import type { FilterBuilder } from "@getaster/elements";

declare const ctx: DataContext;
declare const builder: FilterBuilder;
builder.model = new FilterDraft(ctx.schema, "Devices", grid.view?.criteria);
builder.addEventListener("apply", event => {
  const criteria = (event as CustomEvent<Criteria | undefined>).detail;
  const { criteria: previous, ...view } = grid.view!;
  grid.view = { ...view, ...(criteria ? { criteria } : {}) };
});
```

The host owns how this editor changes its view. For editable grids, use the
built-in Advanced filter action, or intercept `apply` with `preventDefault()`,
await `grid.finishEditing()` and apply only if the same view and draft remain
current. A refused save must leave the applied filter intact. Recreate or reset
the draft when switching entity sets. For a server sort or filter that differs from displayed
text, use the underlying typed property or a declared server path; see
[value formatting and server sorting](formatted-values.md).

## Add grouping and totals

For grouping, connect the grid with `ctx` and `set`, so it owns the grouped
query. An externally supplied shared collection supports flat rows; it is not
converted into grouped query state implicitly.

```ts
const grouped = document.createElement("aster-grid") as Grid;
grouped.ctx = ctx;
grouped.set = "Devices";
grouped.view = {
  columns: [{ field: "name" }, { field: "platform" },
    { field: "online" }, { field: "cost" }],
  sort: [{ field: "id" }], filters: {}, frozen: 0,
  groupBy: ["platform", "online"],
};
grouped.summaries = [
  { method: "count", label: "Devices" },
  { method: "sum", field: "cost", label: "Total cost" },
  { method: "average", field: "cost", label: "Average cost" },
];
document.querySelector("#report")!.append(grouped);
```

Grouping order is explicit: Platform contains Online groups. Remove `groupBy`
to return to flat rows. Groups load their contents as needed; summaries describe
the matching query rather than the currently mounted rows. The service must
support the aggregate operations used by the report.

In the reporting example, start with **No grouping**, choose **Platform →
Online → Site**, and expand successive levels. Toggle Online only and compare
the total. Use the failure control to exercise retry while retaining the previous
confirmed values. Changing grouping first finishes or refuses an active edit.

## Export the query explicitly

`exportCsv` returns CSV text. The application chooses how to deliver it:

```ts
const cancellation = new AbortController();
const csv = await grid.exportCsv({
  scope: "query", maxRows: 10_000, pageSize: 200,
  signal: cancellation.signal,
  onProgress: rows => console.log(`Exported ${rows} rows`),
});
```

Use `scope: "selection"` for a flat grid with a shared Selection. Export follows
the query and visible metadata columns, fetching fresh server values. Custom DOM
cell renderers and lookup labels are not the exported data; finish an active
edit before exporting. Tree reports require the explicit data export API.

The reporting example adds a download link, progress, cancellation, a row limit
and failure feedback around this call. A production application should make
large exports an intentional action and handle service errors visibly.

See [Grid API](../reference/#class:Grid),
[FilterBuilder API](../reference/#class:FilterBuilder) and
[shared table/tile views](shared-collection-views.md).
