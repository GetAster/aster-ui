# Third-party components

`aster-component` hosts a vendor-owned visual subtree beside an HTML alternative.
The same contract works for ECharts, D3, canvas visualisations or other renderers.
Data remains in public Aster models; adapters translate their signals and actions
to a vendor API. No vendor dependency is required by `@getaster/data` or
`@getaster/elements`. The ECharts module is supplied by the application loader.

The [component playground](../../scripts/site/playground/components.html) has two
examples: server platform totals sharing filters with a paged grid, and loaded
device costs sharing the grid's selection. The first follows the grid's published
advanced/column refinements while excluding its own platform contribution. Grid
refinements are local view state; an external replacement of a borrowed
collection's membership query clears them under the existing grid contract.

### Ownership and updates

Configure a host with `label`, `alternative` and `adapter` before appending it.
The label is an h3; put the component under an appropriate h2 section. The host
renders the alternative through normal Aster signal tracking. The visual surface
is presentation-only (`aria-hidden`); keep vendor focusable controls and HTML
portals out of it. Every interactive visual action needs an HTML keyboard/touch
equivalent in the alternative. A vendor that supplies its own complete accessible
UI can instead live in a purpose-built Aster element; this visual-host contract
does not wrap arbitrary application forms.

Mount waits for a non-zero surface in a visible document. Each mount gets a fresh
private DOM node, initial environment, abort signal and nearest borrowed page
scope. Vendor code owns only that node and its descendants. Ordinary alternative
renders, selection changes and theme updates retain the mounted surface. A
replacement adapter/alternative function, retry or disconnect aborts the old
mount, stops signal tracking and disposes its session. Reconnection mounts afresh.
Late async results are disposed and their nodes remain detached from the current
surface. `mount` must clean up any partially acquired resources if it throws.

`session.update(environment)` is synchronous and runs inside a signals effect.
Read model signals there to subscribe; return no promise and do not write back to
the model during an update. Event handlers perform model changes. Every data or
environment change calls update, including hidden/zero-size transitions; adapters
must pause drawing/timers while hidden and refresh from current state on reveal.
Offscreen scrolling does not count as hidden. No data model is released just
because its component is hidden.

Scope and models passed into the adapter are **borrowed**. A page owns its shared
collection/selection/filter models and releases them when the page closes. An
adapter may acquire its own collection, Groups, Summary, child scope publications
or other resources during mount; its session must release/dispose/withdraw each
on disposal. `PageScope.child()` creates an isolated publication namespace, not
automatic resource disposal. Never dispose the parent scope or a peer's models.
Async work must honour the mount signal and reject stale results independently
when the vendor API cannot cancel it.

### Public data bindings

Use `DataContext.collection`, `groups` and `summary`, and read their public
status/error/value signals. Choose the data coverage deliberately: a loaded-page
chart must label itself as such; local aggregate helpers stay unknown until the
whole collection is complete. Use server Groups/Summary for complete-query totals,
including unloaded records. Render loading/error/empty states in both views; never
leave stale bars presented as current totals after a failed request.

Use `SharedFilters.share` with a named signal contribution for a chart category,
and supply its clear callback so Slicer removal updates the chart. Consumers
exclude their own contributor with `{ self: "chart-name" }`. Value contributions
filter peer lists on the same set; identity selections follow the established
selection-sharing rules. Do not rebuild an independent filtered entity cache.

For record selection pass the same `Selection` instance as the grid/tile grid.
Include each stable `KeyText` in its vendor datum; map a validated event back to
`selection.toggle(key)` or `select(key)`. Never interpret a vendor array index as
an entity identity. Category counts are not record identities: selecting a server
aggregate contributes Criteria, rather than selecting just its currently loaded
members. Use guarded edit APIs for writes; a vendor event cannot bypass save or
validation. Read signals from the same signals runtime as the host.
Respect the action's return value: an ordered selection at its configured limit
can reject a toggle; keep the chart consistent with `Selection.keys` and explain
the limit through the HTML view.

### Theme, geometry and preferences

CSS owns surface geometry. Set `--component-height` on the host (default `16rem`)
and `--component-data-height` for the scrollable HTML data region (default `18rem`),
or override the corresponding CSS classes. A ResizeObserver supplies dimensions
to the adapter. Resizing a chart's internal coordinate system is rendering, not
page layout. Do not measure the viewport to assign positions to Aster panels.

