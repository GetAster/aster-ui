# Fields and pickers

The field elements edit one value each. Most are *bound*: you give them an
[[class:EditModel]] and a field name, and they take everything else from the
model and the service's metadata, including the label, the type, the
allowed values, whether the field is required or read-only and why, the
error, and whether the value has changed since it was loaded. They write
each change straight back to the model. Saving is the model's job, so a
screen of fields is saved with one [[method:EditModel.save]].

### The bound controls

| Element | Class | For |
|---|---|---|
| `aster-field` | [[class:Field]] | Text and numbers. Long text (over 500 characters allowed) is a textarea. |
| `aster-check` | [[class:Check]] | A Boolean, as a checkbox. |
| `aster-select` | [[class:Select]] | One of a field's allowed values (`Validation.AllowedValues`). |
| `aster-date` | [[class:DateField]] | An `Edm.Date`, typed or chosen from a calendar. |
| `aster-picker` | [[class:Picker]] | A foreign key: one related record, chosen by its name. |
| `aster-tree-picker` | [[class:TreePicker]] | One node of a hierarchy, such as a category tree. |

All of them extend [[class:BoundField]], which draws what every field shows:
the label and "Optional" marker, the read-only reason, the error, the
changed-value marking with a Revert button, and the "Hidden" box for a value
the server withholds. [[staticMethod:controlFor]] picks the right one from
metadata, and [[class:Form]] lays out many (see [[group:forms]]).

Three controls aren't bound to an edit model:

- [[class:Choice]] (`aster-choice`) is the select-only combobox with a
  `value` and a `change` event, for toolbars and filters.
- [[class:Switch]] (`aster-switch`) toggles a Boolean on a stored record and
  saves at once, for settings.
- [[class:Picker]] with `multiple` holds several values and reports them by
  `change`.

An `aster-field` with no model shows its `value` property, such as a link to
copy.

### Where options come from

A picker's options are records from the service. Give it a
[[class:Collection]] for a short list, which loads whole when the list first
opens, or a [[class:PickerOptions]] for anything larger or richer. A
`PickerOptions` is built from an [[object:OptionsSpec]] and gives the picker
server-side search, columns with sortable headers, headings by a group
field, options that follow the page (a filter signal), and "Create …". One
`PickerOptions` can serve every picker over the same set, such as a column
of a grid. A tree picker's options are a [[class:TreeChoices]], built from a
[[object:TreeChoicesSpec]].

### Example

A task editor: the record is fetched into the store, an edit model is made
over it, and each control is bound to a field by name. The controls choose
nothing themselves; type, label and state come from the metadata and the
model's rules.

```ts
import { DataContext, EditModel, fetchTransport, keyText } from "@getaster/data";
import "@getaster/elements";
import { html, render } from "lit-html";

const ctx = await DataContext.connect(fetchTransport("https://example.com/odata/"));
const key = keyText([42]);
await ctx.reload("Tasks", key); // an EditModel over a saved record needs it in the store
const edit = new EditModel(ctx, "Tasks", key);
const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });

render(
  html`<aster-field .model=${edit} .field=${"title"} .labelled=${true}></aster-field>
    <aster-picker .model=${edit} .field=${"assigneeId"} .options=${people} .labelled=${true}></aster-picker>
    <aster-date .model=${edit} .field=${"due"} .labelled=${true}></aster-date>
    <aster-check .model=${edit} .field=${"done"} .labelled=${true}></aster-check>
    <button type="button" @click=${() => void edit.save()}>Save</button>`,
  document.querySelector("#task")!,
);
```

### Keyboard and focus

Every control is reachable by Tab and stays focusable when read-only, so its
reason can be read; read-only inputs are `readonly` or `aria-readonly`,
never `disabled`. The lists of the select, picker and tree picker keep focus
in the control and mark the active option with `aria-activedescendant`.
Each element's own section lists its keys. `focus()` on any of them focuses
the input inside.

### Limits

- A picker or tree picker stores a single-field key. Sets with compound keys
  can't be picked.
- The tree picker holds one value; there is no multiple tree picker.
- [[class:Picker]] with `multiple` isn't bound to a model; the owner keeps
  the values.
- Dates are typed day first (`7/10/2026` is 7 October) and shown in English;
  "today" is the UTC date (see [[staticMethod:setClock]]).

## class:BoundField

`BoundField` is abstract: use one of the elements above, or extend it for a
control of your own. It renders, in order:

| When | What shows |
|---|---|
| `labelled` is true | The label above the control, linked to it with `for`. "Optional" beside it if the field isn't required or read-only. |
| The value differs from the one loaded, on a saved record | `data-pending` on the element (an edge and a dot in the styles), a Revert button named "Revert Title to Draft plan", and a visually hidden "Changed, not saved yet; was Draft plan" in the control's description. |
| The field is read-only by its state | `data-readonly` on the element and the reason under the control as a hint, unless the reason is in [[attr:BoundField.sharedReasons]]. |
| The model has an error for the field | The first error under the control with `role="alert"`; the control is `aria-invalid`. |
| The server hides the field on this record | A read-only box with the placeholder "Hidden" in place of the control, and `data-value-hidden` on the element. |
| The field's state isn't visible | Nothing, and the element is `hidden`. |

The control's `aria-describedby` names the error, then the read-only reason,
then the description of the change. A new record's fields aren't marked as
changed and have no Revert.

Most fields in an enterprise form are required, so the label marks the
optional ones; the control carries `aria-required` either way.

