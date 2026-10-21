# DataView: custom collection cards

A DataView presents collection records through a developer template, rather than
table columns. In Aster this uses [[class:TileGrid]]: the same data binding,
selection, paging, keyboard and accessibility engine as folder and device tiles.
There is no separate `aster-data-view` tag or second collection implementation.
The [directory example](../playground/dataview.html) demonstrates this composition.

```ts
import { html } from "lit-html";
import { Selection } from "@getaster/data";
import type { DataContext } from "@getaster/data";
import type { TileGrid, TileRenderer } from "@getaster/elements";

declare const ctx: DataContext;
declare const view: TileGrid;
const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }, { field: "id" }] },
  { pageSize: 24, keepPages: 3 });
view.collection = people;
view.selection = new Selection(ctx.store, people, { multiple: true, fallback: false });
view.label = "Team directory";
view.virtualized = true;
view.presentTile = (person, state) => ({
  title: state.hidden.has("name") ? "Hidden" : String(person.name),
});
const card: TileRenderer = (person, state) => html`<article>
  <strong>${state.hidden.has("name") ? "Hidden" : person.name}</strong>
  <p>${state.hidden.has("team") ? "Team hidden" : person.team}</p>
</article>`;
view.renderTile = card;
view.style.setProperty("--tile-min-width", "15rem");
view.style.setProperty("--tile-height", "19rem");
```

## Sorting and filtering belong to the collection

Update [[method:Collection.setQuery]] with `orderBy` and criteria. Sorting must
cover the complete query, not just the currently rendered or loaded cards.
Include a stable key tie-breaker for paging. The directory combines search across
name, role and team with a team equality filter, and supports name ascending/
descending, team/name and availability/name orders.

```ts
people.setQuery({ set: "People",
  filter: { op: "contains", field: "name", value: "amira", caseInsensitive: true },
  orderBy: [{ field: "name", descending: true }, { field: "id" }],
});
```

The public Selection retains membership across sorting and follows the data
core's filter-membership rules. Calling `setQuery` does not require building a
second view-specific record cache. The virtualized view requests visible pages;
no `loadAll()` is required.

## Templates, images and controls

`presentTile` supplies accessible names and descriptions independently of the
visual template. `renderTile` supplies Lit content, with escaped text and normal
control event handlers. Check `state.hidden` before rendering field values or
images. Decorative portraits use empty alt text; meaningful media needs its own
alternative. The default TileGrid presenter also supports images and fallback icons.

The example offers profile cards and compact horizontal cards by changing CSS
geometry while retaining the collection and Selection. CSS owns responsive tracks
and dimensions. Fixed-height virtualization bounds DOM work; `layout="content"`
(as a JavaScript property) is available for owner-loaded expanding cards instead.
Durable drafts belong in an edit model outside the card DOM, because paging and
reflow may recreate card content.

Arrow keys browse, Space selects, Enter opens and F2 enters card actions.
Interactive controls retain their own key handling; Escape returns from card
interaction to navigation. Selection alone does not open a record. The visible
Select/Deselect and Open actions provide touch equivalents. See [[group:tiles]]
for the complete grid/row/cell, selection and paging contract.

## Live data and editing

Use DataContext create/update operations. Other views bound to the same store
receive updates; sort/filter membership changes are managed by the collection.
The directory adds colleagues, toggles selected availability and opens a named
modal profile editor. Saving a new name updates the record and its sorted position.
The example prevents stale save completion from closing a later profile dialog.
Its illustrated portraits are local SVG data URLs; no third-party image service
receives the directory's queries or records.

This increment does not add a generic inline card editor, item drag/reorder or
cross-view copy/move. Those operations need edit and persistent-order contracts;
ordered Selection describes pick order, not persisted record order. Applications
can already place controls in templates, using external edit models for durable
state. Adding this recipe does not imply complete DHTMLX API parity.
