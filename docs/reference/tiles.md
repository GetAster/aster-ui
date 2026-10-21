# TileGrid

`aster-tile-grid` displays collections as icons, images or custom cards.
It shares [[class:Collection]], [[class:Selection]] and page-scope publications.
Enable `.virtualized=${true}` for uniform-height paging and bounded row rendering;
content-height and nonvirtual views render only loaded records. Flat table/tile
views can share this collection and selection; see [[attr:Grid.collection]].

### Example

```ts
import { Selection, type DataContext } from "@getaster/data";
import { html, render } from "lit-html";
import type { TilePresenter } from "@getaster/elements";
import "@getaster/elements";

declare const ctx: DataContext;
const devices = ctx.collection({ set: "Devices", orderBy: [{ field: "name" }] });
// The virtualized view loads pages; no loadAll() is needed.
const selection = new Selection(ctx.store, devices, { multiple: true, ordered: true, maxOrdered: 3 });
const present: TilePresenter = (device, state) => ({
  title: state.hidden.has("name") ? "Hidden" : String(device.name),
  description: state.hidden.has("platform") ? "Platform hidden" : String(device.platform),
});
render(html`<aster-tile-grid .collection=${devices} .selection=${selection}
  .label=${"Your devices"} .presentTile=${present} .virtualized=${true}
  style="--tile-min-width: 12rem; --tile-height: 15rem"
  @tile-open=${(e: CustomEvent<{ key: string }>) => console.log("Open", e.detail.key)}>
</aster-tile-grid>`, document.body);
```

### Layout and motion

CSS controls layout; JavaScript reads the resolved column tracks to group ARIA
rows and navigate spatially. Local sizing properties are `--tile-min-width`
(default `12rem`), `--tile-height` (`15rem` minimum without virtualization,
`20rem` fixed with virtualization), `--tile-gap`
(default density gap), `--tile-media-height` (default `7rem`) and
`--tile-image-fit` (default `contain`). Tile sizing is separate from control
density. Nonvirtual uniform rows grow together to fit content; `layout="content"` is a
JavaScript property that lets each row grow independently with no minimum.
Configure it through `.layout=${"content"}`, not an HTML attribute.

Images reserve space and fall back to the icon on failure. The tile itself has
no entrance, reflow or status animations. Theme-driven colour transitions are
removed under reduced motion, including descendants. Programmatic focus scrolls
instantly. Custom media must itself respect the user's motion preference.

### Keyboard and selection

The grid has one entry in the tab order: a roving tile, or the grid when empty.
Arrow keys move focus without changing selection. Left/right stop at row edges
and follow text direction; up/down follow the current column, clamping to the
last tile of a partial final row. Home/End move within the row; Ctrl+Home/End
move to the logical boundaries (loading the destination page). For an unknown
total, End reaches the current progressive frontier; it never fetches all results.
Page Up/Down move approximately one viewport of
rows. Type-ahead searches loaded titles (including prefetched records), resetting
after 700 ms. Nonvirtual navigation reaches loaded records only.

Space selects in single mode and toggles in multiple mode. Click selects;
Ctrl/Meta-click toggles; Shift-click or Shift-arrow selects the range from the
anchor, replacing the previous range. Ranges cover loaded keys only, including loaded keys between endpoints across
virtual windows; they never enumerate unloaded ranges. Ordered mode makes a
plain click toggle a pick, shows its one-based rank and adds Move earlier/later
buttons. Alt+Up/Down reorders a selected tile. An over-limit range/addition is
rejected in full and announced. Multiple mode also supplies a visible Select/
Deselect button for touch and pointer use without modifiers. Enter,
double-click or the visible Open button emits `tile-open`; selection alone does
not activate a record. There is no select-all command in this increment.

F2 enters controls within the current tile. Tab moves between those controls,
then leaves the grid. Shift+Tab from the first returns to the tile; Escape also
returns to it. Inputs and other controls keep their own arrow keys and activation.
Actions do not select or activate their parent tile. An Actions button, right-click
or Shift+F10/Menu opens the supplied menu; closing it returns focus to the opener.
Pointer users see actions on hover, focus or selection; on touch they remain
visible, with at least 44px action targets on coarse pointers. The action footer
reserves space throughout.

Changing the column count, removing or filtering a focused record recovers focus
to its surviving key or a neighbour; an empty grid stays focusable. ARIA roles
are grid/row/gridcell, with names, descriptions, indices and selection states.
Only exact totals report a logical row count; estimates/progressive totals use `-1`. Status text announces loading,
errors and exact totals; background field updates do not announce every refresh.
The host owns navigation, history, folder hierarchy and focus restoration across
folder changes. This element has no tree semantics.