A subclass implements the protected `control(c)`, given a
[[object:ControlContext]], and calls the protected `write(value)` to set the
model's value. A subclass can also override `describe(meta, value)`, which
turns a value into words for the Revert button and its description (the
picker names the record rather than the key).

```ts
import { BoundField, define, type ControlContext, type View } from "@getaster/elements";
import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";

/** A text field that keeps its value in upper case, such as a currency code. */
class CodeField extends BoundField {
  override focus(options?: FocusOptions): void {
    this.querySelector("input")?.focus(options);
  }

  protected control(c: ControlContext): View {
    const text = typeof c.value === "string" ? c.value : "";
    return html`<label class="aster-field" data-ring-owner>
      <input id=${c.id} .value=${live(text)} ?readonly=${c.state.readOnly}
        aria-label=${this.labelled ? nothing : c.label}
        aria-required=${c.state.required ? "true" : nothing}
        aria-invalid=${c.invalid ? "true" : nothing}
        aria-describedby=${c.describedBy ?? nothing}
        @input=${(e: InputEvent) => this.write((e.target as HTMLInputElement).value.toUpperCase())}>
    </label>`;
  }
}
define("my-code-field", CodeField);
```

## attr:BoundField.model

The [[class:EditModel]] the control reads from and writes to. Default
`undefined`: the control renders with no metadata, the default state
(visible, editable, required) and no value. Setting it re-renders the
control; so does any change in the model it reads.

## attr:BoundField.field

The name of the field in the model's entity type, such as `"assigneeId"`.
Default `""`. A name the type doesn't have renders the control with no
metadata.

## attr:BoundField.label

Default `""`, which uses the field's title (`Core.Description`) and then its
name. With [[attr:BoundField.labelled]] off, the label is the control's
`aria-label` and isn't shown, so set it when the title alone wouldn't make
sense out of context, such as "Project name" for a field titled "Name".

## attr:BoundField.labelled

Default `false`. Turn it on for a field in a form, where the label belongs
above the control. Leave it off where the context names the field, such as a
grid cell under a column header; the label is still the accessible name.
[[class:Form]] and [[staticMethod:controlFor]] set it for you.

## attr:BoundField.sharedReasons

Maps a read-only reason, such as "This project is archived.", to the `id` of
the element that shows it. When this field's reason is in the map, the field
shows no hint of its own and points its `aria-describedby` at that element.
Default an empty map. [[class:Form]] fills it for reasons that apply to more
than one field, so each is said once above the fields.

```ts
const reason = "This project is archived.";
html`<p id="archived-reason" class="aster-hint">${reason}</p>
  <aster-field .model=${edit} .field=${"name"} .labelled=${true}
    .sharedReasons=${new Map([[reason, "archived-reason"]])}></aster-field>`;
```

## object:ControlContext

[[class:BoundField]] builds it on every render and passes it to the
subclass's `control()`. Every value in it is current for that render.

## attr:ControlContext.id

A document-unique id for the control. Put it on the focusable element: the
label's `for` points at it, and the element's other ids are built from it
(`${id}-label` for the label when [[attr:BoundField.labelled]] is on).

## attr:ControlContext.name

The field's name, as set in [[attr:BoundField.field]].

## attr:ControlContext.meta

The field's metadata ([[object:Field]]): type, nullability, maximum length,
allowed values, scale and so on. `undefined` without a model, or when the
type has no such field.

## attr:ControlContext.value

The field's current value in the model, which may be text that didn't parse
(see [[staticMethod:parseInput]]). `undefined` without a model.

## attr:ControlContext.state

The field's [[object:FieldState]] from metadata and page rules: `visible`,
`enabled`, `readOnly`, `required`, and the `reasons` for each. Without a
model it's the default state. A control should make itself read-only, but
still focusable, when `state.readOnly` is true.

## attr:ControlContext.describedBy

A space-separated list of ids, or `undefined` when there's nothing to name.
Put it on the focusable element as `aria-describedby`.

## attr:ControlContext.invalid

`true` when the model has an error for the field. Put it on the focusable
element as `aria-invalid="true"`; the error text is already named by
[[attr:ControlContext.describedBy]].

## attr:ControlContext.label

The label text: [[attr:BoundField.label]], or the field's title, or its name.
Use it as the control's `aria-label` when [[attr:BoundField.labelled]] is off.

## class:Check

Tag `aster-check`. Bind it to an `Edm.Boolean` field with
[[attr:BoundField.model]] and [[attr:BoundField.field]]. `true` is checked,
`false` unchecked, and `null` (or no value) shows the checkbox as mixed;
clicking it then sets `true`. Space toggles it, as on any checkbox. Read-only,
it carries `aria-readonly="true"` and ignores clicks.

```ts
html`<aster-check .model=${edit} .field=${"done"} .labelled=${true}></aster-check>`;
```

## method:Check.focus

Focuses the checkbox.

## staticMethod:formatValue

How every bound control shows a stored value as text.

- `field`: the field's metadata, or `undefined` to get `String(value)`.
- `value`: the value.

Returns `""` for `null` or `undefined`; the allowed value's label when the
field has allowed values with labels; for an `Edm.Decimal` with a scale, the
value padded to that many places; otherwise `String(value)`. Dates are
returned as stored (`2026-10-07`); [[staticMethod:formatDate]] formats them.

```ts
import { formatValue } from "@getaster/elements";

formatValue(budgetField, "7.5");   // "7.50" for an Edm.Decimal with scale 2
formatValue(healthField, "behind"); // "Behind", the allowed value's label
formatValue(undefined, null);      // ""
```

