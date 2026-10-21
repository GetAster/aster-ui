# Grids

`aster-grid` shows the records of one entity set as a table that a person can
shape: sort, filter, group, hide, reorder, resize and freeze columns, save the
result as a named view, and edit rows in place. The page decides where the
data comes from, the starting view, and what a row can do. The same element
covers a handful of rows and 100,000: only the rows near the viewport are in
the DOM, and pages of rows load as they come into view.

This page covers the grid element, the view it is shaped by, and the objects
the page passes in for lookups, cell renderers, row menus, row controls and
expansion. A grid over a self-referencing set can also be a tree grid; that is
covered with the other tree views in [[group:trees]].

### Shared table and tile views

Bind the same [[class:Collection]] and [[class:Selection]] to a flat table and a
[[class:TileGrid]]. `ctx` must be the data context that owns the collection and
selection. The grid infers `set` from the binding. Both views read and update the
same selection, including pick order and its optional limit.

```ts
import { Selection } from "@getaster/data";

const records = ctx.collection({ set: "Devices", orderBy: [{ field: "name" }] });
const picks = new Selection(ctx.store, records, {
  multiple: true, ordered: true, maxOrdered: 3,
});
table.ctx = ctx;
table.collection = records;
table.selection = picks;
tiles.collection = records;
tiles.selection = picks;
tiles.virtualized = true;
```

The supplied collection's query wins on initial binding, including its filter,
sort and `$select`. Its existing filter becomes the base; table filter-row
criteria and `base` are additional constraints. Header sorts and filter edits
update that same collection. Column layout changes do not change the query.
An external `setQuery` replaces the base, reflects its sort in the table and
clears the table's additional filter-row criteria. A query controlled by a signal
should have one owner: do not also write a conflicting query from that signal.

Detach the inactive view when switching paged views: one collection has one
active viewport/prefetch range. Keep the component instances to preserve their
column/filter UI and per-view scroll state. A borrowed collection is never
released on disconnect; its owner eventually calls `ctx.release(records)`.
Before removing an editable table, await [[method:Grid.finishEditing]]; false
means keep it visible with the draft/error. Expansion editors still use their
existing `collapse`/unsaved-change contract. The host owns the switch, saves
scroll offsets, and can transfer the active record using `activeKey`,
[[method:Grid.focusKey]] and [[method:TileGrid.focusTile]]. These focus methods
do not alter a shared selection. The large-device playground demonstrates this.

With a supplied selection, arrows move focus, Space selects/toggles, ordinary
click selects (ordered mode toggles), Ctrl/Meta-click toggles, and Shift-click/
Shift-arrow replaces the range with loaded keys between its endpoints. Ranges
never enumerate unknown pages. Ordered picks display ranks, expose Move earlier/
later buttons, and support Alt+Up/Down. Over-limit changes are rejected in full
and announced. F2 enters selection buttons on a read-only table; Shift+F2 does
so on an editable table, whose ordinary F2 retains inline editing. Escape
returns to grid navigation. Visible pick buttons also support touch.

The borrowed binding supports flat rows. Grouped/tree grids retain their existing
owned-data mode; combining those modes with an external collection/selection
throws, and grouping actions are omitted in bound mode. A borrowed collection
without a selection supports navigation and editing without choosing records.

### Binding a grid

In its owned-data mode, a grid needs three things: a [[class:DataContext]] as `ctx`, an entity set
name as `set`, and a view. Without a `view`, the grid uses
[[staticMethod:defaultView]] for the set's entity type. Everything else is
optional.

The grid builds its query from the view with [[staticMethod:viewQuery]]: the
view's filters, inside the page's `base` criteria, and the view's sort. It
creates a [[class:Collection]] for that query with pages of 100 rows, and the
collection follows the view: a change of sort or filter replaces the rows and
scrolls back to the top.

Every property is backed by a signal. Setting one re-renders the grid, and
reading one inside an `effect` or another Aster element's render tracks it, so
`grid.selected` can drive a detail view. The exceptions are `tree` (read once,
when the grid first has a context and a set), `rules` and `rowMenu` (read when
a row starts editing or a menu opens), and `collection` and `treeModel`, which
are plain getters.

### The view is data

A [[object:GridView]] holds everything the person can change: the columns in
display order (each a [[object:GridColumn]] with an optional pixel width and a
hidden flag), the sort keys, the filters by column, one optional grouping
field, and how many leading columns are frozen. The page gives the starting
view. The person's changes produce new view objects; the grid never mutates
the one it was given.

- With `persist`, the person's current view and their named views are kept in
  this browser's local storage, and a Views button appears in the toolbar.
- With `publish`, the view, the selected record and the total are published to
  the page scope, so page rules and other elements can read them.
- "Reset to the page's view" in the Columns and Views panels goes back to the
  first view the page gave.

A stored view is reconciled with the columns the page offers now: columns that
no longer exist drop out, new ones join at the end hidden, and filters, sort
keys and a grouping on missing columns are dropped. A change to the page's
columns therefore never breaks a saved view.

### What the person can do

- **Sort.** Pressing a header sorts by that column, ascending and then
  descending. Shift adds the column to the sort; with several keys each header
  shows its number. A change of sort is announced, such as "Sorted by Date,
  descending".
- **Column menu.** Each header has a menu button: a Sort group (Ascending,
  Descending, Not sorted, and "Add to the sort"), Group by, "Freeze up to"
  this column, Move and Width submenus, Hide, and Columns…. A column that
  can't sort or group doesn't offer it.
- **Move and resize.** Dragging a header moves its column; dragging its right
  edge resizes it (never under 48 px), and a double-click on the edge returns
  it to sharing the space.
- **Filter row.** The Filters button shows a row under the header. Booleans
  and fields with allowed values get a choice with "Any". A lookup column gets
  a multi-value picker, which makes an `in` filter. Text columns filter by
  "contains", ignoring case. Number and date columns take `5`, `>5`, `>=5`,
  `<5`, `<=5` or a range `1..3`, and dates also accept text such as
  `>=1 Oct 2026`, with a calendar button. Typing applies after a 300 ms pause,
  or at once on Enter or on leaving the input; text that doesn't parse shows a
  message and isn't applied. Turning Filters off clears every filter.
