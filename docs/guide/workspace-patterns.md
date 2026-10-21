# Customize and manage workspaces

Use these patterns when a screen needs configurable selection, reusable variants
or components that load on demand. Start with [Compose a workspace](declarative-workspace.md)
for the model, component and layout concepts used here.

The examples extend the [device workspace](../playground/composition.html).
Its model owns the data and commands; its named children present them.

## Share data and manage cleanup

Suppose your application creates a data context and passes it to a device
workspace. The workspace creates a collection, and its table and tiles use that
collection. Switching between those views keeps the collection alive. When the
workspace closes, it releases the collection; the application can keep using its
data context elsewhere.

The model factory registers that cleanup as soon as it creates the collection:

```js
function createDeviceList({ ctx }, lifetime) {
  const collection = ctx.collection({ set: "Devices" });
  lifetime.defer(() => ctx.release(collection));
  return { values: { collection } };
}
```

Here, the workspace **owns** the collection because its factory created it.
It **borrows** `ctx` because the application supplied it. The `lifetime` argument
is the workspace’s cleanup list: `defer` registers an action to run when the
workspace is disposed. Aster calls these actions in reverse registration order.
Views borrowing the collection leave its cleanup to the model.

Before calling `workspace.dispose()`, the application settles any unsaved-work
confirmation. Disposal itself is unconditional; switching presentation does not
dispose the workspace or its model.

In the full device workspace, the collection takes a computed query directly.
Changing the name input changes that signal; the data core refetches the
collection without a handler pushing filters from one view to another.

### Ownership across child workspaces

A child receives its own lifetime and the owner’s `PageScope`, which makes named
state available to its rules. Nested `Composite` instances receive `parentScope`
explicitly and keep their own publication namespace. The `ctx` option supplies
the scope’s service/schema context for typed navigation rules; nested scopes
inherit it.

## Declare selection policy and each view's participation

The shared model declares how selection works once for the workspace:

```yaml
model:
  type: device-workspace
  inputs:
    ctx: { ref: inputs.ctx }
    selection:
      multiple: true
      ordered: false
      fallback: false
```

The model passes that configuration to `new Selection(...)`. Optional ordered
selection can set `ordered: true` and a positive `maxOrdered`. Both presentations
use the same model so their pick policy cannot diverge accidentally. The contract
rejects incompatible settings: ordered selection requires multiple selection,
and `maxOrdered` requires ordered selection.

The table separately declares whether it allows users to change selection:

```yaml
table:
  type: Grid
  props:
    selectable: true
    collection: { ref: model.collection }
    selection: { ref: model.selection }
```

With `selectable: false`, clicking, touch and selection keyboard actions do not
change the borrowed selection. Selection made in another view remains visible.
Navigation, opening and editing are separate capabilities. This is a view policy,
not a server permission. A reactive `bind` can drive it from model/rule state too.

The live example's **Display-only table** variant demonstrates selecting in Tiles
and reflecting those picks in a table which cannot change them. **Single selection**
changes the shared model policy; **Compact inspector** replaces a public child.

## Customize public children without copying the workspace

The definition exposes specific customization points:

```yaml
customize:
  modelInputs: [selection]
  children:
    views: { optional: true }
    table: { props: [label, selectable, view] }
    tiles: { props: [label, selectable] }
    details: { replace: [CompactDetails] }
```

A JavaScript caller derives a reusable variant, then supplies instance settings:

```js
const compact = deriveComposite(definition, {
  name: "CompactDeviceWorkspace",
  children: { details: { type: "CompactDetails" } },
});

const workspace = new Composite(compact, registry, {
  inputs: { ctx },
  ctx,
  overrides: {
    children: { table: { props: { label: "My managed devices" } } },
  },
}).mount(container);
```

Precedence is base definition → derived definition → instance overrides. Every
definition is detached and deeply frozen. Props merge shallowly; arrays and nested
configuration values such as `view` replace as complete values. Unknown/private
child properties, disallowed replacements and attempts to change commands or
publications fail. A replacement must accept the resulting property contract;
properties are never silently dropped. The original child type remains available
when deriving another variant.

Only children declared `optional: true` allow static `enabled: false` suppression.
A suppressed child has status `suppressed`, does not load its module and rejects
`ensure()`. Lifecycle and complete layout changes require explicit public
`lifecycle: true` and `layout: true` permissions. Suppression differs from a
retained hidden child, which still exists with its model and content.

## Use one contract for runtime validation and TypeScript inference

The example uses reusable `compositeTypes` checks instead of repeating validators
for every string, boolean, instance or signal. `defineCompositeModel` infers
factory inputs and checks exported values from those same contracts:

```ts
const deviceModel = defineCompositeModel({
  inputs: {
    ctx: compositeTypes.instance(DataContext),
    multiple: compositeTypes.boolean,
  },
  exports: {
    collection: compositeTypes.instance(Collection),
    selection: compositeTypes.instance(Selection),
  },
  create: ({ ctx, multiple }, lifetime) => {
    const collection = ctx.collection({ set: "Devices" });
    lifetime.defer(() => ctx.release(collection));
    const selection = new Selection(ctx.store, collection, { multiple });
    return { values: { collection, selection } };
  },
});
```

