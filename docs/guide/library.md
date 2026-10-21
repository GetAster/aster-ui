# Installation and distribution

Aster UI is available on npm under the **`@getaster` organization**. The initial
release is **`0.1.0-preview.0`**, published under the `next` tag. These are
prereleases; production API stability is not yet promised.

## Install the npm packages

For the data core and UI controls:

```sh
npm install @getaster/data@next @getaster/elements@next
```

Add the optional experimental controls or mock service when needed:

```sh
npm install @getaster/elements-preview@next
npm install --save-dev @getaster/mock@next
```

The mock includes the WASM binary and license notices; no Rust compiler is
needed. The mock, examples and charting vendor runtime are separate from the
production controls. See [Get started](getting-started.md) for the shared data
model and a working example.

Teams with a dependency cooldown policy may need an exception for these newly
published first-party versions. Keep malware checks enabled when granting an
exception. You can also evaluate the browser distribution built from source.

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