- **Group.** "Group by" from the column menu groups the rows by that field.
  Group rows show the value and a count from one grouped request; a group's
  rows load when it is opened. "Grouped by Status ✕" in the toolbar stops it.
- **Columns and Views panels.** Columns lists every column with a checkbox
  and up and down buttons. Views (with `persist`) lists the named views and
  saves the current one under a name.

The toolbar shows the row count as a polite live region: "1,204 rows",
"1,204 rows in 4 groups", "300+ rows" when the server gives no count, or
"About 12,000 rows" when the count is an estimate.

### Rows, cells and editing

A cell shows its field's value formatted by type: dates and timestamps as
dates, Booleans as "Yes" or blank, numbers aligned right. A value the server
hides from this person shows as "Hidden", never blank. Two properties change
what a cell shows:

- `lookups` shows a foreign key by a field of the related record (a person's
  name instead of `personId`), and makes the column's editor, filter and group
  labels use that name too.
- `renderers` replaces the content of a column's cells with the page's own
  template.

With `editable`, Enter, F2 or a double-click edits a row in place. The row gets
an [[class:EditModel]] and each cell becomes the control the field's metadata
calls for. Enter saves, Escape reverts, and focus leaving the row saves it.
Only one row is edited at a time. `rules` adds page rules to the row being
edited, with the row published as `row` in a child scope.

A row can also expand into content the page supplies (`expansion`), and carry
floating buttons (`rowControls`). `rowMenu` adds the page's actions to the
context menu of a row.

### Keyboard and ARIA

The grid is one tab stop with `role="grid"` (or `treegrid` when grouped or a
tree). The active cell is its `aria-activedescendant`, and the row of the
active cell is the selection in owned-data mode. With a shared selection, focus
and picks are independent (see above).

| Where | Keys |
|---|---|
| Rows | Arrows move between cells; Page Up and Page Down move by a viewport; Home and End go to the first and last column, and with Ctrl or Cmd to the first and last cell; F2 edits; Enter edits, or expands the row when the grid has `expansion`; Shift+F10 or the Menu key opens the row menu |
| ↑ on the first row | The filter row when it shows, else the header |
| Header row | ← and →, Home and End; ↓ to the filter row, then the rows; Enter or Space sorts, Shift adds to the sort; Shift+F10 or the Menu key opens the column menu |
| Filter row | Enter or F2 goes into the filter; Escape there returns to its cell |
| Group row | → opens, ← closes, Enter or Space toggles |

Keys typed in a cell editor, a filter, an open panel, row controls or expanded
content belong to it. `aria-rowcount` is -1 while the total isn't known
exactly. Only the first sort key sets `aria-sort`.

When the grid itself is narrower than 560 px (a container query, not the
viewport width), each row is drawn as a card of labelled values. It is the same
element with the same keys.

### Example

A grid of time entries: newest first, the date and person columns frozen, the
person and project shown by name, the person's view kept in the browser, and
rows editable with a rule that locks approved entries.

```ts
import { html, render } from "lit-html";
import type { DataContext, FieldRules } from "@getaster/data";
import type { GridView, Lookup } from "@getaster/elements";
import "@getaster/elements";

declare const ctx: DataContext;

const view: GridView = {
  columns: [
    { field: "date", width: 140 },
    { field: "personId", width: 150 },
    { field: "projectId" },
    { field: "hours" },
    { field: "status" },
  ],
  sort: [{ field: "date", descending: true }],
  filters: {},
  frozen: 2,
};

const lookups: Readonly<Record<string, Lookup>> = {
  personId: { set: "People", display: "name" },
  projectId: { set: "Projects", display: "name" },
};

const approved = { op: "eq", field: "row.record.status", value: "approved" } as const;
const rules: Readonly<Record<string, FieldRules>> = {
  hours: { readOnly: { when: approved, reason: "Approved time can't be changed." } },
};

render(
  html`<aster-grid .ctx=${ctx} .set=${"TimeEntries"} .view=${view} .lookups=${lookups}
    .label=${"Time entries"} .publish=${"time"} .persist=${"time"}
    .editable=${true} .rules=${rules} .empty=${html`No time entries match.`}></aster-grid>`,
  document.querySelector("main")!,
);
```

### Limits

- Grouping supports ordered levels; self-referencing tree mode is separate.
  Text fields longer than 500 characters aren't offered for grouping. Group
  metadata loads completely per open branch; record pages and DOM stay bounded.
- Owned-data mode selects the active row. Supply `collection`/`selection` for
  explicit single/multiple/ordered picks. Borrowed bindings currently require flat
  rows; grouping/tree data remains owned by the grid.
- A lookup column sorts only when the entity type has a single-valued
  navigation whose one key field is that column; it then sorts by
  `<navigation>/<display>` on the server. Without one, the column doesn't sort.
- A lookup column's editor and filter load every record of the related set
  (500 per request) the first time either is used.
- `persist` restores stored views only when the page sets `view` before the
  grid connects. With no `view`, the grid falls back to the default view and
  nothing is read from or written to storage.
- Changing `set` on a live grid keeps the current view; give it a view for the
  new set too, or use a new element.
- Toolbar text and messages are in English, and counts are formatted with
  British English number formatting.

## class:Grid

A collection-backed table view with virtualized rows, filtering, sorting,
editing and grouping. Bind it to a shared [[class:DataContext]] so other views
can read the same records.

[Try the interactive Grid explorer](../examples/grid.html) ·
[Get started with a working example](../guide/getting-started.html) ·
[Connect a grid and form](../guide/connected-views.html) ·
[Open the project grid](../playground/first-grid.html)

Tag: `aster-grid`. Bind it with properties, not attributes: `ctx`, `set` and
optionally `view` are what it needs to show rows. The element renders nothing
until it has a context, a set and a view.

