# Field selection

`aster-field-selection` shows a searchable checkbox tree with explicit relationship expansion. It promotes the Grid columns panel's
selection and ordering actions into a reusable control. It reads in-memory
metadata and never requests records.

## class:FieldSelection

Configure through JavaScript properties. A source is either
`{ schema, entitySet }` or `{ fields: [{ path, label? }] }`. A flat fields source
lets a host offer only paths its data adapter supports. A schema source offers
direct properties and both to-one and to-many navigations.

```ts
const chooser = document.createElement("aster-field-selection");
chooser.source = { schema: ctx.schema, entitySet: "Projects" };
chooser.value = ["name", "lead/email"];
chooser.label = "Project fields";
chooser.addEventListener("value-change", (event) => {
  const { value, fields } = (event as CustomEvent).detail;
  // value: ["name", "lead/email"]
  // fields: [{ path: "name", label: "Name" },
  //          { path: "lead/email", label: "lead › Email" }]
  applySelectedFields(value);
});
```

| Property | Default | Meaning |
| --- | --- | --- |
| `source` | `undefined` | Schema/set reference or explicit field options. |
| `value` | `[]` | Ordered, unique, selected field paths. |
| `label` | `"Fields"` | Heading and accessible region name. |
| `filter` | `"all"` | `"all"`, `"direct"` or `"related"`; display only. |
| `search` | `""` | Case-insensitive label and full-path search of available expanded branches. |
| `maxDepth` | `8` | Positive integer bounding interactive navigation depth. |
| `policy` | `{}` | Path to `{ select?, hide?, move? }` refusal reasons. |
| `model` | New local model | Optional shared `FieldSelectionModel`; the other selection properties delegate to it. |

Paths use slash separators, such as `meetings/instructor/email`, relative to
the source entity type. Every intermediate segment must be a navigation and
the last segment must be a scalar field. Notifications carry the complete
relative path and its complete label, including ancestor navigation names and
the field's metadata title. They do not identify a navigator occurrence. The
navigator host maps the selection at its currently selected occurrence into its
own occurrence tree and queries.

The selected list always shows all chosen fields, with Move up, Move down and
Remove actions. Choosing another field appends it. All / Direct / Related,
search, branch collapse and depth changes preserve the entire ordered value.
Search never opens a branch implicitly. A self-referencing schema therefore
does not recursively enumerate itself. At the configured limit, the branch
shows a disabled expansion action with a visible reason; raise `maxDepth` to
explore deeper. Restoring a valid selected path deeper than the limit preserves
it in the selected list.

`value-change` is a bubbling, noncancelable notification after a user selection,
removal or move. Detail is `{ value: readonly string[], fields: readonly
{ path: string; label: string }[] }`. Programmatic changes and display-only
changes do not emit it. Invalid or duplicate paths throw before replacing a
selection. An incompatible source replacement throws and retains the previous
source and selection; clear or repair the value before replacing that source.

## Policy and keyboard interaction

```ts
chooser.policy = {
  id: { hide: "The identifier must stay visible", move: "The identifier cannot be moved directly" },
  confidential: { select: "This view cannot display confidential fields" },
};
```

A reason disables the corresponding user action and appears visibly beside
the affected field, with `aria-describedby` on the disabled control. `move`
refuses moving that field directly; another field may move across it, as in
Grid's existing columns panel. A host setting `value` can restore authored
state; policy guards user actions. Hosts remain responsible for applying their
own query and presentation restrictions.

Tab follows native controls. Space toggles a checkbox; Enter or Space activates
a branch or ordering button. Keyed rows retain focus during updates. If a
selected-field action removes or disables the focused control, focus returns
to search. `focus()` also focuses search. There is no custom tree keyboard
mode or record-selection behavior.

## class:FieldSelectionModel

Construct with `(source?, value?)`. `source`, `value`, `filter`, `search`,
`maxDepth` and `policy` have the same meanings as on the element. Signal-backed
getters make the element follow changes to a borrowed model. `rows` contains
the currently available field/branch rows; `selected` contains all selected
labelled paths; `change` produces the notification detail.

`select(path, selected)`, `move(path, -1 | 1)` and `toggle(navigationPath)` return
whether they changed state. Refused or redundant actions return `false`;
unknown paths throw. `selectionReason(path)` and `moveReason(path, direction)`
give the current refusal. Expanding visits one metadata level. The model has
no network resource or disposal lifecycle.

## Composition and styling

The reusable validators in `field-selection/config.ts` validate a source,
value, filter, depth and policy before a composition adapter assigns them.
Schema sources require a host-supplied Schema reference; YAML must not encode
executable metadata access. Flat options and policy reasons are plain data.
Register the component in the application's composition allowlist.

Import `styles/field-selection.css` after the shared base and identity styles.
Stable hooks are `.aster-field-selection`, `-tools`, `-selected`, `-available`,
`-name`, `-actions`, `-branch` and `-hint` (each suffix follows the full
`aster-field-selection` prefix). The shared theme and density tokens own
colours, spacing, control heights and typography. The per-row
`--aster-field-depth` value is an indentation intent; CSS owns geometry.
Native checkbox states and the shared base focus ring remain active, with
forced-colour borders and disabled text supplied by the component stylesheet.

### Single hierarchy chrome

Set `chooser.chrome = { selected: false }` for one searchable checkbox hierarchy.
Checked fields are shown; clearing a checkbox hides its field. The default
`{ selected: true }` also shows the ordered selected list and its move/remove
actions. `validateFieldSelectionChrome` accepts only the optional boolean
`selected` key. YAML composition uses `chrome: { selected: false }`.

Navigator headers use the internal `aster-navigator-fields` control with
`model`, `occurrence` and `label` properties. Its Choose fields button opens an
anchored dialog and keeps the hierarchy open while selections change. Changes
apply to the chosen occurrence and its addressed descendants. Where a navigation
is repeated, the ancestor hierarchy addresses its first occurrence; each
repeated occurrence header offers its own scoped chooser. Typed compute aliases
appear only at their authored occurrence. Invalid choices report a local error.

The available tree has one keyboard tab stop. Up/Down move between visible
rows, Home/End move to the first/last row, Right expands a relationship or
enters its first child, and Left collapses it or moves to its parent. Space
toggles a scalar field; Enter toggles a relationship. Escape bubbles to a
containing popup. Disabled actions remain discoverable with their refusal
reason. Search and filtering reconcile the active row to a visible ancestor
or the first visible row.

Schema rows show local field names; their accessible names and titles retain
the complete path label. Relationships show their selected descendant count,
including collapsed or filtered descendants. Expansion never selects a
relationship or changes the selected value. Explicit flat sources remain
flat, even when paths contain slash separators; their authored labels remain
visible.

`FieldSelectionRow.localLabel` is the row's local display name (the authored
label or path for flat sources). `selectedCount` counts selected scalar
descendants of a relationship and is zero for scalar rows. The existing
`label` continues to carry the complete path label.
