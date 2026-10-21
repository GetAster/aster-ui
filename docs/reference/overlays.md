# Menus, windows, dialogs, tabs, toasts and buttons

The elements for things that float above the page, switch it, or answer a
person's action:

| Element | Class | For |
|---|---|---|
| `aster-menu` | [[class:Menu]] | A context menu at a point, or a menu under a button, with check, radio, group and submenu items. |
| `aster-window` | [[class:Window]] | A non-modal, movable, resizable window beside the page, such as a debug or help panel. |
| `aster-dialog` | [[class:Dialog]] | A modal dialog that makes the rest of the page inert. |
| `aster-tabs` | [[class:Tabs]] | A tab bar that picks which panel the page shows. |
| `aster-toaster` | [[class:Toaster]] | A short message after an action, with an optional Undo. |
| (function) | [[staticMethod:announce]] | Telling screen readers about a result, with nothing on screen. |
| `aster-button` | [[class:Button]] | A button with busy, confirmation and "can't act now" states that never change its width. |

Tabs and the button aren't overlays; they are here because the page drives them
the same way as the others: it holds the state and the element reports what the
person did.

### How the overlays are placed

Menus, windows and the pickers' lists (see [[group:fields]]) are popovers: they
live in the browser's top layer (the Popover API), so no scroll container, clipped
section or `overflow: hidden` ancestor can cut them off. They are `popover="manual"`.
The owner decides when each closes: a press outside, focus leaving, Escape or a
choice. An automatic popover opened from a `contextmenu` event can be dismissed
by the pointer-up of the same click in some engines, which is why they are manual.

Where a popover goes is decided by CSS anchor positioning, not measured in
JavaScript:

- The anchor element gets `anchor-name: --<id>` and the popover gets
  `position-anchor: --<id>`. JavaScript only names the anchor, and opens or closes
  the popover to match.
- The `.aster-popover` styles put the popover below its anchor and let it extend
  to the right (`position-area: bottom span-right`), with fallbacks that flip it
  above, to the left, or both when there is no room.
- A menu opened at a point ([[method:Menu.openAt]]) isn't anchored: it writes only
  the point, as `--menu-x` and `--menu-y`. A menu opened against an element
  ([[method:Menu.openFrom]]) is anchored, and so is every submenu (to the right of
  its item, flipping to the left).
- A window isn't anchored after it opens, because the person moves it: its place
  is `--window-x` and `--window-y`, written by JavaScript, and clamped to the
  viewport with an 8 px margin.

The helpers that do this (`anchorStyle`, `placeStyle` and `openWhen`) are internal
to the package and aren't exported. The page uses the elements, not the helpers.
The elements need a browser with the Popover API and CSS anchor positioning; there
is no fallback placement.

### Who holds the state

None of these elements keeps state the page depends on. A menu's items are given
to it each time it opens; the page decides what a choice does. A tab bar's
`value` is the page's, and the bar only fires `change`. A dialog and a window
report closing with a `close` event, and the page decides what that means. A
toaster shows what it is told. This keeps one source of truth: the page's own
signals.

All the elements fire their events with `bubbles: true`. Use a window's
`beforeClose` guard to prevent closing; cancelling event dispatch does not stop it.

### Example

A page with a tab bar, a menu on a button, a modal confirmation and a toast
with Undo.

```ts
import { signal } from "@preact/signals-core";
import { html, render } from "lit-html";
import type { Dialog, Menu, Toaster } from "@getaster/elements";
import "@getaster/elements";

const tab = signal("open");
const busy = signal(false);

const page = () => html`
  <aster-tabs .label=${"Filter tasks"} .controls=${"task-list"}
    .items=${[{ value: "open", label: "Open" }, { value: "done", label: "Done" }]}
    .value=${tab.value} @change=${(e: CustomEvent<string>) => (tab.value = e.detail)}></aster-tabs>
  <div id="task-list" role="tabpanel" aria-label="Tasks">Tasks that are ${tab.value}</div>

  <aster-button .label=${"Actions"} .variant=${"secondary"}
    @click=${(e: MouseEvent) => openMenu(e.currentTarget as HTMLElement)}></aster-button>
  <aster-button .label=${"Archive"} .busyLabel=${"Archiving…"} .busy=${busy} .variant=${"primary"}
    @click=${() => void archive()}></aster-button>

  <aster-menu></aster-menu>
  <aster-dialog .labelledBy=${"confirm-title"}
    .content=${html`<h2 id="confirm-title">Archive this project?</h2>
      <button type="button" @click=${() => document.querySelector<Dialog>("aster-dialog")!.close()}>Cancel</button>`}></aster-dialog>
  <aster-toaster></aster-toaster>`;

render(page(), document.body);

function openMenu(anchor: HTMLElement): void {
  document.querySelector<Menu>("aster-menu")!.openFrom(anchor, [
    { label: "Rename", run: () => console.log("rename") },
    { kind: "separator" },
    { label: "Delete", disabled: "Only the owner can delete.", run: () => {} },
  ], "Project actions");
}

async function archive(): Promise<void> {
  busy.value = true;
  await new Promise((r) => setTimeout(r, 500));
  busy.value = false;
  document.querySelector<Toaster>("aster-toaster")!.show("Archived", {
    label: "Undo",
    run: () => console.log("undone"),
  });
}
```

