# Application composition

YAML and JavaScript definitions describe the same named
children, shared models, commands, PageRules and CSS layout intent. See the
[device workspace guide](../guide/declarative-workspace.md) for the running YAML,
model factory, registration code and current boundaries.

## class:Composite

Creates one logical owner and PageScope. Its model factory runs once; bindings
update named children without rebuilding the model. `inputs` are borrowed.
When the registry carries a catalog host input contract, the constructor requires
and types those inputs in TypeScript and validates them before running a model
factory. Missing, unknown and invalid inputs fail at their `inputs.*` paths.
`sources` optionally maps definition paths to YAML file/line/column positions.
Model factories register owned resources on the supplied Lifetime. The optional
`ctx` supplies PageScope's data/schema context for typed navigation rules;
`parentScope` inherits it for nested composites.

Definitions can declare `customize` permissions for named child props,
replacement types, optional suppression, lifecycle and placement. `overrides` on
the instance apply only within those permissions, after any derived variant.
Commands and publications cannot be replaced through overrides.

The supported layout nodes are `stack`, `deck`, `outlet` and `child`. One child
has one placement. A child can be eager or on-demand and retained or recreated
after deactivation. Registration contracts validate resolved props before lazy
module loading. Custom factories must honour their lifetime's abort signal and
release partial resources if they fail. Late sessions are released automatically.

## method:Composite.dispose

Unconditional teardown, idempotent. The application decides whether a dirty or
busy composite can close before calling this method. Releases owned children,
commands, publications and model resources; borrowed resources remain usable.

## class:CompositeRegistry

The host's allowlist of model factories, components and render functions. The
`model`, `component` and `renderer` methods register with a second argument and
look up with one argument. Duplicate registration and unknown names fail.
Component registration needs exactly one `create` or `load` factory. Module loads
are shared per registry/type; a rejected load is evicted so retry can succeed.

### Definition variants and typed contracts

`deriveComposite(base, overrides)` returns a detached, deeply frozen definition.
Overrides merge props shallowly and replace nested values/arrays. Only public
customization points can change. A suppressed optional child (`enabled: false`)
does not construct or load, and its handle's `ensure()` rejects.

`compositeTypes` supplies string/boolean/number, instance, optional, array,
object and signal contracts, plus custom and refinement checks.
`defineCompositeModel` uses them to type factory inputs and outputs and validate
loaded metadata. Its `read(values)` validates/narrows public exports for callers.
`describeCompositeContract` exposes descriptions and schema metadata for tooling;
`CompositeAuthoring.schema()` generates registry-aware editor schemas from the same contracts.

## class:CommandBar

`aster-command-bar` renders an action group from a labelled list of Command
objects. Availability, running state and failures are shared with other action
surfaces. Unavailable actions remain focusable and expose their reason, following
the existing Button convention. Errors appear in a polite status region.

## class:Command

An ordinary application action with reactive `enabled`, `reason`, `busy`, `error`
and `result` state. `command(options)` is a convenience constructor. Code-defined
availability is checked for direct calls as well as buttons. A composite's YAML
rule adds a gate without changing or weakening the underlying command.

## method:Command.execute

Resolves with the action result, or rejects when unavailable or when execution
fails. Concurrent callers share the current invocation. Retry clears the previous
error. The action receives an AbortSignal; disposal aborts it and ignores late
results/errors. The application must honour cancellation around async work.

## class:Lifetime

An explicit resource owner. `defer(cleanup)` registers release functions;
`own(resource)` registers its dispose method. Teardown aborts the owner and
releases resources in reverse order, once. A resource registered after teardown
is released immediately. All remaining cleanups run even if one throws.

## method:PageScope.available

Conservative command availability over a Condition. Every referenced value must
be available before the rule can enable an action. This prevents a missing lazy
publication from enabling a negative test. Existing `when()` semantics remain
unchanged. `checkRule()` reports invalid publication/property paths.

## staticMethod:defineElement

`defineElement({ tag, properties, render })` defines and registers a light-DOM
custom element. It returns a constructor with inferred public accessor types,
`tag`, `properties` and a derived `contract`. The render function receives the
read-only property values and the element. Reads participate in Aster's signal
tracking; validated assignments schedule a render. Accessors are installed on
new instances, without changing existing class prototypes.

