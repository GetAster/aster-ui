# Build a tabbed workspace

[Open the Tabs explorer](../examples/tabs.html) to try data-driven tabs, retained panels and a guarded close. The source below the preview is the application that runs there.

## Keep the open tabs as data

Supply `items` with a stable `value` and a label for each tab. Set `closable` on tabs that can be removed and `disabled` on tabs that cannot be activated. The owner updates `value` when Tabs emits `change`.

```javascript
tabs.items = [
  { value: "overview", label: "Overview" },
  { value: "device-1", label: "Design MacBook", closable: true },
];
tabs.value = "overview";
tabs.addEventListener("change", event => {
  if (event.target === tabs) tabs.value = event.detail;
});
```

Check the event target: inputs inside managed panels can also emit bubbling `change` events.

## Render a panel when it is needed

Set `renderPanel` to a synchronous template function. Tabs first renders a panel when its value is activated, then keeps that panel mounted while it is inactive. Inputs retain their DOM state when you switch tabs. Removing an item removes its panel.

Rendering a panel is not an asynchronous resource factory. Let the owning application or a lifecycle-aware child component load data, cancel work and dispose subscriptions. If your screen owns asynchronous loads, handle their loading and error states explicitly.

## Guard a close request

The `close` event asks the owner to close a value. It does not mutate `items`. Track whether the affected record has unsaved work, ask for confirmation when needed, then update the descriptors and choose an adjacent active value. The example uses an Aster dialog for that decision.

Tabs does not decide whether saving means a server write, a local draft or a change to an application model. The example’s Save is for this visit; reload clears those edits.

## Support keyboard and narrow screens

Arrow keys, Home and End move through enabled tabs. Automatic activation selects on movement; `activation = "manual"` waits for Enter or Space. Delete requests close for a closable tab. The strip scrolls horizontally when needed, with explicit scroll buttons and native touch scrolling.

Close buttons appear for the active, hovered or keyboard-focused tab. They retain their space when hidden, and coarse pointers receive larger targets. Keep panel content responsive too; the tab strip cannot make a fixed-width child fit a phone.

See [Tabs](../reference/#class:Tabs) for the full property and event contracts.