### Limits

- Menus, windows and dialogs need Popover API, `<dialog>` and CSS anchor
  positioning support from the browser, and have no fallbacks.
- One menu element holds one open menu. Opening it again replaces the menu that
  was open.
- A toaster shows one message at a time, and a new message replaces the last. It
  doesn't queue.
- A toast hides itself after a fixed time (see [[method:Toaster.show]]). Don't put
  anything the person must read or act on only in a toast.
- Button names, key help and announcements are in English.

## class:Menu

Tag: `aster-menu`. Put one in the page, empty, and call [[method:Menu.openAt]] or
[[method:Menu.openFrom]] with the items each time. It draws nothing while closed
and has no events: a choice calls the item's own `run`.

Everything about a menu opens with the first item focused, and follows the
WAI-ARIA menu pattern. Items are `role="menuitem"`, `menuitemcheckbox` or
`menuitemradio` buttons in a `role="menu"` that is named by the `label` given on
opening. A submenu's label is its parent item's.

| Key or pointer | Effect |
|---|---|
| Down and Up | Move to the next and previous item, wrapping. |
| Home and End | Go to the first and last item. |
| A printable character | Moves to the next item whose label starts with it, wrapping. One character only; there is no typed buffer. |
| Right, Enter or Space on a submenu item | Opens the submenu and focuses its first item. |
| Enter or Space on another item | Chooses it. Right does nothing on an item that isn't a submenu. |
| Left | Closes the submenu and returns to its parent item. At the top level it does nothing. |
| Escape | Closes one level; at the top level, closes the menu. The key doesn't reach the page, so it won't also close a dialog or window beneath. |
| Tab | Closes the menu. |
| Click on an item | Chooses it. |
| Pointing at an item | Focuses it. On a submenu item, opens the submenu beside it; on another item, closes submenus deeper than it. |
| A press outside, or focus leaving | Closes the whole menu. |

Choosing an action closes the menu and then calls `run`. Choosing a `check` or
`radio` item calls `run` and leaves the menu open, with the mark changed in
place. The items you passed aren't changed, and the marks are forgotten when the
menu next opens, so the page keeps the real state and passes it as `checked` the
next time. Choosing a radio item clears the other radio items in the same list (the same
group, submenu or top level). A disabled action stays focusable, has `aria-disabled` and shows its reason as
its `title`, and does nothing when chosen.

When the menu closes, focus returns to the `opener` it was given, unless the
person has already moved focus somewhere else on purpose.

```ts
const menu = document.querySelector<Menu>("aster-menu")!;
menu.openAt({ x: 320, y: 180 }, [
  { label: "Open", run: () => console.log("open") },
  { kind: "check", label: "Pinned", checked: true, run: () => console.log("toggle pin") },
  { kind: "submenu", label: "Move to", items: [{ label: "Archive", run: () => console.log("archive") }] },
], "Project actions", document.activeElement as HTMLElement);
```

## method:Menu.openAt

Opens the menu at a point, as for a right-click.

- `point`: `{ x, y }` in viewport pixels, such as a mouse event's `clientX` and
  `clientY`. A [[object:RowMenuDetail]] fits. The menu's top-left corner goes
  there, pulled back if needed to stay 8 px inside the right and bottom edges.
- `items`: the menu's [[type:MenuItem]]s.
- `label`: the menu's accessible name.
- `opener`: the element to give focus back to on close, or `null` to leave focus
  where it is.

Returns nothing. The first item is focused once the menu has opened. If a menu is
already open it is replaced.

## method:Menu.openFrom

Opens the menu against an element, below it and flipping at the viewport's edges.

- `anchor`: the element to open under, such as the button that was pressed. It
  gets an `anchor-name` style, which stays on it.
- `items`: the menu's [[type:MenuItem]]s.
- `label`: the menu's accessible name.
- `opener`: the element to give focus back to on close. Default `anchor`.

