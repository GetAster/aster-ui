# Forms

`aster-form` lays out the fields of one [[class:EditModel]] from a description
of the arrangement. The page says which fields go in which section, how many
columns each section has, and which fields are wider than one column. It may
also override a field's label, help text, placeholder and editor. The form
takes everything else from the model and the service's metadata: the control
each field gets, its type, whether it is required, the allowed values, the
error under it, whether it is read-only or disabled and why, and whether it
has changed. A form doesn't save; the model does, with
[[method:EditModel.save]].

The configuration follows the three layers used across Aster UI: **policy
says may** ([[object:FormPolicy]] and each [[object:FormField]]'s static
defaults), **features say how** ([[type:FormFeature]]), and **chrome says
shown** ([[object:FormChrome]]). Scalars are sugar for those objects. Static
read-only, disabled and required values are defaults, not a second rule
system: [[method:EditModel.applyRules]] outranks them, and the metadata's
computed, immutable and non-nullable rules still apply. See
[Configuring a form](#configuring-a-form).

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
| A numeric type | `aster-number-field`, [[class:NumberField]] |
| Anything else | `aster-field`, [[class:Field]]: text, and a textarea for long text |

A [[object:FormField]] may replace that choice with [[attr:FormField.control]]:
a named editor (`"text"`, `"number"`, `"date"`, `"check"`, `"select"` or
`"picker"`) or a JavaScript renderer for a custom control.

Every one of them extends [[class:BoundField]], so each draws its own label,
"Optional" marker, hint, error, changed-value marking with Revert, and
"Hidden" box (see [[group:fields]]). `controlFor` never gives a tree picker;
place an `aster-tree-picker` yourself.

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

### Configuring a form

Three layers, one owner per value:

| Layer | Owns | Where |
|---|---|---|
| **Policy says may** | Static read-only and disabled defaults for the whole form, and each field's own read-only, disabled and required defaults | [[attr:Form.policy]], [[object:FormField]] |
| **Features say how** | When fields revalidate, and whether Enter saves | [[attr:Form.features]] |
| **Chrome says shown** | Default columns, title orientation, inline errors, the error summary and focus on the first invalid field | [[attr:Form.chrome]] |

Scalars are sugar for those structured objects:

| Sugar | Sets | Default |
|---|---|---|
| `form.readOnly` | `policy.readOnly` | `false` |
| `form.disabled` | `policy.disabled` | `false` |
| `form.columns` | `chrome.columns` | `2` |
| `form.titleOrientation` | `chrome.titleOrientation` | `"top"` |
| `form.showInlineErrors` | `chrome.showInlineErrors` | `true` |
| `form.errorSummary` | `chrome.errorSummary` | `false` |
| `form.autoFocus` | `chrome.autoFocus` | `false` |
| `form.validateOn` | a `validation` feature's `on` | `"submit"` |
| `form.saveOnEnter` | a `save` feature | `false` |

The structured form is the contract; JS and YAML spell it the same way when
the values are plain data. Renderers and callbacks — a field's `control`
renderer specifically — stay in JavaScript.

```ts
form.policy = { readOnly: true };
form.chrome = { columns: 3, errorSummary: true, autoFocus: true };
form.features = [{ kind: "validation", on: "exit" }, { kind: "save" }];
form.sections = [
  { title: "Basics", items: ["name", "state", { field: "behindDays", hint: "Only when status is behind", required: true }] },
];
```

```yaml
details:
  type: Form
  props:
    policy:
      readOnly: true
    chrome:
      columns: 3
      errorSummary: true
      autoFocus: true
    features:
      - kind: validation
        on: exit
      - kind: save
    sections:
      - title: Basics
        items:
          - name
          - state
          - field: behindDays
            hint: Only when status is behind
            required: true
```

Static defaults yield to page rules. A field a rule makes editable again is
editable even when `form.readOnly` is true; a rule that names `required`
decides in place of the field's static value. A computed or immutable field
stays read-only whatever the policy says — the metadata's ceilings are not a
default. The form passes its policy to [[method:EditModel.applyPolicy]]; a
model can be shared with other views, but only one form should own its
policy.

#### Validation display

- **When.** `validateOn` is `"submit"` by default: errors appear when the host
  calls [[method:EditModel.validate]] or [[method:EditModel.save]]. `"change"`
  revalidates a field after every edit, and `"exit"` when focus leaves it.
  These call [[method:EditModel.validateField]].
- **Inline errors.** `showInlineErrors` is `true` by default; `false` stops
  each field drawing its error, which still sets `aria-invalid` and still
  appears in the summary.
- **Summary.** `errorSummary` lists the model's field errors above the
  sections as a `role="alert"` region. Each entry is a button that focuses its
  field, opening a collapsed section first. It also shows
  [[attr:EditModel.formError]]. Element-level validation (a date outside its
  bounds, for example) stays under its field and is not in the summary.
- **First invalid.** `autoFocus` moves focus to the first invalid field when
  validation first finds errors. It doesn't move focus again until the errors
  clear, so typing doesn't lose its place. [[method:Form.focusFirst]] is the
  manual form of the same move.
- **Enter.** With a `save` feature, Enter in a single-line field emits the
  cancelable [[event:Form.form-submit]]; unless a listener prevents it, the
  model saves. Enter in a textarea, on a button, or on a combobox keeps its
  own meaning.

#### Layout

`chrome.columns` (or `form.columns`) is the column count for sections that
don't set [[attr:FormSection.columns]]. `chrome.titleOrientation` is `"top"`
(labels above their controls) or `"start"` (labels beside them). In `"start"`
mode the label column is the documented `--aster-form-label-width` variable,
default `9rem`; set it on the form or an ancestor to change the width. CSS
owns that geometry, so there is no `titleWidth` property. The existing
one-column fallback below 520 px still applies.

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
- A field's label, hint and placeholder can be overridden per screen, but its
  type, allowed values and rules still come from the metadata and the model.
  The static read-only, disabled and required flags are defaults, not rules.
- A custom `control` renderer is JavaScript only: the composition validator
  accepts the named editors and rejects a function. A renderer gets the field's
  context and a `write`; it is responsible for its own inner control's
  accessibility.
- A [[object:FormValue]] is text only, and is drawn read-only in a text field. It
  has no state, error or changed marking.
- Fields that need a control the form doesn't pick, such as a tree picker or a
  switch, are placed with their own elements outside the form, or in a section
  built by hand.
- The error summary lists the edit model's field errors. Validation a control
  does itself (a date's bounds, a number's step) stays under that control.

## class:Form

Tag: `aster-form`. Bind it with properties: `model`, `sections`, and optionally
`policy`, `features` and `chrome`. It draws nothing until it has a model. The
controls write to the model as the person types, and everything the page needs
to react to (`dirty`, `valid`, errors) is on the [[class:EditModel]]. The only
event is [[event:Form.form-submit]], from the `saveOnEnter` sugar.

The form re-renders as the model's state, pending flags, errors and each
[[object:FormValue]]'s signal change. It applies its [[attr:Form.policy]] to
the model as static defaults, and withdraws them when it disconnects.

Each [[object:FormSection]] becomes an `aster-section`: a heading (at
`headingLevel`) with a button that collapses it, whose body is a grid of its
items. See [[class:Section]] for the heading, the collapsing and the ARIA.
Every control is drawn with its label above it, or beside it with
[[attr:Form.titleOrientation]] `"start"`. A string item or
[[object:FormField]] gets a bound control; a [[object:FormValue]] gets a
read-only text field.

Keyboard behaviour is that of the controls inside, of each section's heading
button (Enter or Space collapses or opens it), and — with a `save` feature —
Enter in a single-line field (see [[attr:Form.saveOnEnter]]).

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

## attr:Form.policy

Static edit defaults for the whole form, as [[object:FormPolicy]]. Default
`{}`. The form passes them to [[method:EditModel.applyPolicy]]: they are
defaults, so a page rule that names an effect wins, a field's own
[[object:FormField]] default wins over the form-wide one, and the metadata's
computed, immutable and non-nullable rules still apply. Read-only fields
refuse writes; disabled fields do too, and leave the tab order.

```ts
form.policy = { readOnly: true };
form.policy = { disabled: true };
```

```yaml
details:
  type: Form
  props:
    policy:
      readOnly: true
```

## attr:Form.readOnly

Sugar for `policy.readOnly`. Default `false`. A field whose rule explicitly
sets read-only false, or whose FormField sets `readOnly: false`, is editable.

```ts
form.readOnly = true;
```

## attr:Form.disabled

Sugar for `policy.disabled`. Default `false`. A field whose rule explicitly
sets `enabled` (true or false), or whose FormField sets `disabled`, decides on
its own.

```ts
form.disabled = true;
```

## attr:Form.chrome

Which presentation surfaces the form shows, as [[object:FormChrome]]. Default
`{}`, which means two columns, labels above, inline errors, and no summary or
automatic focus.

```ts
form.chrome = { columns: 3, titleOrientation: "start", showInlineErrors: false, errorSummary: true, autoFocus: true };
```

## attr:Form.columns

Sugar for `chrome.columns`: the columns for sections that don't set
[[attr:FormSection.columns]]. Default `2`. A positive integer. Under 520 px of
form width every section is one column.

```ts
form.columns = 3;
```

## attr:Form.titleOrientation

Sugar for `chrome.titleOrientation`: `"top"` (the default) draws labels above
their controls; `"start"` draws them beside, in a column whose width is the
`--aster-form-label-width` variable (default `9rem`). The layout is CSS, not a
property that writes geometry.

```ts
form.titleOrientation = "start";
```

## attr:Form.showInlineErrors

Sugar for `chrome.showInlineErrors`. Default `true`. With `false`, a field
doesn't draw its error; it still sets `aria-invalid`, and the error still
appears in [[attr:Form.errorSummary]].

```ts
form.showInlineErrors = false;
```

## attr:Form.errorSummary

Sugar for `chrome.errorSummary`. Default `false`. When on, the model's field
errors are listed above the sections in a `role="alert"` region, each a button
that focuses its field (opening a collapsed section if needed). The model's
[[attr:EditModel.formError]] is included. A control's own validation, such as
a date outside its bounds, stays under the control and isn't listed.

```ts
form.errorSummary = true;
```

## attr:Form.autoFocus

Sugar for `chrome.autoFocus`. Default `false`. When validation first finds
errors, focus moves to the first invalid field. It doesn't move again until
the errors clear, so typing doesn't lose focus. The same move is available as
[[method:Form.focusFirst]].

```ts
form.autoFocus = true;
```

## attr:Form.features

How the form behaves, as [[type:FormFeature]] descriptors. Default `[]`, which
keeps submit-time validation and no Enter save. Object-only list;
[[attr:Form.validateOn]] and [[attr:Form.saveOnEnter]] are sugar for one
descriptor each.

```ts
form.features = [{ kind: "validation", on: "exit" }, { kind: "save" }];
```

## attr:Form.validateOn

Sugar for a `validation` feature's timing: `"submit"` (the default),
`"change"` or `"exit"`. `"submit"` removes the descriptor. With `"change"` a
field revalidates after every edit; with `"exit"`, when focus leaves it. Both
use [[method:EditModel.validateField]], so a field that becomes valid clears
its error at once.

```ts
form.validateOn = "exit";
```

## attr:Form.saveOnEnter

Sugar for a `save` feature: Enter in a single-line field saves the model.
Default `false`. The form emits the cancelable [[event:Form.form-submit]]
before saving; a listener's `preventDefault()` vetoes the save. Enter in a
textarea, on a button, link or combobox, or with a command modifier keeps its
usual meaning.

```ts
form.saveOnEnter = true;
form.addEventListener("form-submit", (event) => {
  if (!confirm("Save these changes?")) event.preventDefault();
});
```

## event:Form.form-submit

Fired before the `saveOnEnter` default action, bubbling and cancelable.
`detail` is a [[object:FormSubmitDetail]]. `preventDefault()` stops the save.
The model's own validation still decides whether anything is written.

```ts
form.addEventListener("form-submit", (event) => {
  if (!form.model?.dirty.value) event.preventDefault();
});
```

## object:FormPolicy

Static defaults for the whole form. Each is a default that page rules may
override; a field's own [[object:FormField]] flag overrides the form-wide one.

```ts
const policy: FormPolicy = { readOnly: true, disabled: false };
```

## object:FormChrome

The presentation surfaces the form shows. Every option is optional and keeps
today's rendering when absent.

- `columns?: number`: sections without their own columns use this. Default `2`.
- `titleOrientation?: "top" | "start"`: labels above or beside. Default `"top"`.
- `showInlineErrors?: boolean`: draw errors under their fields. Default `true`.
- `errorSummary?: boolean`: list errors above the sections. Default `false`.
- `autoFocus?: boolean`: focus the first invalid field when validation finds
  errors. Default `false`.

## type:FormFeature

One behaviour descriptor; it says how, never whether a presentation surface is
shown.

- `{ kind: "validation", on?: "change" | "exit" }`: revalidate a field after
  each edit, or when focus leaves it. Absent means validation happens when the
  host validates or saves.
- `{ kind: "save" }`: Enter in a single-line field saves the model, after the
  cancelable [[event:Form.form-submit]].

```ts
const features: FormFeature[] = [{ kind: "validation", on: "change" }, { kind: "save" }];
```

## object:FormSubmitDetail

What [[event:Form.form-submit]] carries.

## attr:FormSubmitDetail.model

The [[class:EditModel]] that would save.

## object:FormField

A field of the model with a width, options, presentation overrides or static
state defaults. A plain field name in [[attr:FormSection.items]] is the same
as `{ field: name }`.

```ts
const lead: FormField = {
  field: "leadId",
  span: 2,
  options: people,
  title: "Project lead",
  hint: "The person who answers for delivery",
  required: true,
};
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

## attr:FormField.title

A label override for this screen. Default: the field's title from metadata,
then the field name. It sets [[attr:BoundField.label]].

```ts
const item: FormField = { field: "name", title: "Project name" };
```

## attr:FormField.hint

Help text under the control. It sets [[attr:BoundField.hint]], is included in
the control's `aria-describedby`, and doesn't replace the error.

```ts
const item: FormField = { field: "budget", hint: "Excluding tax" };
```

## attr:FormField.placeholder

Placeholder text for the controls that have one: text, number, date, select
and picker. Checkboxes ignore it. Default: the control's own placeholder.

```ts
const item: FormField = { field: "name", placeholder: "Brand refresh" };
```

## attr:FormField.readOnly

A static read-only default for this field. Page rules override it; computed
and immutable fields stay read-only whatever it says. Default: the form's
[[attr:Form.policy]].

```ts
const item: FormField = { field: "budget", readOnly: true };
```

## attr:FormField.disabled

A static disabled default for this field. A page rule that names `enabled`
overrides it. Default: the form's [[attr:Form.policy]].

```ts
const item: FormField = { field: "budget", disabled: true };
```

## attr:FormField.required

A static required default for this field. A page rule that names `required`
overrides it, and a non-nullable field is required anyway. Default `false`.
A required field is checked by [[method:EditModel.validate]] and by
[[method:EditModel.validateField]] when the form validates on change or exit.

```ts
const item: FormField = { field: "behindDays", required: true };
```

## attr:FormField.control

A typed editor override. A name picks one of the form's controls regardless of
the field's metadata; a function renders a custom editor and is JavaScript
only — the composition validator rejects it.

The names are `"text"`, `"number"`, `"date"`, `"check"`, `"select"` and
`"picker"`. The control still reads and writes the field's value using the
field's metadata type. A picker without `options` shows an empty list.

A custom renderer receives a [[object:FormControlContext]] and returns a
lit-html view. Use `context.id` for the control's element, `context.describedBy`
and `context.invalid` for its ARIA, and `context.write` to write a value; the
model refuses writes to a read-only or disabled field. The frame, label, hint
and error remain the form's.

```ts
const rating: FormField = {
  field: "hue",
  control: (c) => html`<input id=${c.id} type="range" min="0" max="359"
    aria-invalid=${c.invalid ? "true" : nothing} aria-describedby=${c.describedBy ?? nothing}
    .value=${String(c.value ?? 0)} @input=${(e) => c.write(Number(e.target.value))}>`,
};
```

```yaml
items:
  - field: state
    control: text
```

## type:FormControl

A typed editor override: a [[type:FormControlName]] or a
[[type:FormControlRender]]. Plain data in a composition catalog means the name
form only.

## type:FormControlName

One of `"text"`, `"number"`, `"date"`, `"check"`, `"select"` or `"picker"`.

## type:FormControlRender

A function from a [[object:FormControlContext]] to a lit-html view. JavaScript
only.

## object:FormControlContext

What a custom editor gets: the bound field's [[object:ControlContext]] plus
the member below.

## attr:FormControlContext.write

Writes a value to the model's field. A read-only or disabled field refuses it
with an error, so a renderer needn't check the state first. Call it from the
control's input handler; the form re-renders from the model.

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

How many equal columns the section's grid has. Default: [[attr:Form.columns]],
which is `2` unless the form sets another count. Under 520 px of form width it
is 1.

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
- `opts.sharedReasons`: a map from a read-only or disabled reason to the id of
  an element that shows it once. A control whose reason is in the map points to
  that element instead of repeating the reason. Default: none.
- `opts.title`: a label override, passed to [[attr:BoundField.label]].
- `opts.hint`: help text, passed to [[attr:BoundField.hint]].
- `opts.placeholder`: passed to the controls that have one.
- `opts.control`: a [[type:FormControl]] override; a function renders an
  `aster-custom-field`.
- `opts.validateOn`: `"submit"` (default), `"change"` or `"exit"`, passed to
  [[attr:BoundField.validateOn]].
- `opts.showErrors`: whether to draw the error under the control. Default
  `true`, passed to [[attr:BoundField.showErrors]].

Returns a `TemplateResult` for one of `aster-picker`, `aster-check`,
`aster-select`, `aster-date`, `aster-number-field`, `aster-field`, or — for a
renderer override — `aster-custom-field` (see the order in the topic above).
It never returns a tree picker. Nothing is rendered until the template is. The
control isn't tracked or cached: call it again on each render, as the form does.
Importing it registers those elements.

```ts
import { html } from "lit-html";
import { controlFor } from "@getaster/elements";

const cell = (edit: EditModel, field: string) =>
  html`<td>${controlFor(edit, field, { labelled: false })}</td>`;
```