Events: `moved` (a row was dragged to a new parent in a tree grid). Everything
else the grid reports is through signals: `selected`, `expanded`, and what it
publishes with `publish`.

The topic above describes the toolbar, the header menu, the filter row and the
keyboard. Behaviour worth knowing when building a page on it:

- Rows load by page as they come into view, through [[method:Collection.view]].
  While one load is in flight, only the newest wanted range waits; ranges
  scrolled past are dropped.
- Row heights are measured, so wrapped text and expanded rows work. When a
  measured height replaces the estimate above the viewport, the grid adjusts
  the scroll position so the rows on screen stay put.
- A new query (filter, sort, grouping or `base`) scrolls to the top and moves
  the active cell to the first row, unless it is in the header or filter row.
  `selected` keeps its key until the person moves.

```ts
import type { DataContext } from "@getaster/data";
import type { Grid } from "@getaster/elements";
import "@getaster/elements";

declare const ctx: DataContext;

const grid = document.createElement("aster-grid") as Grid;
grid.ctx = ctx;
grid.set = "Projects";
grid.label = "Projects";
grid.view = {
  columns: [{ field: "name" }, { field: "state" }, { field: "health" }],
  sort: [{ field: "name" }], filters: {}, frozen: 0,
};
grid.style.height = "300px";
document.body.append(grid);
```

## method:Grid.expand

Use it from a row control or a deep link. It needs `expansion` to be set.

- `key`: the row's key text, such as `"[42]"` (see [[type:KeyText]]).

Returns `true` when the row is open afterwards, including when it was already
open (focus then stays where it is). Returns `false` when there is no
`expansion`, the record isn't loaded in the store, `canExpand` refuses it, the
`limit` is reached (the toolbar and the live region say so), or, with `single`,
the row already open has unsaved changes. In that last case the open row shows
the unsaved-changes question and nothing else opens until it is answered.

On success, [[method:Expansion.content]] is called once to build the row's
editor, the key is appended to `expanded`, and focus moves to the content's
first field (or its first button), once it has rendered.

```ts
const edit: RowControl = { label: "Edit", icon: icons.edit, run: () => grid.expand(row.key) };
```

## method:Grid.collapse

- `key`: the expanded row's key.
- `how`: `"ask"` (the default) asks first when the editor's `dirty` signal is
  true; `"discard"` calls the editor's `discard()` and closes; `"save"` awaits
  the editor's `save()` and closes only if it resolves to `true`.

Resolves to `true` when the row is closed, or wasn't open. Resolves to `false`
when the grid is asking (the row shows "This task has unsaved changes." with
Save, Discard and Keep editing, and focus moves to the question) or when the
save failed. Closing calls the editor's `dispose()`, removes the key from
`expanded`, and returns focus to the row's first control, or to the grid.

Escape calls `collapse(key)` with `"ask"`: inside expanded content, or on the
grid when the expanded row is the active one. A double-click on an expanded
row closes it when it has no unsaved changes, and does nothing when it has.

```ts
declare const icons: Record<"edit" | "save" | "cancel", TemplateResult>;

const controls = (row: RowState): RowControl[] =>
  row.expanded
    ? [
        { label: "Save", icon: icons.save, run: () => void grid.collapse(row.key, "save") },
        { label: "Cancel", icon: icons.cancel, run: () => void grid.collapse(row.key, "discard") },
      ]
    : [{ label: "Edit", icon: icons.edit, run: () => grid.expand(row.key) }];
```

## method:Grid.reveal

Only for a tree grid (`tree` set). It calls [[method:Tree.reveal]], which opens
each ancestor and loads pages of each level until the row exists, then makes
the row active (and so selected) and scrolls it to the top of the viewport.

- `key`: the record's key.

Resolves to `false` in a grid without a tree, or when the record isn't in the
tree (filtered out, or not under its root). Use it for deep links and after
adding or moving a record.

```ts
const saved = await edit.save();
if (saved) {
  await grid.treeModel?.expand(parentKey);
  await grid.reveal(saved.key);
}
```

## method:Grid.focus

Focuses the grid's scrolling table, the element that holds the active cell,
rather than the custom element itself. `options` are passed on, such as
`{ preventScroll: true }`.

## attr:Grid.ctx

The [[class:DataContext]] the grid reads through: its collections, its record
store, and `ctx.lookup` for lookup columns. Required; until it is set the grid
renders nothing. Default `undefined`.

## attr:Grid.set

The name of an entity set in the context's schema, such as `"TimeEntries"`.
Required. When no `view` is set by the time the grid has a context and a set,
it takes [[staticMethod:defaultView]] of the set's type. Default `""`.

Set it once. Changing it on a live grid starts a new collection but keeps the
current view, which names the old set's columns.

## attr:Grid.base

[[type:Criteria]] combined (with `and`) beneath the view's filters, such as
"this project's entries only". The person can't see or remove it. Reactive: a
new `base` gives a new query and scrolls back to the top. Default `undefined`
(no limit).

In a tree grid it limits the whole tree, as [[object:TreeOptions]] `base`
does. Pass the consumed criteria of a [[class:SharedFilters]] here to make the
grid follow a page's shared filter.

```ts
html`<aster-grid .ctx=${ctx} .set=${"TimeEntries"} .base=${{ op: "eq", field: "projectId", value: 7 }}></aster-grid>`;
```

## attr:Grid.view

A [[object:GridView]]. The person's changes replace it with new objects, so
reading it gives the view as the person has shaped it. Reactive in both
directions: setting it re-renders the grid and re-queries.

Only the first view set becomes the Reset target; setting another later
changes the current view but not what Reset returns to. With `persist`, set
`view` before the grid connects so the stored view can be reconciled against
it (see `persist`). A view the page sets after the grid connects replaces the
person's view, and is then stored as their current one.

Default `undefined`: the grid then uses [[staticMethod:defaultView]].

## attr:Grid.label

The grid's accessible name (`aria-label` on the table), and the start of the
toolbar's name ("Time entries view"). Give every grid one. Default `""`.

