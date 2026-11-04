# Fields and layout composition

Related inputs, flexible layouts and progressive navigation. See the
[guide](../guide/fields-and-layouts.md) and
[interactive example](../playground/foundations.html).

## class:CompositeField

Tag `aster-composite-field`. A labelled fieldset for related editors.

| Property | Type / default | Meaning |
|---|---|---|
| `model` | `EditModel` or undefined | Borrowed edit model for named fields |
| `fields` | readonly string[], `[]` | Unique model fields included in group revert/state |
| `label` | string, empty | Fieldset legend |
| `help`, `error` | string, empty | Group instruction/error, referenced by the fieldset |
| `disabled`, `readOnly` | boolean, false | Lock group; renderers must honor read-only intent |
| `content` | View, nothing | Model-bound editors |
| `value` | application value | Explicit structured/unbound value |
| `renderValue` | callback or undefined | `(CompositeFieldContext) => View` |

`value-change` reports `{value}` after a renderer commit. Each child needs its own
accessible name. Model fields retain their own errors and rules. The group
borrows the model and never saves/disposes it. `content` and `renderValue` are
alternative authoring paths; a renderer takes precedence when supplied.

## method:CompositeField.revert

Reverts only named, visible, writable model fields and clears their forced-pending
marks. Does nothing while the group is disabled/read-only. Application-value mode
does not have an implicit baseline.

## method:CompositeField.focus

Focuses the first invalid control, otherwise the first editable control. Accepts
standard FocusOptions. The legend/group itself is not an extra tab stop.

## object:CompositeFieldContext

`value`, `disabled`, `readOnly`, and `commit(value)`. Commits retain the value and
emit `value-change`; commits are ignored while disabled/read-only. Application
code owns validation, codecs and persistence for structured values.

## class:NumberField

Tag `aster-number-field`. Extends [[class:BoundField]] and shares its model,
field, label, pending/revert, hidden-value and error presentation.

| Property | Type / default | Meaning |
|---|---|---|
| `value` | string, number or null; null | Standalone entered value |
| `numericType` | decimal/integer/float; decimal | Standalone numeric policy; bound metadata takes precedence |
| `min`, `max` | numeric string/number or undefined | Additional inclusive bounds; cannot loosen metadata bounds |
| `step` | positive numeric string/number or undefined | Optional alignment constraint |
| `stepButtons` | boolean, false | Named decrease/increase actions and Up/Down input handling |
| `prefixText`, `suffixText` | string, empty | Presentation affixes outside the editable value |
| `placeholder` | string, empty | Empty-value hint |
| `readOnly` | boolean, false | Additional read-only intent |
| `format` | `(value) => string` or undefined | Display formatter while unfocused; focus edits the raw value |

An explicit step uses min (or zero) as the alignment origin. Without a constraint,
step actions use metadata scale or one. Off-grid values move to the next grid
point; actions disable at bounds. Decimal/Int64 operations are exact. No mouse-wheel
stepping, localized grouping parsing, or numeric ARIA value rounding. Integer
types require integer values/steps. Input remains text for exact values and
native text-editing behavior. Empty becomes null; invalid/intermediate text is
retained. `value-change` reports `{value}`; bound controls also write their model.

Control-specific errors are presentation validation. Business constraints needed
for save must also exist in model rules/server metadata. A control does not
silently add or remove business validation as it mounts/unmounts.

## class:Stack

Tag `aster-stack`. CSS flex layout, vertical by default, without an implicit role.

| Property | Values / default |
|---|---|
| `direction` | horizontal, vertical; vertical |
| `gap` | none, small, medium, large; medium |
| `align` | stretch, start, center, end, baseline; stretch |
| `justify` | start, center, end, space-between, space-around; start |
| `wrap` | false |
| `responsive` | true |
| `content` | View; nothing |

Responsive horizontal content stacks below 520px of container width. Child
`--stack-grow` (default 0), `--stack-basis` (auto), or ordinary CSS flex properties
control growth and basis. Gap uses theme spacing. CSS owns all layout.

