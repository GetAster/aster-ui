# Trees

Records that point at a parent record of the same set, such as tasks with
subtasks or folders with subfolders, can be shown as a tree. Aster UI has one
data model for this and several views over it:

- [[class:Tree]] (in `@getaster/data`) is the model: one [[class:Collection]]
  per open level, the set of open folders, child counts, reveal, move and
  filtering that keeps the path to each match.
- A tree grid is an `aster-grid` with [[attr:Grid.tree]] set to a
  [[object:GridTree]]. It shows the whole tree as indented rows, with every
  grid feature except grouping: sorting, filtering, columns, editing, row
  controls and expansion.
- `aster-tree-navigator` ([[class:TreeNavigator]]) shows one level at a time
  and slides between levels. It suits a phone, where an indented tree is too
  narrow, and a "Move to…" dialog, where the person picks a new parent.
- `aster-tree-picker` ([[class:TreePicker]]) chooses a value from a tree in a
  form field.

The views load the same way: a level is a collection, so it loads by page and
follows the store's changes. When a record's parent changes, it leaves one
level and joins another, wherever it is shown.

### A tree grid

Give the grid a `tree` before it connects. The grid builds a `Tree` over its
set with its `base`, the view's filters and the view's sort, and exposes it as
[[attr:Grid.treeModel]].

- The first column indents each row by its level and has an opener on rows
  that have children. Child counts come from one grouped request per level; a
  row shows an opener until the counts say it has none.
- The table is a `treegrid`, and each row carries `aria-level`,
  `aria-posinset`, `aria-setsize` and, on folders, `aria-expanded`.
- In the first column, → opens a closed folder or moves to the first child of
  an open one, and ← closes an open folder or moves to the parent. In other
  columns the arrows move between cells.
- A filter, by default, shows each match with the path to it, opened. While
  the grid finds those paths the toolbar says "Finding where the matches
  are…"; with too many matches it says "Too many matches to show where they
  are. Narrow the filter." `filterMode: "strict"` instead hides any record
  that doesn't match, with everything under it.
- [[method:Grid.reveal]] opens the path to a record, loads levels until its row
  exists, selects it and scrolls it to the top: the way to support deep links.

With `draggable` in the `GridTree` and [[attr:Grid.editable]] on, a row can be
dragged onto another row to move under it, or onto the header to move to the
top level. A mouse lifts the row after 6 px; a touch or pen holds the row still
first. A label follows the pointer, and the row under it shows whether the
drop is allowed. A drop on the row itself or anywhere in its own subtree is
refused, and the reason is shown in the toolbar and announced. A good drop
saves the new parent with [[method:Tree.move]], opens the new parent, and
fires [[event:Grid.moved]]. Picking up a row, and a drag that ends without a
move, are announced. Presses on buttons, inputs, an edited row, row controls
and expanded content don't start a drag.

### A tree navigator

The navigator shows the children of one node as a list. Each row has a choose
button, named by `chooseLabel` and the node's name ("Move under Write the
brief"), and, on folders, an open button that slides in the level below. A
breadcrumb, Back and Forward move between levels, and Backspace goes up one
level when focus isn't in a text input. After each move, focus goes to the
level's heading, so a screen reader says where the person is.

Choosing fires `choose` with the node's key, and Escape fires `cancel`; the
navigator doesn't close or change anything itself. `choosable` can refuse a
node with a reason (it stays openable), which is how a move dialog stops a
task being moved under itself.

### Example

A tree grid of tasks, with a Move to… dialog that uses a navigator over a
second tree limited to the task's project:

```ts
import { computed } from "@preact/signals-core";
import { html } from "lit-html";
import { keyText, Tree, type DataContext, type Entity, type KeyText } from "@getaster/data";
import type { Grid, GridTree, GridView } from "@getaster/elements";

declare const ctx: DataContext;

const TREE: GridTree = { parentField: "parentId", draggable: true };
const VIEW: GridView = { columns: [{ field: "title" }, { field: "due", width: 140 }], sort: [{ field: "id" }], filters: {}, frozen: 0 };

const grid = html`<aster-grid .ctx=${ctx} .set=${"Tasks"} .tree=${TREE} .view=${VIEW}
  .label=${"Tasks"} .editable=${true}></aster-grid>`;

async function moveDialog(task: Entity, grid: Grid) {
  const tree = new Tree(ctx, {
    set: "Tasks",
    parentField: "parentId",
    base: computed(() => ({ op: "eq", field: "projectId", value: task.projectId ?? null })),
    orderBy: computed(() => [{ field: "id" }]),
  });
  const key = keyText([task.id!]);
  const blocked = new Set([task.id, ...(await tree.descendants(key)).map((e) => e.id)]);
  return html`<aster-tree-navigator .tree=${tree} .label=${"Top level"} .chooseLabel=${"Move under"} .headingLevel=${3}
    .choosable=${(e: Entity) => (blocked.has(e.id) ? "A task can't move under itself or its own subtasks." : undefined)}
    @choose=${async (e: CustomEvent<KeyText>) => {
      await grid.treeModel?.move(key, e.detail);
      await grid.reveal(key);
      tree.dispose();
    }}
    @cancel=${() => tree.dispose()}></aster-tree-navigator>`;
}
```

### Limits

- The set needs a single-field key and a parent field holding that key; a
  `Tree` throws otherwise. A cycle in the parent links makes
  [[method:Tree.ancestors]] throw.
- A tree grid can't also be grouped.
- `GridTree` doesn't expose the `Tree`'s page size or its limits on matches
  and opened folders when filtering; the `Tree` defaults apply.
- The navigator lists only the levels of the tree it is given: it doesn't
  search, and it has no multi-select.