Returns nothing. If a menu is already open it is replaced.

## method:Menu.close

No parameters. Closes the menu and any open submenus, and returns focus to the
opener as described for [[class:Menu]]. Does nothing when closed. Returns nothing.
Call it when the page moves on while a menu is open, such as when another menu
or a route change takes over.

## type:MenuItem

One entry of a menu: a union of shapes told apart by `kind` (`"check"` and
`"radio"` share one).

| `kind` | Other fields | Behaviour |
|---|---|---|
| none, or `"action"` | `label`, `run`, optional `disabled` | Runs and closes the menu. `disabled` is a reason, not a flag: set, the item stays focusable with `aria-disabled` and the reason as its `title`, and does nothing. |
| `"check"` | `label`, `checked`, `run` | A `menuitemcheckbox`, marked with a check. Runs and leaves the menu open. |
| `"radio"` | `label`, `checked`, `run` | A `menuitemradio`, marked with a dot. Choosing one marks it and clears the other radios in the same list. |
| `"submenu"` | `label`, `items` | Opens a menu beside the item. Has `aria-haspopup="menu"` and `aria-expanded`. |
| `"group"` | `label`, `items` | A heading and a `role="group"` around its items. Not focusable itself. Its items count in the keyboard order with their neighbours. |
| `"separator"` | none | A rule. Not focusable. |

`run` takes no arguments and returns nothing. A check or radio's `checked` is
read when the menu opens; the mark then follows the person's choices in place
until it closes.

```ts
const items: MenuItem[] = [
  { label: "Rename", run: () => rename() },
  { label: "Delete", disabled: "Archived projects can't be deleted.", run: () => {} },
  { kind: "separator" },
  { kind: "group", label: "Sort by", items: [
    { kind: "radio", label: "Name", checked: true, run: () => sortBy("name") },
    { kind: "radio", label: "Date", checked: false, run: () => sortBy("date") },
  ] },
];
declare function rename(): void;
declare function sortBy(field: string): void;
```

## class:Window

Tag: `aster-window`. Set `heading` and `content`, then call
[[method:Window.show]], [[method:Window.close]] or [[method:Window.toggle]]. It
draws nothing while closed.

The window is a `role="dialog"` with `aria-modal="false"` named by its heading,
in the top layer. The page stays usable and isn't made inert. The first time it
opens it sits beside its opener, above it, or below when there isn't room (centred
if there is no opener); after that it opens where it was left. Opening focuses the
window itself, not a control in it.

By default content exists only while open. Set `preserveContent = true` to keep
its DOM between openings, including native input values and borrowed child models.
Minimize always preserves content. The host owns models and explicitly releases
its acquisitions when disposing the page.

| Input | Effect |
|---|---|
| Drag the title bar | Moves the window. Presses on its buttons don't start a drag. |
| Move button, then arrow keys | Moves it 16 px a press, 64 with Shift. The button says so in its description. |
| Drag the bottom-right corner | Resizes it (CSS `resize: both`), from 340 by 420 px, down to 240 by 160. |
| Resize button, then arrow keys | Resizes it 16 px a press, 64 with Shift, within CSS minimum/viewport limits. |
| Managed Minimize / Maximize / Restore | Hides without losing content, fills the viewport, or restores normal bounds. |
| Escape inside it, or the Close button | Requests guarded close, returns focus to the opener on success, and fires `close`. Nested pickers consume their own Escape first. |

Moving and viewport changes keep it reachable with an 8 px margin. CSS limits
size to the viewport, including viewports smaller than the desktop minimum.

```ts
const win = document.querySelector<Window>("aster-window")!;
win.heading = "Help";
win.content = html`<p>Keyboard shortcuts…</p>`;
helpButton.addEventListener("click", () => win.toggle(helpButton));
declare const helpButton: HTMLElement;
```

## method:Window.show

Opens the window and focuses it.

- `opener`: the element it opens beside the first time, and the element focus
  returns to on close. Default: the focused element at the time of the call.

If the window is already open, it only focuses it (and keeps its place). Returns
nothing. The window is placed on the next animation frame, so it isn't at its
final place the instant the call returns.

## method:Window.close

No parameters. Returns `Promise<boolean>`, true when closed. Runs `beforeClose`
when configured; false or rejection keeps the window open. Concurrent requests
share one decision. Rejection fires `closeerror` with the error as detail.
On success, hides the window, returns focus to its opener and fires `close`.
Content is removed unless `preserveContent` is true. Already closed resolves true.

## method:Window.toggle

Requests close if visible, otherwise opens it or restores it from minimized.

- `opener`: as for [[method:Window.show]]. Passed through only when it opens.
  Default: the focused element.

