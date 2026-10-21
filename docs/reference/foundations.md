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

`items` is an array of AccordionItem; `expanded` is an array of stable IDs,
default empty; `multiple` defaults false; `headingLevel` is 2, 3 or 4 (default 2).
Programmatic expanded lists may include several panels. Single mode constrains
user toggles. New errors in mounted controls may reveal additional panels in
either mode. The host maps model errors to expanded IDs for uncreated lazy bodies.
`expanded-change` reports `{expanded, reason}` (user/error).

Header Up/Down wrap through enabled toggles. Home/End select the first/last.
Enter/Space toggle normally. Collapsed bodies are inert and remain mounted.
Removing an item drops its content; focused removal restores a surviving header.
The component owns template retention, not application services.

## object:AccordionItem

`id` and `heading` are required. Optional `summary`, `actions`, `disabled`, and
either `body: View` or `create: () => View`. A lazy factory runs once on first
expansion and is retained by ID until removal. Actions remain outside the toggle.
Factories are synchronous; asynchronous resources use composition lifetimes.
Duplicate/empty IDs and simultaneous body/create are rejected.

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