## staticMethod:parseInput

How [[class:Field]] turns typed text into the field's value.

- `field`: the field's metadata, or `undefined` to keep the text as it is.
- `text`: what was typed.

| Field type | Returns |
|---|---|
| `Edm.String` | The text untrimmed; `null` for empty on a nullable field, `""` on a non-nullable one. |
| Empty input, any other type | `null`. |
| `Edm.Byte`, `Edm.SByte`, `Edm.Int16`, `Edm.Int32` | A number for whole-number text such as `-12`; otherwise the text. |
| `Edm.Single`, `Edm.Double` | `Number(text)` when that is finite; otherwise the text. |
| `Edm.Decimal`, `Edm.Int64` | The trimmed text with commas removed, kept as text so no precision is lost. |
| Anything else | The trimmed text. |

Text that doesn't parse is returned as typed rather than dropped, so the
model's validation can say what's wrong in words and the person loses
nothing.

```ts
import { parseInput } from "@getaster/elements";

parseInput(hoursField, "7");          // 7 for an Edm.Int32
parseInput(hoursField, "seven");      // "seven": validation reports it
parseInput(budgetField, "41,200.50"); // "41200.50" for an Edm.Decimal
```

## class:Select

Tag `aster-select`. Bind it with [[attr:BoundField.model]] and
[[attr:BoundField.field]] to a field with allowed values. The options are
the allowed values with their labels, after "None" when the field is
nullable; the frame shows "Choose…" when the value isn't one of them.

It's a select-only combobox, drawn by [[staticMethod:choiceView]]: a
focusable `role="combobox"` that opens a `role="listbox"` popover, rather
than a native `<select>`, so its list looks like the picker's in every
theme. Keys: ↓, ↑, Enter or Space open the list; in the list ↓/↑, Home and
End move, a letter jumps to the next option starting with it, Enter or
Space choose, Escape or Tab close. Leaving the control closes the list.
Read-only, it stays focusable with `aria-readonly` and doesn't open.

```ts
html`<aster-select .model=${edit} .field=${"health"} .labelled=${true}></aster-select>`;
```

## method:Select.focus

Focuses the combobox.

## attr:Select.choices

Replaces the field's allowed values for this one control with a list of
[[object:Option]]s, such as the comparison operators that suit another
field's type. Default `undefined`, which uses the allowed values. The list
adds no "None" of its own: include `{ value: null, label: "None" }` for a
nullable field. The chosen value is still written to the model, so the
field's changed marking, Revert and errors work as usual.

```ts
const operators = [
  { value: "eq", label: "is" },
  { value: "ne", label: "is not" },
  { value: "contains", label: "contains" },
];
html`<aster-select .model=${clause} .field=${"op"} .choices=${operators}></aster-select>`;
```

## class:Choice

Tag `aster-choice`. The same combobox and keys as [[class:Select]], with no
edit model: set [[attr:Choice.options]] and [[attr:Choice.value]], and listen
for [[event:Choice.change]]. Choosing sets `value` itself, so the control
shows the choice straight away; the owner needn't set it back.

Always set [[attr:Choice.label]]: it's the combobox's only accessible name.

```ts
import type { Choice } from "@getaster/elements";
import { html } from "lit-html";

const periods = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
];
html`<aster-choice .label=${"Period"} .options=${periods} .value=${period.value}
  @change=${(e: CustomEvent<string>) => (period.value = e.detail)}></aster-choice>`;
```

## method:Choice.focus

Focuses the combobox.

## attr:Choice.options

The [[object:Option]]s to choose from, in order. Default `[]`. Reactive:
setting a new list re-renders the control.

## attr:Choice.value

The chosen value, compared with `===` against each option's `value`.
Default `undefined`, which shows [[attr:Choice.placeholder]]. A value that
isn't among the options shows as its text. Set by the control when someone
chooses.

## attr:Choice.label

The accessible name of the combobox and its list, such as "Period". Default
`""`. It isn't shown; put a visible label beside the control if the context
doesn't name it.

## attr:Choice.placeholder

Shown when [[attr:Choice.value]] is `null` or `undefined`. Default
`"Choose…"`.

## event:Choice.change

Fires when someone chooses an option, by click or keyboard, with the
option's `value` as `detail`. It fires even when the option chosen is the
current one. [[attr:Choice.value]] already holds the new value when it fires.
It bubbles.

## class:ChoiceState

Keep one per control, as a field of the element, so the list's open state and
active option survive re-renders. Pass it to [[staticMethod:choiceView]] on
every render. Both members are signals, so reading them in `render()` tracks
them.

```ts
readonly #state = new ChoiceState();
```

## attr:ChoiceState.open

A signal: `true` while the list is open. Default `false`. Set it to `false` to
close the list from outside, such as when the owner's row stops editing.

## attr:ChoiceState.active

A signal: the index of the active option in the open list. Default `0`.
Opening the list sets it to the chosen option.

## staticMethod:choiceView

Use it to put the select-only combobox inside an element of your own, as
[[class:Select]] and [[class:Choice]] do. Call it from `render()`, since it
reads the state's signals.

- `state`: the control's [[class:ChoiceState]].
- `p`: the [[object:ChoiceProps]]: the id, the options, the value, and the
  `choose` callback.

Returns the template: the frame with the shown value, and the list as a
top-layer popover anchored under it. Pressing an option doesn't take focus
from the combobox.