Returns nothing.

## attr:Window.heading

The window's title, shown in its title bar and used to name the window and its
Move and Close buttons ("Move Help", "Close Help"). Default `""`. Reactive.

## attr:Window.content

The window's body, a [[type:View]]. Default `nothing`. Rendered while open, or
retained after its first opening when `preserveContent` is true. Reactive.

## attr:Window.open

Whether the window is open. Read-only: there is no setter, so open and close it
with the methods. Reactive. Opening and closing by the person, with the Close
button or Escape, changes it too.

## event:Window.close

Fires whenever the window closes, by [[method:Window.close]], Escape, the Close
button or [[method:Window.toggle]]. No `detail`. It bubbles. By the time it
fires, [[attr:Window.open]] is `false` and focus has gone back to the opener.

## attr:Window.managed

Boolean, default false. Shows Minimize and Maximize/Restore actions. The host
must provide a task-list action to reopen minimized windows.

## attr:Window.preserveContent

Boolean, default false. Retains mounted content after close. Minimize always
retains it. The host still owns model disposal and removal of the window element.

## attr:Window.state

Read-only reactive `"normal" | "maximized" | "minimized"`. Minimized windows
remain `open` but are not visible or focusable.

## attr:Window.active

Read-only reactive boolean. `Workspace` coordinates active chrome across windows.

## attr:Window.closing

Read-only reactive boolean while an asynchronous close guard is pending.

## attr:Window.beforeClose

Optional `() => boolean | Promise<boolean>`. Return true to close, false to keep
editing. A rejection emits `closeerror` and keeps content. The application owns
confirmation UI, saving and error messages. Disconnection invalidates decisions.

## method:Window.activate

`activate(focus = true)` raises the visible window and optionally restores its
last focused descendant, or focuses the panel. Does nothing while a native modal
is open. Activation fires `activate`; no content is recreated.

## method:Window.deactivate

Clears active chrome without hiding or moving focus. Normally used by Workspace.

## method:Window.minimize

Hides the open window without destroying content, remembers maximized state and
returns focus. Fires `statechange` with the new state and `placementchange`.

## method:Window.maximize

Fills the viewport through CSS, keeping normal bounds for restore. Fires
`statechange` and `placementchange`. Does nothing while closed.

## method:Window.restore

Restores a maximized window to normal bounds, or a minimized window to its prior
normal/maximized state, and activates it. Fires `statechange` and `placementchange`.

## method:Window.placement

Returns a copied [[object:WindowPlacement]], suitable for JSON serialization.

## method:Window.setPlacement

Applies a [[object:WindowPlacement]]. Rejects unknown states and non-finite or
non-positive dimensions with TypeError. CSS clamps sizes; position recovers to
viewport margins. Does not itself open the window.

## object:WindowBounds

`{ x: number; y: number; width: number; height: number }`, viewport pixels.

## object:WindowPlacement

`{ state: "normal" | "maximized" | "minimized"; bounds?: WindowBounds;
restoreMaximized?: boolean }`. Bounds describe the normal, restored size.

## class:Workspace

A controller, not an element. Register existing windows with stable IDs, bind a
task list to `entries`, `active.value` and each window's `open`/`state`, then call
`show` from its buttons. The controller borrows windows and never owns their data.

```ts
import { Workspace } from "@getaster/elements";
const workspace = new Workspace();
const unregister = workspace.register("help", document.querySelector<Window>("aster-window")!);
workspace.show("help", helpButton);
// When removing the window: unregister(). On page disposal: workspace.dispose().
declare const helpButton: HTMLElement;
```

## attr:Workspace.entries

Reactive readonly array of `{ id: string; window: Window }`, back-to-front order.
Read in a signal effect for a task list. Also read window open/state/heading there.

## attr:Workspace.active

ReadonlySignal of the active registered ID, or null. Hidden windows are excluded
from active fallback and cycling.

## method:Workspace.register

`register(id, window)` registers a stable non-empty ID and returns an unregister
function. Duplicate IDs/elements throw. Unregister before removing a window.
Unregister never closes or destroys it; another visible window may activate.

## method:Workspace.show

`show(id, opener?)` opens, restores or activates the registered window. Unknown
IDs throw. Does nothing while a native modal is open.

## method:Workspace.cycle

`cycle(backwards = false)` activates another visible window, ordered by stable
ID. Hosts choose a shortcut; the example uses F6/Shift+F6. Modals block cycling.

## method:Workspace.snapshot

Returns version 1 JSON-safe `{ version, windows: [{ id, open, placement }], active }`.
Entries are in stacking order; no data records or content are serialized.

