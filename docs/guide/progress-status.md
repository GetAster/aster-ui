# Show progress without flashing

Fast data updates should not flash a loading message. Slower work needs feedback,
and failures need an immediate explanation. Aster provides a shared timing policy
for progress status, including grid summaries and optional component loading.

By default, a status appears after **250 ms**. Once shown, it stays visible for at
least **400 ms**, switching to completion text if the work finishes during that
interval. Results, errors and the real busy state update immediately. The minimum
visible interval never holds back data or keeps actions disabled.

## Set application or region defaults

```javascript
import { provideProgressPolicy } from "@getaster/elements";

provideProgressPolicy(document.documentElement, {
  delayMs: 300,
  minVisibleMs: 500,
});

// A region can override either setting and inherit the other.
provideProgressPolicy(document.querySelector("#reports"), {
  delayMs: 400,
});
```

Providers follow DOM ancestry, including shadow hosts. Calling the function again
updates mounted descendants, including work already in progress. Pass `{}` to
remove that region's overrides. Application settings are scoped to their root;
they do not mutate a process-wide singleton.

## Override one control

Grid summaries and ComponentHost's vendor-loading status accept `progressPolicy`:

```javascript
grid.progressPolicy = { delayMs: 200, minVisibleMs: 450 };
chartHost.progressPolicy = { delayMs: 500 };
```

Only the specified fields override inherited settings. Zero disables the
corresponding delay or minimum. Timing values must be finite, non-negative integer
milliseconds within the browser timer range.

## Add status to a custom view

Use `ProgressStatus` for application queries, writes or other asynchronous work.
This example uses Lit property bindings and reads the query's public signals:

```javascript
import { ProgressStatus } from "@getaster/elements";
import { html } from "lit-html";

function totalsStatus(groups) {
  return html`<aster-progress-status
    .busy=${groups.status.value === "loading"}
    .error=${groups.status.value === "error" ? "Unable to update totals." : undefined}
    .pendingText=${"Updating totals…"}
    .completeText=${"Totals updated"}
  ></aster-progress-status>`;
}
```

Render this function inside a signal-tracked Aster view. Keep the same element
mounted across updates so its timer and live region remain stable. The control
reserves one text line by default to prevent layout jumps; set `reserveSpace` to
`false` when the surrounding layout already provides space. The status uses an
atomic ARIA live region and no animation, including under reduced motion.

Set the containing data region's `aria-busy` from the **actual** query state.
Use actual busy state for action availability too. Errors appear immediately and
remain until cleared; provide any retry action beside the status. Keep previous
results during a same-query refresh where the data contract allows it.

The [connected charts example](../examples/charts.html) applies this to its server
totals while retaining the chart and accessible table during refresh.

## Declare status in a workspace

`asterComponents.ProgressStatus` exposes the same properties through composition:

```yaml
type: ProgressStatus
props:
  pendingText: Updating totals…
  completeText: Totals updated
  progressPolicy:
    delayMs: 300
    minVisibleMs: 500
```

Register the adapter under `ProgressStatus` in your component registry. Bind
`busy` and `error` to application functions or signals using the workspace's normal
bindings; a static YAML declaration does not start or observe a request itself.

## Build a different presentation

For a custom renderer, use the headless state from `@getaster/data`:

```javascript
import { ProgressState } from "@getaster/data";

const progress = new ProgressState(() => ({
  busy: groups.status.value === "loading",
  error: groups.status.value === "error" ? groups.error.value : undefined,
}), { delayMs: 300, minVisibleMs: 500 });

// Read progress.phase.value in your reactive view:
// idle / waiting: no message; working: pending; complete: finished; error: failure.
// When the owning view closes:
progress.dispose();
```

The source function tracks signal reads. A policy callback can also read signals
for live customisation. Disposing releases timers and subscriptions; it does not
cancel or dispose the borrowed query. `progress.busy` and `progress.error` expose
the actual observed state, independent of presentation timing.

See [ProgressStatus](../reference/#class:ProgressStatus) and
[ProgressState](../reference/#class:ProgressState) for the API.