## class:HorizontalLayout

Tag `aster-horizontal-layout`. Same contract as [[class:Stack]], with direction
horizontal by default. All properties are registered for composition.

## class:VerticalLayout

Tag `aster-vertical-layout`. Same contract as [[class:Stack]], with direction
vertical by default.

## class:Accordion

Tag `aster-accordion`. Coordinates retained [[class:Section]] panels.

`items` is an array of [[object:AccordionItem]]; `expanded` is an array of
stable IDs, default empty; [[attr:Accordion.visibilityMode]] defaults `"mutex"`
(one open at a time), with [[attr:Accordion.multiple]] as its boolean shorthand;
`headingLevel` is 2, 3 or 4 (default 2). Programmatic expanded lists may
include several panels. Mutex mode constrains user toggles. New errors in
mounted controls may reveal additional panels in either mode. The host maps
model errors to expanded IDs for uncreated lazy bodies.
`expanded-change` reports `{expanded, reason}` (user/error).

Three capabilities add controls, all off by default so an unconfigured
accordion renders exactly as before: [[attr:Accordion.canClose]] gives every
item a close control, [[attr:Accordion.canReorder]] gives every enabled item
Move up/down controls, and [[attr:Accordion.canCollapseAll]] adds a
Collapse all button. Close and reorder are requests: the accordion owns neither
its items nor their order, so it emits [[event:Accordion.close]] and
[[event:Accordion.reorder]] for the host to apply.

Header Up/Down wrap through enabled toggles. Home/End select the first/last.
Enter/Space toggle normally. Collapsed bodies are inert and remain mounted.
Removing an item drops its content; focused removal restores a surviving header.
The component owns template retention, not application services.

```ts
accordion.visibilityMode = "multiple";
accordion.canClose = true;
accordion.canCollapseAll = true;
accordion.addEventListener("close", (e) => removeSection((e as CustomEvent<string>).detail));
```

## object:AccordionItem

`id` and `heading` are required. Optional `summary`, `actions`, `disabled`, and
either `body: View` or `create: () => View`. A lazy factory runs once on first
expansion and is retained by ID until removal. Actions remain outside the toggle.
Factories are synchronous; asynchronous resources use composition lifetimes.
Duplicate/empty IDs and simultaneous body/create are rejected. `actions` is the
per-section header renderer: whatever template it returns sits in the section
head, outside the toggle button.

## attr:Accordion.items

The sections, as [[object:AccordionItem]]s in order. Required; default `[]`.
Reacting to a new array reconciles expanded IDs and drops content for removed
items. The accordion does not reorder this array; [[event:Accordion.reorder]]
reports the order the host should assign. Reactive.

## attr:Accordion.expanded

The IDs of the open sections. Default `[]`. Programmatic lists may hold several
IDs in either visibility mode; the mode constrains only user toggles. Duplicate
or empty IDs throw `TypeError`. Reactive.

## attr:Accordion.multiple

Sugar for [[attr:Accordion.visibilityMode]]: `true` is `"multiple"`, `false` is
`"mutex"`. Default `false`. Reading it gives the normalized answer. Reactive.

## attr:Accordion.visibilityMode

How many sections a person may open: `"mutex"` (default) closes the previously
open section when another opens, while `"multiple"` leaves them open. An error
revealing a collapsed section is allowed in either mode. Reactive.

## attr:Accordion.headingLevel

The heading level passed to every [[class:Section]]: 2 (default), 3 or 4. It
sets `aria-level` on the section heads. Reactive.

## attr:Accordion.canClose

Whether every item gets a close control. Default `false`. When `true`, each
section shows the close affordance and activating it emits
[[event:Accordion.close]] with the item's ID. The accordion never removes the
item; the host removes it from `items`. Reactive.

## attr:Accordion.canReorder

