---
name: aster-ui
description: Build screens with Aster UI (@getaster/data, @getaster/elements): grids, forms, list editors, filters, reports and YAML workspaces over a shared DataContext. Use when creating or changing any screen, mockup or prototype in a project that depends on @getaster packages, and before writing records, tables or form state by hand.
---

# Aster UI

Aster UI is a framework of web components over one shared data layer. A
`DataContext` holds the service's metadata and records. Collections load pages for
a query, `Selection` and `PageScope` share what is selected between views, and an
`EditModel` keeps a draft apart from the stored record. The elements read that
layer. Paging, sorting, filtering, selection, drafts, validation, save conflicts
and refresh after save therefore come with the framework. The value of the
framework is in that layer, so every screen goes through it.

## Rules

1. **Every screen reads its records through a `DataContext`. Mockups and
   prototypes are no exception.** Never put an array of records into an element,
   never write a static HTML table, and never fake rows to show an idea. If there
   is no backend yet, describe the data as CSDL JSON metadata and seed records,
   and serve them with `createMockService` from `@getaster/mock`, as the starter
   template's `src/mock.ts` and `src/main.ts` do. A mockup built that way is the
   first version of the real screen. When the service exists, replace the
   transport with `fetchTransport(url)` and the rest carries over. A mockup that
   bypasses the data layer shows nothing about the application and has to be
   rewritten.
2. **Do not write what the data layer already does.** Use these instead:
   - Paging, sorting and filtering: `ctx.collection({ set, orderBy, filter }, { pageSize })`, or give a grid `set` and `view`.
   - Sharing selection between views: `Selection`, or a view's `publish` name on a `PageScope`.
   - A form for one record: `new EditModel(ctx, set, key)`; leave out `key` for a new record.
   - Dirty, valid, errors and conflicts: read them from the `EditModel`, not from your own state.
   - Refresh after save: none needed; a save updates the shared store, and every view reading it updates.
   - Editable rows inside a record: `aster-list-editor` over a `ListEdit`.
   - Read-only, hidden or required fields by condition: field rules on a `PageScope`.
3. **Configure elements through JavaScript properties, not attributes.** In
   lit-html, write `.ctx=${ctx}` and `.view=${{ ... }}`. In plain DOM code, use
   `grid.view = { ... }`. In YAML, use `props:`. A string attribute such as
   `set="Projects"` does nothing.
4. **Use the Aster element for a control rather than a native or hand-made one.**
   Examples are `aster-grid`, `aster-form`, `aster-field`, `aster-select`,
   `aster-date`, `aster-button`, `aster-dialog` and `aster-tabs`; the manifest
   below lists them all. Style through the theme tokens and application layout,
   and do not restyle an element's internals. CSS owns geometry: do not measure
   or position things in JavaScript.
5. **Look up the API; don't infer it.** Signatures change between releases, so
   use the installed version's sources below, not memory or old examples.

## Find the API

- `node_modules/@getaster/elements/custom-elements.json` lists every element with
  its tag, properties, defaults, methods and events, for the installed version.
- `node_modules/@getaster/data/dist/*.d.ts` and
  `node_modules/@getaster/elements/dist/*.d.ts` hold the typed public API with
  its documentation.
- https://ui.getaster.now/docs/reference/index.md links one Markdown page per
  public API, for example
  https://ui.getaster.now/docs/reference/api/class-Grid.md. These pages follow
  the latest release, so check them against the installed version.
- https://ui.getaster.now/docs/guide/index.md lists the guides. Start from the
  closest worked example before you design anything:
  - [Connect a grid and form](https://ui.getaster.now/docs/guide/connected-views.md)
  - [Compose a workspace in YAML](https://ui.getaster.now/docs/guide/declarative-workspace.md)
  - [Filter, group and export](https://ui.getaster.now/docs/guide/filter-group-export.md)
  - [Dashboard widgets](https://ui.getaster.now/docs/guide/dashboard-widgets.md)
  - [Fields and layouts](https://ui.getaster.now/docs/guide/fields-and-layouts.md)
  - [Authentication recovery](https://ui.getaster.now/docs/guide/authentication.md)

## Build a screen

1. Read the service's metadata, or the mock's, for the entity sets, fields,
   keys and annotations the screen uses. Field labels, types, required fields and
   validation come from there; do not repeat them in the screen.
2. Find the closest example in the guides above and start from its shape.
3. Choose how to declare the screen. A YAML screen (`.ui.yaml`, compiled with
   `compileCompositeYaml` and checked with `authoring.validate`) suits layouts
   and bindings, and its executable behaviour lives in a registered model. Code
   with lit-html suits a screen with more behaviour of its own. Follow whichever
   the project already uses.
4. Write the smallest change: a view's columns, a form's fields, a model's
   collection. If you find yourself writing state that tracks records, pages,
   selection or edits, stop and find the API that holds it.
5. Dispose what you create when its screen goes away: edit models, scopes,
   effects, and collections obtained with `ctx.collection` (`ctx.release`).

## Check the work

Run these before you hand the work back, and fix what they report:

```sh
bunx aster-lint src index.html   # or npx; native controls Aster provides, CSS that bypasses theme tokens
bunx tsc --noEmit                # the typed API catches wrong properties and signatures
```

For a YAML screen, `authoring.validate(definition, sources)` reports an
unregistered model, component, renderer or property with its file, line and
column. Then open the screen in a browser. Page through the data, edit a record,
save it, and confirm every view showing that record updates. Make a save fail
and confirm the draft is kept.
