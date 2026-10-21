# Understand the shared data model

A grid, a form and a chart often show different parts of the same records. As
soon as users filter, edit or refresh those records, each view needs to agree
about what changed. Aster gives those views a shared data context and keeps
unsaved edits separate until they are saved.

If you have not run a page yet, start with [Get started](getting-started.md).
This guide explains the pieces you will use when adding a second view or an
editing workflow.

## Connect once for the views that share data

A `DataContext` connects a transport to an OData service. It loads the service's
metadata and owns the schema, record store and synchronization for that context.
Use the same context for views that should share records.

```javascript
import { DataContext, fetchTransport } from "./lib/aster-ui.js";

const ctx = await DataContext.connect(
  fetchTransport("https://your-service.example/odata/")
);
```

The service metadata describes entity sets, property types, keys, relationships
and annotations such as labels, allowed values and validation constraints.
Controls use that information to choose editors and filter operators. The server
must still enforce permissions and validation; client metadata is not an access
control boundary.

For local development, the examples use an optional WebAssembly service with
the same transport interface. Replace its transport with your service connection
when ready. See [installation and distribution](library.md) for the files involved.

## A collection is a query and its loaded pages

The record store holds shared records. A `Collection` holds a query and the keys
at positions in that query's result. It loads pages as views need them; it does
not have to hold the entire result before a user can scroll or filter it.

```javascript
const devices = ctx.collection(
  { set: "Devices", orderBy: [{ field: "name" }] },
  { pageSize: 40, keepPages: 4 }
);
```

Bind both a Grid and a TileGrid to `devices` to share the same result. Changes to
the query apply to the service result, including records on pages that have not
loaded. A known update reaches views through the record store. If an update's
position in a partially loaded result is uncertain, the collection refreshes the
relevant result rather than guessing its order.

Query results are not a snapshot transaction. Concurrent service changes may
require a refresh, and applications should handle errors while retaining useful
confirmed content. See [filtering, grouping and export](filter-group-export.md)
and [stable refresh feedback](connected-views.md#keep-live-refreshes-stable).

## Selection belongs to the data workflow

A `Selection` tracks record keys independently of the mounted rows or tiles.
Sharing one selection lets a user switch presentation without losing their picks.

```javascript
import { Selection } from "./lib/aster-ui.js";

const selection = new Selection(ctx.store, devices, {
  multiple: true, ordered: false, fallback: false,
});
table.ctx = tiles.ctx = ctx;
table.collection = tiles.collection = devices;
table.selection = tiles.selection = selection;
```

Here `table` and `tiles` are existing Grid and TileGrid elements. The controls
present selection; the application chooses its policy. The
[shared collection example](../examples/grid.html) demonstrates single, multiple
and ordered selection, including an optional ordered-selection limit.

## Edit a draft, then save it

An `EditModel` holds a record's uncommitted values, validation state and baseline.
A form writes into that draft. Saving sends changes to the service; a successful
response updates the shared record store, so the grid and other views follow.

```javascript
import { EditModel } from "./lib/aster-ui.js";

// key is a record key obtained from the collection or shared selection.
const edit = new EditModel(ctx, "Devices", key);
form.model = edit;
await edit.save();
```

This illustrates the ownership boundary; a real Save action handles validation,
request errors and conflicts, and keeps the draft available when saving fails.
The edit model tracks concurrency information when the service supplies it.
Resolve a conflict explicitly rather than discarding someone's input.

Decide what happens when selection changes with a dirty draft: refuse the move,
ask for confirmation, or retain an editor per record. The
[connected grid and form](connected-views.md) introduces the flow;
[retained sessions](keyed-sessions.md) covers longer-lived editors. Dispose edit
models when their owner releases them.

## Share state without wiring controls together

Use a `PageScope` to publish named state such as the active selection or editor.
PageRules can read that state to explain why an action is unavailable. For
example, Save can depend on a dirty editor that is not already saving.

Use `SharedFilters` when charts, lists and summary widgets intentionally
contribute criteria to the same workspace. Participation is explicit: a view
chooses which contributions it consumes. The
[dashboard guide](dashboard-widgets.md) demonstrates that pattern.

[JS or YAML composition](declarative-workspace.md) can declare these relationships,
while registered JS functions own requests, commands and cleanup. Choose it when
several controls and their lifecycles form a reusable workspace; ordinary JS
property assignment remains available for small pages.

## Release resources with their owner

A screen that creates a collection owns releasing it with `ctx.release(devices)`.
A control borrowing that collection does not become its owner. The screen also
stops its effects and disposes edit models that it created. Selection has no
dispose method; release references to it when the owning workflow ends.
Composition models can register cleanup with their lifetime so the same rule
holds when a workspace is removed or recreated.

Avoid recreating the context or collection on every render. Keep stable record
keys in custom templates, and let signals update the affected values. See
[composition ownership](workspace-patterns.md) for activation and cleanup patterns.

## Service and realtime boundaries

The connected views in this guide synchronize changes known to their shared
context. Learning about writes made by another client also requires a service
notification or refresh mechanism.

The current remote demo adapter does not subscribe to a production realtime
channel. The agreed transport direction is WebTransport with SSE fallback;
client integration awaits the server event and reconnect contract. Examples that
simulate another user's change are demonstrations, not a deployed realtime
service. Authentication is similarly application-configured; see
[authentication and session recovery](authentication.md).

For detailed APIs use [DataContext](../reference/#class:DataContext),
[Collection](../reference/#class:Collection), [Selection](../reference/#class:Selection)
and [EditModel](../reference/#class:EditModel). The
[data core internals](data.md) explain implementation details when you need them.

## Continue with an editable screen

Next, [connect a grid and form](connected-views.md) to apply the context,
selection and draft ownership described here. Then
[compose a workspace](declarative-workspace.md) when you want reusable named
children, commands and lazy views around that model.