## method:Workspace.restore

`restore(snapshot)` validates known entries, ignores unknown IDs, restores their
placements and opens saved-open windows in saved stacking order. Restores the
active visible window. Saved-closed entries do not close currently open windows;
explicit replacement must run their close guards. The host owns storage.

## method:Workspace.dispose

Releases subscriptions and registration. Does not remove or close borrowed windows.

## event:Window.placementchange

Bubbles with a copied [[object:WindowPlacement]] after pointer movement,
resizing or a state action. Hosts decide when and where to persist it.

## event:Window.statechange

Bubbles with the current [[type:WindowState]] after show, minimize, maximize or
restore. Closing uses the separate `close` event.

## event:Window.activate

Bubbles when inactive chrome becomes active. Workspace listens to coordinate
other registered windows and its active ID.

## event:Window.closeerror

Bubbles with the rejected close guard's error as detail. The window remains open;
the host supplies an accessible error message and recovery action.

## type:WindowState

`"normal" | "maximized" | "minimized"`. Minimized windows may still be open.

## attr:WindowBounds.x

Normal window left edge in viewport pixels. Negative saved values recover to the
visible viewport margin.

## attr:WindowBounds.y

Normal window top edge in viewport pixels, recovered to the viewport margin.

## attr:WindowBounds.width

Positive finite normal width in pixels. CSS applies desktop minimum and viewport
maximum constraints.

## attr:WindowBounds.height

Positive finite normal height in pixels, constrained by CSS to the viewport.

## attr:WindowPlacement.state

The [[type:WindowState]] to restore.

## attr:WindowPlacement.bounds

Optional [[object:WindowBounds]] for normal geometry. Maximizing retains these
bounds for later restore.

## attr:WindowPlacement.restoreMaximized

Optional boolean. A minimized window with true reopens maximized.

## object:WorkspaceEntry

A borrowed registered window: `{ id: string; window: Window }`.

## attr:WorkspaceEntry.id

Stable, unique, non-empty application ID used by task actions and snapshots.

## attr:WorkspaceEntry.window

The existing [[class:Window]] element. Its content and models belong to the host.

## object:WorkspaceSnapshot

JSON-safe versioned layout: `{ version: 1; windows: { id: string; open: boolean;
placement: WindowPlacement }[]; active: string | null }`.

## attr:WorkspaceSnapshot.version

The literal 1. Unknown versions are rejected before restore changes windows.

## attr:WorkspaceSnapshot.windows

Registered IDs, saved open flags and placements in back-to-front order. Unknown
IDs are ignored; saved-closed entries never close currently open dirty content.

## attr:WorkspaceSnapshot.active

The saved active window's ID, or null. Restore focuses it only if registered,
open and visible.

## class:Dialog

Tag: `aster-dialog`. Put one in the page with `content`, and call
[[method:Dialog.show]] to open it. It is a native modal `<dialog>`: the rest of
the page is inert, focus is kept inside, and Escape closes it. A press on the
backdrop closes it too. Focus returns to the opener on close, and `close` fires.

The contents are drawn whether the dialog is open or not; the browser just hides
them while it is closed. So `content` is usually a template that reads the page's
current view, and what you put in is kept between openings. This differs from
[[class:Window]], whose content is removed on close.

A dialog should always be named: set `labelledBy` to the id of its heading inside
`content`. For a dialog with more than one step, use [[method:Dialog.showView]]
instead of opening another dialog on top.

```ts
const dialog = document.querySelector<Dialog>("aster-dialog")!;
dialog.labelledBy = "invite-title";
dialog.content = html`<h2 id="invite-title">Invite someone</h2>
  <input name="email" type="email" aria-label="Email">
  <button type="button" @click=${() => dialog.close()}>Cancel</button>`;
dialog.show(button, () => dialog.querySelector<HTMLElement>("input"));
declare const button: HTMLElement;
```

## method:Dialog.show

Opens the dialog modally.

- `opener`: the element focus returns to when it closes. Default: the focused
  element at the time of the call.
- `focus`: optional function returning the element to focus once it is open.
  Called right after opening. If it isn't given, or returns `null`, the browser
  focuses the first focusable element.

Returns nothing. Does nothing if the dialog is already open, or hasn't rendered
yet (call it after the element is connected).

## method:Dialog.close

No parameters. Closes the dialog, which returns focus to the opener and fires
`close`. Does nothing when it is closed. Returns nothing.

## method:Dialog.showView

Changes what the dialog shows with a morph, instead of opening a second dialog.