```ts
import { AsterElement, ChoiceState, choiceView, define, type View } from "@getaster/elements";
import type { Value } from "@getaster/data";

class SortChoice extends AsterElement {
  readonly #state = new ChoiceState();
  readonly #by = this.prop<Value>("name");

  protected render(): View {
    return choiceView(this.#state, {
      id: "sort-choice",
      options: [
        { value: "name", label: "Name" },
        { value: "due", label: "Due date" },
      ],
      value: this.#by.value,
      placeholder: "Sort by…",
      label: "Sort by",
      choose: (v) => {
        this.#by.value = v;
        this.emit("sort-change", v);
      },
    });
  }
}
define("sort-choice", SortChoice);
```

## object:ChoiceProps

What [[staticMethod:choiceView]] draws, given afresh on each render.

## attr:ChoiceProps.id

The combobox's id. It must be unique in the document: the list's id
(`${id}-options`), each option's id, and the anchor the list is placed
against are built from it.

## attr:ChoiceProps.options

The [[object:Option]]s, in order.

## attr:ChoiceProps.value

The chosen value. `undefined` and `null` both match an option whose value is
`null`.

## attr:ChoiceProps.placeholder

When the value is `null` or `undefined` and no option has that value. A
value that isn't among the options shows as its text instead.

## attr:ChoiceProps.readOnly

When `true`, the list doesn't open and the combobox is `aria-readonly`; it
stays focusable. Default `false`.

## attr:ChoiceProps.label

The `aria-label` of the combobox and the list. Give this or
[[attr:ChoiceProps.labelledBy]].

## attr:ChoiceProps.labelledBy

The id of a visible label, used as `aria-labelledby` on the combobox and the
list.

## attr:ChoiceProps.required

Sets `aria-required="true"` on the combobox. Default `false`.

## attr:ChoiceProps.invalid

Sets `aria-invalid="true"` on the combobox. Default `false`.

## attr:ChoiceProps.describedBy

The combobox's `aria-describedby`: ids of an error, hint or reason.

## attr:ChoiceProps.choose

Called with the chosen option's `value` when someone chooses one by click,
Enter or Space. The list closes after it returns. Update your value here;
the control shows whatever `value` the next render passes.

## object:Option

One entry of a [[class:Select]], [[class:Choice]] or
[[staticMethod:choiceView]] list.

## attr:Option.value

The value chosen, of any [[type:Value]] type. Compared with `===`, so use
primitives (text, numbers, `null`), not objects.

## attr:Option.label

The text shown. Typing a letter in the open list jumps to the next label
starting with it.

## class:Picker

Tag `aster-picker`. Bind it with [[attr:BoundField.model]] and
[[attr:BoundField.field]] to a foreign key, and give it
[[attr:Picker.options]]. The input shows the related record's name; typing
filters the list, and choosing an option writes its key to the model. Focus
or a click selects the text, so typing replaces it.

How typing filters depends on the options:

- A [[class:Collection]] loads whole when the list first opens, and typing
  filters what's loaded, ignoring case.
- A [[class:PickerOptions]] loads its first page on opening. If every option
  fits in one page, typing filters what's loaded; otherwise, 200 ms after
  typing stops, it searches on the server through a collection of its own,
  showing "Searching…" until the answer arrives.

Scrolling near the end of the list, or moving the active option near it,
loads the next page. While text is typed, a polite live region says the
count: "12 matches", or "1,204 matches, 50 shown" when not all are loaded.
An empty list says "Nothing matches “text”." or "No options.".

Keys: ↓/↑ open the list and move; Page Down/Page Up move ten; Home/End go to
the first and last option; Enter chooses; Escape closes the list and puts
back the shown name; Tab leaves without choosing. With `multiple`, Backspace
in the empty input removes the last chip. Focus stays in the input, which is
`role="combobox"`; the active option is its `aria-activedescendant`.

With a [[class:PickerOptions]] the picker also shows:

- **Columns.** With [[attr:OptionsSpec.columns]], a header row of buttons
  that sort the options on the server by that field; a second press reverses
  the sort. The header is outside the listbox and reached with Tab; the list
  stays open while focus is in the picker.
- **Headings.** With [[attr:OptionsSpec.groupBy]], a heading over each run of
  options with the same value.
- **A value outside the options.** When a [[attr:OptionsSpec.filter]] no
  longer includes the current value, the value stays, and a hint under the
  field says so, using [[attr:OptionsSpec.outside]].
- **Create.** With [[attr:OptionsSpec.create]], typed text adds "Create
  “text”…" at the end of the list. Choosing it opens a small form with the
  display field filled in and the listed fields; Create saves a new record
  and selects it, and Escape or Cancel returns to the input.

The picker raises no event when bound: read the value from the model. Only
with [[attr:Picker.multiple]] does it fire [[event:Picker.change]].

```ts
import { PickerOptions } from "@getaster/elements";

// A short list: every person, loaded on first open.
const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });
html`<aster-picker .model=${edit} .field=${"assigneeId"} .options=${people} .labelled=${true}></aster-picker>`;

// A large set with columns, headings and Create.
const clients = new PickerOptions(ctx, {
  set: "Clients",
  columns: ["city", "industry"],
  widths: { city: "minmax(6rem, 0.8fr)", industry: "minmax(7rem, 1fr)" },
  groupBy: "country",
  searchFields: ["name", "city"],
  create: ["city", "country", "industry"],
});
html`<aster-picker .model=${edit} .field=${"clientId"} .options=${clients} .labelled=${true}></aster-picker>`;
```

## method:Picker.focus

