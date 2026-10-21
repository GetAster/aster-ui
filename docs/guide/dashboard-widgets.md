# Compose a dashboard from live widgets

[Open the dashboard explorer](../examples/dashboard.html) to combine an exact summary, platform chart, notes and a device grid. Change a shared filter or add a record to see the same data flow through different widgets.

## Register widget types before restoring a layout

Use `registerType(type, factory)` to define how a widget session is created. The factory receives the widget’s stable ID, configuration and child page scope. Return the session’s render function and lifecycle hooks, including disposal of resources it owns.

The example registers summary, platforms, devices and notes types, then restores descriptors with IDs such as `summary-1`. The full application source is below the preview. Keep vendor chart loading in the adapter factory, so a chart package stays optional.

## Share data through public models

The example creates one data context, shared filters and a collection. The summary asks for exact aggregates over the filtered query. The grid uses the collection, and the chart publishes filter choices back through the same shared-filter model.

Each widget gets a child scope. Keep widget-specific configuration in that widget and shared business state in the data models or owning page scope. Avoid reaching into another widget’s DOM to obtain its selection or data.

## Separate layout from content

A widget descriptor records its ID, type, title, size and serializable configuration. `dashboard.snapshot()` returns layout state; `dashboard.restore(snapshot)` applies it through the component’s lifecycle and removal guards.

The example saves snapshots in local storage. Notes are retained during layout changes, but their text is not included in a layout snapshot. Persist business records and drafts through an explicit data contract when the application requires them across visits.

## Preserve sessions during layout changes

Moving or resizing a retained widget should keep its existing content and subscriptions. The demo’s notes widget demonstrates that an input draft survives those changes. Its `beforeRemove` hook asks for a decision when the widget has unsaved content.

Return ownership cleanup in the widget’s disposer: stop effects, release collections or summaries created for that widget, and dispose vendor sessions. Shared models belong to the page owner and should remain alive while another widget still uses them.

## Include non-drag controls

Move and Resize handles support arrow keys; the actions menu provides equivalent operations. Maximize gives a widget more room and Escape restores it. CSS spans adapt the dashboard at smaller widths; meaningful order must remain in the DOM.

See [Dashboard](../reference/#class:Dashboard), [PageScope](../reference/#class:PageScope), [SharedFilters](../reference/#class:SharedFilters) and the [third-party component contract](../reference/#class:ComponentHost).
