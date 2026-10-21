# Dashboard composition

Compose live widgets using `aster-dashboard`. The host registers factories, owns
shared data and persistence, and supplies a toolbar to add/save/restore widgets.
Layout, content and resource lifetimes are separate: changing placement does not
recreate the widget's data model. See [[group:overlays]] for floating windows.

```ts
import { html, Dashboard } from "@getaster/elements";
const dashboard = document.querySelector<Dashboard>("aster-dashboard")!;
dashboard.registerType("welcome", {
  create({ config }) {
    return { render: () => html`<p>${config.value.message}</p>`, dispose() {} };
  },
});
dashboard.add({ id: "welcome-1", type: "welcome", title: "Welcome", width: 1,
  height: 1, config: { message: "Your workspace" } });
const snapshot = dashboard.snapshot();
await dashboard.restore(snapshot);
```

## class:Dashboard

Tag `aster-dashboard`. A responsive three-column CSS grid that stacks on narrow
containers. Widgets have named regions, shared window chrome, keyboard/touch
layout actions, guarded removal and a non-modal maximize view. The host supplies
registered factories and owns data context, shared models and saved layouts.

## attr:Dashboard.label

Reactive accessible section name. Default `"Dashboard"`; the widget list is named
`"<label> widgets"`.

## attr:Dashboard.widgets

Readonly reactive ordered array of [[object:DashboardWidget]]. Entries and nested
configuration are copied and frozen. Use methods to change layout.

## attr:Dashboard.maximized

Readonly reactive ID of the maximized widget, or null. Maximize is temporary and
is not included in saved layouts.

## attr:Dashboard.busy

Readonly reactive boolean while removal/retry/restore awaits guards. Chrome layout
actions are disabled. Bind host controls to it as well.

## method:Dashboard.registerType

`registerType(name, type)` installs a [[object:DashboardWidgetType]] under a unique
non-empty name and returns an unregister function. Duplicate names throw.
Unregistering while the type is in use throws; remove its widgets first.
Registering an unavailable saved type mounts its retained configurations.

## method:Dashboard.add

`add(widget)` appends a validated [[object:DashboardWidget]] and focuses its actions.
Throws for unknown types, duplicate IDs, invalid configuration or a pending layout
change. Factories mount only once the dashboard is connected.

## method:Dashboard.move

`move(id, index)` moves a widget to a zero-based integer position, clamped to the
current list. DOM and visual order match. Does nothing while busy or maximized;
an unknown ID or non-integer index throws. Keyboard and pointer controls use it.

## method:Dashboard.resize

`resize(id, width, height)` applies [[type:DashboardSize]] spans. CSS clamps width
for narrow screens while retaining desktop intent. Invalid sizes/IDs throw;
busy/maximized layout ignores resize. Emits a layout change and status message.

## method:Dashboard.configure

`configure(id, config, title?)` updates JSON configuration and optionally the title.
Same widget session and scope remain mounted; the factory receives new values
through its config signal. Validation or busy state throws. A widget that cannot
apply configuration without discarding edits should use its own guarded editor.

## method:Dashboard.maximize

`maximize(id)` opens a widget in the top layer without reparenting content;
`maximize(null)` restores its grid slot. Escape restores after nested popups
consume theirs, and focus returns to the maximize control. Native modals and
pending layout decisions block this action.

## method:Dashboard.removeWidget

`removeWidget(id): Promise<boolean>` runs its session's optional removal guard,
then removes/disposes on success. False or rejection leaves content intact.
Concurrent same-ID removals share one decision; other pending layout actions
resolve false. Focus moves to an adjacent widget or the empty widget list.
This is separate from native HTMLElement.remove(), which disconnects the dashboard.

## method:Dashboard.retry

`retry(id): Promise<boolean>` guards and disposes the current session, then starts
its registered factory again. A failed widget has a Retry button. Pending/stale
mounts are aborted; late sessions are disposed rather than rendered.

## method:Dashboard.snapshot

Returns a copied [[object:DashboardSnapshot]]. Contains only layout/configuration,
never factory functions, mounted content, selection or drafts. Hosts choose storage.

## method:Dashboard.restore

`restore(snapshot): Promise<boolean>` validates the complete layout, then runs all
removal guards for omitted IDs or changed types before committing anything.
Same-ID/type sessions keep content and receive new config. Unknown types show an
unavailable state with retained config. Invalid version/layout throws synchronously;
cancel/rejected guard returns false, emitting an error for rejection. Disconnection
invalidates pending decisions. Reentrant different layout requests resolve false.

## event:Dashboard.layoutchange

