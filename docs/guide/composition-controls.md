# Compose built-in controls and navigation

Aster's built-in controls have shared composition contracts. Use them to connect
forms, grids, tabs, fields and other views to your model without maintaining a
second property list in every application. Start with [Compose a workspace](declarative-workspace.md)
for model ownership and [Check workspace connections](workspace-tooling.md) for
JavaScript checks and optional YAML tooling.

## Select the controls your application uses

This registry excerpt assumes your application's `editorModel` is already defined:

```js
import { asterComponents, defineCompositeRegistry } from "../lib/aster-ui.js";

const authoring = defineCompositeRegistry({
  models: { editor: editorModel },
  components: {
    Form: asterComponents.Form,
    Grid: asterComponents.Grid,
    Tabs: asterComponents.Tabs,
    Sidebar: asterComponents.Sidebar,
  },
});
```

Each entry describes the control's public writable properties, including inherited
field properties. Omitted values preserve the element's defaults. Objects such
as `EditModel`, `Collection` and `Selection` are borrowed through references;
bindings read signal values. Contracts participate in validation, TypeScript
checking and schema export. Complex callbacks and object predicates still need
runtime checks; generated schemas cannot describe every application constraint.

For example, this child excerpt borrows an editor exposed by the model:

```yaml
children:
  details:
    type: Form
    props:
      model: { ref: model.editor }
      sections:
        - title: Device details
          columns: 2
          items: [name, owner]
```

If `model.editor` is a signal containing an editor, use `bind` instead of `ref`.
The [device workspace](../playground/composition.html) uses the shared Grid,
TileGrid and CommandBar adapters. Its renderer bodies and save operation remain
ordinary JavaScript in the linked source.

## Drive navigation from data and state

Sidebar is a controlled navigation view. Its `items` are plain objects and `value`
is the current item ID. Each item has a unique `id` and a `label`; optional fields
include `href`, `icon` (a text glyph), `badge`, `hidden`, `disabled`, `reason` and
nested `children`. Groups use native disclosure controls. Links preserve browser
navigation, including modified clicks. Items without a URL are buttons.

This is complete Sidebar setup inside an existing page:

```js
import { Sidebar } from "../lib/aster-ui.js";

const sidebar = new Sidebar();
sidebar.label = "Device management";
sidebar.items = [
  { id: "devices", label: "Devices", href: "#devices", icon: "▦", badge: "24" },
  { id: "management", label: "Management", children: [
    { id: "policies", label: "Policies", href: "#policies", disabled: true,
      reason: "Policy administration permission required" },
  ] },
];
sidebar.value = "devices";
document.querySelector("main").prepend(sidebar);
```

For application routing, listen for the bubbling, cancelable `navigate` event.
Its detail is the item ID. Prevent default to handle a link yourself, execute the
model's command, and update `value` after navigation is accepted. When a factory
adds listeners, register their removal with its Lifetime. The Sidebar does not
change its own selection or decide whether a dirty workspace can close.

Derive `items` in the model from permission and state signals, and bind the array
to Sidebar. Use `hidden` for unavailable destinations and `disabled` with a reason
for actions users should be able to discover. If the current destination becomes
unavailable, the host chooses its fallback. Server authorization remains with the
service. Set `compact: true` for an icon rail; accessible labels remain present.
Supply a trusted `renderIcon(item)` function for SVG or other templated icons.
In definitions, reference a registered renderer; item data contains text only.
Tab follows native navigation, while Up/Down and Home/End move within visible,
enabled controls. No animation is required for navigation.

## Explore the composed showcase

The [component showcase](../#showcase) uses Sidebar and Composite together. Its
model owns the current category and guarded navigation commands. Choosing a
category activates its preview through a deck; the preview module loads on first
use. Returning to **All examples** restores the gallery. Only the active preview
has an iframe, so inactive demos release their browsing contexts and data work.
Previews restart when you switch categories; use **Open full example** for a
separate working page.

This exercises a different composition shape from the device editor: navigation,
lazy content and borrowed appearance signals. It does not demonstrate persistent
editing sessions or a background-data policy. The implementation is in
`apps/aster/src/pages/showcase.ts` and `showcase-preview.ts` in the repository.
The complete implementation below is read directly from those files at build time.

<details class="example-source">
<summary>Showcase model, registry, definition and host</summary>

<!--showcase-composition-source-->

</details>

<details class="example-source">
<summary>Lazy preview implementation</summary>

<!--showcase-preview-source-->

</details>

## Keep lifecycle operations explicit

Property contracts do not turn methods into configuration. Opening a Dialog or
Window, positioning a Menu, registering Dashboard widget types, coordinating
windows with Workspace and sending toast announcements still use their public
methods. A registered factory performs that setup and owns its cleanup. Native
events keep their documented payloads; connect them to application actions in
trusted JavaScript.

For a new app-local element, use `defineElement` and `elementProperty`, then
`compositeElement(Constructor)`. Its declared properties become composition
inputs automatically. The shared adapters preserve existing controls' public
APIs without changing their implementation or reflecting arbitrary DOM attributes.