## class:TileGrid

[Try the interactive TileGrid explorer](../examples/tile-grid.html) ·
[Share a collection between table and tiles](../guide/shared-collection-views.html)

Tag `aster-tile-grid`. Use bounded loaded collections or enable uniform-row paging. Its default
presentation is an icon or image, title, description and an Open action. Custom
content keeps the same shell and action footer. No collection means no view.
All properties are reactive. Strings in default content are escaped by Lit.

## attr:TileGrid.collection

The [[class:Collection]] to render. Default `undefined`, meaning the selection's
collection. It is not owned or released by the element. Keep it consistent with
the provided selection. Without virtualization, unloaded positions are omitted and no automatic fetch
is started. Virtualization renders placeholders and fetches the visible range.

## attr:TileGrid.selection

An optional [[class:Selection]]. Its `multiple`, `ordered` and `maxOrdered` settings determine selection
behaviour, ranks and limits. Default `undefined`: focus, activation and actions work without selection.
Choose `fallback: false` for a single selection that may be empty.

## attr:TileGrid.label

The accessible name of the grid. Default `""`; always supply a meaningful name.

## attr:TileGrid.publish

A page-scope key under which to publish the selection, such as `"devices"`.
Default `""`. Publishes the same selected, records, keys, key, count, any and many
values as a listbox. Removing the element withdraws its publication. Without a
selection or enclosing scope it publishes nothing.

## attr:TileGrid.presentTile

A [[type:TilePresenter]] providing names, descriptions and the default tile's
media. Default `undefined`: the title is the collection's metadata title field,
or its key; a hidden metadata title is shown as "Hidden". Used for accessible
names and type-ahead even when `renderTile` supplies the visual content.

## attr:TileGrid.renderTile

A [[type:TileRenderer]] for the tile's content. Default `undefined`: uses the
default presentation. The outer shell and Open/Actions footer remain the
component's responsibility. The renderer runs in the reactive render, so signal
reads update its content. Do not add roles or tabindex to the tile shell.

Custom controls must have names and ordinary keyboard behaviour. Their original
tabindex is restored in interaction mode and suppressed outside it. Keep drafts
and durable widget state outside the tile DOM: resizing or moving between rows
can recreate the content. Read `state.hidden` before interpreting a null field
as empty; the store has already removed hidden values.

## attr:TileGrid.actions

Optional `(entity, state) => readonly MenuItem[]`, passed to the existing
[[class:Menu]]. Default `undefined`, showing no menu button. Disabled reasons,
submenus and focus return follow that component's contract. The visible Open
action remains available regardless of menu entries.

## attr:TileGrid.empty

A [[type:View]] shown when the collection reports zero records. Default a
paragraph saying "No records.". Loading and not-yet-loaded messages are separate.

## attr:TileGrid.layout

`"uniform"` (default) gives all rows the same content-safe height, with
`--tile-height` as a minimum. `"content"` allows independent row heights.
Enable [[attr:TileGrid.virtualized]] for uniform-height paging.

## attr:TileGrid.virtualized

Boolean, default `false` for an owner-loaded collection. When true with uniform
layout, the element renders visible rows plus two overscan rows on each side,
keeps the active navigation row mounted, and calls [[method:Collection.view]]
with that range and the active position retained. Collection page size and page
retention govern fetching, prefetch and eviction. Content layout always remains
owner-loaded; setting `virtualized` there does not fetch.

CSS `--tile-viewport-height` defaults to `34rem`. Virtual row height is exactly
`--tile-height` (default `20rem`), so templates cannot change adjacent geometry.
Overflowing content is clipped in navigation mode. F2 or the visible Content
button enters interaction mode, where the content scrolls and joins the tile's
keyboard path; Escape returns to navigation. The action footer remains visible.
Use a sufficiently generous height for rich cards.
The full default name remains available through the accessible tile name. Content
mode is the alternative for naturally expanding bounded cards.

CSS still owns tracks and height; observed row geometry maps scroll position to
collection indices. Very tall logical grids use a compressed, browser-safe scroll
extent; local tile spacing and logical ARIA indices stay unchanged. This keeps
100,000 tall tiles reachable even in a single-column phone layout. Resize preserves the first visible logical row and keeps the
active tile mounted. Scrolling and focus reveal are immediate, also under reduced
motion. Placeholder cells reserve geometry, have no key or actions and cannot be
selected. A failed page supplies a Retry loading tiles button; failed keyboard
navigation leaves focus at its origin until retry succeeds. A newer navigation,
query, disconnect or focus leaving the component supersedes delayed focus work.
Loading uses `aria-busy`; page scrolling does not announce each successful page.

