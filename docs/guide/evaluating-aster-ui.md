# Is Aster UI a fit for your project?

Aster UI is a JavaScript and TypeScript foundation for applications where several
views query and edit the same data. It combines a shared data model with web
components for grids, forms, tiles and application workspaces. Use it with Aster
WebData to build applications across SQL databases and existing APIs: the server provides a virtual-data-source interface for your backend code
and exposes registered sources through OData to the UI. The same shared data
model coordinates those views as the application grows.

## Where Aster is strong

- **Applications integrating existing systems.** With Aster WebData on the server,
  write short Python or TypeScript scripts as virtual data sources. WebData
  publishes their declared schema and exposes their records through OData; the
  scripts make the REST or legacy-service calls on configured connections. They
  can read and write other sets through `db`, while UI views consume a common
  typed contract.
  This is valuable when the application must work across systems, not just
  display a single database table.
- **Connected editing workflows.** A grid, form, detail panel and chart can share
  records and selection while keeping unsaved drafts separate. Validation,
  concurrency conflicts and filtered-result membership belong to that workflow.
- **Data beyond the loaded rows.** Collections page their results; grids and tiles
  virtualize visible content. Query-wide filtering, sorting, grouping, summaries
  and export are useful in management tools and operational applications.
- **Reusable application composition.** Named children, bindings, commands and
  lazy views can be declared in JavaScript or YAML. Registered JavaScript functions
  own behaviour and cleanup. Custom elements, Lit templates and signals provide
  the UI foundation; React is not required.

- **Accessible, themed controls.** Controls provide keyboard interaction, focus
  handling, themes and reduced-motion support, with automated accessibility
  checks across the suite.

The [rationale](why-aster.md), [shared data model](data-model.md) and
[connected views guide](connected-views.md) explain these responsibilities.

## For SQL plus backend API projects

This is a core use case for Aster UI with Aster WebData. You implement a virtual
source against the server's provided interface, including any matching or
combining of records the workflow needs. WebData supplies the OData layer and
metadata; UI controls then use that common service. The original API does not
need to speak OData.

Use [Aster WebData](https://getaster.now/products/aster-webdata/) for server setup.
See [the SQL and API walkthrough](integrate-sql-and-apis.md) for a concrete source
definition, the request flow and the UI binding.

## Where something else fits

| Your situation | What fits |
|---|---|
| A small, mostly read-only list or content website | Native HTML and a little application code. |
| An established application that already coordinates records, queries and drafts well | Keep its state model, and use Aster UI for new screens or applications. |
| Specialist scheduling or rich-text editing as the main requirement | A specialist component, which Aster UI can host beside its own controls. |

## What your application provides

- **The service.** An OData service, or Aster WebData over your databases and
  APIs. Its metadata drives field types, validation and query operations.
- **Business rules and access control,** enforced on the server. Client-side
  validation helps people fill in forms; it is not an authorisation boundary.
- **Cross-system logic.** A virtual-source script that combines records from
  several systems owns that matching and its failure handling. Writes to
  independent systems are not one atomic transaction.
- **Notifications of other users' changes.** Report them with
  `ctx.reload(set, key, "external")`, from a server event or a refresh, and every
  view updates. See [service boundaries](data-model.md#service-and-realtime-boundaries).

Preview controls in `@getaster/elements-preview` have their own, separately
versioned contracts; see [preview scope](conversation-preview.md).

## Try a representative workflow

Connect a paged list to an editor, change a field affecting the filter, and check
selection, saving and concurrent refresh against your intended service. For
retained work or sign-in recovery, try the corresponding Webmail workflow.
Inspect the executable source as well as the presentation.

Start with [the working grid](getting-started.md),
[the shared collection example](../examples/grid.html) or
[Webmail with sign in](../examples/mail.html). To see several screens stay in step over one store,
with a server-computed tree total and a record edited with the rows it owns, try the
[finance workspace](../examples/finance.html).
