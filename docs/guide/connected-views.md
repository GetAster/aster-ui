# Connect a grid and form

A list and an edit form should agree about the record they show. Aster gives them a shared context, while an edit model keeps uncommitted input separate from the stored record.

## Run the workflow

[Open the editable grid-and-form example](../playground/). Choose a project, edit its name, and save. The grid reflects the saved change because it reads the same record store. You can edit the example’s source and run it again.

The example is the playground’s default: **A grid, a form and a picker on the same data**.

## Publish the selection

Create a `PageScope` and provide it on a common ancestor. Give the grid a publication name, `projects`. The grid publishes its selection there; another view can observe `projects.key` without querying the grid’s DOM.

```javascript
const scope = new PageScope();
provideScope(out, scope);
```

```html
<aster-grid .ctx=${ctx} .set=${"Projects"}
  .publish=${"projects"} .label=${"Projects"}>
</aster-grid>
```

The HTML above is a Lit template fragment. Import `html`, `render`, `effect`, `PageScope`, `provideScope` and `EditModel` from the Aster module, and use the [getting started](getting-started.md) setup for `ctx` and `out`.

## Create an edit model for the selected record

An effect observes the published key. Dispose the previous edit model when selection changes, then create a model for the selected record.

```javascript
let edit;
const stop = effect(() => {
  const key = scope.value("projects.key").value;
  edit?.dispose();
  edit = key === undefined
    ? undefined
    : new EditModel(ctx, "Projects", key);
  view();
});
```

`view()` is your rendering function. In the runnable example it binds `edit` to an `aster-form`, with a Save action calling `edit.save()`. The full working source is in the playground.

> Selection changes in this introductory example discard the previous draft. For an application with unsaved work, add a leave/selection guard before changing the active record. Choose that policy explicitly.

## Keep drafts separate from saved data

The form writes to the edit model. A successful save updates the shared store, which updates the grid. Validation and save errors belong to the edit workflow; applications should present them and keep the draft available for correction.

Dispose edit models and the page scope, and stop your effects, when their owning screen is removed. See [EditModel](../reference/#class:EditModel) and [PageScope](../reference/#class:PageScope) for lifecycle details.

## Keep live refreshes stable

Treat initial loading, a background refresh and a new query as different states.
During a same-query refresh, render the existing rows and mark the view busy;
show an error and retry action alongside them if the refresh fails. Reserve
loading placeholders for positions that have never loaded. Replacing a whole
view with a loading message can remove focus, collapse its geometry and restart
chart animations.

Aster's collection refresh keeps confirmed positions until the visible pages
and count can be replaced together. An uncertain sort move keeps the row at its
last confirmed position while the server settles its location. Known deletions
and records that definitely leave a filter disappear immediately. A new query
clears its old rows so they cannot appear to answer the new filter.

Grid, TileGrid and Listbox expose busy state without removing loaded content.
Key lists retain their identity when membership and order are unchanged; record
values still update through the shared store. Grouped results retain unchanged
group objects. Custom views should read the rows independently of loading status,
keep stable record/group keys and avoid rebuilding their component instance.
For charts, see [incremental chart updates](connected-charts.md#include-accessible-alternatives-and-motion-preferences).

## Where to go next

Continue with [Compose a workspace](declarative-workspace.md) to declare the
controls, commands and lazy editor around a shared model. If the ownership terms
are unfamiliar, revisit [the shared data model](data-model.md).

[Explore the live example](../playground/) for the complete code, including a related-person picker. Use the [form reference](../reference/#class:Form) for metadata-driven sections and the [Grid reference](../reference/#class:Grid) for view configuration.
