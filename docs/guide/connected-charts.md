# Connect a chart to application data

[Open the charts explorer](../examples/charts.html) to filter a grid from a chart, share selected devices and update values through the data context. The example uses an injected ECharts adapter; the chart package remains optional.

## Install and bundle ECharts

The runnable example has three source layers. You can inspect all three in the [explorer](../examples/charts.html): `echarts-entry.ts` loads the vendor, `echarts-adapter.ts` implements the lifecycle, and `components.js` supplies queries, chart options and actions.

Install the optional vendor package in the application that owns the chart:

```bash
bun add echarts
```

Create a vendor entry point that exports the ECharts API required by the adapter. The actual entry used by the preview is:

<!--echarts-entry-source-->

In this repository, `bun run site` bundles that entry as `playground/vendor/echarts.js`. For a standalone application with the entry at `src/echarts.ts`, the equivalent browser bundle command is:

```bash
bun build ./src/echarts.ts --target browser --minify --outfile ./public/vendor/echarts.js
```

Serve the result over HTTP. A plain browser does not resolve the bare package import `"echarts"` by itself; the bundler resolves it. The entry’s type-only Aster import is erased from the emitted JavaScript.

## Inject the loader and bind the options

The application imports Aster’s public adapter helper and injects the vendor module:

```javascript
import { echartsAdapter, echartsColors } from "../lib/aster-ui.js";

host.adapter = echartsAdapter({
  load: () => import("./vendor/echarts.js"),
  updateMode: "merge",
  option(environment) {
    const colors = echartsColors(environment);
    const rows = groups.rows.value ?? [];
    return {
      xAxis: { type: "category", data: rows.map(row => row.value) },
      yAxis: { type: "value" },
      series: [{
        id: "platform-counts",
        type: "bar",
        data: rows.map(row => ({ name: String(row.value), value: row.count })),
        itemStyle: { color: colors.accent },
      }],
    };
  },
});
```

Here `host` is an `aster-component` element and `groups` is a grouped query created through the data context. The complete example handles its loading/error states and accessible data table too. Reading signals inside `option` makes those reads part of the host’s reactive update; the application does not need to call `setOption` after every write.

## What the adapter actually does

The explorer now shows the actual adapter implementation, including its vendor API calls. Follow these points through `echarts-adapter.ts`:

1. `mount` awaits the injected loader, checks for cancellation, then calls `runtime.init(node, …)` to create the SVG chart.
2. It registers a chart `click` listener that delegates to the application’s callback.
3. `update` reads the application’s complete options and calls `chart.setOption`. It applies theme colours and the motion preference, and calls `chart.resize` when the observed dimensions change.
4. Hidden or forced-colour presentation uses the host’s alternative view. A locale change recreates the vendor instance.
5. `dispose` unregisters the listener with `off`, then disposes the owned chart instance.

These are the same operations a custom adapter would implement for another visualization library. The helper packages them for ECharts; its source makes the integration explicit.

## Give vendor content a lifecycle

`aster-component` is a `ComponentHost`. It owns a stable surface for vendor content and calls the adapter’s mount, reactive update, resize, visibility and disposal hooks. Let the adapter own its vendor instance, and keep application data in public Aster models.

The example sets `host.adapter = echartsAdapter(...)` with a lazy `load` function. The optional vendor chunk is built from `apps/showcase/src/examples/charts/vendor/echarts.ts`; it is not part of the core Aster UI module. The source selector includes the application integration, vendor entry, Aster adapter implementation, HTML and shared presentation files. The optional ECharts package itself is a separate dependency.

## Make query scope explicit

The platform chart uses grouped server aggregates over the matching query. Its HTML table can choose a platform and publish that choice to `SharedFilters`; the grid follows the resulting query. The chart excludes its own platform choice when asking for category totals, so the other categories remain available.

The cost chart shows the first loaded devices. Its caption says so; it does not claim to summarize every unloaded row. Decide whether a visualization needs exact server aggregates, a bounded loaded window, or a separate server query before choosing its data source.

## Share selection and writes

The cost chart’s data table and the grid use the same `Selection`. Data actions target the selected records when there are picks and otherwise target the displayed records. Writes go through `DataContext`, updating the shared record store and the views that read it.

Keep click handlers at the adapter boundary and translate chart-specific events into public selection or filter operations. Other components should not need to understand the vendor’s series or event format.

## Include accessible alternatives and motion preferences

Supply a meaningful host label and an HTML alternative that exposes the data and equivalent actions. A chart should not be the only way to select a device or filter a category. The example keeps those tables available alongside the visualization.

The adapter receives theme and reduced-motion settings. This example uses
`updateMode: "merge"`, a stable series ID and stable data names so ECharts can
transition individual bars. It keeps the last grouped result visible during a
same-query refresh (including its accessible table) and reserves axis headroom for small count changes. Adding a
Linux device updates the Linux total while the other platform bars stay in place.
The totals still come from a server aggregate refresh; the demo does not guess
aggregate values locally. Record-level cost edits follow the shared record store.
See [ECharts data transitions](https://echarts.apache.org/handbook/en/how-to/animation/transition/)
for its named-data diff behavior.

Merge mode replaces the series list by ID, removing absent series while retaining
matching series. Omitted option fields on matching components keep their ECharts
values; explicitly clear them or use the default `updateMode: "replace"` for a
complete configuration reset. This example requests short update animations;
the adapter disables them for reduced motion. Test changing the scheme, resizing, hiding, showing and remounting, because those operations often expose vendor lifecycle bugs.

## Apply the same contract to another library

The totals table uses Aster's `ProgressStatus`: quick refreshes stay silent,
slower refreshes show “Updating totals…” and then “Totals updated” for any
remaining minimum visible time. Its real `aria-busy` state changes immediately.
Use [shared progress policy](progress-status.html) to customise timing across
the application, a region or an individual control.

For D3 or another renderer, implement the same public host lifecycle: mount inside the provided surface, react to model changes, resize from the host’s measurements and dispose owned listeners, observers and asynchronous work. Keep the accessible alternative and data ownership decisions independent of that renderer.

See [ComponentHost](../reference/#class:ComponentHost), the [adapter and D3 recipe](../reference/#group:components), [DataContext](../reference/#class:DataContext) and [SharedFilters](../reference/#class:SharedFilters).