## attr:Grid.publish

With a name, the grid publishes these values to its [[class:PageScope]] under
that name, and withdraws them when it disconnects:

| Value | What |
|---|---|
| `key` | The selected record's key text |
| `selected` | The selected record, live from the store, typed by the set's entity type |
| `any` | Whether a row is selected |
| `view` | The current [[object:GridView]] |
| `total` | The row count, or `undefined` until known |

With a shared selection, `keys`, `records`, `count` and `many` are also published,
and `key`/`selected` are the first pick rather than the active row. Hidden markers
follow that selected record. Detaching withdraws these values, allowing the
alternate tile view to publish under the same key.

A page rule can then read `time.selected.status` or `time.total`. The name also
labels the rules of an edited row (`<publish>.row`) in explanations. Nothing is
published without a page scope above the grid. Default `""` (nothing
published).

```ts
import { effect } from "@preact/signals-core";
import { provideScope } from "@getaster/elements";

provideScope(page, scope);
render(html`<aster-grid .ctx=${ctx} .set=${"TimeEntries"} .publish=${"time"} .label=${"Time"}></aster-grid>`, page);
const status = scope.value("time.selected.status");
effect(() => console.log("Selected entry is", status.value));
```

## attr:Grid.persist

With a name, the grid keeps the person's current view and their named views in
`localStorage` under `aster-grid:<name>`, and shows the Views button. The
stored views are read when the grid connects, reconciled with the columns of
the page's view, and written whenever the view or the named views change.
Where storage is unavailable, nothing is kept and the view still applies until
the page closes. Default `""`.

Use a name that is unique per grid on the site. Storage is per browser, not per
user account.

The stored view is restored only when the page has set `view` before the grid
connects; with no `view`, `persist` reads and writes nothing.

## attr:Grid.renderers

A record from a column's field name to a [[type:CellRenderer]]. A renderer
replaces the default formatting of that column's cells. It doesn't apply to a
row being edited (the cell is a control then), to a value the server hides
(which shows as "Hidden"), to group labels, or to the filter row. Reactive.
Default `{}`.

```ts
grid.renderers = {
  hours: (entity) => html`<span class="hours">${Number(entity.hours).toFixed(1)} h</span>`,
  status: (entity) => html`<span class="aster-status" data-status=${String(entity.status)}>${entity.status}</span>`,
};
```

## attr:Grid.lookups

A record from a column's field name to a [[object:Lookup]]. For each lookup
column:

- The cell shows the related record's `display` field, fetched through
  [[method:DataContext.lookup]], with a placeholder until it arrives.
- An edited row's cell is a picker over the related set.
- The filter row offers a multi-value picker, which filters with `in`.
- Group rows show the related name; no value shows as "None".
- The column sorts by the related field when the entity type has a
  single-valued navigation whose key is this column, and doesn't sort
  otherwise.

Reactive. Default `{}`.

```ts
grid.lookups = {
  personId: { set: "People", display: "name" },
  projectId: { set: "Projects", display: "name" },
};
```

## attr:Grid.rowMenu

A function from a row's record and key to [[type:MenuItem]]s. Right-click,
Shift+F10 or the Menu key opens a menu with these items first, then a
separator and the active column's options as a submenu ("Hours column"). On a
row that isn't loaded yet, only the column's options show. It is called each
time the menu opens. Default: a function returning no items.

```ts
grid.rowMenu = (entity, key) => [
  ...(entity.status === "draft"
    ? [{ label: "Submit", run: () => void ctx.update("TimeEntries", key, { status: "submitted" }) }]
    : []),
  { label: "Delete entry", run: () => void ctx.remove("TimeEntries", key) },
];
```

## attr:Grid.tree

A [[object:GridTree]]. Set it before the grid connects: it is read once, when
the grid first has a context and a set, and the grid then builds a
[[class:Tree]] over the set with the view's filters and sort and the grid's
`base`. Setting it later has no effect. Default `undefined` (a flat grid).

See [[group:trees]] for how a tree grid behaves.

```ts
html`<aster-grid .ctx=${ctx} .set=${"Tasks"} .tree=${{ parentField: "parentId", draggable: true }}
  .editable=${true} .label=${"Tasks"}></aster-grid>`;
```

## attr:Grid.treeModel

The [[class:Tree]] a tree grid built, or `undefined` in a flat grid and before
the grid has a context and a set. Use it to open, close, move or list records
in the tree the grid shows: [[method:Tree.expand]], [[method:Tree.move]],
[[method:Tree.descendants]]. Read-only, and a plain getter, not a signal. The
grid disposes the tree when it disconnects.

```ts
await grid.treeModel?.move(taskKey, newParentKey);
await grid.reveal(taskKey);
```

## attr:Grid.rowControls

A function from a [[object:RowState]] to the row's [[object:RowControl]]s, or
`undefined` for none. It is called while the grid renders, for each loaded row
in view, so the controls follow the row's state and any signal the function
reads: Edit on a closed row, Save and Cancel on an open one, View on a locked
page. Return an empty array for a row with no controls. Default `undefined`.

The buttons sit in a cell of their own after the last column. They show on
hover, on the selected row and on the active row. With a mouse, hovering
another row hides the selected row's, unless it's expanded or holds keyboard
focus. Each is named by its
`label`. Only the active row's buttons are in the Tab order: Tab reaches them
from the grid, ← and → move between them, and Escape returns to the grid. A
click on a control doesn't select or expand the row.

```ts
grid.rowControls = (row) =>
  locked.value
    ? [{ label: "View", icon: icons.view, run: () => grid.expand(row.key) }]
    : [
        { label: "Edit", icon: icons.edit, run: () => grid.expand(row.key) },
        { label: "Remove", icon: icons.remove, run: () => askRemove(row.entity) },
      ];
```

## attr:Grid.expansion

