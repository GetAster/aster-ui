# Release notes

Aster UI publishes one version across `@getaster/data`, `@getaster/elements`,
`@getaster/elements-preview` and `@getaster/mock`. The patch number is derived
from the commit count at the release commit (see `VERSION`). The previous
published release is 0.3.0; a later 0.3-line patch (0.3.5) was published
but its installs were still inside the registry's dependency cooldown when
0.4.0 shipped.

## 0.4.42

A window inside its parent in `@getaster/elements` now keeps its distance from
the parent's edges as the parent moves and resizes, and saved placements can
say how far in from an edge it sits.

### Added

- **`WindowAnchor.inset`.** An anchor can carry `inset: { x?, y? }`, the
  distance in pixels inward from each anchored edge, so
  `{ x: "start", y: "start", inset: { x: 120, y: 40 } }` keeps a window 120 px
  from its parent's start edge and 40 px from its top. Default `0`, flush, so
  0.4.40 placements are unchanged. Snapping still anchors flush.

### Changed

- **With `keepInParentRect`, a window's position is relative to its parent.**
  In 0.4.40 a window dropped away from the edges was free and was only pushed
  back inside when its parent resized. It now anchors to the parent's start
  edges at its current distance, moves with the parent, and reports that
  anchor and inset in `placementchange`. Windows without `keepInParentRect`
  are unchanged. Hosts that re-anchored a window to its parent themselves can
  drop that code.

## 0.4.40

Windows in `@getaster/elements` can now be anchored to the edges of their
area, snap there as they're moved, and follow their parent as it resizes.

### Added

- **Window anchors.** A `WindowPlacement` can carry
  `anchor: { x?: "start" | "end"; y?: "start" | "end" }`. An anchored window
  sits flush against those edges of its area (its parent with
  `keepInParentRect`, otherwise the viewport) and stays there when the area
  resizes. Horizontal sides follow text direction. The anchor is reported in
  `placementchange` and saved in workspace snapshots. Placements without one
  behave as before.
- **`Window.snapDistance`.** Dragging or arrow-key moving a window within this
  many pixels of an edge snaps it flush against that edge, live, and anchors
  it there; moving it out of reach frees it. Default `0`, no snapping.
  `placementchange` still fires once, when the drag ends.

### Fixed

- **`keepInParentRect` now follows the parent's size.** Previously the window
  was kept inside its parent only when it moved or the viewport resized, so
  widening a pane beside it could leave the window over the pane. It now
  re-fits when the parent resizes and fires `placementchange` if it moved.

## 0.4.38

Any field in `@getaster/elements` can now put its label before its control,
for toolbars and filter rows, and a window's content can run to its edges.

### Added

- **`labelPosition: "start"` on every bound field**, including Picker,
  Select, Field, NumberField, DateField and TreePicker. With `labelled`, the
  label, its "Optional" marker and Revert sit before the control on the same
  line, centred on it, and follow the text direction. Hints, reasons and
  errors stay below the control. A standalone field's label is as wide as its
  text. In a form whose `titleOrientation` is `"start"`, the form's label
  column sets the width. The default stays `"above"`.
- **`--aster-window-body-padding-inline`**, the window body's side padding.
  It defaults to `--aster-window-inset`, so windows look the same. Set it to
  `0` for content such as a map or canvas that runs to the window's edges,
  while the title keeps its inset.

### Changed

- **Check's `labelPosition` is now the shared `BoundField.labelPosition`**.
  A check still takes `"start"` and `"end"` beside its box, with the same
  behaviour. The new `LabelPosition` type is exported, and
  `CheckLabelPosition` remains as an alias for it.

## 0.4.35

Pages built on `@getaster/elements` can now make compact tool windows and
icon-only toolbars without restyling Aster's markup. A window can fold to its
title bar, and its frame is sized with component variables that `aster-lint`
now accepts.

### Added

- **Icon-only buttons**: with an `icon`, `Button.labelled = false` draws the
  icon alone in a square button. The label becomes the accessible name and
  the hover text. While the button is busy or confirming, that label takes
  over as the name, and a `reason` still replaces the hover text. A button
  without an icon always shows its label.
- **Fold a window to its title bar**: `chrome.fold` draws a Collapse/Expand
  control, and `Window.folded` sets the same state from code. Folded, the
  content stays mounted but hidden, and the window moves but can't be
  resized. It unfolds to the height it had. `WindowPlacement.folded` saves
  and restores the fold, including in `Workspace` snapshots.
- **Window sizing variables**: `--aster-window-title-size`,
  `--aster-window-control-size`, `--aster-window-inset` (the side inset of
  the title, body, footer and status bar) and
  `--aster-window-body-padding-block` join `--aster-window-header-height`.
  Set them on one `aster-window` to size its frame. On a coarse pointer the
  title bar buttons stay 44px.

