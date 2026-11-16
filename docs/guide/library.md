# Installation and distribution

Aster UI is available on npm under the **`@getaster` organization**. The **0.4 release line** is published under the default `latest` tag.

The four packages are released together at one version and pin each other
exactly. Install them at the same version; mixing versions installs two copies
of the data model and its element registrations.

## Install the npm packages

For the data core and UI controls:

```sh
npm install @getaster/data @getaster/elements
```

Add the optional experimental controls or mock service when needed:

```sh
npm install @getaster/elements-preview
npm install --save-dev @getaster/mock
```

The mock includes the WASM binary and license notices; no Rust compiler is
needed. The mock, examples and charting vendor runtime are separate from the
production controls. See [Get started](getting-started.md) for the shared data
model and a working example.

## Coding agents and editor tooling

`@getaster/elements` ships an agent skill and a
[Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest).
Place the skill in your project with:

```sh
npx aster-skill          # or bunx; writes .claude/skills/aster-ui and .agents/skills/aster-ui
npx aster-skill check    # exits 1 when a copy is missing or from another version
```

The skill tells Claude Code, Codex and other agents that read those folders to
build every screen through the data layer, including mockups (use the mock
service until a real one exists), to configure elements through properties, and
to run `aster-lint` and the type checker before handing work back. Run it again
after upgrading, or call it from your project's `postinstall` script as the
[consumer template](https://github.com/GetAster/aster-ui-template) does. A
symbolic link at either location is treated as your own copy and left alone.

`custom-elements.json`, named by the package's `customElements` field, lists
every element with its tag, properties and their types and defaults, methods
and events. Editors, Storybook and other tools that read the manifest use it
to describe the elements; it declares no attributes, because Aster elements
are configured through properties.

## Stylesheets

Import one composed theme entry and then your application CSS:

```css
@import "@getaster/elements/styles/theme-lamplight.css";
```

`theme-lamplight.css` and `theme-harbour.css` each compose `base.css`,
`elements.css` and that identity in order. `theme-lamplight.css` also imports
`fonts.css`, which declares the Bricolage Grotesque and Fraunces Latin faces
shipped with the package and the metric-matched local fallbacks that hold
the layout while they download. Import both composed entries only when the
application lets people switch identity.

### The mock's WASM file

`@getaster/mock` ships its engine at `wasm/odata_mock.wasm` inside the package
and exports that path, so `import.meta.resolve("@getaster/mock/wasm/odata_mock.wasm")`
finds it in Node.js and Bun. A browser page normally asks for the
root-relative URL `new URL("odata_mock.wasm", document.baseURI)`, which means
the development or static server must serve the installed file at
`/odata_mock.wasm`. For a different location, pass `wasm` bytes, a `URL` or a
URL string to `createMockService`; see the
[mock reference](../reference/#attr:MockServiceOptions.wasm).

A dependency cooldown policy delays new package versions for several days, so
installs resolve the previous release for a while and `npm view` may not list
the newest one. That is the policy doing its job: use the release it allows, or
ask whoever owns the policy whether an exception is warranted. You can also
evaluate the browser distribution built from source.

## Build the browser distribution

Follow [Run it locally](getting-started.md#run-it-locally) to clone the repository
and install its development dependencies.

`bun run site` builds the library beside the demo, in `dist-local/lib/`:

| File | What |
|---|---|
| `aster-ui.js` | The data layer and every element, with lit-html and signals inside: one ES module, no dependencies. |
| `aster-ui.d.ts` | Its types. They name `lit-html` and `@preact/signals-core` for template and signal types, so a TypeScript project installs those two as type dependencies. |
| `aster-ui.css` | The elements' styles. A theme goes before it. |
| `themes/lamplight.css`, `themes/harbour.css` | The two themes. |
| `aster-ui-preview.js`, `aster-ui-preview.css` | Optional experimental controls; imported separately from the stable module. |
| `aster-ui-mock.js`, `odata_mock.wasm` | The OData mock (aster-odata in WebAssembly), for trying the library without a server. |

## In a page, with no build

```html
<link rel="stylesheet" href="lib/themes/lamplight.css">
<link rel="stylesheet" href="lib/aster-ui.css">
<div id="out"></div>
<script type="module">
  import { DataContext, fetchTransport, html, render } from "./lib/aster-ui.js";

  const ctx = await DataContext.connect(fetchTransport("https://example.com/odata/"));
  render(html`<aster-grid .ctx=${ctx} .set=${"Projects"} .label=${"Projects"}></aster-grid>`,
    document.querySelector("#out"));
</script>
```

Importing the module defines every element. `html` and `render` are lit-html's,
and `signal`, `computed` and `effect` are the signals the data layer uses:
use these, not separate copies, or changes won't reach the elements.

## Names

Everything the stable data and elements packages export, as in the
[API reference](../reference/), with one exception: both have a `Field`. In
`aster-ui.js`, `Field` is the element (`aster-field`) and the metadata type
is `FieldMeta`.

## The playground

`playground/` on the site runs examples against the mock with the demo's
data: a grid, a form and a picker on the same records; page rules; pickers
with columns and chips. The code can be edited and run again (Ctrl+Enter or
Cmd+Enter).

## Keep development assets optional

The stable browser module contains the data layer and stable controls. It does
not include the mock engine, preview components, showcase fixtures or the ECharts
runtime. Load the mock only during development, and import preview components
explicitly when accepting their experimental contracts. A vendor adapter does not
load the vendor library; the application supplies that runtime. See
[connected charts](connected-charts.md) for the complete ECharts integration.

The `lib/demo/` files are showcase fixtures, not application data or a required
production download. A real application connects its own transport. The bundled
browser entry registers all stable elements. Developers working inside the
repository can select workspace imports in their own build; the supported
standalone evaluation path today is the generated browser distribution. Measure
the output used by your application when setting a download budget.