Environment updates include inherited token values, font family, direction,
locale, reduced motion, forced colours and pixel ratio. Host/ancestor attributes,
stylesheet load, resize and media changes refresh the environment. For changes
to CSS through `stylesheet.insertRule` or custom application theme mechanisms
that do not change observed attributes or load a stylesheet, call `host.retry()`
to refresh and remount. Adapters must use text/shape/labels in addition to colour.
The HTML alternative must stay usable in forced colours.

`locale` defaults to the nearest `lang`, then `navigator.language`. Locale is a
renderer input, not a claim that all Aster controls are localised. Register the
vendor's locale packs in the loader and format application values with the same
locale. Check explicit RTL rendering in the adapter; the generic host supplies
direction but cannot translate a vendor's geometry or language.

## class:ComponentHost

The `aster-component` custom element. It is a visual host, with an independently
reactive accessible HTML alternative and a stable, mount-owned vendor node.

```ts
import { ComponentHost, echartsAdapter } from "@getaster/elements";
import { html } from "lit-html";

const host = new ComponentHost();
host.label = "Device totals";
host.alternative = () => html`<p>${summary.values.value?.count ?? "Loading…"} devices</p>`;
host.adapter = echartsAdapter({
  load: () => import("echarts"),
  option: () => ({
    animation: false,
    xAxis: { type: "category", data: ["Devices"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: summary.status.value === "idle"
      ? [Number(summary.values.value?.count ?? 0)] : [] }],
  }),
});
document.querySelector("#charts")!.append(host);
```

The application creates and owns `summary` before this example. Include its error
and retry UI in a production alternative.

## attr:ComponentHost.adapter

A `ComponentAdapter` object. Set `undefined` to dispose the visual session. Keep
the same object when data changes; updates follow signals without remounting.

## attr:ComponentHost.alternative

Required function returning a View with equivalent data and actions. Signal reads
are tracked. The alternative is available before vendor loading and after failure.
Keep the function stable, use keyed rows where appropriate and handle focus when
its data disappears. Without an alternative, mounting remains disabled.

## attr:ComponentHost.label

Visible heading and accessible region name. Default `Chart`.

## attr:ComponentHost.locale

Optional explicit locale. Changing it updates the environment. The ECharts
adapter recreates its vendor instance when the locale changes; record/filter
state remains in the borrowed models.

## method:ComponentHost.retry

Disposes any current session, refreshes the mount and starts again when visible.
The loader must support retries: do not retain a rejected promise indefinitely.
Browsers may cache a failed dynamic import by URL. The playground shares a module
promise and uses a fresh, same-origin URL after a failure; normal loads fetch
only one vendor module across both charts. The host cannot rewrite an opaque
application loader's module specifier.

## event:ComponentHost.component-error

Bubbling event with the original error in `detail`, raised for mount/update or
cleanup failures. Mount/update failures show a neutral message and Retry action;
the HTML alternative stays available. Handle/log errors using application policy;
the host does not expose internal error text in its UI. Failures from a detached
or replaced async mount cannot overwrite the new session's status.

## object:ComponentAdapter

One `mount(context)` hook returning a session, synchronously or asynchronously.
Mount only acquires resources; tracked synchronous data reads belong in update.
Check `context.signal.aborted` after every await. A stale returned session is
disposed, but abandoned partial acquisitions remain the adapter's responsibility.

## object:ComponentMount

Mount-owned `node`, abort `signal`, initial `environment` and nearest borrowed
`scope`. Do not append vendor portals outside node or mutate the host's sibling
HTML alternative. Data ownership is explicit, not inferred from DOM containment.

## object:ComponentSession

`update(environment)` handles signal and environment changes. `dispose()` releases
all mount-owned resources exactly once, including when mount resolves after
cancellation. Cleanup should tolerate the abort having already fired.

## object:ComponentEnvironment

Observed surface width/height, visibility, media preferences, locale/direction,
pixel ratio, theme tokens and font. Width and height are CSS pixels. Visibility
includes document visibility and zero-size/visibility-hidden ancestors, not
viewport intersection. Raw token colours may use modern CSS syntax.

## staticMethod:echartsAdapter