Focuses the input.

## attr:Picker.options

A [[class:Collection]] of the related records, or a [[class:PickerOptions]].
Default `undefined`: the list is empty. A collection suits a few hundred
records at most, since it loads whole; use `PickerOptions` above that.

## attr:Picker.display

With a plain [[class:Collection]]: the field of each record shown as its
name and searched by typing. Default `""`, which uses the type's title field
(`AsterData.TitleField`), then [[attr:Picker.valueField]]. Ignored with a
[[class:PickerOptions]], which has [[attr:OptionsSpec.display]].

## attr:Picker.valueField

The field of the chosen record written as the value. Default `""`, which
uses the record's key: the first key field of the options' entity type, or
`"id"` when there are no options yet. Set it only when the foreign key
refers to a field other than the key.

## attr:Picker.multiple

When `true`, the picker holds several values in [[attr:Picker.values]], shown
as chips in the frame, each with a Remove button ("Remove Ada Lovelace").
Choosing an option adds or removes it and leaves the list open, with chosen
options checked; the list is `aria-multiselectable`. Every change fires
[[event:Picker.change]]. The model isn't read or written. Default `false`.

```ts
import { signal } from "@preact/signals-core";

const chosen = signal<readonly Value[]>([]);
html`<aster-picker .multiple=${true} .label=${"People"} .options=${people} .values=${chosen.value}
  @change=${(e: CustomEvent<readonly Value[]>) => (chosen.value = e.detail)}></aster-picker>`;
```

## attr:Picker.values

The chosen keys, in the order chosen. Default `[]`. Set it to give the
starting values; the picker updates it on every change.

## attr:Picker.placeholder

Shown in the empty input. Default `""`, which shows "None" on a nullable
field or with `multiple`, and "Choose…" otherwise. Hidden once a `multiple`
picker has chips.

## event:Picker.change

Fires only with [[attr:Picker.multiple]], when an option is toggled, a chip
is removed (by its button or Backspace), or a created record is added.
`detail` is the new array of values, which [[attr:Picker.values]] already
holds. It bubbles.

## class:PickerOptions

Make one per source of options and share it: every picker that uses it reads
the same [[attr:PickerOptions.all]] collection, so the options load once.
It throws a `SchemaError` if `spec.set` isn't an entity set in the
service's metadata.

- `ctx`: the [[class:DataContext]].
- `spec`: the [[object:OptionsSpec]].

The picker uses everything here; an app usually only constructs it and
passes it to [[attr:Picker.options]] or [[attr:FormField.options]]. The
members are public for controls of your own.

```ts
import { PickerOptions } from "@getaster/elements";
import { computed } from "@preact/signals-core";

// Regions of the country chosen on this record, following it as it changes.
const regions = new PickerOptions(ctx, {
  set: "Regions",
  filter: computed(() => ({ op: "eq", field: "countryId", value: edit.values.value.countryId ?? null })),
  outside: "isn’t in this country.",
});
```

## attr:PickerOptions.ctx

The [[class:DataContext]] it was made with.

## attr:PickerOptions.spec

The [[object:OptionsSpec]] it was made with.

## attr:PickerOptions.type

The entity type of [[attr:OptionsSpec.set]], from the service's metadata.

## attr:PickerOptions.key

The name of the type's first key field: what a picker writes as the value.

## attr:PickerOptions.display

The field shown as each option's name: [[attr:OptionsSpec.display]], or the
type's title field, or [[attr:PickerOptions.key]].

## attr:PickerOptions.pageSize

[[attr:OptionsSpec.pageSize]], or `50`.

## attr:PickerOptions.all

A [[class:Collection]] over the spec's set, filter and order, with
[[attr:PickerOptions.pageSize]] records per page. It follows a filter signal
and [[attr:PickerOptions.sort]]. Its `count` decides
[[attr:PickerOptions.small]].

## attr:PickerOptions.sort

A signal holding the order chosen from the column headers, or `undefined`
for the spec's order. [[method:PickerOptions.sortBy]] sets it; setting it
directly re-orders every picker that uses these options.

## attr:PickerOptions.small

`false` until the count of [[attr:PickerOptions.all]] is known, so a picker
searches on the server until then. Reading it inside `render()` tracks the
count.

## method:PickerOptions.sortBy

The first press sorts ascending by `field`; pressing the same field again
toggles between descending and ascending. A different field starts
ascending. [[attr:OptionsSpec.groupBy]], when set, still comes first.

- `field`: the field to sort by, usually the display field or one of the
  columns.

## method:PickerOptions.tracks

Returns the CSS `grid-template-columns` value for the list: a `12px` check
column when `multiple` is true, then the name and each column, using
[[attr:OptionsSpec.widths]] where given, `minmax(0, 1.4fr)` for the name and
`minmax(0, 1fr)` for each column otherwise.

- `multiple`: whether the picker shows a check column.

## method:PickerOptions.query

Builds the [[object:Query]] for the options.

- `base`: the filter's current criteria, or `undefined`.
- `search`: typed text, optional. When given and not blank, each of
  [[attr:OptionsSpec.searchFields]] is matched with a case-insensitive
  `contains`, any field matching.

Returns a query over the spec's set whose filter is `base` and the search
together, ordered by [[attr:OptionsSpec.groupBy]] first and then by
[[attr:PickerOptions.sort]], the spec's `orderBy`, or the display field.
Called inside a `computed`, it tracks the sort.

## method:PickerOptions.search