Whether enabled items get Move up and Move down controls. Default `false`. The
controls are ordinary buttons in the section head, disabled at the ends and for
a disabled item. Activating one emits [[event:Accordion.reorder]]; the host
assigns the reported order to `items` to move the section. Reactive.

## attr:Accordion.canCollapseAll

Whether a Collapse all control is drawn above the sections. Default `false`.
It collapses every open section and emits [[event:Accordion.expanded-change]]
with an empty list. Reactive.

## event:Accordion.close

A request to close an item, with its string ID as `detail`. It bubbles and is
cancelable, and fires before the host acts. The accordion has no default
action: it never removes or hides the item. `preventDefault()` lets a host veto
closing (for example, a dirty editor) before it removes anything; without a
listener the item simply stays until `items` changes.

## event:Accordion.reorder

A request to move an item, with an [[object:AccordionReorderDetail]] as
`detail`. It bubbles and is cancelable; nothing moves until the host assigns
`detail.order` to [[attr:Accordion.items]]. Focus stays on the moved section's
button when the keyed list moves it. `preventDefault()` cancels the request.

## event:Accordion.expanded-change

Fires after a person opens or closes a section, and after Collapse all. The
`detail` is `{ expanded: string[]; reason: "user" | "error" }`. It bubbles and
is not cancelable. Programmatic writes to [[attr:Accordion.expanded]] do not
emit it.

## object:AccordionReorderDetail

The `detail` of [[event:Accordion.reorder]]:
`{ id, from, to, order }`.

## attr:AccordionReorderDetail.id

The ID of the item being moved.

## attr:AccordionReorderDetail.from

The item's index among [[attr:Accordion.items]] before the move.

## attr:AccordionReorderDetail.to

The requested index after the move: `from - 1` for Move up, `from + 1` for Move
down.

## attr:AccordionReorderDetail.order

The complete stable-ID order to assign to [[attr:Accordion.items]].

## attr:AccordionItem.id

The stable identity of the section, used by [[attr:Accordion.expanded]],
[[object:AccordionReorderDetail]] and lazy-body retention. Required, unique and
non-empty.

## attr:AccordionItem.heading

The section's visible title. Required, plain text.

## attr:AccordionItem.summary

An optional [[type:View]] shown in the section head, typically a count such as
"2 changes".

## attr:AccordionItem.actions

An optional [[type:View]] of header actions, rendered outside the toggle. It is
the per-section `headerActions` surface. JavaScript-only: the YAML catalog
carries it as a registered renderer, not plain data.

## attr:AccordionItem.disabled

Optional boolean, default `false`. A disabled section cannot be toggled and its
reorder controls are disabled. Its body still exists and semantics still name
it.

## attr:AccordionItem.body

An optional [[type:View]] rendered inside the section. Provide either `body` or
[[attr:AccordionItem.create]], not both.

## attr:AccordionItem.create

An optional `() => View` factory run once when the section is first opened and
retained until the item is removed. It keeps large bodies out of the initial
page. Provide either `create` or [[attr:AccordionItem.body]], not both.

## class:Breadcrumbs

Tag `aster-breadcrumbs`. Controlled structural location. Properties: `items`
(BreadcrumbItem[], empty), `label` ("Breadcrumb"), `maxVisible` (4, minimum 3).
The budget includes the overflow position. The first item and final visible
ancestors remain; Show ancestors opens a shared menu for the omitted middle.
The last item has `aria-current=page`. Labels can truncate visually while their
accessible names retain the complete text.

`navigate` is cancellable and reports the item ID as detail. Prevent default to
take ownership of ordinary navigation. Modified link clicks retain native browser
behavior, including overflow links. Routing and permission filtering are host-owned.

## object:BreadcrumbItem

`id`, `label`, and optional `href` or `activate: () => void`. IDs must be unique
and nonempty. URLs accept relative, fragment, HTTP and HTTPS destinations. An item
cannot supply both href and activate. The last item is displayed as current text.