Each declared property uses `elementProperty`. Omitted YAML values keep their
per-instance defaults; explicit values, including `undefined`, must satisfy the
type. Pre-definition property assignments survive custom-element upgrade and
are validated. Native DOM property names and lifecycle hooks are reserved.
Duplicate tag definitions throw. HTML attributes are not reflected implicitly.

Register with `registry.component(name, compositeElement(Constructor))`. Its
contract and documentation metadata come from the property declarations; only
these declared properties become YAML inputs. See the complete custom component
in the [workspace guide](../guide/declarative-workspace.html).

## staticMethod:elementProperty

`elementProperty(type, initial, description)` declares a property's runtime type,
per-instance default factory and human-readable documentation. `type` is a
`CompositeType<T>`, so TypeScript infers both render values and public accessors.
The factory must return a valid value and create fresh mutable defaults as
needed. Models supplied as values remain borrowed.

`Constructor.properties` exposes these descriptors.
`describeCompositeContract(Constructor.contract)` exposes JSON-compatible type,
optionality and description metadata. Defaults are factories and are not executed
to generate documentation. `CompositeAuthoring.schema()` uses this metadata for
registry-wide YAML editor schemas.

## staticMethod:defineCompositeRegistry

`defineCompositeRegistry({ inputs?, models, components, renderers? })` preserves
registration names and contracts for typed authoring. It returns a
`CompositeAuthoring` with a sealed runtime lookup `registry` and immutable catalog
snapshot. Additional registrations are rejected, including from JavaScript.
Use `compositeElement(Constructor)` to preserve declared element property types,
and `defineCompositeModel` contracts to describe model inputs, exports, commands
and publications. Existing imperative registries remain supported.

## class:CompositeAuthoring

Provides typed definition authoring, pre-mount diagnostics, registry-wide
completion and JSON Schema export from one catalog. Validation and completion
do not invoke model factories or component loaders. Contracts and metadata are
snapshotted; implementation functions remain trusted application code.

## method:CompositeAuthoring.define

`define(definition)` checks registered model/component names, props and compatible
references with TypeScript, then validates the definition against the catalog.
The result is the same immutable JSON-compatible format accepted by `Composite`.
It retains literal names for overrides and typed placement. Dynamic definitions
use `validate` instead. Custom predicates, live values, PageRules navigation and
command dependency cycles still require semantic/runtime checks.

## method:CompositeAuthoring.validate

`validate(definition, sources?)` validates structure and declared references,
property contracts and bindings without constructing a screen. It throws the
first diagnostic, using a supplied YAML source location, and returns a detached,
frozen definition on success. The mounted runtime remains authoritative for live
objects, custom predicates and rule context.

## method:CompositeAuthoring.diagnostics

`diagnostics(definition)` returns `{ path, message }` diagnostics. Paths start
with `definition`, matching the YAML compiler's source map. Metadata compatibility
is conservative; a custom predicate without usable schema metadata is checked
against real values by the runtime.

## method:CompositeAuthoring.complete

`complete(definition, path)` returns `{ label, description }` suggestions for a
dotted definition path. Supports registered model/component names, public prop
names, compatible ref/bind targets, command/publication references and renderer
allowlists. Nested arrays/objects use numeric/property path segments. Only
compatibility established by metadata is suggested for ref/bind values.

## method:CompositeAuthoring.schema

`schema(definition?)` exports JSON Schema 2020-12 for the catalog. A supplied
screen also contributes its child names and command aliases. Save the result as
JSON and associate it with YAML files in the editor. Regenerate it when contracts
change. Unknown custom checks are permissive in the schema and remain runtime
checks. A dedicated language-server adapter, automatic refresh and source
navigation are not supplied by this method.

## method:CompositeAuthoring.placement

`placement(definition, template)` types `place(childName)` using the definition's
child keys. Pass its returned function as `CompositeOptions.placement`. The
callback runs once and returns a Lit template. `place()` reuses the complete
declared layout; `place(name)` places an existing child container. Every child
must be covered exactly once. Named placement does not allocate unused default
layout wrappers. Definitions continue to own activation,
rules, lazy creation, retention and disposal; CSS owns responsive geometry.

## staticMethod:defineCompositeRenderer

`defineCompositeRenderer(propertyNames, render)` records a renderer implementation
and its allowed destination properties. Runtime `accepts`, schema metadata and
TypeScript property-name checks derive from this list. Typed authoring also
checks the function's assignability to the destination's declared type.


## method:CompositeRegistry.seal

