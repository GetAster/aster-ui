# Build a web application over SQL and backend APIs

Aster provides a path from existing systems to a working web interface.
**Aster WebData supplies the server integration mechanism: virtual data sources.**
You implement the code that reads or writes your backend, declare its fields,
and register it with the server. WebData exposes that source through OData,
including metadata and query handling. Aster UI connects to that service and
uses the data in grids, forms, tiles and other views.

OData is the common contract WebData provides to the UI. Your original database,
REST API, CLI or legacy service keeps its native interface.

## What you implement and what Aster provides

| Part | Responsibility |
|---|---|
| Your virtual-source handler | Call the backend, map its values to the declared fields, and implement the reads and writes the source supports. |
| Aster WebData | Register the source alongside SQL sources, publish OData metadata, process requests, enforce configured access policy and run supported query operations. |
| Aster UI | Consume the common service through a data context; share records, queries, selection and edits between views. |
| Your application | Choose the screens, business rules, source-matching logic and how to handle failures in external systems. |

The virtual-source interface is part of WebData. Backend-specific code plugs
into that interface; metadata generation and OData request processing belong to
the server.

## Example: combine SQL customers with account status from an API

Suppose customer names and contact details live in SQL, while account status
comes from your existing backend API. You want one customer workspace in a web
application, with filtering, paging and an editor.

Define the SQL-backed customer source and a virtual source for the backend API.
If the screen needs a combined row, register a virtual `CustomerWorkspace`
source whose read handler fetches customer records through the engine, calls
your API and matches the results by customer ID. Cross-source engine calls let
the handler participate in the same server data layer as other sources.

The handler owns that matching logic. A source definition for its returned rows
can look like this:

```yaml
dataSource:
  ID: CustomerWorkspace
  serverType: virtual
  handler: customer_workspace
  fields:
    - { name: id, type: integer, primaryKey: true }
    - { name: name, type: text, length: 200 }
    - { name: accountStatus, type: text, length: 40 }
```

The registered `customer_workspace` handler implements WebData's `VirtualSource`
contract. Its `fetch` method returns records matching that schema. A Rust
handler can use its own HTTP client or CLI integration, and the supplied context
provides engine calls such as `fetch` and `get` for other data sources.

Once the definition and handler are registered, WebData publishes the entity
set and its metadata. The UI can request:

```http
GET /odata/CustomerWorkspace?$filter=accountStatus%20eq%20%27Active%27&$orderby=name&$top=40
```

WebData handles the OData request. A minimal handler supplies the complete,
bounded result for the engine to filter, sort and page. For a large source,
declare and implement query pushdown so the handler can ask the underlying
system for the relevant data efficiently.

## Bind the resulting data to a grid

Given that service and an existing `<aster-grid>` element, the UI connection is
the same as for a SQL-backed entity set:

```javascript
import "@getaster/elements";
import { DataContext, fetchTransport } from "@getaster/data";

const ctx = await DataContext.connect(fetchTransport("/odata/"));
const customers = ctx.collection(
  { set: "CustomerWorkspace", orderBy: [{ field: "name" }] },
  { pageSize: 40, keepPages: 4 }
);

const grid = document.querySelector("aster-grid");
grid.ctx = ctx;
grid.collection = customers;
grid.view = {
  columns: [{ field: "name" }, { field: "accountStatus" }],
  sort: [], filters: {}, frozen: 0,
};
```

The context loads the published metadata. Controls use its field types and
annotations for editors, filtering and validation feedback. Other views can
share the collection and selection, or open an edit model over a selected row.
See [Get started](getting-started.md) for page setup and
[connect a grid and form](connected-views.md) for editing.

## Write through the same integration

A virtual source can implement `add`, `update` and `remove` as well as `fetch`.
Declare the writes it supports and implement their backend-specific behaviour.
An edit saved through Aster UI then travels through OData to the source's write
handler; the returned record updates the shared UI data model.

Write handlers and server operations can also call other data sources through
the engine. For example, a workflow can update a SQL customer record and request
an account change from your API. Source permissions, execution context and
external failure handling still apply.

Cross-source workflows and distributed transactions are different requirements.
Atomic write support depends on the participating backends' declared transaction
capabilities; calling several systems does not make their external effects
atomic. Automatic joins across arbitrary backends are also separate from a
handler that combines records explicitly. Check the server release's supported
operations and design partial-failure handling for the workflow.

## Choose this path for an integration application

This combination is useful when you want to bring existing systems into an
interactive application: backend code implements virtual sources, WebData gives
them a common service contract, and the UI supplies connected data views.

Use [Aster WebData](https://getaster.now/products/aster-webdata/) for the companion
server and its setup documentation. The npm UI packages contain the client data
layer and controls; see [installation and distribution](library.md) for those
packages, [the shared data model](data-model.md) for client ownership, and
[the fit assessment](evaluating-aster-ui.md) to compare this approach with your
project's needs.