### Changed

- **A stacked horizontal layout gives each item the full width.** Below 520px
  of container width a responsive `HorizontalLayout` (or horizontal `Stack`)
  becomes a column, and its items now fill that column from the top.
  Previously `align` and `justify` still applied once stacked, so `end`
  pushed items to the right edge and `center` centred them. Both now only
  arrange the row. Set `responsive = false` to keep a row at every width.

### Fixed

- **`aster-lint` accepts component variables in app CSS.** `css-token` no
  longer flags variables from `COMPONENT_VARS`, such as
  `--aster-window-header-height`, which the reference says a page may set on
  one placement. Theme tokens and density sizes are still only for theme
  files.

## 0.4.29

Layouts in `@getaster/elements` now remember more of a person's choices
across reloads. A sidebar can keep its folded groups, and a persisted split
keeps whether its pane was collapsed.

### Added

- **`Sidebar.persist`**: give the sidebar a name and the groups a person
  folds stay folded after a reload. The state is saved in `localStorage`
  under `aster-sidebar:<name>`. Groups no longer in the items are ignored and
  dropped at the next save, and new groups start open. If storage is
  unavailable or holds bad data, every group starts open.

### Changed

- **`Split.persist` now also saves whether the pane is collapsed**, beside its
  width. It saves when the person collapses or restores the pane; setting
  `collapsed` from code is the application's state and is not saved. A saved
  collapsed state applies only while the split is `collapsible`, so a pane
  is never hidden without a control to restore it. Widths saved by earlier
  releases still load.

## 0.4.26

Two additions to `@getaster/elements` for text and navigation. A disclosure
can now sit inside a sentence, and a sidebar item can carry a description.

### Added

- **`aster-disclosure` (`Disclosure`)**, a "show more" toggle inside a line of
  text, such as "raises 12 errors" opening to the list. It is a button with
  `aria-expanded` and `aria-controls`, followed by its content in the same
  flow. It takes `label`, `body` and `open`, and is available from YAML
  composition. A native `<details>` can't do this: inside a `<p>`, the HTML
  parser ends the paragraph before it. `aster-lint`'s `native-details` rule
  now suggests it.
- **`SidebarItem.description`**: more about a destination, such as the path
  of the project a group stands for. It is the item's tooltip and its
  accessible description. A tooltip now lists the compact rail's label, the
  disabled reason and the description, one per line. Before, a disabled item
  in the compact rail showed only its reason.

## 0.4.23

Layout and navigation controls cover more of an application shell, and a new
check keeps applications on Aster's elements and theme. A split can size and
collapse its end pane, for an inspector beside the work, and its collapse
control can sit on the resize bar. Composite placement can put children inside
a split. A checkbox's label can sit beside the box. Sidebar now draws the same
navigation as the showcase, with a caret on the current item. All changes are
in `@getaster/elements`.

### Behaviour changes

- **A composite with a `placement` must mount into the document.** Before, the
  constructor checked that every placed child was inside the composite, so a
  child placed inside an element that renders its content when it connects,
  such as a split's panes, failed with "has no placement", and mounting into a
  detached element worked. Now unknown, duplicate and missing names still fail
  in the constructor, and containment is checked by `Composite.mount()`: a
  child the template drops fails there and the composite is disposed, and
  mounting into an element that isn't in the document throws a `placement`
  error. Mount into an element in the page; composites without a placement are
  unchanged.
- **Sidebar draws the shared navigation look.** The current item is in the
  strong weight with a caret beside it, in place of a filled highlight; badges
  show as counts in the figure face, not pills; and an item without an `icon`
  or `renderIcon` no longer shows its initial, except in the compact rail. A
  folded group that hides the current item carries the caret. Give items icons
  if you relied on the initials, and remove application CSS that restyled the
  sidebar.

### Added

- **`Split.pane`** chooses the sized pane: `"start"` (default) or `"end"`.
  `size`, `min`, `max`, `persist` and collapsing apply to it, and the other
  pane takes the rest, so an end pane keeps its width as the page widens.
- **`Split.chrome.collapse`** places a collapsible split's control: the
  toolbar row above the panes (default), a chevron button on the resize bar
  (`"bar"`), which stays at the edge when the pane collapses, or none
  (`false`), with the host driving `collapsed`. **`Split.labels`** names it,
  such as "Hide the inspector".
- **`Check.labelPosition`** puts a shown label above the box (default), or
  beside it with `"start"` or `"end"`, inside the checkbox's own label, for a
  toolbar toggle or a single option.