`seal(inputs?)` closes registration and returns a `CompositeResolver` lookup API.
Later additions or resealing throw. A supplied host input contract is snapshotted
and checked by every `Composite` using the resolver before its model is created.
Catalog-created registries are sealed automatically. Imperative registries remain
configurable until sealed.

## constant:asterComponents

A named, reusable map of built-in element adapters for `defineCompositeRegistry`.
Select entries explicitly, such as `{ Grid: asterComponents.Grid, Form:
asterComponents.Form }`, to keep an application's allowlist deliberate. It is an
exported value, not a function. Contracts cover the controls' public writable
properties, including inherited field bindings. Omitted properties preserve the
element's own defaults; explicit `undefined` is accepted only where supported.

Includes Button, Field, Check, Select, Picker, TreePicker, DateField, Choice,
Switch, Grid, TileGrid, Listbox, Form, ListEditor, RuleEditor, FilterBuilder,
TreeNavigator, Tabs, Section, Split, Carousel, Slicer, ComponentHost, Window,
Dialog, Dashboard, CommandBar, Sidebar and ProgressStatus. Callbacks, templates and borrowed
models enter through registered renderers or model/input references. They are
ordinary JavaScript values; YAML cannot supply executable code.

Rich application-specific object predicates remain runtime checks and may have
limited schema completion. These adapters do not change any standalone control
API. Events retain their existing names and payloads; trusted host/factory code
connects them to model actions and owns listener cleanup.

Dashboard widget-type registration, Menu positioning, Dialog/Window opening,
Workspace coordination and Toaster announcements retain their explicit lifecycle
methods. They are not writable configuration properties. Use a registered factory
and its Lifetime for setup/cleanup of such services. Register app-local components
with `compositeElement(Constructor)` to derive their contract automatically.

## attr:CommandBar.showErrors

Defaults to true. Set false when a form, notification or another application
surface owns contextual error feedback. The command's error state is preserved;
this controls presentation only. Exposed through the shared composition adapter.

## attr:CommandBar.formatError

Optional `(error, action) => string` callback for application-facing error text.
The default uses the Error message or string value. Failures are grouped in a
separate labelled status surface, with the failed action's label. Set showErrors
false when the application supplies its own retry/dismiss interaction.


## class:KeyedSessions

DOM-free owner of keyed resource descriptors. `reconcile(descriptors)` retains
identity while adding, removing or reordering keys; duplicate keys and changed
types fail before reconciliation. `ensure(key)` deduplicates lazy creation;
`activate(key)` selects logical activity. Handles expose status/value/error,
Lifetime, PageScope and SessionActivity. Removed or disposed pending creations
are aborted and late resources are released. Inputs and services remain borrowed.

`requestClose(key)` consults the resource's optional asynchronous `canClose(signal)`
guard. Concurrent requests share the guard; a stale result cannot close a replacement
session. `remove(key)`, reconciliation removal and owner disposal bypass guards.

## class:CompositeSessions

Elements bridge over KeyedSessions using a CompositeResolver's existing component
contracts, lazy loader and factories. Descriptors have key, type, inputs, optional
lazy and inactive policy. Creation is lazy by default. Each ready resource exposes
a stable host element, hidden/inert when inactive. The registry declares mutableInputs
and an apply hook; other inputs retain their original identity. State updates
through borrowed signals do not require replacing the descriptor.

Works with registered elements and `compositeComponent` definitions. Models can
expose handles through normal JS/YAML references and renderers; no separate YAML
interpreter is involved. See the [retained views guide](../guide/keyed-sessions.md).

## class:SessionActivity

Owns logical data activity independently of view retention. `setActive(boolean)`
selects local activity; readonly `running` combines it with ancestors and the
inactive policy (`pause` by default, or `continue`). A paused ancestor constrains
all descendants. CompositeOptions.activity supplies the parent; model factories
receive their composite activity as an optional third argument. A nested
composite follows its supplied parent activity policy; named children can pause
more strictly. A standalone composite defaults to pause.

`run(start)` creates an owned ActivityTask. Every run receives `{ signal, refresh,
markFresh }` and may return a cleanup function synchronously or asynchronously.
Pause/disposal aborts the run and releases even a late cleanup. Guarded markFresh
ignores aborted runs. `task.invalidate()` marks stale and restarts active work;
paused work waits until resume. Task stale/error signals support application UI.
Only registered work is managed; shared data contexts and collections are not
implicitly cancelled on deactivation.
