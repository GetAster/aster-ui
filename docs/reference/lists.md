# Lists, list editors and filter chips

For icons, images and custom cards over a bounded collection, use
[[class:TileGrid]] (see [[group:tiles]]).

Four elements work on lists of records without being grids:

| Element | Class | For |
|---|---|---|
| `aster-listbox` | [[class:Listbox]] | Choosing one record from a list the page draws, such as people or projects. |
| `aster-list-editor` | [[class:ListEditor]] | Editing the rows of a [[class:ListEdit]], such as a task's subtasks or a field's answers, as a table of fields. |
| `aster-rule-editor` | [[class:RuleEditor]] | Editing a rule as a tree of conditions, held as rows of a list edit. |
| `aster-slicer` | [[class:Slicer]] | Showing the page's [[class:SharedFilters]] as chips that each remove their own part. |

For a table with sorting, filtering and editing in place, use [[class:Grid]]
(see [[group:grid]]). These four are for short lists that the page lays out
itself or edits as a whole.

### The listbox

A listbox shows the rows of a [[class:Collection]] and keeps one of them
selected. The selection is a [[class:Selection]] that the page makes and owns,
so a detail view, a toolbar or a page rule can follow it without the listbox
being involved. The listbox draws each row's content with `renderRow` and
leaves everything else to the page: `row-open` and `row-menu` say what the
person asked for, and the page decides what happens.

A single [[class:Selection]] selects the first loaded row when nothing chosen
is in the collection (see [[attr:Selection.key]]), so a listbox over a loaded
collection always has a row selected. A selection made with `multiple` isn't
supported by the listbox: it selects and draws one row, the first key.

The listbox never loads rows. It draws the keys the collection already holds,
so load the collection first: `await collection.loadAll()` for a short list.
It has no virtual scrolling; every loaded key is in the DOM. For thousands of
rows use a grid.

### Editing a list of rows

A [[class:ListEdit]] holds the rows; the editor draws them and the page saves
them. `ListEditor` and `RuleEditor` never call `save()`: put the list in a
[[class:RecordEdit]] with the record that owns it, or call
[[method:ListEdit.save]] from a Save button.

- A new row is marked pending in full, and a cell that differs from its saved
  value is marked pending on its own, with its original value described in
  words.
- Removing an existing row marks it for deletion: it shows struck through and
  as text, with Undo, until the list is saved. Removing a new row discards it.
  A row with changes offers Revert.
- Every action button names its row, by the value of its first column or "new
  row": "Remove Write the brief". A row that is new or marked for removal
  starts its first cell with a hidden "New: " or "To be removed: ".
- With a reason in `readOnlyReason`, the whole editor is text, the reason is
  shown above it, and nothing can be added, removed, reverted or moved; see
  [[attr:ListEditor.readOnlyReason]].

Each cell is the control [[staticMethod:controlFor]] picks from the field's
metadata, bound to the row's [[class:EditModel]]; see [[group:fields]].

### Example

A master list of tasks in a listbox, and beside it the subtasks of one task
as an editable table, with the assignee chosen by name.

```ts
import { html, render } from "lit-html";
import { ListEdit, Selection, type DataContext } from "@getaster/data";
import { PickerOptions, type ListColumn } from "@getaster/elements";
import "@getaster/elements";

declare const ctx: DataContext;

// A master list of tasks, one always selected, published to the page scope.
const tasks = ctx.collection({ set: "Tasks", orderBy: [{ field: "title" }] });
await tasks.loadAll();
const selection = new Selection(ctx.store, tasks);

// The selected task's subtasks, edited as rows.
const subtasks = ctx.collection({
  set: "Subtasks",
  filter: { op: "eq", field: "taskId", value: 1 },
  orderBy: [{ field: "position" }],
});
await subtasks.loadAll();
const list = new ListEdit(ctx, subtasks, {
  defaults: () => ({ taskId: 1, title: "", assigneeId: null, done: false }),
  positionField: "position",
});
const people = new PickerOptions(ctx, { set: "People" });

const columns: ListColumn[] = [
  { field: "title" },
  { field: "assigneeId", width: "12rem", options: people },
  { field: "done", width: "5rem" },
];

render(
  html`<aster-listbox .label=${"Tasks"} .selection=${selection} .publish=${"tasks"}
      .renderRow=${(task: { title?: unknown }) => html`<span>${String(task.title)}</span>`}
      @row-open=${(e: CustomEvent<{ key: string }>) => console.log("open", e.detail.key)}></aster-listbox>
    <aster-list-editor .list=${list} .columns=${columns} .label=${"Subtasks"}
      .addLabel=${"Add subtask"}></aster-list-editor>`,
  document.body,
);
```

