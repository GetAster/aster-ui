# Compose fields and layouts

Related inputs, collapsible settings and resizable panes appear throughout
business applications. Aster supplies their field state, keyboard operation and
theme treatment so each screen can focus on its data and workflow.

Try the [interactive example](../playground/foundations.html). It includes exact
numeric values, a model-bound group, nested splits, lazy accordion panels,
breadcrumbs and cards that retain their inputs when reordered.

## Group related model fields

Budget and spend remain separate OData properties. A CompositeField gives them
a shared label, instructions and group revert while each child keeps its own
validation, pending state and field rules.

```ts
import { html } from "lit-html";
import "@getaster/elements";
import type { EditModel } from "@getaster/data";

declare const project: EditModel;
const finances = html`
  <aster-composite-field
    .model=${project}
    .fields=${["budget", "spent"]}
    .label=${"Project finances"}
    .help=${"Amounts in GBP"}
    .content=${html`
      <aster-number-field .model=${project} .field=${"budget"}
        .labelled=${true} .prefixText=${"£"}></aster-number-field>
      <aster-number-field .model=${project} .field=${"spent"}
        .labelled=${true} .prefixText=${"£"}></aster-number-field>
    `}
  ></aster-composite-field>`;
```

Use `disabled` to lock the group. `readOnly` locks native template controls too;
an application-value renderer receives read-only intent and must honor it. Group
revert only acts on named, visible, writable fields. Hiding and read-only rules
remain the model's responsibility; use ordinary bound controls to enforce them.

## Compose an application value

A structured value can belong to the application rather than a scalar model
property. The renderer receives that value and an explicit commit callback:

```ts
const dimensions = html`<aster-composite-field
  .label=${"Dimensions"}
  .value=${{ width: "20", height: "10" }}
  .renderValue=${({ value, commit, readOnly }) => html`
    <aster-number-field .label=${"Width"} .labelled=${true}
      .value=${value.width} .readOnly=${readOnly}
      @value-change=${(e: CustomEvent) => commit({ ...value,
        width: e.detail.value })}></aster-number-field>
    <aster-number-field .label=${"Height"} .labelled=${true}
      .value=${value.height} .readOnly=${readOnly}
      @value-change=${(e: CustomEvent) => commit({ ...value,
        height: e.detail.value })}></aster-number-field>`}
  @value-change=${(e: CustomEvent) => console.log(e.detail.value)}
></aster-composite-field>`;
```

The value is retained on the element and reported through `value-change`. The
host maps it to persistence explicitly. There is no implicit object-to-string
codec. Give every child an accessible label; the group legend does not replace
the child labels. Renderer callbacks in YAML are references to registered code.

## Keep numbers exact

NumberField uses text input with a numeric mobile keyboard, preserving incomplete
input while editing. Decimal and Int64 values stay as strings. Stepping uses exact
decimal arithmetic, including values beyond JavaScript's safe integer range.

```ts
const price = html`<aster-number-field
  .label=${"Unit price"} .labelled=${true}
  .value=${"9007199254740993.25"}
  .min=${"0"} .step=${"0.05"} .stepButtons=${true}
  .prefixText=${"£"}
></aster-number-field>`;
```

An explicit step validates alignment. Without a step constraint, fractions are
allowed; step actions use metadata scale, or one. Up/Down step when step buttons
are enabled. Mouse-wheel scrolling does not change values. Invalid text remains
visible, and empty input becomes null. Input uses canonical decimal notation;
localized grouping separators are not parsed. Affixes are presentation only.
An optional `format(value)` callback formats the unfocused display; focus reveals
the raw editable value. Formatting never changes the model value. Bound Decimal
fields use metadata scale for their default display.

Metadata chooses NumberField automatically in forms and grid editors, after
picker and allowed-value selection. The EditModel owns save validation. If an
application sets additional presentation constraints such as `step`, it must
also express the business rule in the EditModel's `rules` and server validation;
a DOM control is not the authority for whether a record can be saved.

## Arrange content with CSS layouts

```ts
const toolbar = html`<aster-horizontal-layout .gap=${"medium"}
  .align=${"center"} .wrap=${true}
  .content=${html`<strong>Project settings</strong><button>Save</button>`}
></aster-horizontal-layout>`;
```

HorizontalLayout, VerticalLayout and Stack share `direction`, `gap`, `align`,
`justify`, `wrap`, `responsive` and `content`. Horizontal layouts become vertical
in containers of 520px or less unless `responsive=false`. Use ordinary CSS flex
properties on children; `--stack-grow` and `--stack-basis` are convenience
variables. Supply a height when the layout must fill a bounded region.

Split keeps two panes mounted while resizing or collapsing:

```ts
const workspace = html`<aster-split .label=${"Resize navigation"}
  .size=${280} .min=${180} .max=${520} .collapsible=${true}
  .start=${html`<nav aria-label="Projects">…</nav>`}
  .end=${html`<article>…</article>`}
></aster-split>`;
```