Returns a new [[class:Collection]] whose query follows `search` and the
filter. A picker makes one when typed text needs the server, and releases it
when the list closes.

- `search`: a signal of the typed text.

Call [[method:PickerOptions.release]] when done with it, or its records stay
in use.

## method:PickerOptions.release

Releases a collection made by [[method:PickerOptions.search]], through
[[method:DataContext.release]]. Don't release [[attr:PickerOptions.all]],
which other pickers share.

- `collection`: the collection to release.

## method:PickerOptions.record

- `value`: a key value, as stored in the foreign key.

Returns a signal of the record, from the store or fetched (batched with
other lookups) through [[method:DataContext.lookup]]; it holds `undefined`
until the record arrives. Returns `undefined` itself for a `null` or
`undefined` value.

## method:PickerOptions.fits

Used to show [[attr:OptionsSpec.outside]].

- `entity`: the record, usually the current value's.

Returns `true` when there's no filter or the record matches it, and `false`
when it doesn't. Returns `undefined` when the filter can't be evaluated in
the browser, such as criteria over related records that aren't loaded; the
picker then says nothing.

## method:PickerOptions.text

The text of one field of a record, as an option shows it.

- `entity`: the record.
- `field`: the field. Default [[attr:PickerOptions.display]].

Returns the allowed value's label when the field has one, `""` for `null`,
and the value as text otherwise.

## object:OptionsSpec

Only [[attr:OptionsSpec.set]] is required. Give it to the
[[class:PickerOptions]] constructor.

```ts
const spec: OptionsSpec = {
  set: "People",
  display: "name",
  searchFields: ["name", "email"],
  columns: ["team"],
  orderBy: [{ field: "name" }],
  pageSize: 100,
};
```

## attr:OptionsSpec.set

The entity set the options come from, such as `"People"`. Its type's key is
what the picker writes.

## attr:OptionsSpec.filter

Plain [[type:Criteria]] fix the options. A signal of criteria re-queries
them whenever it changes; `undefined` from the signal means no filter. A
value the filter no longer allows stays in the field, with a hint
([[attr:OptionsSpec.outside]]).

```ts
filter: computed((): Criteria => ({ op: "eq", field: "projectId", value: scope.value("project.record.id").value as number })),
```

## attr:OptionsSpec.orderBy

[[object:SortKey]]s for the options. A person's choice from the column
headers replaces it until the options are made again.

## attr:OptionsSpec.display

Shown as the option's name in the list and in the input, and searched by
default.

## attr:OptionsSpec.searchFields

Typing matches any of them with `contains`. Default `[display]`. Searching
on the server needs the fields to support `contains` in the service's
`$filter`.

## attr:OptionsSpec.columns

Field names shown after the name, each with a sortable header labelled with
the field's title. Allowed values show their labels. Without columns, the
list has no header.

## attr:OptionsSpec.widths

Track sizes by field name, including the display field's, such as
`{ name: "minmax(0, 2fr)", city: "8rem" }`. Fields not listed share the
rest. See [[method:PickerOptions.tracks]].

## attr:OptionsSpec.groupBy

The options are sorted by this field first, and each run of options with the
same value gets a heading (`role="group"`, labelled by the heading). A record
with no value goes under "None".

## attr:OptionsSpec.pageSize

Records per page for the options and for each server search. Default `50`.
It also decides when typing searches on the server: when there are more
options than this.

## attr:OptionsSpec.create

The display field is always first in the form, filled with the typed text.
Fields with allowed values are selects, others text fields. The new record
is saved through an [[class:EditModel]] when the person presses Create, with
its validation; a failure shows in the form. Omit it to offer no Create.

## attr:OptionsSpec.outside

The hint starts with the current value's name, so write the rest of the
sentence: `"isn’t on this project’s team."`. Default "isn’t among the options
now.". It's part of the input's `aria-describedby`.

## class:TreePicker

Tag `aster-tree-picker`. Bind it with [[attr:BoundField.model]] and
[[attr:BoundField.field]] to the field that holds a node's key, and give it
[[attr:TreePicker.options]]. Use it where names repeat across branches, so a
flat list can't tell them apart. The closed control shows the chosen node's
name, with its path under it ("Client details › Trading address"); the path
is also the input's description ("In Client details, Trading address").

Opening reveals the chosen node, loading the levels above it. Typing filters
the tree, 200 ms after typing stops, to the matches and the folders leading
to them; folders that are there only as a path are drawn quieter. The first
match that can be chosen is active. The list says "Searching…", "Too many
matches; type more." or "Nothing matches “text”." as needed.

Keys: ↓/↑ open and move; Enter chooses (on a folder that can't be chosen, it
opens or closes it); Escape closes and puts back the name. Once ↓/↑ have
moved in the tree since the last typing, → opens a folder or moves into it,
← closes it or moves to its parent, and Home/End go to the first and last
row; before that, those keys move the caret in the input. The popup is
`role="tree"` with `treeitem` rows carrying `aria-level`, `aria-posinset`
and `aria-setsize`. Focus stays in the input; the active row is its
`aria-activedescendant`.

Each picker that opens gets its own [[class:Tree]] from its options, so which
folders are open is per picker; it's disposed when the element is removed.

```ts
import { TreeChoices } from "@getaster/elements";

const categories = new TreeChoices(ctx, {
  set: "Categories",
  parentField: "parentId",
  orderBy: [{ field: "name" }],
  choosable: (c) => c.kind !== "group",
});
html`<aster-tree-picker .model=${edit} .field=${"categoryId"} .options=${categories} .labelled=${true}></aster-tree-picker>`;
```