### Limits

- The listbox selects one row and has no type-ahead, Page Up or Page Down.
  Arrow keys stop at the ends instead of wrapping.
- The list editor and the rule editor draw every row; neither is virtualised.
- Button names, the words around a rule's controls and announcements are fixed
  English text. Only the labels that have a property (`label`, `addLabel`,
  `empty`, `readOnlyReason`) can be set.

## class:Listbox

Tag: `aster-listbox`. Bind it with properties: `selection` (or `collection`
alone, with nothing selected) and `renderRow`. It draws nothing until it has a
collection, which it takes from `collection` or else from the selection.

Events: `row-open` and `row-menu`. Both bubble and can be cancelled. Everything
else is reported through the [[class:Selection]]: read its `key` or `selected`
signals, inside an `effect` or another element's render, to follow the choice.

Inside the element is one tab stop, a `role="listbox"` (an `aster-caret-group`,
so a bar slides to the selected row). Focus stays on it; the selected row is
its `aria-activedescendant`, and each row is a `role="option"` with
`aria-selected`. The listbox has `tabindex="-1"` while the collection is
empty.

| Input | Effect |
|---|---|
| Click on a row | Selects it. A click that ends a text selection inside the row doesn't. |
| Double-click on a row | Fires `row-open`. |
| Right-click on a row | Selects it and fires `row-menu` at the pointer. The browser's menu is suppressed. |
| Down and Up | Select the next and previous row. They stop at the ends. With nothing selected, either selects the first row. |
| Home and End | Select the first and last row. |
| Enter | Fires `row-open` for the selected row. |
| Shift+F10 or the Menu key | Fires `row-menu` for the selected row, at its left edge and bottom. Nothing happens with no selection. |

Keys, double-clicks and menu keys typed into an `input`, `textarea`, `select`
or editable element inside a row are left to that element, so a row can hold an
editor. Clicks and right-clicks are still handled when they land in an editor.

```ts
import type { Menu, RowMenuDetail } from "@getaster/elements";

const menu = document.querySelector<Menu>("aster-menu")!;
document.addEventListener("row-menu", (e) => {
  const { key, x, y, opener } = (e as CustomEvent<RowMenuDetail>).detail;
  menu.openAt({ x, y }, [{ label: "Open", run: () => open(key) }], "Person actions", opener);
});
declare function open(key: string): void;
```

## attr:Listbox.collection

The collection whose rows are listed. A [[class:Collection]], or `undefined`.
Default `undefined`, which means "the selection's own collection". Set it only
to list a different collection from the one the selection is made in, such as a
filtered view; a selected key that isn't in the selection's collection is
dropped by the selection. Reactive.

## attr:Listbox.selection

The [[class:Selection]] the listbox reads and writes. Default `undefined`: rows
are drawn but none is selected, and clicks and keys do nothing. Make it with
`new Selection(ctx.store, collection)`. Reactive, so a new selection replaces
the old one at once.

## attr:Listbox.publish

A page-scope key, such as `"people"`. When it and `selection` are both set and
the listbox is under a page scope (see [[class:PageScope]]), the selection is
published there: `selected`, `records`, `keys`, `key`, `count`, `any` and `many`
become readable as `people.selected`, `people.key` and so on, by page rules and
other elements. Changing `publish` or `selection` re-publishes, and
disconnecting the element withdraws it. Default `""`, which publishes nothing.
Reactive. Without a page scope above the element, nothing is published and no
error is raised.

## attr:Listbox.renderRow

A [[type:RowRenderer]]: called with each row's record and its key text, returns
the row's content. It is called while the listbox renders, so signals it reads
re-render the listbox. A key whose record isn't in the store yet draws an empty
row. Default: a function that draws nothing. Reactive.

```ts
listbox.renderRow = (person, key) => html`<b>${person.name}</b> <small>${key}</small>`;
```

## attr:Listbox.empty

A template shown inside the list when the collection has loaded and its count is
0. While the collection is still loading it shows nothing. Default `nothing`.
Reactive.

## attr:Listbox.label

The listbox's accessible name, as `aria-label`. Always set it: there is no
visible label to fall back on. Default `""`. Reactive.

