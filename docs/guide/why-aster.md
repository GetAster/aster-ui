# Why Aster UI?

You can build a table. The harder decision is how much of the application’s data behaviour you want to own as that table becomes a working screen.

A list starts with rows and a few columns. Then someone needs filtering, selection across pages, an edit form, totals over the entire result, and updates from another user. Each feature is reasonable. Their interactions are where the work accumulates.

## The work between features

Consider a device-management screen. A user filters to Windows devices, selects a few, opens one in a form and changes its platform. Meanwhile, another administrator updates a device on a page that has not been loaded.

The screen now has several questions to answer:

- Does the edited device still belong in the filtered result?
- Should its selection survive a sort, a page change or a switch to a tile view?
- Do the totals describe the loaded rows or the complete query?
- Can an external update replace an unsaved form draft?
- What happens if the user’s save is based on an old version?
- Can someone complete the same workflow using a keyboard?

These questions cross component boundaries. Adding one more button or table plugin does not settle them.

## What Aster takes responsibility for

Aster puts records, queries, selection and edits in a shared data layer. Its controls use that model, so a grid, a form and a tile view can participate in the same workflow.

| Concern | Aster’s approach |
|---|---|
| Shared records | Views connected to one data context read the same normalized records. |
| Large results | Collections load bounded pages; grids and tile grids virtualize their visible content. |
| Filtered and sorted results | Fully loaded results can be evaluated locally. Partial results refresh affected windows when placement is uncertain. |
| Editing | Drafts stay separate from stored records, with validation and field-level change tracking. |
| Concurrent changes | ETags and conflict handling protect against silently overwriting a newer version. |
| Reporting | Exact summaries and export operate on the query, including unloaded records. |
| Interaction | Controls provide keyboard behaviour, focus handling, themes and reduced-motion support. |

These guarantees apply to changes the context learns about through requests,
refreshes or notifications supplied by the application. Receiving another
client’s writes also requires a service notification or refresh mechanism.
Production realtime integration is pending the server contract; the agreed
transport direction is WebTransport with SSE fallback. See
[service and realtime boundaries](data-model.md#service-and-realtime-boundaries).

The benefit is a consistent foundation for these interactions. Your application still decides its workflows, permissions, server policy and presentation.

## Build applications across existing systems

The data does not have to originate in an OData backend. With Aster WebData on
the server, you can write virtual data sources that adapt REST APIs, CLIs or
legacy services and expose them through the OData layer. Handlers can read and
write other data sources through the engine, so a workflow can coordinate data
from several systems behind a common service contract.

For a device portal, that could mean database inventory, live status from a
management API and a legacy administrative tool in one workspace. Aster UI uses
the resulting metadata and shared data model for its grids, forms and queries.
The backend adapters belong to the server integration; the UI uses their common
contract.

This is a strong reason to consider the wider platform for data integration
projects. Cross-source workflows still need explicit failure handling: they do
not guarantee arbitrary federated joins or distributed transactions. See
[virtual data sources](data-model.md#connect-different-backends-through-virtual-data-sources)
for the responsibilities and current boundaries.

## When a simple table is sufficient

For a small, read-only list with a few links, native HTML and a little application code may be all you need. Aster introduces concepts worth learning: a data context, collections, edit models and metadata.

It becomes more useful when several views share editable data, results are paged, or the screen needs the enterprise interactions above. Evaluate it against those requirements and the cost of maintaining their combinations.

Aster UI consumes an OData service with metadata. For other backends, a virtual data source in Aster WebData can provide that contract; the integration needs an adapter, rather than a different URL alone. Third-party visualizations can use Aster’s public data and component-host APIs, but integration still needs an explicit owner and lifecycle.

## See the model at work

The introduction runs a small project grid against the same OData engine used by the demos. The following how-to connects a form to that grid, so you can see a saved edit reach another view.

<div class="doc-actions"><a class="doc-action primary" href="getting-started.html">Run the example →</a><a class="doc-action" href="../#showcase">Explore the showcase ↗</a></div>

For exact signatures and options, use the [Grid reference](../reference/#class:Grid) and [DataContext reference](../reference/#class:DataContext).