## method:TreePicker.focus

Focuses the input.

## attr:TreePicker.options

The [[class:TreeChoices]] the tree comes from. Default `undefined`: the
control doesn't open.

## attr:TreePicker.placeholder

Shown in the empty input. Default `""`, which shows "None" on a nullable
field and "Choose…" otherwise.

## class:TreeChoices

Make one per hierarchy and share it between tree pickers. It throws a
`SchemaError` if `spec.set` isn't an entity set in the metadata.

- `ctx`: the [[class:DataContext]].
- `spec`: the [[object:TreeChoicesSpec]].

A top-level node is one whose parent field holds the parent field's root
value (`AsterData.RootValue`), or `null` when the metadata gives none.

Besides feeding [[class:TreePicker]], [[method:TreeChoices.trail]] is useful
on its own for showing where a node sits:

```ts
const record = categories.record(task.categoryId)?.value;
const where = record ? [...categories.trail(record), categories.text(record)].join(" › ") : "";
```

## attr:TreeChoices.ctx

The [[class:DataContext]] it was made with.

## attr:TreeChoices.spec

The [[object:TreeChoicesSpec]] it was made with.

## attr:TreeChoices.type

The entity type of the set, from the metadata.

## attr:TreeChoices.key

The name of the type's first key field: what the tree picker writes.

## attr:TreeChoices.display

The field shown as a node's name: [[attr:TreeChoicesSpec.display]], or the
type's title field, or [[attr:TreeChoices.key]].

## method:TreeChoices.tree

- `search`: a signal of the typed text. When it isn't blank, the tree's
  filter matches any of the search fields with a case-insensitive
  `contains`.

Returns a new [[class:Tree]] over the set, ordered by
[[attr:TreeChoicesSpec.orderBy]]. Call its `dispose()` when done.

## method:TreeChoices.record

- `value`: a key value.

Returns a signal of the record, fetched if it isn't in the store, or
`undefined` for a `null` or `undefined` value.

## method:TreeChoices.text

Returns the record's display field as text, or `""` when it's empty. Unlike
[[method:PickerOptions.text]], it doesn't use allowed-value labels.

- `entity`: the record.

## method:TreeChoices.trail

- `entity`: the node.

Returns its ancestors' names, top level first, excluding the node itself.
An ancestor not yet in the store is fetched and shown as "…" (with nothing
above it) until it arrives; called inside `render()`, the trail fills in by
itself. A loop in the parent links ends the trail rather than hanging.

## method:TreeChoices.canChoose

- `entity`: the node.

Returns [[attr:TreeChoicesSpec.choosable]]'s answer, or `true` without one.

## method:TreeChoices.matches

Whether a node matches typed text, for drawing the folders on a match's path
quieter than the matches.

- `entity`: the node.
- `typed`: the text typed.

Returns `true` when any search field contains the text, ignoring case;
`false` for blank text.

## object:TreeChoicesSpec

Give it to the [[class:TreeChoices]] constructor. `set` and `parentField`
are required.

## attr:TreeChoicesSpec.set

The self-referencing entity set, such as `"Categories"`.

## attr:TreeChoicesSpec.parentField

Holds the parent's key, or the root value on a top-level node.

## attr:TreeChoicesSpec.display

Shown as the node's name and searched by default.

## attr:TreeChoicesSpec.searchFields

Typing matches any of them. Default `[display]`.

## attr:TreeChoicesSpec.orderBy

[[object:SortKey]]s applied within each level. Default none, which is the
server's order.

## attr:TreeChoicesSpec.choosable

Called with each node's record. A node it refuses is drawn as a group: Enter
or a click opens or closes it rather than choosing it. Use it for headings
that only organise, or to refuse a node and its descendants, such as when
choosing a new parent for a node.

```ts
choosable: (node) => node.kind === "question",
```

## class:DateField

Tag `aster-date`. Bind it with [[attr:BoundField.model]] and
[[attr:BoundField.field]] to an `Edm.Date` field. The value is the date as
`YYYY-MM-DD` text, with no time zone, as `Edm.Date` holds it.

Typing accepts the forms in [[staticMethod:parseDate]] and writes the date
as it's typed: a recognised date as `YYYY-MM-DD`, empty as `null`, and
anything else as the text, so the model's validation can say it isn't a
date. While the input has focus it shows exactly what was typed; on leaving
it shows the date as "7 Oct 2026". The placeholder is "None" on a nullable
field and "A date, like 7 Oct" otherwise.

