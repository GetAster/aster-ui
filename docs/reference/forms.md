# Forms

`aster-form` lays out the fields of one [[class:EditModel]] from a description
of the arrangement alone. The page says which fields go in which section, how
many columns each section has, and which fields are wider than one column. The
form takes everything else from the model and the service's metadata: which
control each field gets, its label, its type, whether it is required, the
allowed values, the error under it, whether it is read-only and why, and
whether it has changed. A form doesn't save; the model does, with
[[method:EditModel.save]].

The pieces are:

- [[class:Form]], the element, with a `model` and `sections`.
- [[object:FormSection]], one titled, collapsible group of fields. A section is
  drawn by an [[class:Section]] (see [[group:layout]]).
- [[type:FormItem]], one entry of a section: a field name, a
  [[object:FormField]] to give it a width or a list of options, or a
  [[object:FormValue]] to show a computed figure beside the fields.
- [[staticMethod:controlFor]], the function that picks a control for a field.
  The form uses it for every field, and so do the list editor and the rule
  editor (see [[group:lists]]). Call it yourself to build a layout of your own.

### Which control a field gets

`controlFor` chooses from the field's metadata, in this order:

| The field | Control |
|---|---|
| Has `options` given for it (a foreign key) | `aster-picker`, [[class:Picker]] |
| Is `Edm.Boolean` | `aster-check`, [[class:Check]] |
| Has allowed values (`Validation.AllowedValues`) | `aster-select`, [[class:Select]] |
| Is `Edm.Date` | `aster-date`, [[class:DateField]] |
| Anything else | `aster-field`, [[class:Field]]: text, numbers, and a textarea for long text |

Every one of them extends [[class:BoundField]], so each draws its own label,
"Optional" marker, error, changed-value marking with Revert, and "Hidden" box
(see [[group:fields]]). `controlFor` never gives a tree picker; place an
`aster-tree-picker` yourself.

### What the form shows for you

- **Changes.** A collapsed section shows how many of its fields have changed
  since the record was loaded, "1 change" or "3 changes", beside its heading.
  Only fields count, not [[object:FormValue]]s.
- **Errors.** A section holding an invalid field opens itself, and can't be
  held closed while the field is invalid. [[method:Form.focusFirst]] moves focus
  to the first such field, which is the form's part of "show me what's
  wrong" after a failed save.
- **One reason, once.** When several visible read-only fields have the same
  reason (an archived project, say), the reason shows once above the sections as
  a hint, and each of those fields points to it with `aria-describedby`, instead
  of repeating it under every field. A reason that applies to one field stays
  with that field.
- **Hidden fields.** A field whose state is not visible (see
  [[method:EditModel.state]]) draws nothing.
- **Narrow containers.** The columns come from CSS: `--columns` on each section
  and `--span` on each field. When the form itself is 520 px wide or less, by a
  container query and not the viewport's width, every section is one column and
  every span is 1.

### Example

A project form, as the demo's project page lays it out: a name across two
columns, a lead chosen by name, a client chosen from a large set by server-side
search, and a budget section with a derived figure.

```ts
import { computed } from "@preact/signals-core";
import { html, render } from "lit-html";
import { EditModel, type DataContext, type KeyText } from "@getaster/data";
import { PickerOptions, type FormSection } from "@getaster/elements";
import "@getaster/elements";

declare const ctx: DataContext;
declare const key: KeyText;

const edit = new EditModel(ctx, "Projects", key);
const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });
await people.loadAll();
const clients = new PickerOptions(ctx, { set: "Clients", searchFields: ["name", "city"] });

const left = computed(() => {
  const v = edit.values.value;
  return v.budget === null || v.spent === null ? "" : String(Number(v.budget) - Number(v.spent));
});

const sections: FormSection[] = [
  { title: "Basics", columns: 2, items: [{ field: "name", span: 2 }, { field: "leadId", options: people }, "state", { field: "clientId", options: clients }] },
  { title: "Schedule", columns: 2, items: ["health", "behindDays"] },
  { title: "Budget", columns: 3, open: false, items: ["budget", "spent", { title: "Left", value: left }] },
];

render(
  html`<aster-form .model=${edit} .sections=${sections} .headingLevel=${3}></aster-form>
    <button type="button" @click=${() => void edit.save()}>Save</button>`,
  document.body,
);
```

### Limits

- The grid is a CSS grid with equal columns. There is no way to give a column a
  width, to put a field in a specific column, or to nest sections.
- A field's label, type and rules come from the metadata and the model, never
  from the form. To change a label for one screen, use a bound field directly
  with its `label` (see [[attr:BoundField.label]]).
- A [[object:FormValue]] is text only, and is drawn read-only in a text field. It
  has no state, error or changed marking.
- Fields that need a control the form doesn't pick, such as a tree picker or a
  switch, are placed with their own elements outside the form, or in a section
  built by hand.

## class:Form

Tag: `aster-form`. Bind it with properties: `model` and `sections`. It draws
nothing until it has a model. It has no events of its own: the controls write to
the model as the person types, and everything the page needs to react to
(`dirty`, `valid`, errors) is on the [[class:EditModel]].

The form re-renders as the model's state, pending flags and each
[[object:FormValue]]'s signal change.

Each [[object:FormSection]] becomes an `aster-section`: a heading (at
`headingLevel`) with a button that collapses it, whose body is a grid of its
items. See [[class:Section]] for the heading, the collapsing and the ARIA.
Every control is drawn with its label above it. A string item or
[[object:FormField]] gets a bound control; a [[object:FormValue]] gets a
read-only text field.

Keyboard behaviour is that of the controls inside and of each section's heading
button (Enter or Space collapses or opens it). The form adds no keys of its own.

