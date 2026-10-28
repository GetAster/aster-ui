# Element internals

This advanced guide explains rendering, styles and the detailed implementation
contracts of the elements. Start with [Get started](getting-started.md) and
[fields and layouts](fields-and-layouts.md) for application-facing examples.
The [shared data model](data-model.md) explains state ownership;
[theming](themes.md) covers appearance and [distribution](library.md) covers
loading the controls in a page.

## AsterElement

Every Aster element extends `AsterElement` (`packages/elements/src/base/element.ts:35`),
a custom element that renders with lit-html. There's no framework on top: no
Lit `ReactiveElement`, no decorators.

**Light DOM.** Elements render into themselves, not a shadow root
(`base/element.ts:118`). Page CSS, the token contract and the polish rules
apply without piercing anything, and tests and screen readers see one tree.
Element styles are kept apart by an `aster-` class prefix and a cascade layer.

**Render in a computed.** On connect, the element wraps `render()` in a
signals `computed` and an `effect` (`:48`). Any signal `render()` reads,
whether the element's own properties, a collection's `items`, a record in the
store or a field's `FieldState`, becomes a dependency. Nothing subscribes or
unsubscribes by hand; disconnect disposes the effect (`:63`).

**Microtask batching.** Recomputing is synchronous, but committing to the DOM
is queued once per microtask (`:107`). The first render on connect commits at
once (`:53`), so an element has its content as soon as it's attached.
`updated()` runs after each commit and is where geometry reads belong (`:44`).

**Lazy upgrade.** The project, People, Tasks, Model, Time and Reports pages are separate chunks,
loaded on first visit (`apps/showcase/src/workspace/app.ts:42`). lit-html may set `.setup` or
`.projectId` on the element before its class is defined, which leaves a plain
own property shadowing the class's setter. On first connect,
`#upgradeProperties` deletes each such property and sets it again through the
setter (`:94`).

**The helpers.**

| Helper | For |
|---|---|
| `prop(initial)` | A signal-backed property behind a plain getter and setter (`:70`) |
| `Bindable<T>` and `read()` | A property that takes a value or a signal of one, such as a button's `busy` (`:9`) |
| `listen(target, type, handler)`, `onDisconnect(fn)` | Listeners and cleanup removed on disconnect (`:80`, `:75`) |
| `emit(type, detail)` | A bubbling, cancelable `CustomEvent` (`:90`) |
| `define(name, ctor)` | Registers once, so two imports don't throw (`:123`) |
| `provideScope(el, scope)`, `scopeOf(el)` | Gives a subtree its `PageScope`; finds the nearest one, crossing shadow roots (`:130`, `:135`) |
| `each(items, key, view)` | Keyed lists, below (`:155`) |

**`each()`, and why.** lit's `repeat` calls its template function during the
commit, outside `render()`, so signals read there aren't tracked. `each`
builds every item's view first, inside `render()`, then hands lit the finished
views to key and move. Use it for every keyed list. The cost is that any
signal one row reads re-renders the whole list. The grid keeps that cheap by
rendering only the rows near the viewport.

## Tokens, identities and the base styles

**The token contract.** `styles/contract.ts:9` lists every custom property an
identity must define, by role: type, surfaces, text and edges, accent, status,
identity (lightness and chroma for colours whose hue comes from data),
elevation, shape and motion, toast and light. `packages/elements/test/contract.test.ts`
checks that each identity defines exactly these tokens and that the element
and app stylesheets use no `--aster-` token outside the list and the density
tokens below. [themes.md](themes.md) lists every token with its role.

**Identities.** Two ship. **Lamplight** (`styles/lamplight.css`) is the
default, on `:root`, with a dark set on `:root[data-scheme="dark"]`. **Harbour** (`styles/harbour.css`) applies on
`:root[data-identity="harbour"]`, with its
own dark set. Adding them needed no element changes, and Harbour was written
from [themes.md](themes.md) alone. `bun run theme-check` runs the guide's
checker (every token defined, WCAG contrast) on any theme file.
`setScheme()` sets `data-scheme` and cross-fades with a view transition
(`motion.ts:17`). The demo's theme menu picks the identity and remembers it;
`?identity=harbour` overrides it.

**Density.** Six sizes follow density, not identity (`styles/contract.ts:39`):

| Token | Sets | Compact | Standard | Comfortable |
|---|---|---|---|---|
| `--aster-ctl` | Control height | 26px | 30px | 38px |
| `--aster-ctl-tight` | Controls inside grids | 22px | 26px | 32px |
| `--aster-pad-y` | Vertical padding of grid cells and listbox rows | 5px | 9px | 12px |
| `--aster-row-y` | Vertical padding of single-line rows: nav items, tabs, menu items, options, list-editor rows, toolbars | 3px | 6px | 9px |
| `--aster-pad` | Padding of panels and bars | 8px | 12px | 16px |
| `--aster-gap` | Between fields | 10px | 14px | 18px |

`styles/base.css:8–10` sets them for `data-density` on the root, `compact`,
`standard` or `comfortable`. With no choice it's standard, or comfortable on a
coarse pointer (`:11–13`). The contract test checks that every density defines
all of them (`packages/elements/test/contract.test.ts:41`). Fixed pixel sizes
in the element styles follow them (`calc(var(--aster-row-y) + 2px)` and so
on), so one change of density moves every element together.

The geometry test is `tests/e2e/density.spec.ts`. In each density it measures
a text field, a select and a picker, each as high as `--aster-ctl`, and a
button two pixels less (`:75`). Across the three it measures 13 kinds of
element, among them tabs, nav items, options, menu items, list-editor rows,
grid rows and toolbars, and drill rows, and requires each to be smaller in
compact and larger in comfortable than in standard. For the single-line rows,
the height less the number of `--aster-row-y` it holds (two, and four for a
list-editor row shown as text) must be the same in every density, to within a
pixel (`:83`). So rows grow and shrink with the one token.

**Layer order** (`styles/base.css:4`):

```css
@layer aster.identity, aster.base, aster.elements, app;
```

Identities only set custom properties, so they sit lowest. The app's CSS can
override anything without `!important`. The reduced-motion block is
unlayered on purpose, so it beats all of them (`styles/base.css:78`).

**Polish rules** every screen gets without asking (`styles/base.css`):

- **One focus ring.** `:focus-visible` draws a 2px outline in `--aster-focus`.
  A frame marked `data-ring-owner` (text field, select, picker, date) draws
  it around itself and hides the inner control's (`:49–50`).
- **Cursor by role**, including `col-resize` for a focusable separator and a
  pointer for select-only comboboxes (`:56–65`). Elements never set a cursor
  themselves.
- **Selectable by role.** Controls aren't text-selectable; inputs and
  `data-copyable` are (`:68–69`).
- **Reduced motion.** Every duration token drops to 0s (`:78`).

Some primitives are CSS only, in `elements.css`: the nav, ledger figures,
status words, avatars, the inline error (`.aster-error`) and the hint
(`.aster-hint`).

## The bound-field contract