An [[object:Expansion]]. With it, a double-click or Enter on a row expands it,
and a double-click on an expanded row with no unsaved changes closes it,
instead of editing it in place (F2 still edits when `editable`), and
[[method:Grid.expand]] works. The content spans every column under the row.
Several rows can be open unless `single` or `limit` says otherwise. Default
`undefined`.

```ts
grid.expansion = {
  noun: "task",
  limit: 3,
  content: (row) => taskEditor(ctx, row.key, row.entity),
};
```

## attr:Grid.expanded

A read-only signal of the expanded rows' keys, oldest first. Read
`grid.expanded.value` in a render or an effect to follow it, for example to
mark open rows elsewhere on the page or to keep a URL in step.

```ts
effect(() => {
  const open = grid.expanded.value;
  document.title = open.length ? `Tasks (${open.length} open)` : "Tasks";
});
```

## attr:Grid.editable

`true` lets the person edit rows in place: Enter, F2 or a double-click starts
(with `expansion`, only F2), Enter saves, Shift+Enter is a new line in long
text, Escape reverts and ends, and focus leaving the row saves it. Default
`false`.

Each edited cell is the control the field calls for (text, check, select,
date, or a picker for a lookup column); computed fields stay as text. Focus
goes to the pressed cell's control, or the row's first editable one. Starting
another row saves the current one first and stays on it if the save fails. A
row with errors stays in edit with focus on the first invalid field; a form
error shows under the row; a change by someone else to a field being edited
offers "Keep mine" and "Take theirs".

In a tree grid, row dragging also needs `editable`. [[attr:RowState.editable]]
passes this flag to row controls and expansion content.

## attr:Grid.rules

Page rules for the fields of the row being edited, by field name, as
[[object:FieldRules]]. When a row starts editing, the grid creates a child of
its page scope, publishes the row's edit there as `row`, and applies these
rules, so a rule reads its own record (`row.record.status`) or the values being
typed (`row.values.projectId`). Read when a row starts editing; a change
applies to the next row edited. A read-only reason shared by several cells
shows once under the row. Default `{}`. Rules need a page scope above the grid.

```ts
const approved = { op: "eq", field: "row.record.status", value: "approved" } as const;
grid.rules = {
  hours: { readOnly: { when: approved, reason: "Approved time can't be changed." } },
  date: { readOnly: { when: approved, reason: "Approved time can't be changed." } },
};
```

## attr:Grid.empty

A template shown in place of the rows when the query matches nothing (the
count is 0). Default: nothing. Say what the person can do, such as clearing a
filter.

```ts
grid.empty = html`No time entries match. Clear the filters to see them all.`;
```

## attr:Grid.collection

The current [[class:Collection]]. Set an existing collection to enable borrowed
flat-data mode; default `undefined` means own a collection from `ctx`, `set` and
`view`, or infer the collection from a supplied `selection`. An explicit binding is
readable before connection; binding properties are reactive. The owned collection
getter is a plain read, independent of row measurements. The owner must
use the same data context; the grid never releases a borrowed collection.

In owned tree mode it is the top-level collection; in grouped mode each group
has its own collection and the root is not loaded by the grid. Explicit binding
with `tree` or a grouped view throws. Explicit collection and selection bindings
must refer to the same collection. For replacement, clear selection, replace the
collection, then supply its selection (or use only `selection` inference).

## attr:Grid.summaries

An array of [[type:GridSummary]], default `[]`. Displays exact server totals for
the full filtered grid query in a named summary region outside the virtual rows.
Grouped grids also show every level's totals in its header. Counts
never represent just loaded rows. Null aggregate values display an em dash.
Sort and column changes do not recount overall totals; filter changes and saved
records do. Loading clears previous totals, and failures offer keyboard-reachable
retry. Tree grids require an explicitly scoped [[method:DataContext.summary]]
instead. See [summaries and CSV export](reporting.md).

## type:GridSummary

`{ method: "count", label?: string }`, or a `field`, aggregate `method` and
optional `label`. Methods: `sum`, `average`, `min`, `max`, `countdistinct`.
Sum and average require numeric fields. An omitted label uses the metadata title
and operation. Count needs no field. These settings belong to the host component,
not the persisted end-user view.

## method:Grid.exportCsv

- `options`: [[object:GridCsvOptions]], default query export.

Returns CSV text for visible metadata columns in current view order. Uses the
captured query, including filters, base criteria, sort and projection. Custom
DOM renderers, lookup labels, group headers and summary rows are excluded. The
host chooses the download filename and action. A selection export uses the shared
[[class:Selection]], preserving pick order even for evicted pages.

The grid must be connected. An unsaved inline draft rejects export; finish or
cancel editing first. Expansion drafts are independent and must be resolved by
the host when required. Tree grids use the standalone
[[staticMethod:exportCsv]] with an explicit query. Export does not finish editing,
change selection, load collection pages or move the viewport. See
[[staticMethod:exportCsv]] for cancellation, row limits, hidden fields and
concurrent-server-change limits.

## object:GridCsvOptions

The [[object:CsvOptions]] paging, cancellation, progress and row-limit options,
plus `scope` instead of explicit keys. Default row limit is `100000`.

## attr:GridCsvOptions.scope

`"query"` (default) exports the full filtered result. `"selection"` exports the
shared selection in pick order, fetching selected records afresh by key. An
empty selection produces headers only; a grid without shared selection rejects
selection export.

## attr:Grid.selection

An optional shared [[class:Selection]], default `undefined`. With it, `multiple`,
`ordered` and `maxOrdered` govern picks; focus is separate. Its collection supplies
the binding if `collection` is omitted. The grid publishes the same selection
values/hidden markers as TileGrid plus `view` and `total`. Without a selection,
a borrowed grid does not choose records. Existing owned grids keep their active-
row selection behavior.

## attr:Grid.activeKey

Read-only navigation record key, independent of shared selection. Undefined for
an empty grid or a destination whose record has not loaded yet. A loaded active
key follows its new position after updates; removal recovers a surviving neighbor.

## attr:Grid.selected