Creates the reference ECharts adapter from an application loader, reactive option
function and optional click mapper. The host never imports ECharts; the playground
alone builds ECharts **6.1.0** as an optional local chunk (a root dev dependency).
Applications may use a modular loader registering only their charts/components.

The adapter uses SVG, complete-option replacement by default, silent updates,
observed-size resize and explicit listener removal/disposal. Locale changes
recreate the vendor instance. Its default surface, font and palette use theme
tokens; use `echartsColors(environment)` for axes/labels and custom series.
Application options can override defaults, except motion/tooltip policies.

Reduced motion disables top-level and per-series animation and universal
transitions. In forced colours, rendering is hidden and the HTML alternative is
the data/action view. Hidden components still read signals but defer drawing.
Tooltips are disabled: values and actions belong in the equivalent HTML view,
and vendor HTML tooltips must not escape the presentation-only subtree. The
adapter does not promise accessibility for arbitrary ECharts options; every
legend, zoom, brush, drilldown or custom action needs an equivalent HTML control.

ECharts' own lifecycle guidance covers [size and disposal](https://echarts.apache.org/handbook/en/concepts/chart-size/)
and [events/actions](https://echarts.apache.org/handbook/en/concepts/event/).
Its [ARIA support](https://echarts.apache.org/handbook/en/best-practices/aria/)
can supplement a chart, but this adapter deliberately uses the independent HTML
alternative for keyboard and assistive-technology operation.

## staticMethod:echartsColors

Converts theme colours through the browser's colour engine into sRGB RGBA values
for vendor parsers that do not understand `oklch()` and other modern CSS syntax.
Call inside option for axes, labels and series. It performs no geometry reads.

## object:EChartsAdapterOptions

`load`, `option`, optional `click` and optional `updateMode` (`"replace"` by
default). The option callback returns chart options, including deliberate
empty/loading/error states. Replacement mode resets the configuration on update.

Choose `updateMode: "merge"` for incremental transitions with stable series IDs
and data names. Matching series merge; absent series are removed using
`replaceMerge: ["series"]`. Other omitted fields retain ECharts values, so clear
them explicitly or use replacement mode when changing configuration shape.
Changing the reduced-motion preference resets options to prevent a merged
per-series override from surviving the preference change. Validate unknown click
payloads before using a datum's key or value.

## object:EChartsRuntime

Structural `init` contract, supplied by the loader. The full ECharts module or a
registered modular build can satisfy it without a runtime dependency in Aster.
Locale packs beyond the vendor's built-ins must be registered by the loader.

## object:EChartsInstance

Structural methods the reference adapter uses: option updates, resize, click
listener attachment/removal and disposal. Vendor instances stay private to their
sessions; cross-component synchronisation uses the data layer.

### D3 uses the same lifecycle

Create a normal `ComponentAdapter`; no D3-specific data layer is needed. The
following sketch assumes `rows` is a signal of `{ key, label }` records and `pick`
is a public selection action. It uses native SVG text, so CSS owns typography and
its vertical rows. For a real chart, its marks/scales are internal rendering.

```js
host.adapter = {
  async mount({ node, signal }) {
    const { select } = await import("d3-selection");
    if (signal.aborted) return { update() {}, dispose() {} };
    const svg = select(node).append("svg").attr("width", "100%").attr("height", "100%");
    return {
      update(env) {
        const current = rows.value; // tracks the public data signal
        svg.style("display", env.visible && !env.forcedColors ? null : "none");
        svg.selectAll("text").data(current, d => d.key).join("text")
          .attr("x", 12).attr("y", (_, i) => 24 + i * 24)
          .attr("fill", env.theme.text).text(d => d.label)
          .on("click.aster", (_, d) => { if (!signal.aborted) pick(d.key); });
      },
      dispose() {
        svg.selectAll("text").on(".aster", null);
        svg.remove();
      },
    };
  },
};
```

Supply `host.alternative` with the same rows and pick action as named HTML buttons.
Use [D3 keyed joins](https://d3js.org/d3-selection/joining) to retain mark identity.
If adding timers, transitions, brushes, simulations or global listeners, stop and
remove them in dispose and pause them while hidden; honour reduced motion. This
is an integration recipe, not a bundled D3 implementation or tested D3 adapter.