- `change`: a function that does the change, such as setting a signal the
  `content` template reads. It is called once, either inside a view transition or,
  where view transitions aren't supported or the person prefers reduced motion,
  at once.

Returns nothing. The dialog's panel has a `view-transition-name`, so the box
animates from the old size to the new while the contents change. Without
`startViewTransition`, the change just happens.

```ts
dialog.showView(() => (step.value = "done"));
declare const step: { value: string };
```

## attr:Dialog.content

What is inside the dialog's panel, a [[type:View]]. Default `nothing`. Reactive.
It is rendered even while the dialog is closed.

## attr:Dialog.labelledBy

The id of the element that names the dialog, used as the `aria-labelledby` of the
`<dialog>`. It must be inside `content`. Default `undefined`: the dialog has no
accessible name. Reactive.

## attr:Dialog.open

Whether the dialog is open. Read-only. It reads the native `<dialog>`'s state
when asked and isn't a signal, so it doesn't re-render anything when it changes:
listen for `close`, and note when you call [[method:Dialog.show]].

## event:Dialog.close

Fires after the dialog has closed, whether by [[method:Dialog.close]], Escape or
a press on the backdrop. No `detail`. It bubbles, so a handler on the
`aster-dialog` element or an ancestor hears it. Focus has already returned to the
opener. Use it to reset the dialog's state, so the next opening starts clean.

## class:Tabs

Tag: `aster-tabs`. Bind it with `items` and `value`, and set `value` yourself
when `change` fires. It keeps no selection of its own: a press on a tab fires
`change`, and the selected tab changes only when the page sets `value`. Where
`value` matches no item, or is `undefined`, the first enabled tab is the selected one.