With a shared selection, its first chosen key (first in pick order), or undefined
when empty. In legacy owned mode, the active row's record key. Read-only and
reactive. Use `activeKey` for navigation and `selection.keys` for multiple picks.

## method:Grid.focusIndex

- `index`: zero-based nonnegative safe integer position in a flat collection.
- `column`: optional zero-based visible column, default `0`, clamped to the view.

Returns `Promise<boolean>`. Ensures the destination page, makes the cell active,
reveals it and focuses the grid. With a shared selection this does not select.
False for absent, failed, disconnected, superseded or non-flat navigation. In
owned-data mode activation retains the existing active-row selection behavior.

## method:Grid.focusKey

- `key`: a loaded record key.
- `column`: optional zero-based visible column, default `0`.

Returns `Promise<boolean>`. Uses `focusIndex` to focus a key currently in the
collection's loaded slots. Does not locate an arbitrary unloaded server key;
use `focusIndex` when its logical position is known.

## method:Grid.finishEditing

Returns `Promise<boolean>`. Saves and ends the current inline edit. True when
saved or no edit is open; false leaves validation/server errors and the draft
visible. Await it before switching/removing an editable table. It does not close
or save custom expansion editors; use their existing `collapse` contract.

## event:Grid.moved

Fired after a row in a tree grid was dragged onto a new parent and the move
was saved: [[method:Tree.move]] resolved and the new parent was opened. The
`detail` is `{ key, from, to }`: the moved record's key, and its old and new
parent keys (`undefined` for the top level). It bubbles. It isn't fired for a
refused drop, a drop on the row's current parent, or a move made by calling
`Tree.move` yourself. Use it to say where the row went and offer Undo.

```ts
html`<aster-grid .tree=${tree} .editable=${true}
  @moved=${(e: CustomEvent<{ key: KeyText; from: KeyText | undefined; to: KeyText | undefined }>) => {
    const { key, from } = e.detail;
    toaster.show("Moved", { label: "Undo", run: () => void grid.treeModel?.move(key, from) });
  }}></aster-grid>`;
```

## type:CellRenderer

Used as the values of [[attr:Grid.renderers]]. The function receives the row's
record and key text and returns a lit-html template. It is called while the
grid renders, so signals it reads re-render the grid. Keep it cheap: it runs
for every rendered cell of its column.

```ts
const due: CellRenderer = (entity) =>
  entity.due ? html`<time datetime=${String(entity.due)}>${formatDate(String(entity.due))}</time>` : nothing;
```

## object:Expansion

What [[attr:Grid.expansion]] takes: how a row's content is made, which rows may
expand, and how many may be open at once.

```ts
const expansion: Expansion = {
  noun: "task",
  single: true,
  canExpand: (entity) => entity.archived !== true,
  content: (row) => {
    const edit = new EditModel(ctx, "Tasks", row.key);
    return {
      get view() {
        return html`<aster-form .model=${edit} .sections=${sections}></aster-form>`;
      },
      dirty: edit.dirty,
      save: async () => (await edit.save()) !== undefined,
      discard: () => edit.revert(),
      dispose: () => edit.dispose(),
    };
  },
};
```

## method:Expansion.content

Called once each time a row expands, to build its [[object:ExpansionEditor]].
The editor is kept until the row closes: scrolling the row out of view and back
shows the same editor with its edits.

- `row`: the row's [[object:RowState]] at the moment it expands. It is a
  snapshot and isn't updated afterwards; read the store or an edit model for
  live values.

Returns the editor. Build any edit model here, and release it in the editor's
`dispose`.

## method:Expansion.canExpand

- `entity`: the row's record.

Returns `false` to refuse. A refused row ignores Enter and double-click, and
[[method:Grid.expand]] returns `false`, without a message. Omit it to let
every row expand.

## attr:Expansion.single

`true` makes opening a row close the one already open. If that row has unsaved
changes, the grid asks about it first and the new row doesn't open. With
`single`, `limit` is ignored. Default: off.

## attr:Expansion.limit

A number: expanding one more row than this is refused, and the toolbar and the
live region say "Only 2 tasks can be open at once. Close one first." (using
`noun`). Default: no limit. Ignored when `single` is set.

## attr:Expansion.noun