```html
<aster-form id="project"></aster-form>
<script type="module">
  const form = document.querySelector("#project");
  form.model = edit; // an EditModel made elsewhere
  form.sections = [{ title: "Basics", items: ["name", "state"] }];
</script>
```

## method:Form.focusFirst

No parameters. Returns nothing.

Focuses the first element inside the form with `aria-invalid="true"`; when none
is invalid, the first editable input, textarea or combobox. Read-only controls
are skipped. Nothing happens if the form hasn't rendered or has nothing to focus.
A control in a section that is still collapsed can't take focus until the section
has opened itself, which it does after the next render.

[[method:EditModel.save]] resolves to `undefined` when it didn't save, including
when validation failed, so this focuses the first problem after a failed save.

```ts
const saved = await edit.save();
if (!saved) form.focusFirst();
```

## attr:Form.model

The [[class:EditModel]] the fields are bound to. Default `undefined`: the form
draws nothing. Reactive. Setting a different model rebinds every control.

## attr:Form.sections

An array of [[object:FormSection]]s, drawn in order. Default `[]`. Reactive, but
the array is compared by identity: to change the layout, set a new array
rather than editing the old one.

## attr:Form.headingLevel

The level of the sections' headings in the page's outline: `2`, `3` or `4`.
Default `2`. Pass it to [[attr:Section.level]]. Reactive.

## object:FormField

A field of the model with a width or options. A plain field name in
[[attr:FormSection.items]] is the same as `{ field: name }`.

```ts
const lead: FormField = { field: "leadId", span: 2, options: people };
```

## attr:FormField.field

The name of a field of the model's entity type, such as `"name"` or `"leadId"`.
It is passed to [[staticMethod:controlFor]] as `name`.

## attr:FormField.span

How many of the section's columns the field takes. Default `1`. A span greater
than the section's `columns` is capped at it. In a form 520 px wide or narrower,
every span is 1.

## attr:FormField.options

Makes a foreign-key field a picker: a [[class:Collection]] for a short list that
loads whole, or a [[class:PickerOptions]] for search, columns and "Create …"
(see [[group:fields]]). A field with `options` is always a picker, even if its
type is Boolean or it has allowed values. Without `options`, a foreign key is
drawn as a plain text field of its raw key, so a foreign key almost always needs
this.

## type:FormItem

An entry in [[attr:FormSection.items]]: a field name (`string`), a
[[object:FormField]], or a [[object:FormValue]]. The form tells a
`FormValue` from a `FormField` by the presence of a `value` property, so a
`FormField` can't have one.

```ts
const items: FormItem[] = ["name", { field: "leadId", options: people }, { title: "Left", value: left }];
```

## object:FormSection

One collapsible group of fields. Its title is its heading.

```ts
const budget: FormSection = { title: "Budget", columns: 3, open: false, items: ["budget", "spent", { title: "Left", value: left }] };
```

## attr:FormSection.title

The section's heading. Required. Shown as the [[attr:Section.heading]].

## attr:FormSection.columns

How many equal columns the section's grid has. Default `2`. Under 520 px of form
width it is 1.

## attr:FormSection.open

`false` starts the section collapsed. Default `true`. It is applied when the
form first draws the section, and again only if the value given changes; the
person's own opening and closing is otherwise kept. An invalid field opens the
section whatever this says. A collapsed section's heading shows how many of its
fields have changed.

## attr:FormSection.items

The section's contents, as [[type:FormItem]]s, in order, filling the grid left
to right and wrapping by `columns`.

## object:FormValue

A figure shown read-only among the fields, such as a total derived from other
fields. It is drawn as a read-only text field with `title` as its label. It isn't
bound to the model: nothing is saved from it, it has no error or changed marking,
and it isn't counted in the section's "n changes".

```ts
const left = computed(() => String(Number(edit.values.value.budget) - Number(edit.values.value.spent)));
const item: FormValue = { title: "Left", value: left, span: 1 };
```

## attr:FormValue.title

The label shown above the value. Required.

## attr:FormValue.value

A signal of the text to show, for example from `computed`. The form reads it
while rendering, so the figure updates as the signal changes. A signal of a
string, not a number: format it yourself, such as with `compactMoney`.

## attr:FormValue.span

How many of the section's columns the value takes. Default `1`.

## staticMethod:controlFor

Returns the lit-html template of the control for one field. Use it to lay out
fields yourself in the way the form does, in a table cell or a card.

- `model`: the [[class:EditModel]] the field belongs to.
- `name`: the field's name. The control is chosen from `model.type`'s metadata for it.
- `opts.options`: a [[class:Collection]] or [[class:PickerOptions]]. When given,
  the control is always a picker.
- `opts.labelled`: required. `true` shows the label above the control; `false`
  keeps it as the accessible name only, as in a table cell where a column header
  already says it.
- `opts.span`: a column span, written as the `--span` custom property on the
  control. It matters only inside the form's grid.
- `opts.sharedReasons`: a map from a read-only reason to the id of an element
  that shows it once. A control whose reason is in the map points to that element
  instead of repeating the reason. Default: none.

Returns a `TemplateResult` for one of `aster-picker`, `aster-check`,
`aster-select`, `aster-date` or `aster-field` (see the order in the topic above).
It never returns a tree picker. Nothing is rendered until the template is. The
control isn't tracked or cached: call it again on each render, as the form does.
Importing it registers those five elements.

```ts
import { html } from "lit-html";
import { controlFor } from "@getaster/elements";

const cell = (edit: EditModel, field: string) =>
  html`<td>${controlFor(edit, field, { labelled: false })}</td>`;
```