It draws a `role="tablist"` named by `label`, in an `aster-caret-group` (see
[[class:CaretGroup]]) so a bar slides under the selected tab. Each tab is a
`role="tab"` button with `aria-selected`. The selected tab is the only one in
the tab order (roving `tabindex`); activation is automatic by default. Disabled
tabs are skipped. Left and Right follow the writing direction. A selected tab's
optional close button is also keyboard reachable. Closable strips use `aria-owns`
to associate the tablist with tabs while keeping close buttons outside its owned
children, as permitted by [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/#tab).

| Key | Effect |
|---|---|
| Left and Right | Move to the previous or next tab, wrapping, focus it and select it. |
| Home and End | Select the first and last tab. |

Up and Down do nothing. A press on a tab selects it, and does nothing if it is
already the selected one. In manual activation mode, arrows move focus only; Enter or Space selects. Delete requests closing a closable tab.

With `renderPanel` unset, give the external panel `role="tabpanel"` and an id, and set
that id as `controls` so each tab has `aria-controls`. Each tab button has a
unique `id`, and the tabs set `aria-labelledby` on the panel to the selected
tab's id each time they render, so the panel is named by its tab. The panel
must exist when the tabs render, and the attribute is removed when `controls`
changes or the tabs leave the page.

```ts
html`<aster-tabs .label=${"Project sections"} .controls=${"project-panel"}
    .items=${[{ value: "details", label: "Details" }, { value: "tasks", label: "Tasks" }]}
    .value=${tab.value} @change=${(e: CustomEvent<string>) => (tab.value = e.detail)}></aster-tabs>
  <div id="project-panel" role="tabpanel">…</div>`;
```

With [[attr:Tabs.renderPanel]], Tabs owns one labelled `tabpanel` per item.
Only the selected panel is visible; its content is first rendered on activation
and retained while inactive. Removing an item removes its panel. Templates must
read reactive data for updates; keep loading and resource ownership in your
application or a lifecycle-aware child component. The callback is synchronous:
return a loading view while an application-owned asynchronous request runs.

Tabs accepts a signal of descriptors, so additions, removals, renamed labels and
query results update the strip without a separate tabs data store. Use stable,
unique values. The strip scrolls horizontally when space is limited, with touch
scrolling and backward/forward buttons. Selection and keyboard focus reveal the
target without animated scrolling. Coarse pointers receive 44px targets.

```ts
html`<aster-tabs .label=${"Open devices"} .items=${deviceTabs} .value=${selected}
  .renderPanel=${(item: TabItem) => html`<device-editor .deviceId=${item.value}></device-editor>`}
  @change=${(e: CustomEvent<string>) => { if (e.target === e.currentTarget) selected.value = e.detail; }}
  @close=${(e: CustomEvent<string>) => { if (e.target === e.currentTarget) requestClose(e.detail); }}></aster-tabs>`;
```

## attr:Tabs.renderPanel

Optional `(item: TabItem) => View` callback. Default `undefined`, preserving the
external `controls` panel mode. When set, Tabs owns labelled panels and ignores
`controls`. Content is lazy on first activation and retained until removal.
The callback runs reactively for visited items; it is a template renderer, not
a one-time resource factory. Use child component lifecycle hooks for cleanup.

## attr:Tabs.activation

`"automatic"` (default) selects when arrows move focus. `"manual"` moves focus
without selecting until Enter or Space. Prefer manual activation for panels
whose first render needs a network request. Clicking always selects.

## event:Tabs.close

Close request with the tab value as string `detail`, from its close button or
Delete on a closable, enabled tab. It bubbles. Tabs never removes items itself.
The owner may confirm unsaved work before removing the item from `items` and
setting the desired adjacent selection. For asynchronous confirmation, restore
focus to the selected tab after removal. Synchronous removal recovers focus
automatically when focus was within Tabs. Closing the final tab leaves an empty
strip; the owner should provide an Add/Open action as a focus destination.

## attr:Tabs.items

The tabs, as [[object:TabItem]]s in order: an array, or a signal of one. Default
`[]`. Reactive; a signal is read while the tabs render, so they follow it. Use it
for a count in a label, such as "Tasks 12".

## attr:Tabs.value

The `value` of the selected tab: a string, or a signal of one. Default
`undefined`, which selects the first enabled tab. Reactive. The page sets it from
`change`; it never changes by itself.

## attr:Tabs.label

The tab list's accessible name, as `aria-label`. Default `""`. Name what is being
chosen, such as "Project sections". Reactive.

## attr:Tabs.controls

The id of the panel the tabs control, set as `aria-controls` on every tab.
Default `undefined`: no external `aria-controls`. Ignored when `renderPanel` is set. Reactive.

## event:Tabs.change

Fires when the person chooses a tab other than the selected one, by a press or by
the arrow, Home or End keys. The `detail` is the chosen tab's `value` (a string).
It bubbles. It doesn't fire when the page changes `value`, or when the chosen tab
is the selected one. With automatic activation, a key press moves focus and
fires it together. Manual activation waits for Enter or Space.

```ts
tabs.addEventListener("change", (e) => (tab.value = (e as CustomEvent<string>).detail));
```

## object:TabItem

One tab of an [[class:Tabs]].

```ts
const items: TabItem[] = [{ value: "details", label: "Details" }, { value: "tasks", label: "Tasks 12" }];
```

## attr:TabItem.value

The tab's identity: what [[attr:Tabs.value]] holds and what `change` carries. Use
a short, stable string; values should be unique within one `items`. It is also
written as the tab's `data-value`.

## attr:TabItem.label

The text shown on the tab, and its accessible name. Plain text.

## attr:TabItem.closable

Optional boolean, default `false`. Shows a labelled close button for the active,
hovered or keyboard-focused tab, and enables Delete to emit [[event:Tabs.close]].
The button keeps its space while hidden so labels do not shift. On touch devices,
select a tab to reveal its close action. It does not mutate `items`.

## attr:TabItem.disabled

Optional boolean, default `false`. Disables selection and closing, and skips the
tab during keyboard navigation. If the selected tab becomes disabled, the first
enabled item is displayed. With no enabled items, no panel is shown.

## class:Toaster

Tag: `aster-toaster`. Put one in the page and call [[method:Toaster.show]] on it.
The toast is a fixed box at the bottom centre of the viewport, drawn above the
page's content. It is a `role="status"` live region, so a screen reader reads the
message when it changes. Nothing moves focus to it, so an Undo button on a toast
is reached by Tab only while it is showing; offer the same action somewhere else
too, when it matters.

A toast fits a result with no place of its own on screen, such as "Created Brand
refresh", or an action that can be undone. For a result that has a visible place,
show it there. For one with nothing to show, use [[staticMethod:announce]].

```ts
const toaster = document.querySelector<Toaster>("aster-toaster")!;
toaster.show("Moved to Archive", { label: "Undo", run: () => undoMove() });
declare function undoMove(): void;
```

## attr:Toaster.duration

How long a toast with no action stays, in milliseconds. Default `1800`. Read
when [[method:Toaster.show]] is called, so a change applies to the next toast.

## attr:Toaster.actionDuration

How long a toast with an action stays, in milliseconds. Default `6000`. Read
when [[method:Toaster.show]] is called.

## method:Toaster.show

Shows a message, replacing any message already showing.

- `message`: the text.
- `action`: optional [[object:ToastAction]]. A button with its `label` appears in
  the toast; pressing it dismisses the toast and then calls `run`.

Returns nothing. The toast stays [[attr:Toaster.actionDuration]] with an action and
[[attr:Toaster.duration]] without, whatever the message's length. Pointing at it or
focusing inside it (the Undo button, say) holds it; once neither applies it
stays a further 2 seconds.

## method:Toaster.dismiss

No parameters. Hides the current toast at once and cancels its timer. Returns
nothing. Does nothing when no toast is showing.

## staticMethod:announce

Tells screen readers about a result, with nothing shown. It is a plain function,
not a method.

- `text`: the message, in plain text.

Returns nothing. The first call adds one visually hidden `aria-live="polite"`
paragraph to the end of `<body>`; later calls reuse it. It is cleared and filled
on the next animation frame, so repeating the same text is announced again. It is
polite: it waits for the reader to finish what it is saying. It works without a
toaster, and is what [[class:Slicer]] uses for its removals.

```ts
import { announce } from "@getaster/elements";

announce("Pinned Brand refresh");
```

## object:ToastAction

The button on a toast, passed as the second argument of [[method:Toaster.show]].

```ts
const undo: ToastAction = { label: "Undo", run: () => void ctx.undo(saved) };
```

## attr:ToastAction.label

The button's text. Keep it to a word or two, such as "Undo".

## attr:ToastAction.run

A function called, with no arguments, when the button is pressed. The toast is
dismissed first. Its return value is ignored: for an async action, start it with
`void` and report any failure with a new toast.

## class:Button

Tag: `aster-button`. It draws one native `<button class="aster-button">` and
adds the states a button needs: rest, hover, pressed, focus, busy and "can't act
now". Listen for `click` on the element, as with any button. A button of `type`
`"submit"` inside a `<form>` submits it.

All of its labels (`label`, `busyLabel` and `confirmLabel`) sit in one grid cell,
so the button is always as wide as the widest of them and swapping them never
moves the layout. Only the label showing is visible and read by screen readers.
A busy label, when there is one, takes precedence over the confirmation.

Clicks are swallowed, before any listener on the element sees them, while the
button is busy or has a `reason`. A submit button doesn't submit then either.
While busy, `aria-busy="true"` is set. The label change is not announced by the
button itself; announce an outcome that matters with [[staticMethod:announce]].

Prefer `reason` to disabling: the button stays focusable and in the tab order, so
a keyboard or screen-reader user can find it and read why it can't act.

```ts
import { signal } from "@preact/signals-core";

const saving = signal(false);
html`<aster-button .label=${"Save"} .busyLabel=${"Saving…"} .confirmLabel=${"Saved"}
  .variant=${"primary"} .busy=${saving} .reason=${dirty ? undefined : "No changes to save."}
  @click=${() => void save()}></aster-button>`;
declare const dirty: boolean;
declare function save(): Promise<void>;
```

## method:Button.confirm

Shows the confirm label in place of the label for a moment.

- `ms`: how long to show it, in milliseconds. Default `1600`.

Returns nothing. Calling it again restarts the timer. With no `confirmLabel`,
nothing visible changes. A busy button keeps showing its busy label until it
isn't busy.

```ts
await navigator.clipboard.writeText(link);
copyButton.confirm();
declare const copyButton: Button;
declare const link: string;
```

## method:Button.focus

- `options`: the usual `FocusOptions`.

Focuses the native button inside, not the host element. A button that has a
`reason` can be focused.

## attr:Button.label

The button's text, shown at rest. Default `""`. Reactive.

## attr:Button.busyLabel

The text shown while `busy` is true, such as "Saving…". Default `undefined`: the
label stays while busy. Reactive.

## attr:Button.confirmLabel

The text [[method:Button.confirm]] shows for a moment, such as "Copied". Default
`undefined`. Reactive.

## attr:Button.busy

Whether an action is in progress: a boolean, or a signal of one. Default `false`.
While true the button shows `busyLabel`, has `aria-busy`, and swallows clicks.
Passing a signal keeps the button in step with it without re-setting the
property. Reactive.

## attr:Button.variant

`"secondary"` (the default) or `"primary"`, the visual weight. Use one primary
button per view. Reactive.

## attr:Button.type

`"button"` (the default) or `"submit"`. A submit button submits the enclosing
form. Reactive.

## attr:Button.icon

A [[type:View]] drawn before the label, such as an inline SVG with
`aria-hidden="true"`. Default `nothing`. Reactive.

## attr:Button.reason

Why the button can't act now: a string, or `undefined`. Set, the button has
`aria-disabled="true"`, shows the reason as its `title`, and swallows clicks, but
stays focusable. Cleared (`undefined`), it acts. Default `undefined`. An empty
string counts as no reason. Reactive.