The calendar button, named "Choose" and the label, opens a date-picker
dialog under the input (the WAI-ARIA APG date picker dialog). The month
heading is a polite live region, each day is named in full ("Wednesday 7
October 2026"), the chosen day is `aria-selected` and today
`aria-current="date"`. Keys in the grid: ←/→ move a day, ↑/↓ a week, Page
Up/Page Down a month and with Shift a year, Home/End go to Monday and Sunday
of the week, Enter or Space choose. Tab cycles through the year and month
buttons and the grid; Escape closes and returns focus to the button, and a
press outside closes it. Choosing a day writes it and returns focus to the
input. Read-only, there is no calendar button.

```ts
html`<aster-date .model=${edit} .field=${"due"} .labelled=${true}></aster-date>`;
```

## method:DateField.focus

Focuses the text input.

## staticMethod:formatDate

- `value`: a date as `YYYY-MM-DD`.

Returns the day without a leading zero, the English short month name and
the year. Text in any other form, including something typed that isn't a
date, comes back unchanged, so it's safe to call on whatever a date field
holds.

```ts
formatDate("2026-10-07"); // "7 Oct 2026"
formatDate("next week");  // "next week"
```

## staticMethod:parseDate

- `text`: what was typed. Case, extra spaces and commas don't matter.
- `thisYear`: the year for a date typed without one.

Two-digit years mean 20xx. A month name is matched on its first three
letters, so "Sept" and "September" both work, and a full stop after it is
allowed. Day-first numeric dates accept `/`, `.` or `-` between parts.
Returns the date as `YYYY-MM-DD`, or `undefined` when the text isn't a date
in one of these forms or names a day that doesn't exist (31 June).

```ts
parseDate("7/10/26", 2026);       // "2026-10-07"
parseDate("Oct 7", 2026);         // "2026-10-07"
parseDate("7 September", 2026);   // "2026-09-07"
parseDate("31 Jun 2026", 2026);   // undefined
```

## staticMethod:setClock

[[class:DateField]] and the calendar take "today" from it: for the year of a
date typed without one, and for the calendar's opening month and its
`aria-current` day. Today is the clock's date in UTC, so near midnight it
can differ from the person's local date.

- `clock`: returns the current time in milliseconds, like `Date.now`.

Call it once at start-up. A frozen clock makes tests and screenshots
repeatable.

```ts
import { setClock } from "@getaster/elements";

const frozen = Date.parse("2026-10-07T12:00:00Z");
setClock(() => frozen);
```

## class:Field

Tag `aster-field`. Bind it with [[attr:BoundField.model]] and
[[attr:BoundField.field]]. It shows the value through
[[staticMethod:formatValue]] and writes every keystroke back through
[[staticMethod:parseInput]]; while a decimal is typed it shows the typed text
rather than padding it. Numeric types get `inputmode="numeric"` (whole
numbers) or `"decimal"`, so a touch keyboard shows digits. An `Edm.String`
with no allowed values and a maximum length over 500 is a textarea that
grows with its text up to a maximum height, where the browser supports CSS
`field-sizing`.

Read-only by its state, the input is `readonly`: it takes focus, and its
reason can be read.

Without a model it shows [[attr:Field.value]], and typing changes the input
but not `value`. To follow typing in an unbound field, listen for the
native `input` event, which bubbles from the inner input.

```ts
// Bound, with a button beside it.
html`<aster-field .model=${invite} .field=${"name"} .label=${"Invite by name or email"}
  .placeholder=${"Name or email address"}
  .trailing=${html`<aster-button .type=${"submit"} .label=${"Invite"}></aster-button>`}></aster-field>`;

// Unbound and read-only: a link to copy.
html`<aster-field .value=${url} .readOnly=${true} .label=${"Share link"}></aster-field>`;
```

## method:Field.focus

Focuses the input or textarea.

## attr:Field.value

Used only when there's no model. Default `""`. Setting it re-renders the
input with the new text.

## attr:Field.placeholder

Shown in the empty input. Default `""` (none). Don't use it in place of a
label.

## attr:Field.readOnly

Makes the input `readonly` whether or not the field's state is read-only,
and selects the whole text on focus, ready to copy. Default `false`. It adds
no reason; for a reason, make the field read-only through the model's rules.

## attr:Field.keyboard

Any `inputmode` value: `"numeric"`, `"decimal"`, `"email"`, `"tel"`, `"url"`
or `"search"`. Default `""`, which uses the type's mode, if any.

```ts
html`<aster-field .model=${edit} .field=${"phone"} .keyboard=${"tel"}></aster-field>`;
```

## attr:Field.trailing

A template shown beside the frame, inside the same row, such as an Invite
or Copy button. The error and hint span under both. Default `nothing`.

## class:Switch

Tag `aster-switch`. Use it for settings that take effect at once, such as
"Allow comments" on a share link; for a Boolean in a form that's saved
together, use [[class:Check]]. Give it [[attr:Switch.binding]]; the record
must be in the store (loaded by a collection, a lookup or `reload`), or the
switch shows off.

Pressing the switch, or anywhere on its row, saves the new value through
[[method:DataContext.update]]. The switch shows the new state at once and is
`aria-busy` while the save runs; presses during the save are ignored. If the
save fails, the switch goes back and the row shows "Couldn’t turn this on:"
with the service's message and "It’s back as it was." under it, with
`role="alert"`. It's a `button` with `role="switch"` and `aria-checked`, so
Space and Enter toggle it. No event is raised: the store changes, and
everything showing the record follows.

```ts
import { keyText } from "@getaster/data";

const link = keyText([1]);
html`${["allowComments", "allowDownloads"].map(
  (field) => html`<aster-switch .binding=${{ ctx, set: "ShareLinks", key: link, field }}></aster-switch>`,
)}`;
```

## attr:Switch.binding

The record and field to toggle, as a [[object:SwitchBinding]]. Default
`undefined`, which renders nothing.

## attr:Switch.label

The row's text and the switch's accessible name. Default `""`, which uses
the field's title, then its name.

## object:SwitchBinding

Which stored record and field an [[class:Switch]] toggles.

## attr:SwitchBinding.ctx

The [[class:DataContext]] that holds the record and saves it.

## attr:SwitchBinding.set

The entity set, such as `"ShareLinks"`.

## attr:SwitchBinding.key

The record's key as [[type:KeyText]], made with `keyText([value])`.

## attr:SwitchBinding.field

An `Edm.Boolean` field. Any value but `true` shows as off.
