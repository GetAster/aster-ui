# Share data between table and tile views

A device fleet may need a table for comparison and cards for recognition. A folder catalogue may need compact rows and square icons. Switching presentation should keep the collection and selection that the user is working with.

[Explore Grid](../examples/grid.html) · [Explore TileGrid](../examples/tile-grid.html)

## Bind both controls to one collection

Create a collection through the data context, then assign it to both views. The collection owns the query and loaded pages; changing presentation does not construct a new query.

```javascript
const collection = ctx.collection(
  { set: "Devices", orderBy: [{ field: "name" }] },
  { pageSize: 24, keepPages: 3 }
);

table.ctx = ctx;
table.collection = collection;
tiles.collection = collection;
tiles.virtualized = true;
```

A grid still needs a view describing its columns. A TileGrid needs an accessible presentation (`presentTile`) and can use a custom `renderTile` for its visual content. Give virtualized controls a bounded viewport through CSS. The explorer’s source contains the full setup and both renderers.

## Share selected keys

```javascript
const selection = new Selection(ctx.store, collection, {
  multiple: true,
  fallback: false,
});
table.selection = selection;
tiles.selection = selection;
```

Selection belongs to records, rather than to a rendered row or card. Changing sort or presentation preserves the picked keys. A membership filter can remove a selected record from the result. Ordered selection adds `ordered: true` and can set `maxOrdered` when pick order has meaning.

## Keep the draft outside either presentation

The example’s **Edit first selected** action creates an `EditModel` for the selected key. The form lives beside the collection view, so switching between table and tiles keeps that draft mounted. Save writes through the same data context and updates its shared record store.

Changing selection does not silently replace an open draft: the editor keeps the record it was opened for. The example disables sample-data and selection-mode changes until the editor is saved or discarded. A production application should choose its own leave and discard policy.

For inline grid editing, call `table.finishEditing()` before removing the table and honour a refused or failed save. This example uses a separate form and does not enable inline grid editing.

## Separate presentation from membership

The platform and name controls change the collection’s query. Tile size changes CSS variables. A view switch replaces the mounted collection control while retaining the collection and selection objects. The example does not retain the old scroll position or active-cell focus when switching; those are separate view-state policies.

## Inspect and reuse the source

Start with **Code for this example** below either preview: it highlights binding, selection and rendering without the fixtures. Expand **Full application source** for the complete JavaScript, HTML and CSS. Excerpts are formatted from the running files; complete files are shown verbatim. **Open full size** uses the same example with the current controls; **Copy example link** retains presentation, filters, sort, selection mode and tile size.

Grid-header customizations, sample edits and selected keys are local to that page and reset on reload. The OData engine runs in WebAssembly with mock records; the folder catalogue does not connect to a real filesystem.

Release a collection with `ctx.release(collection)` when its owning screen closes, dispose edit models, and stop effects. Removing a control from the DOM does not mean that another view has finished using its collection.

See [Collection](../reference/#class:Collection), [Selection](../reference/#class:Selection), [Grid](../reference/#class:Grid), [TileGrid](../reference/#class:TileGrid) and [EditModel](../reference/#class:EditModel) for the full API contracts.