Used in the limit message and in the unsaved-changes question ("This task has
unsaved changes."). Give the singular; the plural adds "s". Default `"row"`.

## object:ExpansionEditor

What [[method:Expansion.content]] returns. Only `view` is required. Give
`dirty`, `save` and `discard` together so the grid can ask before closing over
unsaved changes; without `dirty`, the grid never asks.

## attr:ExpansionEditor.view

The content shown under the row. The grid reads this property on every render,
so make it a getter that builds the template if the content depends on
signals; a template built once doesn't change.

```ts
const editor: ExpansionEditor = {
  get view() {
    return html`<aster-form .model=${edit} .sections=${sections}></aster-form>`;
  },
};
```

## attr:ExpansionEditor.dirty

A signal that is `true` while the content has unsaved changes. When it is
true, [[method:Grid.collapse]] with `"ask"`, Escape in the content, and (with
`single`) expanding another row show the unsaved-changes question. Pass an
edit model's own `dirty` signal.

## method:ExpansionEditor.save

Saves the content. Resolve to `true` on success; the row then closes. Resolve
to `false` to keep it open, for example when validation fails and the content
shows the errors. Called by the question's Save button and by
`collapse(key, "save")`. Without it, those close the row without saving.

## method:ExpansionEditor.discard

Drops the unsaved changes, such as an edit model's `revert()`. Called by the
question's Discard button and by `collapse(key, "discard")` before the row
closes.

## method:ExpansionEditor.dispose

Releases what the editor holds (edit models, collections, effects). Called
when the row closes, however it closes. It is not called when the grid
disconnects with rows still open; dispose those yourself if the grid is being
thrown away.

## object:Lookup

What [[attr:Grid.lookups]] takes for each foreign-key column. The column's own
value must be the related record's single key value.

```ts
const lookup: Lookup = { set: "People", display: "name" };
```

## attr:Lookup.set

The entity set the foreign key points into, such as `"People"`. The editor's
and filter's options come from it.

## attr:Lookup.display

The field of the related record to show, such as `"name"`. It is also what the
column sorts by when the entity type has a navigation for the key.

## object:RowControl

One button of a row's floating controls, returned from
[[attr:Grid.rowControls]].

```ts
const remove: RowControl = {
  label: "Remove",
  icon: html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5l.5-9"/></svg>`,
  run: () => askRemove(row.entity),
};
```

## attr:RowControl.label

The button's accessible name and tooltip. The button shows only the icon, so
make the label say the action: "Edit", "Add subtask".

## attr:RowControl.icon

The button's content, a template; usually an inline SVG with
`aria-hidden="true"`, since `label` names the button.

## attr:RowControl.run

Called when the button is pressed. The press doesn't select or expand the row.

## object:RowState

What [[attr:Grid.rowControls]] and [[method:Expansion.content]] receive.
`rowControls` gets a fresh one on every render, so it reflects the row now;
`content` gets the one from the moment the row expanded.

## attr:RowState.key

The row's key text.

## attr:RowState.entity

The row's record as stored.

## attr:RowState.expanded

Whether the row is expanded.

## attr:RowState.editable

The grid's [[attr:Grid.editable]] flag, the same for every row. Use page rules
or the record itself for per-row permissions.

## class:RowHeights

The offsets behind the grid's virtualization, exported for building other
virtualized lists. Heights are kept by row key, so a row measured once keeps
its height when rows are inserted, removed or re-sorted. Rows not measured, and
slots with no key (rows not loaded), count as `estimate`. Offsets are prefix
sums rebuilt lazily after a change: one pass over the rows per change, then a
binary search per lookup. It is plain state, not signals.

- `new RowHeights(estimate)`: `estimate` is the height in pixels assumed for
  rows not measured yet. The grid uses 37.

```ts
const rows = new RowHeights(32);
rows.setKeys(collection.keys.value);
const { start, end } = rows.window(scroller.scrollTop, scroller.clientHeight, 400);
const before = rows.offset(start);
const after = rows.total() - rows.offset(end);
// Render rows start..end-1 between spacers of `before` and `after` pixels,
// then measure each rendered row:
for (const el of list.querySelectorAll<HTMLElement>("[data-key]")) rows.measure(el.dataset.key!, el.offsetHeight);
```

## attr:RowHeights.estimate

The height, in pixels, of a row not measured yet. Settable, but offsets aren't
rebuilt until the next `setKeys` or `measure` call that changes something.

## method:RowHeights.setKeys

- `keys`: the row keys in display order, with `undefined` for rows not loaded.

Replaces the rows and marks the offsets for rebuilding. Measured heights are
kept, by key, whether or not the key is still present.

## method:RowHeights.measure

- `key`: the row's key.
- `height`: its measured height in pixels.

Returns `true` if the height differs from the one recorded before, which means
the offsets changed and the list should re-render. Returns `false` for the same
height.

## method:RowHeights.height

- `index`: a row's position.

Returns its measured height, or `estimate` when it isn't measured or has no
key.

## method:RowHeights.offset

- `index`: a row's position. Values outside `0` to `count` are clamped.

Returns the distance in pixels from the top of the first row to the top of
that row.

## method:RowHeights.total

Returns the height of all rows, the same as `offset(count)`.

## method:RowHeights.indexAt

- `y`: a distance in pixels from the top.

Returns the index of the last row whose top is at or above `y`: the row at
that position. Returns 0 for an empty list, and the last row for a `y` past
the end.

## method:RowHeights.window

- `top`: the scroll position.
- `height`: the viewport's height.
- `overscan`: extra pixels to include above and below.

Returns `{ start, end }`: the first row to render and one past the last.
`{ start: 0, end: 0 }` when there are no rows.

## attr:RowHeights.count

The number of rows given to `setKeys`. Read-only.

## staticMethod:defaultView

What the grid shows when the page gives no view.

- `type`: the set's [[object:EntityType]].

Returns a [[object:GridView]] with a column for every field of the type in
declaration order, except the key fields, which are left out. No sort, no
filters, no grouping and nothing frozen. Use it as a starting point and adjust
the columns.

```ts
const type = ctx.schema.set("Projects").type;
const base = defaultView(type);
const view: GridView = { ...base, columns: base.columns.filter((c) => c.field !== "notes"), sort: [{ field: "name" }] };
```

## staticMethod:sortBy

What pressing a header does, as a pure function.

- `view`: the current view.
- `field`: the column to sort by.
- `add`: `true` for a Shift-press, adding to the sort.

Returns a new view. Without `add`, the sort becomes this column alone:
ascending, or descending when it was already sorted ascending by this column.
With `add`, an unsorted column is appended ascending, and a sorted column
switches direction in place. It never removes a sort key.

```ts
let v = sortBy(view, "due", false); // [{ field: "due" }]
v = sortBy(v, "due", false);        // [{ field: "due", descending: true }]
v = sortBy(v, "title", true);       // [{ field: "due", descending: true }, { field: "title" }]
grid.view = v;
```

## staticMethod:viewQuery

The [[object:Query]] a grid sends for a view. Use it to load the same records
the grid shows, for an export or a summary.

- `set`: the entity set.
- `view`: the view; its filters and sort are used, its columns aren't.
- `base`: optional criteria combined beneath the filters.
- `sortPaths`: optional replacement sort fields by column, such as
  `{ personId: "person/name" }`. Default `{}`.

Returns a query whose `filter` is the base and every view filter joined with
`and` (omitted when there are none) and whose `orderBy` is the view's sort
(omitted when empty). The view's columns, grouping and frozen count don't
affect it.

```ts
const query = viewQuery("TimeEntries", grid.view!, grid.base);
const all = ctx.collection(query, { pageSize: 500 });
await all.loadAll();
const rows = all.items.value.filter((e) => e !== undefined);
ctx.release(all);
```

## object:GridColumn

One column of a [[object:GridView]].

```ts
const columns: GridColumn[] = [{ field: "date", width: 140 }, { field: "note" }, { field: "internalRef", hidden: true }];
```

## attr:GridColumn.field

The name of a field of the set's entity type. The header shows the field's
title from the metadata, or this name. A field the type doesn't have still
gets a column, with blank cells.

## attr:GridColumn.width

Without a width, the column shares the space left over with a minimum that
suits its type: 80 px for Booleans, 90 px for numbers, 110 px for dates and
fields with allowed values, 150 px for timestamps, 160 px otherwise, and a
260 px minimum with a larger share for text over 500 characters. Resizing from
the header sets a width of at least 48 px. A frozen column needs a width:
give one to each column the view freezes.

When every visible column has a fixed width, the scroll area fits those columns,
placing the vertical scrollbar beside the last column. It remains bounded by the
available width and scrolls horizontally when necessary. Flexible columns fill
the available width; the narrow card layout always uses the full width.

## attr:GridColumn.hidden

`true` hides the column. It stays in the view, so the Columns panel lists it
and a person can show it again. Default: shown. The person can't hide the last
visible column.

## object:GridView

The view a grid is shaped by: give one to [[attr:Grid.view]], read the
person's from it, or save and restore it yourself. It is plain data and safe
to serialize as JSON. The person's changes always produce a new object.

```ts
const view: GridView = {
  columns: [{ field: "date", width: 140 }, { field: "personId", width: 150 }, { field: "hours" }, { field: "status" }],
  sort: [{ field: "date", descending: true }],
  filters: { status: { op: "eq", field: "status", value: "submitted" } },
  frozen: 2,
};
```

## attr:GridView.columns

Every column the grid offers, visible or hidden, in display order. The Columns
panel and the header menu reorder this list.

## attr:GridView.sort

[[object:SortKey]]s, most significant first; `[]` for the server's order. A
key's `field` is a column's field; for a lookup column, the grid sorts by the
related display field instead (see [[staticMethod:viewQuery]]).

## attr:GridView.filters

Keyed by column field; each value is any [[type:Criteria]], and all of them
must hold. The filter row writes plain criteria (`eq`, `in`, `contains`, `gt`,
`ge`, `lt`, `le`, or an `and` of `ge` and `le` for a range), and shows a
view's filters back as text in the same forms. Other criteria a page puts here
still apply, but the filter row can't show them: give a date column plain
dates here, not relative ones. `{}` for none.

## attr:GridView.criteria

Optional advanced [[type:Criteria]] expression. It is ANDed with the host base,
shared collection constraint and column filters without flattening nested groups.
The toolbar’s Advanced filter dialog uses a separate draft; Apply commits the
whole expression, Cancel leaves the query unchanged and Clear expression clears
only this property after Apply. It is included in current and named saved views.
Missing fields or invalid saved clauses remain available for repair and cause
an always-false filter until repaired or cleared. See [advanced filtering](filtering.md).

## attr:GridView.groupBy

A field name or ordered array of field names, outermost first. Absent or an empty
array means no grouping. Existing single-field saved views remain valid. Names
must be distinct, nonempty metadata properties. A new field order starts with
every group collapsed. The header menu adds/removes levels; toolbar controls
remove or reorder them. Grouping is ignored by a self-referencing tree grid.
See [multi-level grouping](grouping.md) for paging, summaries and keyboard use.

## attr:Grid.groupingModel

The [[class:Grouping]] owned by a connected grouped grid, otherwise undefined.
Its IDs and methods allow programmatic expansion, collapse and retry. It follows
view filter/sort changes; changing the grouping dimensions replaces the model.
Host calls to the data model do not save grid editors: await
[[method:Grid.finishEditing]] before an action that could hide an inline draft.
The grid's own collapse and grouping controls save first and keep invalid drafts
visible when saving fails. Expansion-editor drafts remain the host's concern.

## attr:GridView.frozen

`0` for none. Frozen columns stay at the left while the rest scroll sideways.
Each frozen column needs a `width`; "Freeze up to" in the header menu sets
missing widths to the column's current size, but a view the page writes must
include them. Hiding columns lowers it so at least one visible column stays
unfrozen.


## attr:Grid.selectable

Default `true`. Whether this view allows user selection changes. Set `false` to
remove selection actions and prevent pointer/keyboard selection changes while
continuing to reflect the borrowed Selection's picks. Navigation and other record
actions remain available. Disabling a view never clears the shared selection or
changes its single/multiple/ordered policy.

## event:Grid.row-open

Fired with `{ key }` for a loaded record on double-click or Enter. The key is the
encoded record key used by DataContext and RecordStore. Call `preventDefault()`
to handle opening in the application and suppress the Grid's default expansion
or inline editing. F2 retains its editing/selection-control behaviour. Interactive
controls inside cells do not trigger row opening. Selection remains independent.

## attr:Grid.formatters

Text-only display functions by field. A CellFormatter receives the raw typed
value, row entity and field metadata. A renderer takes precedence; otherwise a
formatter takes precedence over built-in lookup/date/value formatting. Returned
text is escaped. Formatting never changes query criteria, server order or CSV
values. Register formatter functions in code and reference them through the
`formatters` property in YAML composition.

## type:CellFormatter

`(value: Value | undefined, entity: Entity, field: Field | undefined) => string`.
Use for date labels, units and other text presentations. Use CellRenderer when
cell content requires markup. Neither function is a client sorting callback.

## attr:GridColumn.sortField

Optional server field or single-valued navigation path used when sorting this
column. It overrides automatic lookup sorting; absent, the raw column field (or
lookup display path) is used. Filtering continues to use the typed column field.
The service must expose and support the alternate field. Saved column layouts
retain the application's current mapping. Server ordering includes the data
layer's key tie-breakers for stable paging.

For normalized/collated ordering, provide a server-computed sort key. A JavaScript
callback over loaded rows cannot order unloaded pages correctly. The toolbar's
Sort menu offers column ordering in both table and narrow card layouts.