## object:GridTree

What [[attr:Grid.tree]] takes. It is passed to the [[class:Tree]] the grid
builds, together with the grid's `base` and the view's filters and sort.

```ts
const tree: GridTree = { parentField: "parentId", filterMode: "strict", draggable: true };
```

## attr:GridTree.parentField

A field of the set's entity type, such as `"parentId"`. Its value on a
top-level record is `rootValue`; on any other, the parent record's key. Moving
a row writes this field.

## attr:GridTree.rootValue

The `null` default applies only when the parent field's metadata gives no root
value: without `rootValue` here, the tree uses the field's own `rootValue`
from the metadata, else `null`. Set it when top-level records hold something
else, such as `0`.

## attr:GridTree.filterMode

`"keepAncestors"` (the default) shows every record that matches the view's
filters, plus the ancestors on the path to it, and opens those paths.
`"strict"` shows only matching records, and hides a parent that doesn't match
together with everything under it, even matching descendants. See
[[type:FilterMode]].

## attr:GridTree.draggable

`true` lets the person move a record by dragging its row, while
[[attr:Grid.editable]] is also on. Default: off. Each drop is saved at once
with [[method:Tree.move]], so offer Undo from [[event:Grid.moved]].

## class:TreeNavigator

Tag: `aster-tree-navigator`. Bind `tree` to a [[class:Tree]]; everything else is
optional. The navigator reads the tree's levels with [[method:Tree.level]] and
doesn't change its open state, so it can share a tree with other views. Give
the navigator a tree of its own when it should start at the top regardless of
what is open elsewhere.

Structure and ARIA: a `section` named by `label` (or "Navigate"); Back and
Forward buttons; a breadcrumb `nav` named "Path", whose current item has
`aria-current="location"`; a heading (`role="heading"` at `headingLevel`) named
by the parent node, or by `label` at the top; and a list labelled by that
heading. The level's first page loads when it is shown and further pages as
the list scrolls near its end, with "Loading…", "Nothing here." and "20 of
85…" shown as status rows.

Keyboard: the buttons are in the Tab order; Escape fires `cancel`; Backspace
goes up a level unless focus is in an input or a text area.

Opening a level slides it in from the right and the old one out to the left,
in 240 ms; going back reverses it. Under `prefers-reduced-motion: reduce`
nothing moves.

Events: `choose` and `cancel`.

```ts
html`<aster-tree-navigator .tree=${tree} .label=${"All tasks"} .chooseLabel=${"Edit"}
  @choose=${(e: CustomEvent<KeyText>) => openEditor(e.detail)}></aster-tree-navigator>`;
```

## method:TreeNavigator.go

Use it to start the navigator somewhere other than the top, such as at a
task's current parent.

- `key`: the node whose children to show, or `undefined` for the top level.

Resolves once the path is known. It loads the node's ancestors with
[[method:Tree.ancestors]], then shows the level with the usual slide, forward
when the new path is at least as deep as the current one. It doesn't add a
Back step. Does nothing without a `tree`.

```ts
const nav = dialog.querySelector<TreeNavigator>("aster-tree-navigator")!;
await nav.go(task.parentId === null ? undefined : keyText([task.parentId]));
nav.focus();
```

## method:TreeNavigator.focus

Focuses the heading that names the level shown, which is also where focus goes
after every move. Call it after opening a dialog that holds the navigator.

## attr:TreeNavigator.tree

The [[class:Tree]] to navigate. Reactive. Default `undefined`, which renders
nothing. The navigator doesn't dispose the tree; the page does, when it is done
with it.

## attr:TreeNavigator.display

A field name of the tree's entity type. Default `""`, which uses the type's
title field from the metadata, or else the key field. A node not loaded yet
shows "…".

## attr:TreeNavigator.label

Also the navigator's accessible name, and the heading at the top level.
Default `""`, which names the navigator "Navigate" and its top level "Top
level".

## attr:TreeNavigator.choosable

A function from a node's record to a reason it can't be chosen, or `undefined`
when it can. A refused node keeps its open button, so the person can still go
below it; its choose button has `aria-disabled="true"`, the reason as its
tooltip, and pressing it does nothing. Called for each row on every render, so
it can read signals. Default `undefined` (every node can be chosen).

```ts
nav.choosable = (e) => (blocked.has(e.id) ? "A task can't move under itself or one of its own subtasks." : undefined);
```

## attr:TreeNavigator.path

Keys of the opened nodes, from the top level down to the parent of the level
shown; `[]` at the top. Read-only. It changes with every move, Back and
Forward, and reading it in a render or an effect follows it.

## attr:TreeNavigator.headingLevel

A number for `aria-level`, such as 3 inside a dialog whose title is a level 2
heading. Default `2`.

## attr:TreeNavigator.chooseLabel

The button's accessible name is this text and the node's name, so make it the
action: "Move under", "Edit". The visible button shows the node's name and an
icon. Default `"Choose"`.

## event:TreeNavigator.choose

Fired when the person presses a node's choose button and `choosable` allows
it. The `detail` is the node's key ([[type:KeyText]]). It bubbles. The
navigator stays as it is; the page decides what happens next.

```ts
html`<aster-tree-navigator .tree=${tree}
  @choose=${(e: CustomEvent<KeyText>) => void moveUnder(e.detail)}></aster-tree-navigator>`;
```

## event:TreeNavigator.cancel

Fired on Escape anywhere inside the navigator, with no `detail`. The navigator
stops the Escape key from reaching its ancestors, so an enclosing dialog
doesn't see it: close the dialog from this event.

```ts
html`<aster-tree-navigator .tree=${tree} @cancel=${() => dialog.close()}></aster-tree-navigator>`;
```
