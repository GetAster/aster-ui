# Build a web application over SQL and backend APIs

Aster provides a path from existing systems to a working web interface.
**Aster WebData serves your database tables and virtual data sources through one
OData service.** A virtual data source is a short Python or TypeScript script that
returns rows from somewhere else, such as a REST API or another set; you declare
its fields beside it. WebData publishes the metadata and handles the query. Aster
UI connects to that service and uses the records in grids, forms, tiles and other
views.

OData is the common contract WebData provides to the UI. Your original database
or REST API keeps its native interface.

## What you write and what Aster provides

```diagram
{
  "source": "docs/diagrams/integration-map.svg",
  "narrow": "docs/diagrams/integration-map-narrow.svg",
  "description": "Aster UI uses OData to reach WebData on the server, which serves SQL tables and your virtual-source scripts over existing systems."
}
```

The browser sees one service contract. Calls to your backend stay in the
server-side script; when SQL and API records need matching, that script owns
the matching logic.

| Part | Responsibility |
|---|---|
| Your virtual-source script | Call the API on a configured connection, map its values to the declared fields, and implement the reads and writes the source supports. |
| Aster WebData | Serve the source beside SQL tables, publish OData metadata, check every returned row against the declared fields, own each connection's credential, timeout, retries and rate limit, enforce access rules, and do the filtering, sorting and paging the script leaves undone. |
| Aster UI | Consume the common service through a data context; share records, queries, selection and edits between views. |
| Your application | Choose the screens, business rules, source-matching logic and how to handle failures in external systems. |

## Example: combine SQL customers with account status from an API

Suppose customer names and contact details live in a SQL table, while account
status comes from your existing backend API. You want one customer workspace in a
web application, with filtering, paging and an editor.

Serve the SQL table as a set, `Customer`, and declare the API once as an HTTP
connection, `accounts`, in the server configuration. A virtual
`CustomerWorkspace` source then reads customers through `db`, asks the API for
their status and matches the two by customer ID:

```yaml
dataSource:
  ID: CustomerWorkspace
  serverType: virtual
  script: customer_workspace.py
  fields:
    - { name: id, type: integer, primaryKey: true }
    - { name: name, type: text, length: 200 }
    - { name: accountStatus, type: text, length: 40 }
```

```python
def read(query):
    customers = db.fetch('Customer')
    r = http.get('/accounts/status', connection='accounts')
    if not r.ok:
        fail('AccountsError', f'the accounts API answered {r.status_code}')
    status = {a['customerId']: a['status'] for a in r.json()}
    return [{'id': c['id'], 'name': c['name'], 'accountStatus': status.get(c['id'])}
            for c in customers]
```

`db` reads stored sets as the caller, so the `Customer` set's access rules
still apply. The connection's configuration holds where the credential is; the
script never sees it. The same script can be written in TypeScript with web
`fetch` and `aster.db`.

WebData then publishes the entity set and its metadata. The UI can request:

```http
GET /odata/CustomerWorkspace?$filter=accountStatus%20eq%20%27Active%27&$orderby=name&$top=40
```

WebData handles the OData request. A script that declares nothing returns the
complete, bounded result, and WebData filters, sorts and pages it. For a large
source, a `pushdown:` block passes the filter, order or page the script can hand
to the underlying system, and WebData does the rest.

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

A virtual source takes writes for the functions it names: map `add`, `update`
and `remove` under `functions:` for the writes it supports. An edit saved through
Aster UI then travels through OData to that function, and the returned row
updates the shared UI data model. An update or delete carries the row's ETag, and
WebData refuses a stale one with `412` before the script runs, so the UI's
conflict handling works as it does for a table.

A write function can also call other sets through `db` and your API through its
connection. For example, it can update a SQL customer record and request an
account change from the API. Access rules, the request's deadline and external
failure handling still apply.

Calling several systems does not make their effects atomic. In a `$batch`, an
atomic group that makes more than one write and writes a virtual set is
refused, and the script
must handle a partial failure between the API and the database itself. Automatic
joins across arbitrary backends are also separate from a script that combines
records explicitly. Check the server release's supported operations and design
partial-failure handling for the workflow.

## Choose this path for an integration application

This combination is useful when you want to bring existing systems into an
interactive application: scripts implement virtual sources, WebData gives
them a common service contract, and the UI supplies connected data views.

Use [Aster WebData](https://getaster.now/products/aster-webdata/) for the companion
server and its setup documentation. The npm UI packages contain the client data
layer and controls; see [installation and distribution](library.md) for those
packages, [the shared data model](data-model.md) for client ownership, and
[the fit assessment](evaluating-aster-ui.md) to compare this approach with your
project's needs.