## method:Listbox.rowFor

- `key`: the row's key text.

Returns the row's `role="option"` element, or `undefined` when the key isn't
rendered, for example because the collection no longer has it or the listbox
hasn't rendered yet. Its `data-key` attribute holds the key.

## method:Listbox.flash

- `key`: the row's key text.

Draws attention to a row once: on the next animation frame it restarts the
`aster-flash` animation on the row. Returns nothing. If the row isn't rendered
by then, nothing happens. It doesn't select the row, scroll to it, or announce
anything; follow it with [[method:Listbox.select]] to move the selection too.

## method:Listbox.focus

- `options`: the usual `FocusOptions`.

Focuses the inner `role="listbox"`, not the host element, so the arrow keys work
at once. Nothing happens before the first render.

## method:Listbox.select

- `key`: the row's key text.

Selects that row (through [[method:Selection.select]]) and, on the next animation
frame, scrolls it into view if it isn't already (`block: "nearest"`). Returns
nothing. Does nothing without a `selection`. A key the collection doesn't hold
is dropped by the selection. It doesn't fire `row-open`.

## event:Listbox.row-open

Fires for Enter on the selected row, or a double-click on a row, but not when the
target is an editor inside the row. The `detail` is `{ key }`: the row's key
text. It bubbles and can be cancelled. A double-click selects the row first
(through its first click). Use it to open the record, such as showing its detail
on a narrow screen.

## event:Listbox.row-menu

Fires for a right-click on a row, and for Shift+F10 or the Menu key with a row
selected. The `detail` is a [[object:RowMenuDetail]]. A right-click on a row
selects it first and calls `preventDefault()` on the browser's own event; the
keyboard doesn't change the selection. Pass the detail's point and opener to
[[method:Menu.openAt]]. It bubbles and can be cancelled.

## object:RowMenuDetail

The `detail` of [[event:Listbox.row-menu]]. Its `x` and `y` make it a point
object that [[method:Menu.openAt]] takes as it is.

```ts
listbox.addEventListener("row-menu", (e) => {
  menu.openAt((e as CustomEvent<RowMenuDetail>).detail, items, "Actions", (e as CustomEvent<RowMenuDetail>).detail.opener);
});
```

## attr:RowMenuDetail.key

The key text of the row the menu is for.

## attr:RowMenuDetail.x