- **`SidebarItem.collapsible: false`** shows a group as a labelled section
  that doesn't fold, such as "Pinned".
- **`aster-lint`**, a command in `@getaster/elements`, reports native controls
  and hand-made ARIA widgets that Aster provides as elements, and CSS that
  restyles Aster's markup, uses fixed colours or fonts, or sets theme tokens
  outside a theme file. Each finding names the element and its reference
  entry; an `aster-allow` comment with a reason records an exception. See
  [Check an application](docs/guide/aster-lint.md). The consumer template
  runs it as `bun run lint`.

### Fixed

- A collapsed sidebar group's "›" chevron is no longer clipped.
- Composite placement can put children inside a split's panes and other
  elements that take their content as properties.
- The caret of a caret group, as in tabs and navigation, stays visible in
  forced colours.

## 0.4.14

Grouped menu items now fill the menu row, so hover and keyboard-focus
highlights and pointer targets extend across the available width. This fixes
short action, checkbox, radio and submenu buttons inside menu groups
(`@getaster/elements`). No API changes or migration are required.

## 0.4.13

Lamplight's web fonts no longer shift the page when they arrive. `fonts.css`
now declares metric-matched local fallbacks (`"Bricolage Grotesque Fallback"`
over Arial, `"Fraunces Fallback"` over Georgia and `"Fraunces Fallback Times"`
over Times New Roman), scaled with `size-adjust` and the ascent, descent and
line-gap overrides to the web faces, and Lamplight's `--aster-font-ui` and
`--aster-font-figure` stacks name them ahead of the generic families. Text
set in a fallback takes the width and vertical metrics of the web face, so
the swap moves nothing (`@getaster/elements`). Pages that import
`theme-lamplight.css` or `fonts.css` get this without changes; a page that
preloads the two woff2 files still removes the swap on most connections.

## 0.4.0

This release finishes the host-configuration work: a host can now shape a grid's
capabilities and chrome, a form's validation and save policy, overlay and
navigation behaviour, and a grid's presentation without patching components or
forking the library. A screen can also be compiled from YAML with a package
export, styled with one composed theme import, and started from a standalone
template. The next release's declarations cover every documented API; the
0.3.0 package predates these surfaces.

### Breaking changes

- **`Grid.editable` reads as `CapabilityValue`** (`@getaster/elements`).
  Before: `editable` was a `boolean` on the public `Grid` class. Now it is the
  plain-data capability form, `boolean | readonly string[]`, and the setter also
  accepts a JavaScript predicate. Assigning `grid.editable = true` (or `false`)
  keeps its previous meaning. Code that stores the read value in a `boolean`
  must switch to `CapabilityValue` or narrow it; use `Grid.policy.editable` for
  the full per-field form. The same shape applies to the other capability
  properties (`sortable`, `filterable`, `groupable`, `resizable`, `movable`,
  `hideable`, `freezable`).
- **`RowState.editable` means "some visible, non-computed column may be
  edited".** Before, it reported whether the entity set allowed editing. A row
  whose only editable columns are hidden or computed now reports `false`, which
  is the useful answer for row-level controls. Use the grid's policy or the
  field's own state when the decision is about a specific column.

### Grid capabilities and chrome

- `Grid.policy` (`GridPolicy`, `FieldPolicy`) narrows sorting, filtering,
  grouping, resizing, moving, hiding, freezing and editing globally and per
  field, with boolean, allowlist or predicate values; the schema and server
  capabilities still impose their own ceilings. Refused actions explain why,
  and a drift note appears when policy and server capabilities disagree.
- `Grid.features` describes multi-sort, edit mode, selection appearance and
  column, and paging as plain data. `Grid.chrome` and `Grid.toolbar` compose
  the header, filter row, header menu, paging bar and toolbar with `show*`
  sugar. The sort menu is now a multi-key panel.
- The header and column menus accept additional items and per-field filter
  operator allowlists (`Grid.filterOperators`).
- Cell editing (`editMode: "cell"`), cell selection, and a selection checkbox
  column with a select-all header checkbox are available through configuration.
- Typed event families: sort, filter, criteria and selection changes; row and
  cell click, double-click and context-menu; cancelable edit start and save;
  edit errors and cell changes.
- Loading and error views, `refresh()`, `autoFetch`, and paged mode with
  `pageSize`, `keepPages`, `exactCount` and a paging bar.
- Tree grids pass through reparenting, drop-on-leaves, auto-open, opener and
  icon configuration, cascade selection, and bounded expansion. `scrollToRow`
  and `scrollToCell` scroll without moving focus.

### Grid presentation and labels

