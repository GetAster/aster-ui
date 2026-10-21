# Application navigation

Sidebar presents data-driven application destinations using native navigation
semantics. See [Built-in controls and navigation](../guide/composition-controls.md)
for setup, permission-derived items and the composed showcase.

## constant:Sidebar

Constructor returned by `defineElement`, registered as `aster-sidebar`. Create
with `new Sidebar()` or declare a child using `asterComponents.Sidebar`.

| Property | Type | Default | Purpose |
|---|---|---|---|
| `items` | readonly SidebarItem[] | `[]` | Navigation items with unique nonempty IDs. |
| `value` | string or undefined | undefined | Current item ID, controlled by the host. |
| `label` | string | Navigation | Accessible name of the navigation landmark. |
| `renderIcon` | function or undefined | undefined | Trusted icon template; default uses the item glyph or initial. |
| `compact` | boolean | false | Icon rail; labels remain accessible. |

Emits a bubbling, cancelable `navigate` event with the item ID as `detail`.
Prevent default for application routing; otherwise links follow their URLs.
Modified link clicks keep native browser behavior. Disabled items never emit
navigation. There is no automatic selection update, routing or close policy.

Tab follows native controls. Up/Down and Home/End focus visible enabled links,
buttons and group disclosures. Groups support native Enter/Space disclosure.
Hidden items are absent. Permission/state changes update through a new items
array or composition binding; the host chooses fallback navigation if needed.
Compact labels, disabled reasons, current-page state and forced-colors styling
remain available without animation.

## object:SidebarItem

An item with required `id` and `label`. Optional `href` makes it a link; absent
`href` makes it a button. `children` makes a disclosure group and cannot coexist
with `href`. Optional `icon` is a text glyph, `badge` is text, `hidden` omits the
item, `disabled` prevents navigation and `reason` explains unavailability.
Disabling a group disables its descendants. IDs are unique across all groups.
Nesting is bounded; links accept relative, fragment, HTTP and HTTPS URLs.
Executable URL schemes are rejected. Labels and icons are rendered as text.

## constant:sidebarItems

The reusable Sidebar item-array contract. Runtime checks enforce shape, unique
IDs, bounded depth and allowed URL protocols. Schema metadata describes the
top-level item properties; recursive descendants retain runtime validation.