DOM drafts must live outside the tile: virtual rows can unmount, and reflow may
recreate a tile in a different row. Record keys prevent state reuse for a different
record at the same position. The record store retains fetched entities; this is
bounded DOM and collection-page retention, not a hard bound on application memory.

## attr:TileGrid.activeKey

Read-only key of the focused/navigation tile, or `undefined` when empty. Separate
from selection; use the selection's signals to follow selected records.

## method:TileGrid.tileFor

- `key`: a key, or `undefined`.

Returns the tile's gridcell element, or `undefined` when it isn't rendered.

## method:TileGrid.focus

- `options`: native `FocusOptions`.

Focuses the active tile or, when empty, the grid. Does not select or activate.

## method:TileGrid.focusTile

- `key`: a loaded record's key.

Focuses and reveals the tile after the next render, without selecting or
activating. Does nothing for an unloaded/absent key. Scrolling is immediate.

## method:TileGrid.focusIndex

- `index`: a nonnegative safe integer, zero-based collection position.

Returns `Promise<boolean>`. Ensures the destination page, reveals and focuses its
record without selection/activation. Returns false for unavailable, failed or
superseded navigation. It does not enumerate preceding pages. A failed navigation
can be retried from the visible retry button. Prefer this for an unloaded position;
`focusTile` only knows keys currently present in collection slots.

## event:TileGrid.tile-open

Bubbling, cancelable event for Enter, double-click and the Open button. Its detail
is [[object:TileOpenDetail]]. The host implements navigation or record opening.

## object:TileOpenDetail

The activation event's detail, containing `key`, the stable record key text.

## attr:TileOpenDetail.key

The key of the record the user activated.

## type:TilePresenter

`(entity: Entity, state: TileState) => TileContent`. Supplies the tile's accessible
name, description and default media. Keep this function cheap and synchronous.

## type:TileRenderer

`(entity: Entity, state: TileState) => View`. Supplies visual content, using the
existing Lit templates and controls. Name/status hooks are in `presentTile`.

## object:TileState

State passed to the presenter, renderer and menu builder.

## attr:TileState.key

Stable record key text, suitable for operations through the data context.

## attr:TileState.index

Zero-based position in the collection, including unloaded positions before it.

## attr:TileState.selected

Whether the shared selection contains this record.

## attr:TileState.focused

Whether it is the active navigation tile; focus may be outside the grid.

## attr:TileState.hidden

Names of fields hidden by the server, as a read-only set. Render a suitable
"Hidden" description instead of treating their null values as empty.

## attr:TileState.selectionOrder

One-based pick order in ordered selection mode, or `undefined` when unordered or
unselected. The shell exposes its rank visually and in the accessible description.

## object:TileContent

Accessible text and optional default visual presentation.

## attr:TileContent.title

Required accessible tile name and the default visible title.

## attr:TileContent.description

Optional description, linked to the tile through `aria-describedby`. Include
useful status and type information without repeating every action label.

## attr:TileContent.image

Optional image URL. Space is reserved; failure reveals the fallback icon.

## attr:TileContent.imageAlt

Alternative for a meaningful image. Default `""` for a decorative thumbnail.

## attr:TileContent.icon

Optional Lit view for the fallback icon. Default a decorative document icon.

### Switching between table and tiles

Supply the same collection and selection to both components. Keep one paged view
connected at a time; the owner retains the component instances, swaps them in the
host, and transfers the navigation key independently of selection. The device
playground's View control demonstrates this with the same 100k collection.

Before detaching an editable table, await `table.finishEditing()` and keep it
visible if that returns false. Expanded custom editors have their own unsaved-
change contract. Save per-view scroll offsets in the host and restore them only
for the same query; `focusKey`/`focusTile` can then reveal the originating record
when its key remains loaded. For an unloaded known position use `focusIndex`.
Both controls publish compatible selection values, so only the connected one
should publish under a given scope key. Sorting preserves selected membership
and pick order; filter changes retain the usual membership-checking semantics.


## attr:TileGrid.selectable

Default `true`. Whether this view allows user selection changes. Set `false` to
remove selection actions and prevent pointer/keyboard selection changes while
continuing to reflect the borrowed Selection's picks. Navigation and other record
actions remain available. Disabling a view never clears the shared selection or
changes its single/multiple/ordered policy.