Inside the factory, `ctx` and `multiple` have their inferred TypeScript types.
`deviceModel.read(instance.model)` validates and narrows exports for host code
without a cast. `describeCompositeContract(deviceModel.inputs)` exposes field
descriptions, optionality and schema metadata for tooling. `compositeTypes.refine`
adds cross-field checks and corresponding schema constraints, as used for the
selection policy. Identity and signal contracts still need runtime checks; this
metadata also feeds the [registry authoring tools](workspace-tooling.md), which
check references and generate editor schemas. Live PageRules and custom predicates
still require runtime validation.

Named children expose status/error signals and `ensure()` for explicit demand.
Deferred children load on first activation; retained children stay mounted and
hidden/inert between visits. With `retain: false`, deactivation releases the child
and a later visit creates a fresh instance. Registry module loads are shared;
instance creation and ownership are separate. Late factory results are released
after their owner closes. Custom asynchronous factories must register partial
acquisitions with their lifetime and honour its abort signal.

The current YAML profile rejects aliases, anchors, tags, duplicate/unsafe keys,
multiple documents, non-finite/unsafe numbers and oversized/deep definitions.
The parser is a build-time development dependency. Use the compiled JSON format
when loading a definition dynamically.

## Declare public commands and publications

Model exports already have typed contracts. Add contracts for the commands and
publications a definition may reference. This factory excerpt illustrates the contracts for a small editing-state model.
It is separate from the device model; it demonstrates state changes,
not persistence:

```ts
import {
  Command, command, compositeTypes as t, defineCompositeModel,
  signal, valuesPublication,
} from "../lib/aster-ui.js";

const editing = defineCompositeModel({
  inputs: {},
  exports: { dirty: t.signal(t.boolean) },
  commands: { markDirty: t.instance(Command), save: t.instance(Command) },
  publications: { editor: t.publication({ dirty: t.boolean }) },
  create: (_inputs, lifetime) => {
    const dirty = signal(false);
    return {
      values: { dirty },
      commands: {
        markDirty: lifetime.own(command({
          label: "Change draft", run: () => { dirty.value = true; },
        })),
        save: lifetime.own(command({
          label: "Save", enabled: () => dirty.value,
          run: () => { dirty.value = false; },
        })),
      },
      publications: { editor: valuesPublication({ dirty }) },
    };
  },
});
```

Persistence belongs in your Save function. The [device model](../playground/composition-model.js)
shows the actual editor save operation and its error handling. Publication
contracts describe the named signal values needed by the screen; a publication
may expose additional values. Declared command and publication contracts are
checked when the model is created. Existing models without these declarations
continue to work with the runtime, but the authoring tools cannot discover
undeclared commands or publications by executing a factory.


## Resolve command aliases by name

Aliases do not depend on their declaration order:

```yaml
commands:
  submit: { use: commands.save }
  save: { use: model.commands.save }
```

The runtime resolves dependencies before creating the aliases. Public command
maps keep declaration order for iteration. Cycles such as `submit → save → submit`
produce a diagnostic with the reference chain. Completion and schema export use
the same dependency resolver and omit targets that would introduce a cycle.


## Place existing children in semantic markup

With a typed registry named `authoring` and its checked `definition`,
use `place()` to put the declared layout inside your own markup without listing
its children again:

```js
import { Composite, html } from "../lib/aster-ui.js";

const placement = authoring.placement(definition, place => html`
  <section aria-label="Device status">
    <header><h2>Current draft</h2></header>
    ${place()}
  </section>
`);
const workspace = new Composite(definition, authoring.registry, {
  inputs: { ctx }, ctx, placement,
}).mount(container);
```

This callback runs once when the workspace is constructed. `place()` builds the
declared layout around the existing children. If you need different regions,
use named placements instead, such as `place("toolbar")` and `place("editor")`.
Each child must be covered exactly once; mixing root and named placements or
omitting a child fails.

Activation is planned independently from markup. With named placements, Aster
does not build a default layout tree and discard it. The definition’s deck/outlet
state remains the authority for activation, visibility and lazy creation. Models, commands, inherited PageScope and disposal keep their existing
ownership. Use CSS for responsive geometry and component properties for reactive
content; this is not a second template lifecycle.

The device example’s **Semantic layout** variant demonstrates custom header,
view and inspector regions around the same children and editing session.

## Keep registry contracts stable

`defineCompositeRegistry` returns a sealed runtime registry. To add a capability,
update the declaration and create a new registry. Contracts and metadata are
snapshotted so changes to caller-owned maps cannot make validation disagree with
the runtime. The `catalog` property is the metadata snapshot used by tooling;
`registry` is the runtime lookup passed to `Composite`.

The registry's host `inputs` contract is checked before model factories or child
loaders run. Required inputs must be supplied; optional inputs may be omitted.
Separate registries can reuse component/model registrations with different host
input contracts.

Strict object contracts reject known extra source keys, including objects nested
inside arrays and signals. Identity checks and custom predicates still need
runtime validation. See [Check workspace connections](workspace-tooling.md) for
the JavaScript, YAML and editor workflows.
