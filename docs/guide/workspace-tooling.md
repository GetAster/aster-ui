# Check workspace connections

Web applications can become complex quickly. A list gains an editor, another
view shares its selection, and actions depend on drafts, permissions and loading
state. Aster UI provides a foundation for keeping those connections explicit and
the code understandable as the application grows.

Workspace composition brings the model, actions and named components together
in one definition. A typed registry checks that the names exist and the values
fit: for example, that a draft-status indicator receives a boolean signal rather
than a device name. The same contracts support JavaScript and TypeScript checks,
validation before mounting, and YAML editor completion.

Use this when a screen has shared state, reusable variants or enough connections
that checking them is useful. Application functions remain ordinary JavaScript.
Aster's `Composite` creates and owns the registered children; your application
chooses where to mount the workspace and when to dispose it.

This guide extends [Compose a workspace](declarative-workspace.md). The examples
use its device model and draft-status component. Start with a JavaScript object;
choose YAML if you want the screen definition in a separate editable file.

## Register a model and component

A registry maps the names used in a definition to their implementations and
contracts. This smaller version of the [running example](../playground/composition.html)
registers just its model and status indicator:

```js
// @ts-check
import {
  Composite, DataContext, compositeElement, compositeTypes as t,
  defineCompositeRegistry,
} from "../lib/aster-ui.js";
import { deviceWorkspaceType } from "./composition-model.js";
import { DraftStatus } from "./composition-status.js";

const authoring = defineCompositeRegistry({
  inputs: { ctx: t.instance(DataContext) },
  models: { devices: deviceWorkspaceType },
  components: { DraftStatus: compositeElement(DraftStatus) },
});
```

These imports refer to the showcase's modules. The [model implementation](../playground/composition-model.js)
contains the collection, selection, draft and command functions. The
[status component](../playground/composition-status.js) declares its properties
and renders its message; its full body is also shown in [Compose a workspace](declarative-workspace.md).
`compositeElement(DraftStatus)` derives the property contract from that declaration.

The name `authoring` refers to the checks and editor tools returned by
`defineCompositeRegistry`. Its `registry` property supplies the implementations
to the runtime. You do not need a separate set of contracts for YAML.

## Check a JavaScript definition

Continue with the same registrations:

```js
const definition = authoring.define({
  version: 1,
  name: "DeviceStatus",
  model: {
    type: "devices",
    inputs: {
      ctx: { ref: "inputs.ctx" },
      selection: { multiple: true, ordered: false, fallback: false },
    },
  },
  children: {
    status: {
      type: "DraftStatus",
      props: { dirty: { bind: "model.dirty" } },
    },
  },
  layout: { child: "status" },
});
```

`dirty` is a boolean property and `model.dirty` is a boolean signal. Changing the
binding to `model.message`, a string signal, fails the contract check:

```js
// Invalid: a string signal cannot supply this boolean property.
props: { dirty: { bind: "model.message" } }
```

The diagnostic identifies `definition.children.status.props.dirty` and reports
that `model.message` is incompatible with `dirty`. Misspelled
component names, unknown properties and missing layout children are checked too.
`ref` passes the referenced object; `bind` reads a signal's current value and
keeps the property updated. Passing a signal through `ref` does not unwrap it.

TypeScript checks these connections using the registered types. In JavaScript,
`// @ts-check` enables the same editor checks in a TypeScript-aware editor when
the imported registrations retain their type information. Without editor type
checking, `authoring.define(...)` still validates the definition before returning it.

To mount this definition, provide an existing connected `DataContext` named `ctx`
and a DOM element named `container`, as in the composition guide:

```js
const workspace = new Composite(definition, authoring.registry, {
  inputs: { ctx }, ctx,
}).mount(container);

// When the host screen closes:
// workspace.dispose();
```

Static checks cannot prove future values, custom predicates or instance identity.
The runtime validates actual inputs and values and checks PageRules against the
live context. Guard unsaved changes before calling unconditional `dispose()`.

## Choose JavaScript or YAML

Keep a JavaScript object when you want the definition beside application code.
YAML is useful when layout and connections should be independently editable or
reviewable. Both describe the same workspace; data access, event handlers,
renderers and save functions stay in JavaScript.

For example, the same status child in YAML is:

```yaml
children:
  status:
    type: DraftStatus
    props:
      dirty: { bind: model.dirty }
```

This is an excerpt, not a complete YAML document. See the
[complete device definition](../playground/composition.ui.yaml) and the
[build-time compilation instructions](declarative-workspace.md#load-and-mount-the-workspace).
Use the registrations in the [device registry module](../playground/composition-registry.js)
for that full definition; it also uses grids, renderers and a lazy inspector.

After compiling your YAML to JSON, replace the JavaScript `authoring.define(...)`
step with validation. This loading excerpt assumes the same `authoring`, `ctx`
and `container` as above, and a compiled file using those registered names:

```js
const response = await fetch("./device-status.ui.json");
if (!response.ok) throw new Error(`Definition request failed: ${response.status}`);
const { definition, sources } = await response.json();
const checked = authoring.validate(definition, sources);
const workspace = new Composite(checked, authoring.registry, {
  inputs: { ctx }, ctx, sources,
}).mount(container);
```

`authoring.diagnostics(definition)` returns all discovered `{ path, message }`
entries. `validate` throws the first, including a YAML source location when
provided. Neither creates a model, imports a child module or starts a data request.
Plain JavaScript applications get this validation without adopting TypeScript.

## Add YAML editor completion

Export `authoring.schema()` as JSON and associate the YAML file with it. For a
particular screen, `authoring.schema(definition)` also includes its command aliases
and child names. Regenerate the schema when registrations change. The
[device example](../playground/composition.html) has a **Download YAML schema**
link for its actual registry.

```yaml
# yaml-language-server: $schema=./composition.schema.json
```

Add that comment at the top of the YAML file. Editors using the YAML language
server can then suggest registered model/component names, properties, reference
targets and renderer names, with descriptions for hover help. See the
[YAML language server's schema association documentation](https://github.com/redhat-developer/yaml-language-server#associating-schemas)
for editor configuration.

For custom editor integrations with a parsed document, Aster also exposes
completion filtered by the destination property's contract:

```js
const suggestions = authoring.complete(
  definition,
  "definition.children.status.props.dirty.bind",
);
// Includes model.dirty, described as a signal of boolean.
// Excludes model.message, a signal of string.
```

JSON Schema cannot express every cross-reference, rule path, instance identity
or custom predicate. Custom validators without enough type metadata remain
permissive in schema export; semantic completion omits unproven matches. Runtime
validation remains authoritative. A dedicated language-server adapter for live
semantic diagnostics, automatic schema refresh and source navigation is separate
work; the available editor setup uses schema association.

## Extend the workspace

[Built-in controls and navigation](composition-controls.md) covers the shared
control adapters and the composed showcase. The [workspace patterns guide](workspace-patterns.md) covers public command and
publication contracts, reusable variants, lazy children, command aliases and
placing existing children inside semantic HTML. The
[complete device registry](../playground/composition-registry.js) shows the grid adapters,
renderer function bodies, validation and mounting together.