Set `orientation="vertical"` as a property for stacked panes and use Up/Down on
the separator. Side-by-side splits use Left/Right, following text direction.
Home/End select size limits; Enter toggles an enabled collapse. Escape cancels a
pointer resize. `size` is axis-neutral; existing `width` usage still works.
`persist` optionally saves the preferred size on this browser.

Nested splits support more panes. Horizontal splits adapt to their own width at
720px; `responsive=false` retains resizing in narrow regions. A vertical split
needs a bounded height. Content, focus and drafts survive layout changes.

## Reveal settings progressively

```ts
const settings = html`<aster-accordion .expanded=${["general"]}
  .items=${[
    { id: "general", heading: "General", body: html`<p>Settings…</p>` },
    { id: "notes", heading: "Notes", create: () => html`
      <label>Private note<textarea></textarea></label>` },
  ]}
></aster-accordion>`;
```

`create` runs synchronously once when first expanded; its template remains
mounted until the item is removed. Use composition lifecycles for asynchronous
modules or owned resources. Set `multiple=true` to allow several user-expanded
panels. Newly invalid mounted fields can open additional panels in either mode.
For errors in an uncreated lazy body, the owner maps model errors to `expanded`
IDs before focusing the invalid field. Header arrow keys, Home and End navigate within the accordion.

## Show location and related items

```ts
const path = html`<aster-breadcrumbs .items=${[
  { id: "home", label: "Workspace", href: "/workspace" },
  { id: "projects", label: "Projects", href: "/projects" },
  { id: "current", label: "Spring launch" },
]}></aster-breadcrumbs>`;
```

The last item is current. Overflow puts intermediate ancestors in a menu.
Links preserve normal browser behavior; action items can provide an `activate`
callback. The cancellable `navigate` event reports the item ID. The component
does not implement routing or permission checks.

In the live **Location and context** example, breadcrumb actions, child buttons
and Back call one `showLocation` action. It updates the visible hierarchy and
breadcrumb items from the same path. Selecting an ancestor directly or through
overflow changes the view; the final breadcrumb always names the current view.
The host retains folder notes when an ancestor jump removes their editors.

Carousel accepts optional stable `id` values on slides. Supply them for dynamic
lists so card DOM and input state survive reordering. Previous/Next and touch
scrolling work in either text direction. There is no automatic rotation.

## Use these controls from YAML

Select the public contracts for your registry:

```ts
const components = {
  NumberField: asterComponents.NumberField,
  CompositeField: asterComponents.CompositeField,
  HorizontalLayout: asterComponents.HorizontalLayout,
  Split: asterComponents.Split,
  Accordion: asterComponents.Accordion,
  Breadcrumbs: asterComponents.Breadcrumbs,
  Carousel: asterComponents.Carousel,
};
```

The registry validates properties and provides editor schema/completion through
the existing [workspace tooling](workspace-tooling.md). Templates, factories and
value renderers stay in registered JS/TS. Layout controls do not replace the
composition owner's activation, guards and disposal policies.

## Preview contextual navigation

Import `ContextualHierarchy` from `@getaster/elements-preview` and its
`styles/hierarchy.css`. Supply `levels` with stable IDs, titles and content.
Appending a level retains prior DOM and drafts; removing the current level
restores the previous invoking control and scroll. The `back` event requests an
ancestor ID; the host completes guards and updates levels. Use
`navigate(levels, event.currentTarget)` when opening a level from a control so
focus returns to the actual opener, including in Safari.

Levels removed from the array lose their DOM. Use KeyedSessions/CompositeSessions
in the host when application resources or drafts must outlive that removal.
Register it explicitly with `compositeElement(ContextualHierarchy)` to use its
property contract in JS/YAML composition; it is absent from `asterComponents`.
Browser history is host-owned. This remains a preview without an automatic
routing bridge. Directional entry motion is optional, as described below.

### Choose resources while browsing folders

The **Choose files and folders** section of the
[live example](../playground/foundations.html#folder-picker-heading) demonstrates
the selection-oriented version. Choose a row to select a source; use its chevron
to open a folder. The selected-source tray persists across locations. Back,
Forward and breadcrumbs navigate without clearing choices. An empty folder can
be chosen with Choose this folder.

This is a host-owned recipe. It supplies a cancellable `children(id, signal)`
provider, confirmed listing cache, history and per-location return positions.
While loading, the old listing stays usable. Failed loads retain location and
selection and offer Retry. A newer navigation cancels the older request. The
example's source includes these handlers directly; replace the simulated
provider with your authorized service or data-layer adapter.

Use `navigationVisible=false` when supplying a toolbar around the hierarchy.
`motion="slide"` enables a short directional entry transition; the default is
`none`, and reduced-motion preferences disable it automatically. Neither option
handles routing or grants access to files. The example does not read local files.

Folders-only mode demonstrates eligibility separately from existing selection:
selected files stay visible for explicit removal and Use remains unavailable
until the selection meets the policy.

See [CompositeField](../reference/#class:CompositeField),
[NumberField](../reference/#class:NumberField) and
[Split](../reference/#class:Split) for their public contracts.