Bubbles after an accepted add/move/resize/configuration/removal/restore, with a
copied [[object:DashboardSnapshot]] as detail. DOM commits in the next microtask.
The event does not automatically persist anything.

## event:Dashboard.layouterror

Bubbles with a guard rejection/error as detail. Layout remains intact and a polite
status explains the failed change. The host may add recovery UI.

## event:Dashboard.widgeterror

Bubbles from the dashboard with `{ id, error }` when a factory, render or disposal
fails. Other widgets remain usable. The failed widget offers retry.

## type:DashboardValue

A JSON value: null, boolean, finite number, string, readonly array of JSON values,
or a plain record of JSON values. Cycles, functions, symbols and non-JSON objects
are rejected, with a maximum nesting depth of 32.

## type:DashboardConfig

Readonly record of [[type:DashboardValue]]. Defaults to an empty object. Copies
are frozen before reaching factories or saved layouts.

## type:DashboardSize

The literal union `1 | 2 | 3`, used for grid column and row spans. Local CSS custom
properties `--dashboard-row` and `--dashboard-gap` default to 300px and 16px.

## object:DashboardWidget

Serializable widget description: ID, registered type, title, width, height and
optional configuration.

## attr:DashboardWidget.id

Stable unique non-empty string. It identifies retained sessions across layout
changes; changing the ID removes/recreates the widget through guards.

## attr:DashboardWidget.type

Registered factory name, never executable code or a module URL. Unknown restored
names retain configuration and show an unavailable state.

## attr:DashboardWidget.title

Plain, non-empty title used for the region and named chrome actions. Display text
may ellipsize; the full title remains in accessible names.

## attr:DashboardWidget.width

Desired column span as [[type:DashboardSize]]. Responsive CSS caps the visible span.

## attr:DashboardWidget.height

Row span as [[type:DashboardSize]]. Widget bodies scroll independently of chrome.

## attr:DashboardWidget.config

Optional [[type:DashboardConfig]]. Updated reactively for same-ID/type sessions.
No edit drafts should be placed here unless the host intends to serialize them.

## object:DashboardSnapshot

`{ version: 1; widgets: readonly DashboardWidget[] }`, ordered by reading/layout
order. Maximize is temporary and excluded. Persistence is an application concern.

## attr:DashboardSnapshot.version

Literal 1. Unknown versions throw before layout or content changes.

## attr:DashboardSnapshot.widgets

Ordered widget descriptions. Restore validates the complete array, including
configuration, before consulting removal guards.

## object:DashboardMount

A factory's lifetime context: stable ID, child PageScope, readonly configuration
signal and abort signal.

## attr:DashboardMount.id

The widget ID for this mount; stable through layout-only changes.

## attr:DashboardMount.scope

A distinct child of the nearest provided [[class:PageScope]], or a new root scope.
Its parent data context and publications remain accessible; sibling publications
do not collide. A session releases any publications it creates on disposal.

## attr:DashboardMount.config

ReadonlySignal of frozen [[type:DashboardConfig]]. Reading it in the session's
render function subscribes the view. Data models can also follow it in owned effects.

## attr:DashboardMount.signal

AbortSignal cancelled on removal, replacement, retry or dashboard disconnection.
Async factories check it after awaits and release partial acquisitions on failure.
A late returned session is disposed exactly once and never shown.

## object:DashboardSession

Owned resources and content of one widget mount. The dashboard retains this session
through move, resize, maximize and same-ID/type restore. Embedded custom elements
follow their own native disconnect/reconnect behavior during DOM reordering;
widget data acquisitions and native inputs stay with the retained session.

## method:DashboardSession.render

`() => View`, called synchronously with signal tracking. Return a stable template
or existing node wrapped in `html`; avoid acquiring resources during render.

## method:DashboardSession.dispose

`() => void`, called once after abort to release this session's acquisitions.
Never dispose borrowed DataContext, collection, Selection or parent scope resources.

## method:DashboardSession.beforeRemove

Optional `() => boolean | Promise<boolean>`. Return true to permit removal,
replacement/retry; false to retain. Rejection is reported as layout error. This guard
may show an accessible modal. Restore runs every affected guard before changing
anything, so defer destructive discard work until disposal. Page disconnection
releases resources without prompting.

## object:DashboardWidgetType

A registered application factory. Registration is explicit; snapshots cannot load
or execute new code.

## method:DashboardWidgetType.create

`(context: DashboardMount) => DashboardSession | Promise<DashboardSession>`.
Acquire only resources this session owns, borrow shared models explicitly, and
honor cancellation. Failure is isolated to the widget with a retry action.