`BoundField` (`field/bound-field.ts:31`) is the base of every control bound to
one field of an `EditModel`: `aster-field`, `aster-check`, `aster-select` and
`aster-picker`. It takes `model`, `field`, an optional `label` (defaulting to
the field's title from metadata) and `labelled` (show the label above the
control; otherwise it's the accessible name only). A subclass writes only
`control(c)`, given a `ControlContext` with the id, metadata, value,
`FieldState`, `describedBy` and `invalid` (`:8`), and calls `write(value)`,
which goes through `model.set()` (`:89`).

The base renders what every field shows (`render`, `:93`):

| From the model | Shows as |
|---|---|
| `state(name).visible` false | Nothing, and the element is `hidden` (`:98`) |
| `state(name).required` | "Optional" beside the label of fields that aren't required or read-only (`:134`); `aria-required` on the control |
| `state(name).readOnly` and its reason | `data-readonly`; the reason under the field as a hint (`:140`), or, when it's in `sharedReasons`, only referenced |
| `pending(name)` | `data-pending`: an ink edge on the frame and a dot by the label (`styles/elements.css:229`) |
| Pending on a saved record | A Revert button whose name says the old value, "Revert Status to On track" (`:125–130`) |
| Pending on a saved record, in words | A visually hidden "Changed, not saved yet; was On track" that the control's `aria-describedby` names (`:108`, `:124`, `:139`) |
| `errors[name][0]` | `role="alert"` under the field; the control is `aria-invalid` |
| `hidden` has the field (the server hides it on this record) | In place of the control, a read-only text box whose placeholder says "Hidden", whatever the control would be; `data-value-hidden`; the model's read-only reason, "You can't see Budget on this record.", as its hint and description (`#hiddenValue`, `:91`, `:152`) |

`aria-describedby` points at the error, then the read-only reason, then the
description of the change. An empty old value reads "was empty"; the picker
names the old record, and a select its label (`describe`, `:85`, `:122`).
A new record's fields aren't described as changed, and a new list row says
it's new in its first cell instead (see `aster-list-editor`). A replayed
change is drawn as pending but not described, since a replay is built as a
new record. Most
fields are required, so the label marks the optional ones. `sharedReasons`
maps a reason to the id of an element that already shows it (`:70`); the
form uses it so a reason that applies to several fields is shown once.

**Typed input** (`field/values.ts`). `parseInput(field, text)` turns what was
typed into the field's value: integers and doubles become numbers, Decimal and
Int64 stay exact text without thousands separators, empty is null except on a
non-nullable string. Text that doesn't parse stays as typed, so validation
reports it in words and nothing typed is lost (`:10`). `formatValue` shows a
value, using the allowed value's label when there is one (`:25`).
`inputKind` picks the input type and mode: `inputmode="decimal"` for decimals (`:42`).

## The elements

### `aster-field` (`field/field.ts`)

A text input inside a `label` frame that owns the focus ring. Bound to a
model, it shows the formatted value and writes every keystroke back through
`parseInput` (`:84`). Read-only by state, the input is `readonly`, so it
still takes focus and its reason can be read. Without a model it shows
`value`, and `readOnly` selects the whole value on focus, for the share link.
`trailing` renders beside the frame (the Invite button), so the error spans
under both.

### `aster-check` (`field/check.ts`)

A Boolean field as a checkbox. A null value shows as mixed until it's set
(`:17`). Read-only disables it.

### `aster-select` (`select/select.ts`, `select/choice.ts`)

One of a field's `Validation.AllowedValues`, with their labels. A nullable
field also offers "None"; with no value it shows "Choose…". It's a
select-only combobox (`role="combobox"` with `aria-haspopup="listbox"`), so
its list is drawn like the picker's and themed with the rest. The control
itself is `choiceView` in `choice.ts`; `aster-select` binds it to a field.
Keys: ↓/↑, Enter or Space open; in the list ↓/↑, Home and End move, a letter
jumps to the next label starting with it, Enter or Space choose, Escape and
Tab close. Read-only, it stays focusable with `aria-readonly`, so its reason
can be read.

`choices` is a list of `{ value, label }` (`Option`, `select/choice.ts:6`)
that replaces the field's allowed values for this one control, such as the
operators that suit another field's type (`select/select.ts:13–20`, `:29`).
It brings no "None" of its own: include one in the list for a nullable
field. The choice is still written through the model, so the field's pending,
revert and description work as for any other. The rule editor uses it for
operators and values.

### `aster-picker` (`picker/picker.ts`, `picker/options.ts`)

**Binds to:** a model and field, plus `options`: a `Collection` of the
related records, or a `PickerOptions` (below). With a collection, `display`
(default: the target's `AsterData.TitleField`) and `valueField` (default: its
single key) say what to show and what to store. With `multiple` it binds to
no model; see Several values.

A combobox for a foreign key, such as a project's lead. The input shows the
related record's display text; typing filters the options. A plain collection
loads whole when the list first opens. Focus or a click selects the text, so
typing replaces it. Keys: ↓/↑ open and move, Page Down/Up move by ten,
Home/End go to the first and last option, Enter chooses, Escape closes and
restores the text, Tab leaves without choosing. Focus stays in the input; the
active option is its `aria-activedescendant`, and a press on an option
doesn't steal focus. The list is a top-layer popover (see Overlays).

**`PickerOptions`** (`picker/options.ts:42`) is where options come from: a
query over an entity set, shared by every picker that uses it, such as a
grid column. It takes an `OptionsSpec`:

| Option | Does |
|---|---|
| `set`, `display`, `orderBy`, `pageSize` | The set; the field shown as the name (the type's title field); the order (by name); the page size (50) |
| `filter` | Criteria, or a signal of them. A signal follows the page scope: the project's people, a country's regions |
| `searchFields` | What typing searches, ignoring case (the display field) |
| `columns`, `widths` | More fields beside the name; CSS track sizes by field, the name's too |
| `groupBy` | Options under a heading per value of a field |
| `create` | Offers "Create …" with a small form of these fields |
| `outside` | What the field says when its value isn't among the options |

**Server search.** If every option fits one page (`small`,
`picker/options.ts:86`), typing filters what's loaded. With more, typing waits
200 ms (`picker/picker.ts:12`), then asks the server through a collection of
its own (`search`, `options.ts:112`) that's released when the list closes.
The list says "Searching…" until the answer arrives, and a polite live region
says the count, "12 matches, 5 shown". Scrolling or moving near the end loads
the next page.

**Columns.** With `columns`, the list is a grid: the name and the columns, with
a header row. Each header is a button that sorts the options by that field,
on the server, and reverses on a second press; the arrow and the label say
which way. The header sits outside the listbox and is reached by Tab; the list
stays open while focus is anywhere in the picker. `widths` sets the tracks,
and the rows are subgrids of them (`options.ts:79`). With `groupBy`, a heading
introduces each run of options, and the sort applies within a group.

**Dependent options and `outside`.** A `filter` signal re-queries the options
as the page changes. A value the filter no longer allows stays; the field
shows it and a hint under it says why, "Ada Lovelace hasn't logged time on
this project" (`options.ts:129`, `picker.ts:134`), referenced by
`aria-describedby`.

**Create.** With `create`, any typed text adds "Create “text”…" at the end of
the list. Choosing it opens a form popover of the display field, filled with
the text, and the listed fields. Enter or Create
saves a new record through an `EditModel`, and the picker selects it; Escape
cancels and returns to the input.

**Several values.** With `multiple`, `values` holds the chosen values and
`change` reports them as an array. It isn't bound to a model; the owner keeps
the values. Each is a chip in the frame with its own Remove button, named
"Remove Ada Lovelace". Choosing an option toggles it and the list stays open,
with chosen options checked; Backspace in the empty input removes the last chip
(`picker.ts:234`). The grid's filter row uses it for lookup columns.

### `aster-tree-picker` (`picker/tree-picker.ts`, `picker/tree-choices.ts`)

**Binds to:** a model and field, plus `options`: a `TreeChoices`.

A combobox whose popup is a tree, for choosing one node of a hierarchy where
names repeat: the demo's 26 "Address line 1" fields, one in each address
group. The closed control shows the chosen node's name, with the path to it
underneath ("Client details › Trading address"); the path is also the input's
description, said as "In Client details, Trading address". Opening the
popup reveals the chosen node. Typing filters the tree, after 200 ms, to the
matches and the folders leading to them, opened. The first match that can be
chosen is active, and folders the person didn't search for are quieter.

Keys: ↓/↑ open and move, Enter chooses (on a folder that can't be chosen it
opens or closes it), Escape closes and restores the text. Once ↓/↑ have moved
in the tree, → opens a folder or moves into it, ← closes it or moves to its
parent, and Home/End go to the first and last row. Before that they move the
caret in the input. Rows are `treeitem`s with `aria-level`, `aria-posinset`
and `aria-setsize`. Focus stays in the input, and the active row is its
`aria-activedescendant`.

**`TreeChoices`** takes `set`, `parentField`, `display`, `searchFields`,
`orderBy` and `choosable` (which nodes can be the value; a group only opens).
Each picker that opens gets a `Tree` of its own over the set
([data.md](data.md#tree)), so open folders are per picker, and disposes it
when removed. `trail(entity)` gives the ancestors' names, fetched as needed,
for showing a node elsewhere: the demo's dependency viewer and remove dialog
use it.

### `aster-date` (`date/date-field.ts`, `date/calendar.ts`, `date/dates.ts`)

**Binds to:** a model and an `Edm.Date` field. `controlFor` picks it for any
Date field.

A date typed in the forms people write: `2026-10-07`, `7/10/2026` (day
first; `.` and `-` work too, and two digits mean 20xx), `7 Oct 2026`,
`Oct 7 2026`, and `7 Oct`, which means this year (`dates.ts:22`). A month is
its first three letters. It's shown as "7 Oct 2026". While the input has
focus, what's typed stays as typed; text that isn't a date is kept as text, so
validation says so; empty is null. The placeholder is "None" on a nullable
field, otherwise "A date, like 7 Oct". Dates are `YYYY-MM-DD` with no time
zone, as `Edm.Date` holds them.

The calendar button opens the APG date-picker dialog, a month grid in a
popover under the input (`role="dialog"`, `aria-modal`). Days are named in
full ("Wednesday 7 October 2026"); the chosen day has `aria-selected` and
today `aria-current="date"`. Keys in the grid (`calendar.ts:132`): ←/→ move a
day, ↑/↓ a week, Page Up/Down a month, with Shift a year, Home/End to the
week's Monday and Sunday, Enter or Space choose. The focused day is the
grid's one tab stop, and moving it to another month turns the page. Tab
cycles through the dialog's buttons (previous and next year and month) and the
grid; Escape closes and returns to the button. Days of neighbouring months
are left blank. The month heading is a polite live region.

The button takes focus on press in every engine (macOS engines don't focus a
button on click), so focus never falls to the page between the input and the
calendar. A grid row being edited would otherwise end its edit when focus left
it (`date-field.ts:58`).

`setClock(fn)` sets where "today" comes from, in UTC (`dates.ts:79`). The demo
gives it its own clock, so `?now=` freezes the calendar's today along with
everything else (`apps/showcase/src/workspace/main.ts:15`). The grid's filter row uses
the same calendar and parser for date columns.

### `aster-form` (`form/form.ts`)

**Binds to:** an `EditModel` and `sections`.

Fields laid out from metadata. The app gives only the arrangement: sections
with a title, a column count and items, each a field name, `{ field, span,
options }` or a read-only `{ title, value }` such as the derived "Left"
(`:12–34`). Each field's control comes from `controlFor` (`form/controls.ts:18`):
a field with `options` is a picker, a Boolean a checkbox, a field with
allowed values a select, a Date the date field, anything else a text field. Label, type, required
marker and state come from the model. Each section is an `aster-section`
whose collapsed summary counts its pending fields, "2 changes" (`:94`). A
read-only reason that applies to more than one visible field shows once,
above the sections, and each field points to it with `aria-describedby`
(`:81–88`), so an archived project shows its reason once, not under every
field. The grid is CSS: `--columns` and `--span`, collapsing to one column in
a narrow container (`styles/elements.css`, the form block). `focusFirst()`
focuses the first invalid field.

### `aster-section` (`section/section.ts`)

A titled section that collapses. The heading is a `role="heading"` with a
button carrying `aria-expanded`. The body stays in the DOM, `inert` while
collapsed, and CSS animates its height as a grid row from `0fr` to `1fr`, so
nothing is measured in JS. A collapsed section with an invalid field in it
opens (`:67`). `summary` shows beside the heading while collapsed.

### `aster-split` (`split/split.ts`)

Two panes (`start`, `end`) with a resize bar. The bar is a focusable ARIA
`separator` with `aria-valuenow`, `min` and `max`: drag it, or use ←/→ in
16px steps and Home/End for the limits (`:102`). JS writes only the start
pane's width, as `--split-start` (`:75`); CSS lays out the panes and stacks
them at phone width, hiding the bar. Dragging follows the text direction.
With `persist`, the width is kept per viewer in local storage, and storage
failures are ignored.

### `aster-list-editor` (`list-edit/list-edit.ts`)

**Binds to:** a `ListEdit` and `columns` (`{ field, width?, options?, display? }`).
Also `label`, `addLabel`, `empty` and `readOnlyReason`.

The rows of a list edit as a `role="table"` of bound controls, one per
column, chosen by `controlFor` like the form's (`:126`). Column titles come
from metadata (`:95`). A new row is pending in full and gets focus when added
(`:216–229`). Removing an existing row marks it: struck through, shown as
text, with Undo until the list is saved. Removing a new row discards it. A
changed row offers Revert. Each action button names its row by its first
column, or "new row": "Remove Write the brief" (`:113`). `readOnlyReason`
makes the whole list text, with the reason above it and no Add.

**Said as well as drawn.** A row that is new or marked for removal starts its
first cell with a visually hidden "New: " or "To be removed: ", so a screen
reader hears "To be removed: trust" (`:115–116`). A changed value in a cell
shown as text keeps the pending edge (`:119`). A field the row can't change,
such as a key once saved, is text with its reason as the cell's `title`,
not repeated under every row; a new row's cells are all editable
(`:122–125`). Edited cells are bound fields, so they describe a change as
"Changed, not saved yet; was …".

**Reordering.** A list whose `ListEdit` has a position field, and isn't
read-only, puts a handle button first in each row that isn't marked for
removal, named "Move Write the brief" with `aria-keyshortcuts` for Alt+↑ and
Alt+↓ (`:139–148`). Two ways to move a row:

- **Drag the handle.** With a mouse, after 4 px a line shows where the row
  will land among the rows not being removed. A touch or pen holds the handle
  still first ([touch drag](#drag-on-touch-screens-basedragts)): the row lifts,
  raised over its neighbours, and the line shows at once. Letting go moves it;
  Escape, an interrupted pointer, or a touch let go outside the list leaves
  the order as it was (`:183–220`).
- **Alt+↑ or Alt+↓ on the handle** moves it one place; at either end nothing
  happens (`:163–177`).

A move is announced in a polite live region, "trust, moved to 2 of 5", and
focus returns to the handle (`:104`, `:167–175`). A drag also says when it
picks a row up, "Picked up trust, 3 of 5", and "trust not moved" when it ends
without a move (`:205`, `:217`). The move is
`ListEdit.move`, so the new order is the position field changed on the rows
that moved: pending, revertible and in the change set. The table has
visually hidden column headers "Order" and "Actions" (`:94`, `:96`).

### `aster-rule-editor` (`rule/rule-editor.ts`)

**Binds to:** a `ListEdit` of clause rows as `list`, a `category`, a `label`,
`fields` and `describe`. Optionally `messages`, `readOnlyReason` and `empty`
(what's said when there's no rule, "Always" by default).

A rule as a tree of clauses: groups (`and`, `or`, `not`) holding conditions
(a field, a test and a value) and further groups. The clauses are
the rows of a list edit, so a field's rules save with the field in one
`RecordEdit` ([data.md](data.md#recordedit)). The rows need `op`,
`parentClauseId`, `position`, `category`, `fieldRef`, `value` and, on a
message's top group, `message` (`:32–36`). The editor shows and adds only the
rows whose `category` is its own (`:108`), so one list holds several rules.
Group operators are `and`, `or` and `not`, the tests `set` and `unset` take no
value (`:23–25`). Tests and group operators are labelled by the allowed
values of the row's `op` field, or shown as the bare value without one
(`opLabel`, `:307`); the demo's `Clauses` name the groups "All of", "Any of"
and "None of". The demo's field editor has a Visibility
editor and a Messages editor over the same `Clauses`
(`apps/showcase/src/workspace/features/model/field-editor.ts:242–247`).

**What a condition can test.** `describe(fieldRef)` returns a signal of a
`RuleField` for the field a condition names, or `undefined` (`:12–19`):
`operators`, the tests that suit the field's kind; `input`, `"text"`,
`"number"` or `"date"`; and optional `options`, the values to choose from.
The test is an `aster-select` over those operators (`choices`) and the value
is an `aster-select` over the options, or, with the test `in`, a checkbox for
each option whose chosen ones are stored as a JSON array, or an `aster-field`
without options (`:186`, `:192–216`). `input` sets that field's keyboard and
placeholder: `"number"` a decimal keyboard, `"date"` the placeholder
`YYYY-MM-DD` (`:216`). `fields` is what the field picker draws on: `PickerOptions` for a list, or
`TreeChoices` for an `aster-tree-picker` where names repeat across groups, as
in the demo. When locked, the field is the chosen option's text, with its
groups in brackets for a tree, or the bare `fieldRef` when it isn't among the
options; with no `fields` it shows nothing (`#fieldText`, `:235`). With no
description the test and value aren't offered (`:180`, `:186`). In the demo `describe` reads the field's kind and, for a
choice field, its answers (`field-editor.ts:61–98`), so an unknown field can't
be picked.

**Messages.** With `messages`, each top-level group is a message: a text
field, "when", and the group's conditions, named "Message 1", "Message 2"
(`:117`, `:138–143`). "Add a message" adds a group with one empty condition.
Without `messages` there's at most one top group, and none means the rule is
"always"; "Add a condition" appears while there is none (`:112`,
`:265–270`). Inside a group, "Add condition" and "Add group" add a condition
or an `or` group with one empty condition, and focus goes into the new
condition (`:154–158`, `:272–288`).

**Pending, Revert, Undo and removal.** Every input is a bound field, so it
shows pending and describes a change in words. A new or changed group or
condition is marked pending as a whole (`:135`, `:180`). A changed row of an
existing clause offers Revert; a new one only Remove, which discards it.
Removing an existing clause strikes it through, shows it as text and offers
Undo until the rule is saved; removing a group removes what's under it, and
Undo brings back all of it (`#actions`, `:215–229`). The buttons are named by
place: "Remove Shown when, condition 2", "Revert Message 1", "Undo removing
Shown when". A nested group's buttons read "this group" instead of its place
(`:148`, `:151`).

**Links for new groups.** A new group has no key yet, so a condition added
inside it can't name its parent by key. It is added with a link to the group's
row instead, and the editor finds a group's children by that link
(`list.add(values, { parentClauseId: parent.id })`, `:262`; `#children`,
`:239–248`). On save the `RecordEdit` sends the child inside the group's
entry ([data.md](data.md#recordedit)). Inside an existing group the child
holds the group's key. A new clause takes the next position among its
siblings (`:254–259`).

**Keyboard and ARIA.** Each group is a `role="group"` labelled by its heading
row (`aria-labelledby`), and each condition a `role="group"` whose
`aria-label` is its place, "Shown when, condition 1" or "Message 1, group 2,
condition 3", with ", new" or ", to be removed" added (`:134`, `:179`). A
group's heading starts with a visually hidden "New:" or "To be removed:"
(`:137`). Every control is named by its place and what it is: "Shown when,
condition 1: field", "…: test", "…: value", "Message 1: match" for a group's
operator, and a legend "…: values" over the checkboxes (`:146`, `:175`,
`:178`, `:205`, `:210`). The controls are the ordinary select, picker and
field, with their keys; the buttons are in the Tab order.

**Read-only.** With `readOnlyReason`, the reason is shown as a hint above the
rule and every group, field, test and value is text. Add, Remove, Revert and
Undo are gone (`:109`, `:115`, `:130`, `:152`, `:216`). A clause marked for
removal is shown as text in the same way.

### `aster-listbox` (`listbox/listbox.ts`)

**Binds to:** a `Selection` (and, optionally, a `collection`; by default the
selection's own). `renderRow(entity, key)` draws a row; `empty` shows when the
count is 0. With `publish`, it publishes the selection to its page scope under
that key (`:55–66`) and withdraws it on disconnect.

Focus stays on the `role="listbox"`; the active row is its
`aria-activedescendant`. Arrow Up/Down, Home and End move the selection;
Enter or double-click fire `row-open`; Shift+F10, the Menu key or right-click
select the row and fire `row-menu` with a point and the opener. Keys typed
into an editor inside a row are left alone, and a click that ends a text
selection doesn't change the selected row. The first-row fallback lives
in `Selection`, in the data core, so it holds whether or not a listbox is
rendered.

### `aster-grid` (`grid/grid.ts`, `grid/view.ts`, `grid/filters.ts`, `grid/rows.ts`)

**Binds to:** `ctx` and `set`. Optionally `view` (a `GridView`), `base`
(criteria every row meets), `lookups`, `renderers`, `rules`, `rowMenu`,
`rowControls`, `expansion`, `tree`, `editable`, `publish`, `persist`, `label`
and `empty`.

One element for a set's rows, from a few to 100,000: sorted, filtered,
grouped, edited in place, shown as a tree, opened into editors, and drawn as
cards on a phone. The person shapes it; the page supplies the starting view
and what a row can do.

**Layout and virtualization.** Layout is CSS: the columns are one
`grid-template-columns` on the table (`--grid-columns`), each row is a
subgrid so cells line up, and the header and frozen columns are sticky. JS
keeps only the rows near the viewport in the DOM, 400 px each way
(`grid.ts:152`), and spacers stand for the rest. Rows differ in height (wrapped
text, an open editor), so `RowHeights` (`grid/rows.ts:11`) keeps heights by
row key: measured ones where known, an estimate of 37 px elsewhere, prefix
sums for offsets and a binary search for the row at a scroll position. Heights
settle in the frame they change, so the spacers never show a frame late:

- A row new to the grid is measured right after the render that adds it
  (`updated`, `:750`).
- One ResizeObserver watches the scroll box and the shown rows (`:569`).
  When the box's width changes, every shown row is measured in the
  observer's callback and the re-render lands before paint (`#boxResized`,
  `:1472`). A row that resizes alone, such as one whose editor opens,
  applies in the next frame, because re-rendering for it inside the
  callback would add rows at its own depth, which the observer defers with
  a loop error.
- A row that leaves the DOM is unobserved; otherwise it would report 0×0
  from outside the document.

When a measured height replaces an estimate above the viewport, the grid
scrolls by the difference so the row on screen stays put (`#measured`,
`:1482`). Pages load as rows come into view, through `Collection.view`
([data.md](data.md#collection)); a row not loaded yet is a placeholder line.
Only the latest wanted range loads, so scrolling past doesn't queue requests.
A column has a pixel `width`, or shares the leftover space with a floor
that suits its type (`view.ts:41`). Numbers align right.

**When the count isn't known.** A server may leave the count out above a
size. The collection then lays out a page past the last one loaded
([data.md](data.md#collection)), and the grid says so: the toolbar reads
"300+ rows", the rows known to exist, and the table's `aria-rowcount` is -1,
the value ARIA gives for an unknown total (`atLeast`, `grid.ts:154`). When a
short page shows the end, both give the real count. The flat and the tree
layouts do this; a grouped grid gets its counts from `Groups`.

**When the count is an estimate.** Current Web Data returns exact counts when
requested. Other compatible services, or the mock’s explicit test simulation,
may estimate the count instead
(`Collection.estimated`). The toolbar then reads "About 12,000 rows", the
estimate to two significant figures (`roughly`, `grid.ts:164`), the table's
`aria-rowcount` is -1, and the table is described by the total, so a screen
reader hears "about" too. While the count is an estimate or open-ended, the
table's `aria-describedby` names the total; once it's exact, the row count
says it and the description goes.

**Hidden values.** A cell whose value the server hides on its record reads
"Hidden", in the muted italic of `.aster-hidden`, never blank (`hiddenValue`,
`grid.ts:161`). It does so ahead of a column's own renderer. In a row being
edited, the bound field shows it the same way (see the bound-field contract).

**The view is data.** A `GridView` (`view.ts:14`) is `columns` (field, optional
`width`, `hidden`) in display order, `sort`, `filters` (criteria by column; all
hold), `groupBy` and `frozen`, the number of leading visible columns that stay
in place when scrolling sideways. The page gives the starting view. The
collection's query is built from it (`viewQuery`) inside `base`, and follows
it. Every change is a function from view to view (`sortBy`, `setHidden`,
`moveColumn`, `setWidth`, `freezeThrough`, `setFilter`, `setGroup`), so each
is tested without a DOM. Without a `view`, `defaultView` shows every field but
the key. A new query (a filter, sort, grouping or `base`) scrolls back to the
top; if the active cell was in the header or filter row, it stays there.

**Header and its menu.** Pressing a header sorts: ascending, then descending.
Shift adds the column to the sort; with several keys each header shows its
number. Dragging a header moves the column, and its right edge resizes it
(double-click to fit the space again; never under 48 px). A change of sort is
announced, "Sorted by Due, descending". The menu button on each header opens
the column's menu (an `aster-menu`, below): a Sort group of Ascending,
Descending and Not sorted radios plus "Add to the sort", Group by, Freeze up to
this column, Move and Width submenus, Hide, and Columns…. A column that can't
sort or group doesn't offer it; long text, over 500 characters, can't be
grouped. Frozen columns need fixed widths, so freezing fixes the width of each
column it covers at its measured size. Only the first sort key sets
`aria-sort`.

**Columns and Views panels.** The toolbar has Columns and, with `persist`,
Views. Each opens a popover under its button (`grid.ts:747`, `:772`). Columns
lists every column with a checkbox (the last visible one can't be hidden) and
buttons to move it up or down. Views lists the named views with Delete, and a
field and Save to name the current one. Both end with "Reset to the page's
view". Applying a saved view reconciles it with the columns offered now
(`reconcile`, `view.ts:186`): columns that no longer exist drop out, new ones
join at the end, hidden, so changing the page never breaks a saved view.
Escape closes a panel and returns focus to its button; a press outside closes
it.

**`persist`.** The name keeps the person's current view and named views in
local storage, under `aster-grid:<name>`, per browser. They're read when the
grid connects, reconciled, and written whenever either changes. Where storage
fails nothing is kept, and the view still applies until the page closes.

**Filter row.** The Filters button shows a row under the header; turning it off
clears the filters, and the button counts them, "Filters (2)". The row stays
while any filter is set. Each cell fits its column: Booleans and allowed values
are an `aster-choice` with "Any"; a lookup column is a multi-value picker with
chips, which gives an `in` filter; text is "contains", ignoring case; numbers
and dates take typed filters, `5`, `>5`, `>=5`, `<5`, `<=5` or a range `1..3`,
and dates also `>=1 Oct 2026`, with a calendar button that keeps the operator
(`filters.ts:9`). Text that isn't one of these shows a message under the filter
(`aria-invalid`) and isn't applied. Typing applies after a 300 ms pause
(`grid.ts:154`); Enter or leaving the input applies at once. A restored view
shows the text that makes its criteria.

**Grouping.** Group by comes from the header menu, and a "Grouped by Status ✕"
button in the toolbar stops it. Group rows show the label and a count; the
counts come from one grouped request that follows the filters (`Groups`,
[data.md](data.md#groups)). A new grouping starts collapsed. Opening a group
creates a collection of its rows in the view's sort; closing releases it. A
group's size is known from its count, so the scrollbar is right before its
rows arrive. A lookup column's groups show the related name, and no value is
"None". The toolbar says "12,400 rows in 4 groups". The grid becomes a
`treegrid` with group rows at level 1. → or Enter or Space opens a group, ← or
Enter or Space closes it. There's one level of grouping, and none in a tree
grid.

**Lookups.** `lookups` maps a foreign-key column to `{ set, display }`. The
cell shows the related record's display field, read through `ctx.lookup`
(batched, shared with every other view), with a placeholder until it arrives.
Editing makes the cell a picker over the related set; the filter, the group
label and the sort use the name too. Sorting by the key would look sorted and
not be, so the grid finds the single-valued navigation whose key is the column
(`personId` has `person`) and sorts by `person/name`, which the server orders
(`grid.ts:1439`, [data.md](data.md#collection)). A lookup column with no such
navigation doesn't sort.

**Inline editing.** With `editable`, Enter, F2 or a double-click on a row edits
it. With `expansion`, a double-click and Enter expand the row instead, and F2
still edits it in place. The row gets an
`EditModel`, and each cell becomes the control `controlFor` chooses: text
field, check, select, date, or a picker for a lookup. Computed fields stay as
text. Focus goes to the clicked cell, or the first editable one. Only one row
is edited at a time: starting another saves the first, and stays if that
fails (`:1607`). Enter saves and returns focus to the row; Shift+Enter is a
new line in long text; Escape reverts and ends (`:1657`). Focus leaving the row
saves it; moving inside the row, or into a list it opened, doesn't (`:1674`). A
row with errors stays in edit with focus on the first invalid field. A form
error shows under the row, and a conflict says "Someone else changed Hours
while you were editing" with Keep mine and Take theirs.

`rules` takes page rules by field, as `applyRules` does. Each row being
edited gets a child scope with the row published as `row`
(`editPublication`), so a rule reads its own record: `row.record.status`. A
read-only reason that covers several cells shows once under the row, not under
each cell.

**Row menus.** `rowMenu(entity, key)` returns the page's actions for a row.
Right-click, Shift+F10 or the Menu key opens them at the pointer or under the
active cell, then a separator and the active column's options as a submenu,
"Hours column". On a row that isn't loaded, only the column's options show.

**Density.** Row and control sizes follow the density tokens (see Tokens). Row
heights are measured, so compact fits more rows with no grid code.

**Cards at phone width.** When the grid itself is under 560 px wide (a
container query, not the viewport's width), each row is a card of labelled
values in one column. The header row stays for assistive technology and the
keyboard, clipped out of sight; the labels are generated content with empty
alternative text, since the headers already name the cells
(`styles/elements.css`, the grid block). It's the same element and the same
keys. In a tree grid the card is indented by its level, and its first cell is
the heading: the opener and the title on one line, without a label. Row
controls are a line at the card's end, there only while they show (selected,
focused, expanded; hovered only where the device can hover), so a card keeps
no empty space for them. An expansion spans the card's width.

**Keyboard.** Focus is on the grid, one tab stop. The active cell is its
`aria-activedescendant`, and the row it's in is the selection.

| Where | Keys |
|---|---|
| Rows | ←/→/↑/↓ move between cells; Page Up/Down move by a viewport; Home/End to the first and last column; Ctrl or Cmd with Home/End to the first and last cell; F2 edits; Enter edits, or on a grid with `expansion` expands the row; Shift+F10 or the Menu key opens the row menu |
| ↑ from the first row | The filter row if it's shown, else the header |
| Header row | ←/→, Home/End; ↓ to the filter row, then the first row; Enter or Space sorts, with Shift adds to the sort; Shift+F10 or the Menu key opens the column menu |
| Filter row | Enter or F2 goes into the filter; Escape there comes back to its cell |

Keys typed in an editor, a filter or an open panel belong to it. The toolbar's
row count is a polite live region.

**Publishing.** With `publish="time"`, the grid puts `selected` (the active
row's record, typed by the set), `key`, `any`, `view` and `total` in the page
scope under that key, and withdraws them on disconnect (`grid.ts:1123`). A rule
can read `time.selected.status` or `time.total`.

**Tree grid.** `tree` is a `GridTree`: `parentField`, `rootValue` (null),
`filterMode` and `draggable`. Set it before the grid connects. The grid
builds a `Tree` ([data.md](data.md#tree)) over the same `base`, filters and
sort, and shows it as `treeModel`. The first column indents each row by its
level and has an opener on folders; child counts say which rows are folders,
and a row shows an opener until its counts say it has no children. The grid is a `treegrid`, with
`aria-level`, `aria-posinset`, `aria-setsize` and `aria-expanded` on each row.
In the first column, → opens a closed folder, or goes to the first child of an
open one; ← closes an open folder, or goes to the parent (`:1805`). Levels load
as they open, by page, and are virtualized like the rest. A filter keeps the
path to each match, opened (`keepAncestors`, the default), or with `strict`
hides what doesn't match; the toolbar says "Finding where the matches are…"
while it walks up, and "Too many matches to show where they are. Narrow the
filter." past the limit. `reveal(key)` opens the path to a record, loads
levels until its row exists, makes it active and scrolls it to the top; it
resolves to false if the record isn't in the tree.

With `draggable` and `editable`, a row is dragged by pointer: a mouse lifts it
past 6 px, a touch or pen by holding it still ([touch
drag](#drag-on-touch-screens-basedragts)). A label follows the pointer (above a
finger, larger), the row under it becomes the new parent, and the header means
the top level. A drop on the row itself or its own subtree is refused, with
the reason shown and announced. A drop calls `tree.move`, opens the new parent
and emits `moved` with `{ key, from, to }` for the page to say where it went
(`:1529`, `:1589`). Picking a row up is announced, "Picked up Write the brief.
Drop it on another row to move it under that row.", and so is a drag that
ends without a move: let go away from any row or over its old parent, or
interrupted by `pointercancel`. Presses on buttons, inputs, an edited row,
controls and expansions don't start a drag.

**Floating row controls.** `rowControls(row)` returns `RowControl`s,
`{ label, icon, run }`, for a `RowState` of `{ key, entity, expanded,
editable }`. It's called inside the render, so the controls follow the row's
state: Edit, or Save and Cancel while it's open; View and Close on a locked
page. They sit in a cell of their own past the last column, and show on hover
and on the selected and active rows. With a mouse, hovering another row
moves them there: the selected row's give way unless it's expanded or holds
keyboard focus (`elements.css`, `@media (hover: hover)`). On a touch screen a
tap selects the row, so the tapped row shows them. Each button is named by its label. Only
the active row's buttons are in the Tab order: Tab reaches them from the grid,
←/→ move between them, and Escape returns to the grid (`:438`). A click on a
control doesn't select the row or expand it.

**Expansion.** `expansion` is an `Expansion`: `content(row)`, and optionally
`canExpand(entity)`, `single`, `limit` and `noun`. A double-click, Enter on the
row (also on a grid that isn't `editable`), or `expand(key)`, opens a row in
place: its content goes under the row across all the columns, and focus moves
into its first field. A double-click on an open row closes it, unless it has
unsaved changes. Escape closes it, from inside its content or from the grid
with the row active, asking first over unsaved changes (`#dblclick`, `#key`). `content` runs once per
expansion and returns an `ExpansionEditor`: a `view` (read in the render, so it
follows signals), and optionally `dirty` (a signal), `save()`, `discard()` and
`dispose()`. Its state outlives the DOM: scrolled out of view and back, a row
shows the same editor with its edits. `expanded` is a signal of the open keys,
in the order they opened.

Several rows may be open. With `single`, opening one closes the other. With
`limit`, one more is refused with a message in the toolbar and the live
region, "Only 2 tasks can be open at once. Close one first.", using `noun`.
`canExpand` refuses a record, and then Enter and a double-click do nothing.
`expand` returns false for any refusal.

**The unsaved-changes question.** `collapse(key, how)` closes a row. `how` is
`"ask"` (the default), `"save"` (which stays open if `save()` fails) or
`"discard"`. Asking happens only when `dirty` is true. The row shows an alert
dialog in place, "This task has unsaved changes.", with Save, Discard and Keep
editing, and focus goes to it. Escape inside the content asks to close it, and
inside the question means Keep editing; other keys in the content are its own
(`:480`). In single mode, expanding a row while the open one is dirty asks the
same about the open one and refuses until it's answered (`:343–348`).

### `aster-tree-navigator` (`tree/navigator.ts`)

**Binds to:** a `Tree` ([data.md](data.md#tree)) as `tree`. Optionally `display`
(the field shown as the name; the type's title field), `label`, `chooseLabel`
("Choose"), `headingLevel` (2) and `choosable(entity)`, which returns the reason
a node can't be chosen, or undefined.

A tree one level at a time, the tree's form for a phone as cards are the
grid's. Each row has two buttons: one chooses the node, named by `chooseLabel`
and its name, "Move under Write the brief"; the other, on folders, opens it to
show the level below (`navigator.ts`, `render`). Choosing emits `choose` with
the node's key; Escape emits `cancel`. A node `choosable` refuses stays
openable, with the reason as the choose button's `title` and `aria-disabled`.
A breadcrumb, Back and Forward move between levels; Backspace goes up one when
focus isn't in a text input (`:225`); `go(key)` shows the level under a key as
if each level had been opened in turn (`:67`). The level loads by page as the
list scrolls, with "Loading…", "Nothing here." and "n of m…" shown.

Opening slides the new level in from the right and the old one out; going back
reverses it. The outgoing list is cloned as an inert ghost for the animation
(`:167`), and with reduced motion nothing moves. After each move focus goes to
the level's heading, a `role="heading"` named by the parent, so a screen reader
announces where you are, and the list is labelled by it. The navigator is
built on the same `Tree` as the tree grid, so they share levels, counts and
sync.

### `aster-carousel` (`carousel/carousel.ts`)

**Binds to:** `slides`, each `{ label, view }`, and `label`.

A row of cards that snaps one at a time, the next peeking in: the APG carousel
pattern without rotation. Previous and Next buttons, disabled at the ends, and
"2 of 5" said politely as it changes. Scrolling, swiping and the buttons all
move it; the current slide, `index`, is whichever is most in view
(an IntersectionObserver, `:85`), and `show(i)` brings one into view, smoothly
unless motion is reduced. Each slide is a group named "2 of 5: Brand refresh".
When every slide fits, or there's one, there are no buttons (`:74`).

### `aster-menu` (`menu/menu.ts`)

**Binds to:** nothing; the owner calls `openAt(point, items, label, opener)` for
a context menu at a point, or `openFrom(anchor, items, label, opener)` to open
against an element, below it. `label` names the menu. Focus returns to
`opener` (the anchor by default) when it closes. `close()` closes it.

A `MenuItem` is one of (`menu.ts:6`):

| Kind | Fields | Behaviour |
|---|---|---|
| action (no `kind`) | `label`, `run`, `disabled` | Runs and closes. `disabled` is a reason: the item stays focusable, with `aria-disabled` and the reason as its title, and does nothing |
| `check`, `radio` | `label`, `checked`, `run` | `menuitemcheckbox` or `menuitemradio`, marked ✓ or •. Runs and leaves the menu open; the owner holds the state |
| `submenu` | `label`, `items` | Opens beside the item |
| `group` | `label`, `items` | A `role="group"` under a heading |
| `separator` | | A rule |

Keyboard (`:176`), after the APG menu pattern: it opens with its first item
focused. ↓/↑ move and wrap, Home/End go to the ends, a letter jumps to the next
label starting with it. → or Enter or Space opens a submenu and focuses its
first item; ← or Escape closes one level; Escape on the top level closes the
menu. Enter or Space chooses; Tab closes. Pointing at an item opens its
submenu or closes deeper ones. A press outside, or focus leaving, closes all.

The menus are manual popovers: an auto popover opened from `contextmenu` is
dismissed by the same click's pointer-up in some engines. A menu opened at a
point writes only the point (`--menu-x`, `--menu-y`); one opened against an
element, and every submenu, is placed by CSS anchor positioning and flips at
the edges.

### `aster-window` (`window/window.ts`)

A non-modal window beside the page: a dialog (`aria-modal="false"`) in the top
layer that doesn't make the page inert. Set `heading` and `content`; `show(opener)`,
`close()` and `toggle(opener)` open and close it, `open` says which, and
closing emits `close`. The first time it opens beside its opener, above it, or
below when there's no room (`:144`); after that it opens where it was left, and
focus moves into it.

It moves by dragging the title bar, or from the Move button: ←/→/↑/↓ in 16 px
steps, Shift for 64 (`:86`); the button's description says so. CSS resizes it
from the corner. It stays inside the viewport with an 8 px margin. Escape
inside it, or the Close button, closes it and returns focus to the opener. The
position is two custom properties JS writes when it moves; the clamp needs the
window's size, measured then.

### `aster-slicer` (`slicer/slicer.ts`)

The page's shared filter ([data.md](data.md#shared-filters)) as chips: one per
contribution, showing its `label`, each removing its own contribution. Give it
`filters` (a `SharedFilters`), a `label` that names it and shows before the
chips ("Filters" by default; the demo's says "Filtered by"), and the `empty`
text shown when nothing applies ("None. Showing everything." by default)
(`:21–22`).

It's a toolbar, after the WAI-ARIA APG toolbar pattern
(`role="toolbar"`, `:62`), named by its visible label. There is one tab stop
(a roving tabindex). ← and → (and ↑ and ↓) move between chips and wrap, and
Home and End go to the ends (`#key`, `:93`). Enter, Space, Delete and
Backspace remove the focused chip. A chip's accessible name says what pressing
it does: "Remove filter: Status: Approved". After a removal, focus goes to the
chip that slid into its place, or to the one before it. After the last, focus
goes to the empty text, which takes focus for that (`tabindex="-1"`), so it
never falls to the page (`#remove`, `:124`; `updated`, `:85`). With two or
more chips, "Clear all" is the toolbar's last item (`#clearAll`, `:137`).
Every removal is said through the polite live region: "Removed filter:
Project health: On track. 2 filters left." or "Cleared all filters."
(`:133`, `:145`). A `slicer-change` event says which contributors were removed.

A contribution whose contributor follows a signal and gave no way to clear it
(`removable(by)` false) shows as a chip that can't be pressed. Its name says
so ("Filter: … , set by its source"), with `aria-disabled` (`:71`).

The slicer doesn't build filters itself. The reference's Slicer picks a
control from a field's type (chips for a value list, a date range, a
two-handle range for numbers). Here, contributors are the page's own
controls, and the slicer only shows and removes what they contributed.
`tests/e2e/reports.spec.ts` covers the keyboard, the focus moves, the
announcements, and axe in light and dark.

### Overlays (`overlay/anchor.ts`)

Every floating thing is a popover in the top layer, so no scroll container or
collapsed section clips it: menus and submenus, the select and picker lists,
the calendar, the grid's Columns and Views panels, the picker's create form.
Placement is CSS anchor positioning. JS names the anchor and opens or closes
the popover, and measures nothing.

- The anchor gets `style=${anchorStyle(id)}` (`anchor-name: --id`, `:13`).
- The overlay gets `popover="manual"`, the `aster-popover` class and
  `style=${placeStyle(id)}` (`position-anchor: --id`, `:17`).
- `openWhen(open)` is a lit `ref` that calls `showPopover()` or `hidePopover()`
  to match (`:25`). A popover rendered fresh isn't in the document when it
  runs, so it syncs in a microtask.
- `.aster-popover` in `styles/elements.css` sets `position-area: bottom
  span-right`, with fallbacks that flip block, inline, or both, so it moves to
  the other side at the edges of the viewport.

The popovers are `manual`: each owner decides when it closes (a press outside,
focus leaving, Escape), because an auto popover can be dismissed by the click
that opened it. The window is the exception: it's placed by `--window-x` and
`--window-y`, since the person moves it.

### Drag on touch screens (`base/drag.ts`)

`pressDrag` is the gesture behind both drags above. A mouse lifts a drag once
it moves the drag's distance (6 px in the grid, 4 px up or down on a list
handle). A touch or pen lifts it by holding still for 400 ms (`HOLD_MS`);
moving more than 8 px first (`HOLD_SLOP`) is a scroll, left to the browser, and
the press is forgotten. A quick tap is still a tap.

`touch-action` is decided when a touch starts and can't change during it, so
it stays at the default and scrolling works everywhere, handles included. A
lifted touch holds the page still by cancelling its `touchmove`s, and a held
press doesn't open the context menu or start a text selection. While lifted,
the scroller follows the finger in a 48 px band at its top and bottom (below a
sticky header), faster nearer the edge, and the drop target is found again as
the content moves under it. `pointercancel` cancels. Moves are followed on the
document by pointer id, so they keep arriving when the row under the finger is
re-rendered; only a mouse takes pointer capture.

Tested in `touch.spec.ts`: Chromium drives real touches over CDP, so its
scrolling and `pointercancel` come from the browser. Playwright gives Firefox
and WebKit only a tap, so there pointer events with `pointerType: "touch"`
stand in, and a swipe is the `pointercancel` a browser sends when it scrolls.

### The smaller elements

- **`aster-caret-group`**: a bar that slides to the descendant with
  `aria-current` or `aria-selected="true"`; JS writes `--caret-pos` and
  `--caret-size`, CSS draws it.
- **`aster-tabs`**: `role="tablist"` with a roving tabindex and automatic
  activation. Fires `change`; the owner sets `value`.
- **`aster-button`**: rest, hover, pressed, focus, busy and disabled. Labels
  are stacked in one grid cell, so swapping "Save", "Saving…" and "Saved"
  never changes the width. `reason` replaces disabling: the button stays
  focusable, says why in its `title`, sets `aria-disabled` and swallows the
  click. `busy` takes a signal.
- **`aster-switch`**: one Boolean of a stored record, saved on toggle through
  `ctx.update`, reverting with an error if the save fails.
- **`aster-dialog`**: a native modal `<dialog>`; `showView` morphs one panel
  between views with a view transition.
- **`aster-toaster`** and **`announce`**: one toast at a time with an optional
  action; a polite live region for background results.
- **`aster-choice`**: a select-only combobox not bound to a model: `options`, a
  `value`, a `label`, and a `change` event with the chosen value. The grid's
  filter row uses it; `aster-select` is the same control over a field's allowed
  values.
- **`format.ts`**: `relativeTime` with `absoluteTime` on hover, `compactMoney`.

## How the demo uses them

**Projects list.** The list publishes the shared project selection as
`projects` (`apps/showcase/src/workspace/app.ts:260`); the app provides the root scope
(`:85`), and each page publishes into a child of it.

```ts
html`<aster-listbox id="projects-list" class="rows" .label=${`${TAB_TITLES[tab]} projects`}
  .selection=${model.selection} .publish=${"projects"}
  .renderRow=${(e: Entity, key: KeyText) => this.#row(e, key)}
  @row-open=${(e: CustomEvent<{ key: KeyText }>) => this.#openProject(e.detail.key)}>
</aster-listbox>`;
```

A row's menu (right-click, Shift+F10 or the Menu key) is an `aster-menu` opened
at the pointer: Open, Rename, Pause or Archive or Resume, Pin (`app.ts:485`).
Each move has an Undo toast.

**Project page** (`#project/<id>`, `apps/showcase/src/workspace/features/projects/project.ts`). The
header has Revert and Save buttons. Save's `reason` comes from a scope rule:
it's enabled while the project or its tasks have changes, and pressing it
with errors shows them (`:118–128`, `:241`). The Details tab is one form over
the project's edit model; only the layout is the app's (`:271–276`):

```ts
const sections: FormSection[] = [
  { title: "Basics", columns: 2, items: [{ field: "name", span: 2 }, { field: "leadId", options: model.people }, "state", { field: "clientId", options: clients }] },
  { title: "Schedule", columns: 2, items: ["health", "behindDays"] },
  { title: "Budget", columns: 3, items: ["budget", "spent", { title: "Left", value: left }] },
];
html`<aster-form .model=${edit} .sections=${sections}></aster-form>`;
```

Lead is a picker over People, State and Status are selects from allowed
values, and Days behind appears and becomes required with Status = Behind,
by the rules in [data.md](data.md#pagescope-and-rules). An archived project
shows every ruled field read-only, with the reason once above the form. The Tasks tab is an
`aster-list-editor` over a `ListEdit`, read-only with the same reason when
archived (`:146–159`); its Due column is an `aster-date`, and its Assignee a
picker over only the people who've logged time on the project. That picker's
`filter` is a signal over a `Groups` of the project's time entries by person,
so it follows the entries, and `outside` says "hasn't logged time on this
project" for a current assignee who has none (`:260–270`). Leaving with unsaved
changes asks in place: Save and leave, Discard them, or Stay (`:170–178`). A
conflict offers Keep mine or Take theirs (`:162`).

Client is a picker over 100,000 clients, so it searches on the server. The
drop-down has City and Industry columns that sort, a heading per country, and
"Create …" for a client that isn't there yet (`:252–259`).

**People page** (`#people/<id>`, `apps/showcase/src/workspace/features/people/people.ts`). An
`aster-split` with the people listbox on the left, publishing `people`, and
the selected person's detail on the right (`:89–103`). The detail's form is
the person's own edit model, kept per person, so unsaved changes stay with
each person while you look at someone else; the list marks them (`:99`). The
person's projects and open tasks are collections whose queries follow
`people.selected.id` (`:154–167`). At phone width the split stacks and the
URL decides which view shows (`:214`).

**Time page** (`#time`, `apps/showcase/src/workspace/features/time/time.ts`). One `aster-grid` over
every time entry, 100,000 by default, with `?time=<n>` for fewer. The page
gives a view (newest first, the date and person columns frozen), two lookups
(person and project, so those columns show names and sort by them), and
`publish` and `persist` names, so the Views panel appears and the person's own
view is kept (`:7–25`, `:73`). It's `editable`, with `rules`: an approved
entry's hours and date are read-only, with the reason, by a rule that reads
`row.record.status` (`:27–38`). Billable is a derived value: changing an
entry's project suggests billable when the project has a client and not
billable when it hasn't, read through `row.values.project.clientId`; opening
a row changes nothing, and unticking or ticking it yourself sticks
(`:37`; `tests/e2e/derived.spec.ts`). The row menu moves an entry through Submit,
Approve, Back to draft and Reopen, or deletes it, each with an Undo toast
(`:49`). At phone width the grid is a list of cards.

**Tasks page** (`#tasks`, `apps/showcase/src/workspace/features/tasks/tasks.ts`). Every project's
tasks as a tree grid over `parentId`, `draggable`, with levels loading as they
open. Each row has floating controls: Edit, Add subtask, Move to… and Remove,
or Save and Cancel while open (`:99`). Edit expands the row into the task
editor (`task-editor.ts`): Details and Subtasks tabs over one edit model and a
`ListEdit` of the children. A tab's form is built when it's first chosen;
saving checks every field, built or not, and an alert names the ones that
fail before saving the task, then its subtasks (`task-editor.ts:92`). Closing
over changes asks the grid's question. The page's Lock editing button turns
Edit into View, removes Add and Remove, and makes the fields read-only by a
rule on a `page.locked` publication (`task-editor.ts:36`). Add subtask opens a
dialog with a form; Move to… opens an `aster-tree-navigator` in a dialog whose
`choosable` refuses the task and everything under it, found with
`tree.descendants`; Remove lists the subtasks that go with it, and deletes
them deepest first. A drag or Move to… ends with an Undo toast. `#tasks/<id>`
and `#tasks/<id>/subtasks` are deep links: they `reveal` the task, open its
editor and choose the tab, and choosing a tab pushes a history entry, so Back
returns to the tab before. At phone width the page is a navigator over all
tasks, and choosing one opens its editor beneath it (`:286`).

**Model page** (`#model`, `apps/showcase/src/workspace/features/model/infomodel.ts`; the Model item
in the sidebar, `app.ts:162`, and on the phone's tab bar). An information model editor: a 462-field intake
questionnaire as a tree grid of fields (groups, then questions under them),
with a Change log tab beside it (`infomodel.ts:454–481`). It is the elements
together:

- **Rows and editor.** Each field row has floating controls by state: Edit,
  Add field on a group, Dependencies, Move to… and Remove, or Save and Cancel
  while it is open (`#controls`, `infomodel.ts:150–173`). Edit, or Enter on
  the row, expands the field into its editor (`field-editor.ts`): Definition, Answers
  (a choice field only), Visibility and Messages over one `RecordEdit`
  ([data.md](data.md#recordedit)). Definition is an `aster-form`, Answers an
  `aster-list-editor` with reordering, and the two rule tabs an
  `aster-rule-editor` each. A tab is built when first chosen, and a save checks
  every row of every tab, built or not: an alert names what fails, the first
  failing tab opens, and nothing is sent (`field-editor.ts:184–193`). A good
  save is one request with the field's ETag.
- **Deep links.** `#model/<field>` reveals a field, however deep, and
  `#model/<field>/<tab>` opens it on a tab. Choosing a tab pushes a history
  entry, so Back returns to the tab before (`#tabChosen`, `infomodel.ts:191`).
- **Working copy.** Every change goes to a draft in IndexedDB, and a field with
  a draft opens again after a reload with it taken up
  (`field-editor.ts:130–141`, `infomodel.ts:115–118`). Another user's change to
  a field not edited here is taken in; to one that is, the editor offers Keep
  mine or Take theirs (`conflictNote`, `field-editor.ts:216`).
- **Remove.** A dialog lists the fields under it and the other fields' rules
  that read it. Confirming removes those conditions first, one save per
  repaired field, then the field, as one log entry (`#impact`,
  `infomodel.ts:292`; `#remove`, `:311`).
- **Dependencies.** A non-modal `aster-window` lists the fields whose rules
  read this one, and which read each of its answers; Go to field is a deep
  link (`#showDependents`, `infomodel.ts:355`).
- **Change log.** A grid over `Changes`, newest first. An entry expands into
  a replay: the field's editor over its old values, read-only, with only the
  tabs the change touched, and a Dependency updates tab when the change
  repaired other fields (`replay`, `infomodel.ts:485`; `changedTabs`,
  `field-editor.ts:279`).
- **Lock editing.** A button turns Edit into View, removes Add field, Move
  and Remove, and makes every tab read-only with a reason
  (`field-editor.ts:28`, `:235`).

**Reports page** (`#reports`, `apps/showcase/src/workspace/features/reports/reports.ts`). Time
across every project, through one shared filter. The page makes a
`SharedFilters` and publishes it as `filters` in its child scope (`:70`).
Three kinds of control contribute to it (`#toggles`, `:142`): the Period
buttons ("This week", "Last 30 days" and "Last 90 days", relative dates on
`TimeEntries.date`, resolved at each fetch) and the Project health buttons
(criteria on `Projects`). The third is the bars of an hours-by-status chart:
each bar is a toggle button whose name says its figure ("Approved: 10,890
hours, 89%"), and pressing it contributes a value selection (`#chart`,
`:170`). An `aster-slicer` shows the contributions as chips. The figures
(`ctx.groups` over `filters.query`) and the entries grid (its `base` is the
consumed criteria for `TimeEntries`) follow all of them, health through the
entries' `project`. The chart follows everything but its own bar (`self`,
`:79`), so every status stays visible. The open-tasks list follows health
only, and says so: "Follows Project health: Behind. Doesn't follow Last 30
days, Status: Approved: they're about other records." (`#follows`, `:220`).
`tests/e2e/reports.spec.ts` checks every figure against the server's data.

**Home** (`app.ts:375`). The pinned projects as cards in an `aster-carousel`,
one at a time on a phone.

**Theme, density and `?debug`.** The sidebar footer has the user's name on a
line of its own, then a density switch (compact, standard, comfortable; kept
per browser, comfortable at first on a touch screen), a theme menu (an
`aster-menu` of radio items: Lamplight and Harbour, `themes.ts`), and the lamp
(`app.ts:174–179`). On a phone the tab bar carries Home, Projects, People,
Model and Time, then the theme menu and the lamp (`:184–201`). `?debug` shows a Simulate button that toggles an
`aster-window`, so the panel sits beside the page while you edit. The panel
shows the rules behind the focused field's state from `model.explain(field)`
(`apps/showcase/src/workspace/debug.ts:25`), and can make another user's edit arrive or the
next save fail.

## Implementation boundaries

The following capabilities are outside the current element contracts:

- **Rules on tabs, sections and menu items.** `FieldState` drives fields and
  buttons; sections and tabs don't take one yet.
- **Grid:** filtering by a related record's field from the grid's own filter
  row (sorting by one works, and a `base` filter can use `via`), and rules over a column rather than a
  row's cells. Saved views are kept in the browser, not on a server. Bound
  editable controls mark derived values as “Suggested value” and describe the
  mark to assistive technology.
- **Slicer:** Reports saves slices with its screen; the library exposes
  `SharedFilters.snapshot` and `restore`. The slicer doesn't choose a
  control from a field's type. Selections in the demo aren't shared: the data
  core's `selectionShare` is tested, and no demo grid uses it yet.
- **Trees:** several values in the tree picker, cascading selection, folders sorted apart from leaves, saved open state,
  reordering among siblings.
- **Drag:** mouse and touch drags scroll at the edges. A narrow tree grid
  shows a Top level drop target while dragging; Move to… remains available
  from the keyboard.
- **A rule editor over other row shapes.** It reads the clause rows' field
  names (`op`, `parentClauseId`, `position`, `category`, `fieldRef`, `value`,
  `message`) and the operators `and`, `or`, `not`, `set` and `unset` as
  written (`rule/rule-editor.ts:21–23`, `:32–36`).
- **A replay's changes said in words.** A replayed field, row or condition is
  drawn as pending; only added and removed list rows are also said, because a
  replay is built as a new record.
- **Form association** through `ElementInternals`; bound fields wrap native
  controls instead.
- **`@getaster/react`**, the generated wrappers.
- **i18n, RTL, high contrast** (v1). Dates and counts are formatted for
  `en-GB`, and the calendar starts on Monday.
- **Manual screen-reader validation** is deferred for this phase. Automated
  axe and keyboard checks cover exercised paths; they do not establish
  VoiceOver or NVDA usability.