- `Grid.presentation` owns column presentation (`title`, `align`, `valueMap`,
  `format`, `cellClass`), row and cell classes (names, ordered rules, or one
  JavaScript predicate), and highlight rules over row or cell values. Values
  stay query values; formatting is display-only.
- `Grid.labels` replaces the grid's built-in labels, with `{name}`
  placeholders for values. It is a configuration surface, not a localisation
  engine.
- `--aster-*` component geometry variables for forms, grids, menus, windows and
  dialogs are documented in the stylesheet contract; `base.css` provides each
  default and an application may override them per placement.

### Forms and fields

- `Form.policy` and `Form.features` configure validation timing, save-on-Enter,
  field defaults (`readOnly`, `disabled`, `required`) and a cancelable
  `form-submit` event. `Form.chrome` controls columns, title orientation,
  inline errors, the error summary and autofocus.
- `FormField` gains `title`, `hint`, `placeholder`, `readOnly`, `disabled`,
  `required` and a named editor or JavaScript-only `control` renderer.
- `EditPolicy` and `EditFieldPolicy` (`@getaster/data`) provide static edit
  defaults through `EditModel.applyPolicy`; page rules that name an effect
  still win, and metadata ceilings still apply. `EditModel.validateField`
  validates one field on demand.
- `DateField` gains bounds, display format, placeholder and dismiss-on-select;
  `Switch` gains disabled, read-only and on/off labels; `Button` gains tone,
  size and variant sugars; select and choice controls gain filtering, a clear
  action and a no-results message.

### Overlays and navigation

- `Window` and `Dialog` configuration covers header, footer, status, close
  button, modality, dismissal and initial focus and placement. A modal window
  falls back to a non-modal stacking when another modal is already open.
- `Menu` adds icons, shortcuts, submenu direction, auto-dismiss, an empty
  message, and `aria-keyshortcuts` mirroring in right-to-left layouts.
- `Accordion` adds multiple or mutex visibility, close, reorder and
  collapse-all capabilities, with cancelable close and reorder requests.
- `Section` gains panel chrome, collapsible and footer configuration, and
  `canClose` gating the close control. Tree navigators gain a loaded-level
  search.

### Composition and onboarding

- **`@getaster/elements/yaml`** exports `compileCompositeYaml`, the compiler
  behind the repository CLI. It returns the plain-data definition and its
  file/line/column sources; `defineCompositeRegistry(...).validate(definition,
  sources)` checks names and properties before mounting. YAML carries no code:
  tags, anchors, aliases and functions are rejected.
- **`styles/theme-lamplight.css` and `styles/theme-harbour.css`** compose the
  base primitives, element styles and one identity in the required order.
  Lamplight's entry also loads the packaged Bricolage Grotesque and Fraunces
  Latin faces; `styles/fonts.css` declares them in a form that survives Bun's
  CSS minifier.
- **`@getaster/mock` exports `wasm/odata_mock.wasm`**, and its documentation
  states the browser contract: a page asks for the root-relative
  `odata_mock.wasm` route, and the development server serves the installed file
  there. `createMockService` already accepted bytes, a `URL` or a URL string.
- **A consumer template** (`templates/consumer`, published separately as
  `GetAster/aster-ui-template`) demonstrates install, YAML compilation, a data
  context over the mock, the composed theme and a static build.

### Fixed

- A shared grid no longer keeps filters or advanced criteria that its policy
  refuses; the refused entries leave the shared query but stay in the stored
  view and take effect again when permission returns.
- Paged Shift-selection selects the visible endpoints and the records between
  them by pointer and keyboard, instead of page-relative positions in the full
  collection.
- A rejected ordered tree cascade leaves the entire selection unchanged and
  explains the refusal, instead of partially applying it.
- Tree Shift-selection follows the visible tree order rather than collection
  order.
- Paged grids announce row counts and row indices that stay mutually
  consistent.
- Exact Int64 and Decimal values format, compare and match hilites without
  floating-point loss; a rounding carry that grows the integer part no longer
  moves the decimal point.
- Number-format configuration the platform cannot render — a malformed
  currency code, fraction digits outside the supported range, or a minimum
  above the maximum — is rejected when the presentation is set, naming the
  offending entry, instead of throwing at render time.
- Changing a window's modality while it is open keeps the current panel and
  any draft; the new modality still applies on the next opening.
- Shared buttons keep a visible edge in forced colours, where shadows are
  dropped.
- Native select controls now follow the active theme in both schemes instead of
  retaining browser default styling.
- An inline grid edit ends when Escape reaches the grid during its first frame.
- A modal window no longer throws when it cannot stack on another open modal;
  it falls back to non-modal stacking.
- The documentation site's colour-scheme picker is a themed listbox, with
  consistent keyboard and assistive-technology behaviour.
