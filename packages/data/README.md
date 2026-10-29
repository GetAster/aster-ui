# @getaster/data

Reactive data models for metadata-driven OData applications. Aster's data core
shares records, queries, selections and edit state across views without depending
on the DOM or a UI framework.

Use it on its own for application state, or with `@getaster/elements` for grids,
forms and other browser controls. Aster is pre-1.0; API stability is not yet promised.

## Install

```sh
npm install @getaster/data
```

The package provides ES modules and TypeScript declarations. Node.js consumers
require Node 22 or later. Browser consumers need a modern ES-module environment
and a bundler or import map that resolves npm dependencies.

## Read a collection

This example requires an OData service with JSON CSDL metadata and a `Projects`
entity set. Replace the service URL with your endpoint.

```ts
import { DataContext, fetchTransport } from '@getaster/data';

const ctx = await DataContext.connect(
  fetchTransport('https://your-service.example/odata/')
);
const projects = ctx.collection({ set: 'Projects' }, { pageSize: 50 });

try {
  await projects.view(0, 20);
  if (projects.error.value) throw projects.error.value;
  console.log(projects.items.value.slice(0, 20));
} finally {
  ctx.release(projects);
}
```

`DataContext.connect()` reads the service metadata. A collection represents a
query and loads a bounded window of records; `items`, `status` and `error` expose
reactive state. Release a collection when its owner no longer needs it.

## What the core provides

- A shared record store so confirmed changes reach all connected views.
- Paging, filtering, sorting, grouping, summaries and hierarchical data models.
- Selections, edit drafts, validation and conflict handling.
- Composable commands, lifetimes and keyed sessions for application ownership.
- A transport boundary for HTTP services, authentication and local test services.

Service capabilities determine which queries and writes are supported. The server
must enforce authorization and write concurrency; client-side field visibility and
validation are not security boundaries. Configure authentication and CORS for
your deployment. For local examples without a server, use `@getaster/mock`.

The only runtime dependency is `@preact/signals-core`. The package has no install
scripts and contains no UI controls, fonts, charting runtime or mock WebAssembly.

## Documentation and support

- [Shared data model](https://ui.getaster.now/docs/guide/data-model.html)
- [Connect SQL and APIs](https://ui.getaster.now/docs/guide/integrate-sql-and-apis.html)
- [Authentication](https://ui.getaster.now/docs/guide/authentication.html)
- [API reference](https://ui.getaster.now/docs/reference/)
- [Examples and showcase](https://ui.getaster.now/showcase/)
- [Report a bug](https://github.com/GetAster/aster-ui/issues)

## License

Apache-2.0. See the included `LICENSE` and package-specific `NOTICE`.
Separately installed dependencies retain their own licenses.