Viewport pixels from the left. The pointer's `clientX` for a right-click; for the
keyboard, the left edge of the selected row (0 if the row isn't rendered).

## attr:RowMenuDetail.y

Viewport pixels from the top. The pointer's `clientY` for a right-click; for the
keyboard, the bottom edge of the selected row (0 if the row isn't rendered).

## attr:RowMenuDetail.opener

The element to give focus back to when the menu closes: the listbox's inner
`role="listbox"` element. Pass it as the `opener` of [[method:Menu.openAt]].

## type:RowRenderer

The type of [[attr:Listbox.renderRow]]. It receives the row's [[type:Entity]] and
its [[type:KeyText]] and returns a [[type:View]] for the content of one row. It
runs for every row on every render of the listbox, so keep it cheap and read
only the signals the row needs. The listbox wraps the result in the row's
`role="option"` element; don't add roles of your own to the outer node.

```ts
import { html } from "lit-html";
import type { RowRenderer } from "@getaster/elements";

const person: RowRenderer = (entity) =>
  html`<span class="name">${String(entity.name)}</span><span class="email">${String(entity.email ?? "")}</span>`;
```

## class:ListEditor

Tag: `aster-list-editor`. Bind it with properties: `list` and `columns` are what
it needs; it renders nothing without a [[class:ListEdit]]. There are no events;
the state is the list's. Watch [[attr:ListEdit.dirty]], [[attr:ListEdit.valid]]
and [[attr:ListEdit.busy]] for a Save button, and call [[method:ListEdit.save]].

The element renders a `role="table"` named by `label`, with a header row (column
titles from the field's metadata title, or the field name), one row per
[[object:ListRow]], and an Add button after the rows. The last column of each
row holds its Revert, Remove or Undo button.

**Reordering.** A list made with a position field (see
[[attr:ListEdit.ordered]]) puts a handle button first in each row that isn't
marked for removal, named "Move" and the row's name, with
`aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"`. There are two ways to move a row:

- Drag the handle. A mouse lifts the row after 4 px of vertical movement. A touch
  or pen lifts it by holding still first, so scrolling still works. A line shows
  where the row will land among the rows not being removed. Letting go moves it
  through [[method:ListEdit.move]]. Escape, an interrupted pointer, or a touch
  let go outside the list leaves the order as it was.
- Alt+Up and Alt+Down on the handle move the row one place. At either end nothing
  happens.

A move is said in a polite live region, "Write the brief, moved to 2 of 5", and
focus goes to the row's handle. A drag also says "Picked up …" and "… not moved".
Rows marked for removal don't count in "n of m". With `readOnlyReason` set there
are no handles.

An added row gets focus: its first input or select.

```ts
import type { ListEditor } from "@getaster/elements";

const editor = document.createElement("aster-list-editor") as ListEditor;
editor.list = list;
editor.columns = [{ field: "title" }, { field: "done", width: "5rem" }];
editor.label = "Subtasks";
document.body.append(editor);
```

## attr:ListEditor.list

The [[class:ListEdit]] being edited. Default `undefined`: the element draws
nothing. Reactive; setting another list replaces the rows at once.

## attr:ListEditor.columns

An array of [[object:ListColumn]]s, in display order. Default `[]`, which draws
rows with only their action buttons. The first column's value names the row in
button labels and announcements, so put the most recognisable field first.
Reactive.

## attr:ListEditor.label

The table's accessible name (`aria-label`). Default `""`. Reactive.

## attr:ListEditor.addLabel

The text of the Add button. Default `"Add"`. Pressing it calls
[[method:ListEdit.add]] with no values, so the new row starts from the list's
`defaults` (see [[object:ListEditOptions]]), and focuses its first input. Reactive.
Not shown while `readOnlyReason` is set, even to an empty string.

## attr:ListEditor.readOnlyReason

Why the rows can't be edited now. Setting a string makes the rows read-only: they are
text, and the Remove, Revert, Undo, move and Add controls are gone. A non-empty
string also shows the reason above the table; an empty string makes the list
read-only with no reason shown, so use a real one. `undefined`, the default,
makes it editable. Reactive. A field that is
read-only in the row's own state, such as a key after it's saved, is text in an
editable list too, with its reason as the cell's `title`; a new row's cells are
all editable.

## attr:ListEditor.empty

A template shown below the table when the list has no rows (a row marked for
removal still counts as a row). Default `nothing`. It is shown in a read-only
editor too. Reactive.

## object:ListColumn

One column of a [[class:ListEditor]]. Each cell is the control
[[staticMethod:controlFor]] picks for `field` from the row's metadata: a picker
when `options` is set, a checkbox for a Boolean, a select for a field with allowed
values, the date field for an `Edm.Date`, otherwise a text field.

```ts
const columns: ListColumn[] = [
  { field: "title" },
  { field: "assigneeId", width: "14rem", options: people, display: (row) => names.get(String(row.edit.values.value.assigneeId)) ?? "" },
];
declare const names: ReadonlyMap<string, string>;
```

## attr:ListColumn.field

The name of a field of the list's entity type. It also supplies the column
title (the field's metadata title, else its name).

## attr:ListColumn.width

A CSS grid track size such as `"8rem"` or `"minmax(10rem, 2fr)"`. Default `"1fr"`.
The handle column (24 px) and the actions column (`auto`) are added around the
columns you give.

## attr:ListColumn.options

Makes a foreign-key field a picker over these records: a [[class:Collection]] for
a short list that loads whole, or a [[class:PickerOptions]] for search, columns
and "Create …". Share one `PickerOptions` between all rows of a column. Without
it the field gets whatever control its type calls for. See [[group:fields]].

## attr:ListColumn.display

A function from the [[object:ListRow]] to the text to show where the cell is text
rather than a control: a read-only editor, a row marked for removal, or a field
the row can't change. It is not used for editable cells. Default: the value
formatted by the field's type (a key shows as the key). Use it to show the name
that an `options` picker would show.

## class:RuleEditor

Tag: `aster-rule-editor`. Bind it with properties: `list`, `category`, `label`,
`fields` and `describe`. It renders nothing without a [[class:ListEdit]]. There
are no events; saving the list saves the rule.

A rule is a tree of clauses. A group is "when" `and`, `or` or `not` "of these",
and holds conditions and further groups. A condition is a field, a test
(operator) and a value. Each clause is one row of the list. The rows need these
fields: `op`, `parentClauseId`, `position`, `category`, `fieldRef` and `value`,
and `message` when `messages` is set. The editor also expects `op` to have allowed
values, whose labels are shown for the operators ("Any of" for `or`); without them the raw values `and`, `or`, `not` and the operators
themselves are shown.

The editor shows and adds only the rows whose `category` equals its own, so one
list can hold several rules (a field's visibility rule and its messages).

Without `messages` a rule has at most one top-level group; with none, the rule
means "always" and says so with `empty`. The Add button then reads "Add a
condition". It adds a group `and` holding one empty condition. With `messages`,
each top-level group is a message: a text control, "when", and its conditions;
the Add button reads "Add a message". Inside a group, "Add condition" and "Add
group" (an `or` group with one empty condition) add to it. A new clause takes the
next position among its siblings, and focus goes to the new condition's field.

Removing a group removes everything under it; Undo restores all of it. A clause
that is new or changed is marked pending as a whole. A group has the
`role="group"` with its heading as the name; a condition is a `role="group"` named
by place, such as "Shown when, condition 2" or "Message 1, group 2, condition 3",
with ", new" or ", to be removed" added. Every control is named by its place and
purpose ("Shown when, condition 1: field", "…: test", "…: value", "Message 1:
match"), and the buttons by place too ("Remove Shown when, condition 2").

A group added in the same session has no key yet, so a condition added to it
holds a link to its parent's row instead of the key (see
[[attr:ListRow.links]]). A [[class:RecordEdit]] sends such a child inside its
parent's entry when it saves, so save a rule with its record through one.

```ts
import { computed, signal } from "@preact/signals-core";
import type { RuleEditor, RuleField } from "@getaster/elements";

declare const clauses: ListEdit;
declare const fieldOptions: PickerOptions;

const fieldInfo: Record<string, RuleField> = {
  "1": { operators: ["eq", "ne", "set", "unset"], input: "text" },
  "2": { operators: ["eq", "in"], input: "text", options: [{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }] },
};

const editor = document.createElement("aster-rule-editor") as RuleEditor;
editor.list = clauses;
editor.category = "visibility";
editor.label = "Shown when";
editor.fields = fieldOptions;
editor.describe = (ref) => signal(ref === undefined ? undefined : fieldInfo[String(ref)]);
document.body.append(editor);
```

## attr:RuleEditor.list

A [[class:ListEdit]] of clause rows. Default `undefined`: nothing is drawn.
Reactive.

## attr:RuleEditor.category

The `category` value of this rule's rows. Only rows with that value are shown,
and new rows are added with it. Default `""`, which matches rows whose
`category` is empty. Reactive.

## attr:RuleEditor.label

The rule's visible heading, which also names the `<section>`. Control names are
built from it ("Shown when, condition 1: test") unless `messages` is set, when
they start "Message 1". Default `""`. Reactive.

## attr:RuleEditor.messages

`true` makes each top-level group a message with its own text, shown when its
conditions hold, and allows any number of them. `false` allows one top-level
group and no message text. Default `false`. Reactive.

## attr:RuleEditor.fields

What the field picker in each condition draws on: a [[class:PickerOptions]] for a
flat list (an `aster-picker` per condition), or a [[class:TreeChoices]] where
names repeat across groups (an `aster-tree-picker`, with the group path shown
for a chosen field as "(in Group › Subgroup)"). The chosen value is stored in
the row's `fieldRef`. Default `undefined`: the field of a condition is blank,
since nothing can name it. In a read-only editor, the field shows as text if
`fields` is set. Reactive.

## attr:RuleEditor.readOnlyReason

Why the rule can't be edited now. Any string, including `""`, makes every
group, field, test and value text, removes Add, Remove, Revert and Undo, and
shows the reason as a hint above the rule (nothing for `""`). Default
`undefined`. Reactive.

## attr:RuleEditor.empty

What is said when the rule has no clauses. Default `"Always"`. It is plain text,
not a template, and it also shows when the editor is read-only. Reactive.

## object:RuleField

What a condition can test about the field it names. The page gives
[[class:RuleEditor]] a function `describe(fieldRef)`, which takes the condition's
`fieldRef` value and returns a signal of a `RuleField` or `undefined`, so a
description that arrives later updates the condition. With
`undefined`, the test and the value aren't offered and stay as stored.

```ts
const status: RuleField = {
  operators: ["eq", "ne", "in", "set", "unset"],
  input: "text",
  options: [{ value: "draft", label: "Draft" }, { value: "approved", label: "Approved" }],
};
```

## attr:RuleField.operators

The test operators that suit the field, as strings, such as `["eq", "ne", "gt"]`.
They become the choices of the condition's test control, labelled from the
allowed values of the row's `op` field. `set` and `unset` take no value, and the
value control is hidden for them.

## attr:RuleField.input

`"text"`, `"number"` or `"date"`: the value control for a field with no
`options`. `"number"` gives the field a decimal on-screen keyboard; `"date"`
gives it the placeholder `YYYY-MM-DD`. The editor doesn't
parse the value: it is stored as typed, subject to the `value` field's own
metadata. `"text"` has no effect beyond the plain field.

## attr:RuleField.options

Values to choose from, as [[object:Option]]s. With them the value control is a
select over them; with the `in` operator it is a checkbox per option, and the
chosen ones are stored as a JSON array in the row's `value` (`["draft","approved"]`).
Without them the value is a text field; with `in`, the person then has to type
the JSON array. Default none.

## class:Slicer

Tag: `aster-slicer`. Bind it with `filters`, a [[class:SharedFilters]] that the
page's other controls contribute to. It renders nothing until it has one. The
slicer doesn't build filters; it only shows what is contributed and withdraws
what the person removes.

Events: `slicer-change`, once after each removal. State is the filters' own:
read [[attr:SharedFilters.contributions]].

The element shows the `label`, then one chip per contribution, in the order they
were contributed, each saying the contribution's own label ("Status is
approved"). Pressing a chip removes that contribution (through
[[method:SharedFilters.remove]]). With two or more chips, a Clear all button
follows them. With none, the `empty` text shows.

It is a `role="toolbar"` named by the visible label, with one tab stop (roving
tabindex).

| Key | Effect |
|---|---|
| Left and Right, Up and Down | Move to the previous or next chip. They wrap, and pass through Clear all. |
| Home and End | Go to the first and last item. |
| Enter and Space | Press the focused item: remove the chip, or clear all. |
| Delete and Backspace | Remove the focused chip. They do nothing on Clear all. |

After a removal, focus goes to the chip that moved into its place, or the one
before it; after the last, to the empty text, which takes focus for this and is
not in the tab order. Each removal is said through the page's polite live
region ([[staticMethod:announce]]): "Removed filter: Status is approved. 2
filters left." or "Cleared all filters."

A contribution that follows a signal and gave no way to withdraw
([[method:SharedFilters.removable]] is false) shows as a chip that can't be
pressed: it has `aria-disabled`, no cross, and the name "Filter: … , set by its
source". Clear all skips it, and when any such chip is left it says "Cleared the
filters that can be removed. 1 filter left."

```ts
import { SharedFilters, type DataContext } from "@getaster/data";
import type { Slicer } from "@getaster/elements";

declare const ctx: DataContext;

const filters = new SharedFilters(ctx.schema);
filters.set({ by: "health-chart", label: "Health is on track", set: "Projects",
  criteria: { op: "eq", field: "health", value: "on-track" } });

const slicer = document.createElement("aster-slicer") as Slicer;
slicer.filters = filters;
slicer.label = "Filtered by";
slicer.addEventListener("slicer-change", (e) => console.log((e as CustomEvent<{ removed: string[] }>).detail.removed));
document.body.append(slicer);
```

## attr:Slicer.filters

The [[class:SharedFilters]] to show. Default `undefined`: nothing is drawn.
Reactive; the chips follow [[attr:SharedFilters.contributions]] as they change.

## attr:Slicer.label

Text shown before the chips, which also names the toolbar. Default `"Filters"`.
Use something that reads as a lead-in, such as `"Filtered by"`. Reactive.

## attr:Slicer.empty

Text shown, and focused after the last removal, when there are no contributions.
Default `"None. Showing everything."`. Plain text, not a template. Reactive.

## event:Slicer.slicer-change

Fires after the slicer removed one or more contributions, either by a chip or
Clear all. The `detail` is `{ removed }`: an array of the contributors' `by`
names that were withdrawn. For Clear all it lists only those that are gone, not
the ones that couldn't be removed. It isn't fired for a press on a chip that
can't be removed, and not when contributions change from elsewhere. It bubbles
and can be cancelled (cancelling has no effect on the removal, which has already
happened). Read [[attr:SharedFilters.contributions]] for the current state.
