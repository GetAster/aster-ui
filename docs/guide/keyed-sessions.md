# Keep work open across views

An application can have several editors, messages or dashboards open at once.
Each needs a stable identity and its own resources. Switching views should retain
unfinished work; closing a view should release its subscriptions and pending work.

`CompositeSessions` manages registered components by key. It uses the same registry
and contracts as JS and compiled YAML compositions. The mail workspace uses it for
message panels and drafts; its YAML still binds ordinary Tabs items and selection.

## Register the panel

A factory receives validated inputs, an owned lifetime, a local scope and activity.
Inputs such as a shared DataContext are borrowed. Register only resources created
for this panel with its lifetime.

```ts
const registry = new CompositeRegistry();
registry.component("Editor", {
  props: { recordId: compositeTypes.string },
  create: ({ props, lifetime, activity }) => {
    const editor = createEditor(props.recordId);
    lifetime.defer(() => editor.releaseSubscriptions());
    return {
      element: editor.element,
      canClose: async signal => !editor.dirty || await confirmDiscard(signal),
      dispose: () => editor.dispose(),
    };
  },
});
const catalog = registry.seal();
```

`createEditor` and `confirmDiscard` are application functions. For a nested compiled
composition, register `compositeComponent(definition, catalog)` instead. Its model
receives the inherited activity as the optional third factory argument.

## Open, select and close

```ts
const sessions = lifetime.own(new CompositeSessions(catalog));
sessions.reconcile([
  { key: "customer-42", type: "Editor", inputs: { recordId: "42" } },
  { key: "customer-19", type: "Editor", inputs: { recordId: "19" } },
]);
sessions.activate("customer-42");
const panel = await sessions.ensure("customer-42");
container.append(panel.element);

// Asks the component's close guard, then removes an accepted session.
await sessions.requestClose("customer-42");
```

Creation is lazy by default. `ensure` and activation share one in-flight creation.
Reconcile the complete desired descriptor list to add, remove or reorder sessions;
existing keys retain their component and host. Duplicate keys and changes to a
key's component type or immutable inputs are rejected. A component may declare
`mutableInputs` when its registered `apply` hook supports updates.

`get(key)` exposes the handle's `status`, `value`, `error`, `activity` and lifetime.
Use these signals in a renderer to show loading or an error and to place the ready
host. `sessions` is the ordered readonly signal of handles. The stable host is
hidden and inert when inactive; retention does not grant permission to run data work.

`remove`, reconciliation removal and owner disposal release resources unconditionally.
They do not ask a user close guard. Pending factories receive an aborted lifetime;
a factory that finishes late still has its returned resource disposed. Use
`requestClose` for a user action that must protect unsaved work.

## Choose background activity

Logical activity is separate from DOM retention. A session's `inactive` policy is
`"pause"` by default; `"continue"` permits work while another session is selected.
A paused ancestor still pauses descendants. This is useful for a retained chart
that should stop polling, or unread counts that should continue within an active
workspace.

```ts
const activity = lifetime.own(new SessionActivity());
const refresh = activity.run(async ({ signal, refresh, markFresh }) => {
  if (refresh) {
    await loadLatest({ signal });
    markFresh();
  }
  return subscribeToChanges({ signal }); // returns an unsubscribe function
});

activity.setActive(false); // aborts this run and releases its subscription
refresh.invalidate();      // records staleness while paused
activity.setActive(true);  // starts a fresh run, with refresh: true
```

Each run gets its own AbortSignal and guarded `markFresh`. A late completion from
an aborted run cannot clear a newer run's staleness. Check the signal before
publishing results when an underlying library cannot cancel its operation. Errors
are exposed through `task.error`; the application chooses its recovery UI.

Activity manages work explicitly registered through `run`. It does not cancel a
shared collection or dispose a borrowed context merely because a panel is hidden.
The mail sample owns a polling timer through this hook and pauses its workspace
activity when the document becomes hidden. Document visibility is an application
choice, rather than an implicit rule for every component.

Sessions and draft values live for the current application visit. Reload restoration
and credential storage require separate application policies.

[Open the mail workspace](../playground/mail.html) ·
[CompositeSessions API](../reference/#class:CompositeSessions)
