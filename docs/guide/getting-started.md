# Get started with Aster UI

Run a complete project grid, inspect the code, and see where the data model takes responsibility. If you are evaluating the library, start with [why Aster UI](why-aster.md).

This example uses plain JavaScript and custom elements. The browser runs a local OData service in WebAssembly; no backend or account is needed to try it here.

## Try the working example

Sort by a column heading or filter a column. The grid sends those query changes through its data context to the OData service.

<iframe title="Live project grid example" src="../playground/first-grid.html" loading="lazy"></iframe>

[Open the example on its own](../playground/first-grid.html) · [Explore a connected grid and form](connected-views.md)

## Run it locally

You need Git and Bun. The repository includes the prebuilt WebAssembly mock; rebuilding the server engine is not part of this introduction.

```bash
git clone https://github.com/getaster/aster-ui.git
cd aster-ui
bun install
bun run site
bun scripts/serve-static.ts dist-local/showcase --strict
```

Open **http://localhost:4174/playground/first-grid.html**. The built site is static; use an HTTP server rather than opening HTML through a `file:` URL, because the example fetches modules, metadata and WebAssembly.

The standalone distribution lives in `dist-local/lib/`. You can also copy that directory and the two example files into your own static site, preserving their relative paths. See [installation and distribution](library.md) for the files and TypeScript dependencies.

## The HTML shell

A theme supplies the visual tokens. The elements stylesheet supplies the controls. Importing the library module registers the custom elements.

<!--first-grid-html-->

## Connect data and render the grid

The first section starts a local service with metadata and seed records. `DataContext.connect()` reads the metadata and creates the shared data context.

The grid names an entity set and a view. The view describes columns, sorting and filtering; the collection handles loading records for that query. CSS gives the virtualized grid a bounded height.

<!--first-grid-js-->

The `html` template’s dot syntax binds JavaScript properties: `.ctx=${ctx}` passes an object to the element. It does not serialize that object into an HTML attribute. The source imports `html` from `lit-html` and data APIs from `@getaster/data`; importing `@getaster/elements` registers the controls. The standalone HTML includes an import map that points those names to the shared browser distribution. In an npm application, your bundler resolves the same package imports. Keep one copy of Lit and signals so the controls and your application share their runtime.

## What this example establishes

- **A context:** the shared schema, record store and service connection.
- **An entity set:** `Projects`, defined by the service’s metadata.
- **A view:** the visible columns, initial sort and filters.
- **A control:** a keyboard-accessible grid that loads and renders that view.

The small fixture demonstrates the contract. For larger results, collection paging and row virtualization use the same API. This example does not demonstrate save conflicts or cross-view editing; the [connected views how-to](connected-views.md) introduces the edit model.

## Connect your own service

Replace the mock setup with a fetch transport pointing to your OData service root:

```javascript
import { DataContext, fetchTransport } from "../lib/aster-ui.js";

const ctx = await DataContext.connect(
  fetchTransport("https://your-service.example/odata/")
);
```

Keep the rendering code, change `Projects` and its fields to match your metadata, and configure authentication and CORS for your deployment. The service must support the operations you enable. Metadata annotations drive field types, labels, validation and declared capabilities; see [the shared data model](data-model.md).

## Continue building

Follow these guides in order to build on the running grid:

1. [Understand the shared data model](data-model.md): context, collections,
   selection and ownership.
2. [Connect a grid and form](connected-views.md): use that model to keep selection,
   drafts and saved records in sync.
3. [Compose a workspace](declarative-workspace.md): connect reusable controls,
   actions and lazy views in JavaScript or YAML.

For specific controls and appearance:

- [Grid API](../reference/#class:Grid): properties, methods and events.
- [Component showcase](../#showcase): TileGrid, filtering, dashboards, windows and more.
- [Theming](themes.md): give the same controls your application’s identity.
