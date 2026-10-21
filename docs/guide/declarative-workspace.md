# Compose a workspace

A screen often combines a list, an editor and actions such as Save or Discard.
Those controls need to agree on the selected record, the current draft and when
an action is available. Aster lets you declare how they fit together in YAML or
JavaScript, while keeping queries and application behaviour in ordinary functions.

This guide uses a device-management screen: a table and tile view share a
selection, and an editor changes the selected device. You’ll see how to connect
those parts and where to put your own code.

If you are new to Aster, begin with [Get started](getting-started.md) and
[Connect a grid and form](connected-views.md). They introduce the data context,
collections and editing used here. You can also use Aster controls directly;
a workspace definition is useful when you want to name, connect and reuse the
parts of a larger screen.

## Try the device workspace

[Explore the live workspace and its source](../examples/composition.html), or
[open it full size](../playground/composition.html). It runs with sample data in
your browser; no backend or account is needed.

1. Select a device and choose **Edit selected**.
2. Change its name, then switch to **Tiles**. The same draft stays open.
3. Choose **Save device** or press Ctrl/⌘ S. Both views show the saved name.

The example also asks before discarding an unsaved draft when you recreate the
workspace. You can explore its variants after the basic wiring is familiar.

## Understand the three parts

A **workspace** is a named set of components connected to one model and placed
in a layout. In code, Aster represents it with `Composite`.

| Part | What you define | In this example |
| --- | --- | --- |
| Model | Data, selection, editing state and action functions | A device collection, its selection and Save command |
| Children | Named components and their public properties | A Grid, a TileGrid and an editor |
| Layout | Where children appear and which are active | Switch between the table and tiles; show the editor when needed |

JavaScript registers the model and component types that a definition may use.
YAML connects those registered names; it does not contain executable functions.
The same definition can be written as a JavaScript object.

## Connect a component to the model

Here is the table child from the running example, shortened to show the shared
data and selection:

```yaml
children:
  table:
    type: Grid
    props:
      label: Managed devices table
      selectable: true
      collection: { ref: model.collection }
      selection: { ref: model.selection }
```

`table` is the name of this child. `Grid` selects a component registered by the
application. `props` sets that component’s public properties. A literal such as
`selectable: true` is passed as a value; `ref` passes an object exported by the
model. Both the table and tiles reference the same collection and selection,
so switching presentation keeps the selected device.

Use `bind` when a property should follow a changing signal value. For example,
the draft-status component follows whether the editor has unsaved changes:

```yaml
status:
  type: DraftStatus
  props:
    dirty: { bind: model.dirty }
```

`ref` passes the exported object itself. `bind` reads a signal and updates the
property as its value changes. The complete definition below includes the view
configuration, actions and layout omitted from these excerpts.

## Keep actions in JavaScript

The model supplies commands such as Edit, Save and Discard. A command combines
an action function with availability, busy and error state. Buttons and keyboard
shortcuts invoke the same command.

The definition connects the workspace’s Save action to the model’s function:

```yaml
commands:
  save:
    use: model.commands.save
    enabledWhen:
      op: and
      args:
        - editor.dirty
        - { op: not, arg: editor.busy }
    reason: Change a field before saving.
```

Here, PageRules evaluates the model’s published editing state: Save requires a
changed draft and no save already in progress. The rule also applies to direct
calls to `workspace.commands.save.execute()`. The model’s own validation still
runs, and a failed save keeps the draft open for correction.

The [model source](../playground/composition-model.js) contains the actual Save
function, query and selection setup. The complete source is also included below.

## Declare a component's properties once

The workspace's draft status is a custom component. Its complete implementation
is below, read from the running example's source:

<!--composition-status-->

Register the constructor without repeating its property list:

```js
registry.component("DraftStatus", compositeElement(DraftStatus));
```

YAML can immediately set every declared property or bind it to a model signal:

```yaml
status:
  type: DraftStatus
  props:
    label: Device draft status
    dirty: { bind: model.dirty }
    busy: { bind: model.busy }
```

`elementProperty(type, initial, description)` supplies validation, a per-instance
default factory and documentation. `defineElement` installs reactive accessors on
each new instance. Ordinary JavaScript assignments such as `status.dirty = true`
use the same validator and schedule rendering. TypeScript infers accessor and
render-property types. Render properties are read-only in TypeScript; the second
render argument is the typed element for event handlers and DOM events.

Omitted YAML properties keep their defaults. Explicit `undefined` is accepted
only by an optional type. Default factories should create fresh arrays/objects;
Aster does not clone borrowed models. Properties assigned before custom-element
upgrade are preserved and validated. Native DOM properties and lifecycle names
are reserved so a property declaration cannot replace element behaviour.
Properties are JavaScript APIs; HTML attribute reflection is not implicit.

`DraftStatus.properties` retains descriptions/default factories, and
`describeCompositeContract(DraftStatus.contract)` produces JSON-compatible type,
optionality and description metadata for documentation tools. No second property
list is maintained. The component
must still be registered by trusted code before a YAML definition can use it.
Existing elements and adapters continue to work with `compositeElement(tag, contract)`.

## Load and mount the workspace

Register the model and components in application code, then compile the YAML
at build time. From this repository:

```sh
bun scripts/composite-yaml.ts screen.ui.yaml screen.ui.json
```

The compiler produces a definition and source locations for useful validation
errors. The browser loads the JSON; it does not need a YAML parser.

```js
const { definition, sources } = await response.json();
const workspace = new Composite(definition, registry, {
  inputs: { ctx },
  ctx,
  sources,
}).mount(container);
```

`ctx` is the data context created by your application. The registry connects
names such as `Grid` and `device-workspace` to their implementations. See the
[host registration source](../playground/composition.js) for the running example’s
component adapters, tile renderer and lazy editor loader.

For a JavaScript definition, pass `defineComposite({ ... })` to the same
constructor. When the screen closes, check for unsaved work before calling
`workspace.dispose()` to release its owned resources.

## Complete example source

These files are read directly from the running example when the documentation
is built. Expand them to follow the full wiring and application functions.

<details class="example-source">
<summary>Workspace definition — YAML</summary>

<!--composition-yaml-->

</details>

<details class="example-source">
<summary>Model, query and action functions — JavaScript</summary>

<!--composition-model-->

</details>

The [host registrations](../playground/composition.js) connect these names to
code. The [editor implementation](../playground/composition-details.js) shows
how the lazy component creates a Form and binds its editing model.

## Continue building

Read [Customize and manage workspaces](workspace-patterns.md) for shared selection
policy, public child overrides, reusable variants, lazy loading and cleanup.
Use [Registry & editor tooling](workspace-tooling.md) for typed definitions, YAML
completion and custom markup. The [composition API](../reference/#class:Composite)
documents the runtime contracts.
