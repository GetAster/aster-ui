import { expect, test } from "bun:test";
import { KeyedSessions, SessionActivity, type SessionDescriptor, type ActivityRun } from "../src/index.ts";
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("keyed sessions create lazily, retain identity across reorder, bound resources on removal", async () => {
  let created = 0; let released = 0;
  const sessions = new KeyedSessions({ create: () => ({ id: ++created, dispose: () => { released++; } }) });
  sessions.reconcile([{ key: "a", type: "editor" }, { key: "b", type: "editor" }]);
  expect(created).toBe(0); sessions.activate("a"); const a = await sessions.ensure("a");
  sessions.reconcile([{ key: "b", type: "editor" }, { key: "a", type: "editor" }]);
  expect(await sessions.ensure("a")).toBe(a); expect(created).toBe(1);
  expect(() => sessions.reconcile([{ key: "a", type: "editor" }, { key: "a", type: "editor" }])).toThrow("Duplicate");
  expect(sessions.sessions.value.map(s => s.descriptor.key)).toEqual(["b", "a"]);
  sessions.reconcile([]); expect(released).toBe(1); sessions.dispose(); expect(released).toBe(1);
});

test("removing pending creation aborts owned work and disposes a late resource exactly once", async () => {
  let finish!: (value: { dispose(): void }) => void; let aborted!: AbortSignal; let owned = 0; let late = 0; let borrowed = 0;
  const service = { dispose() { borrowed++; } };
  const sessions = new KeyedSessions({ create: (_d: SessionDescriptor, mount) => {
    aborted = mount.lifetime.signal; mount.lifetime.own({ dispose() { owned++; } }); void service;
    return new Promise<{ dispose(): void }>(resolve => { finish = resolve; });
  } });
  sessions.reconcile([{ key: "a", type: "preview" }]); const pending = sessions.ensure("a"); await tick();
  sessions.remove("a"); expect(aborted.aborted).toBe(true); expect(owned).toBe(1);
  finish({ dispose() { late++; } }); await expect(pending).rejects.toThrow();
  expect(late).toBe(1); expect(borrowed).toBe(0);
});

test("guarded close coalesces callers and owner disposal bypasses guard", async () => {
  let answer!: (accepted: boolean) => void; let guards = 0; let disposed = 0;
  const sessions = new KeyedSessions({ create: () => ({ canClose: () => { guards++; return new Promise<boolean>(resolve => { answer = resolve; }); }, dispose() { disposed++; } }) });
  sessions.reconcile([{ key: "a", type: "draft" }]); await sessions.ensure("a");
  const first = sessions.requestClose("a"); const second = sessions.requestClose("a"); await tick();
  expect(guards).toBe(1); answer(false); expect(await first).toBe(false); expect(await second).toBe(false);
  const closing = sessions.requestClose("a"); await tick(); sessions.dispose(); answer(true);
  expect(await closing).toBe(false); expect(disposed).toBe(1); expect(sessions.sessions.value).toEqual([]);
});

test("activity pauses cancellation, cleans late acquisition, refreshes on return and constrains nesting", async () => {
  const workspace = new SessionActivity();
  const foreground = new SessionActivity({ parent: workspace, inactive: "pause" });
  const background = new SessionActivity({ parent: workspace, inactive: "continue" });
  const child = new SessionActivity({ parent: foreground, inactive: "continue" });
  const starts: ActivityRun[] = []; let release!: (value: () => void) => void; let cleaned = 0;
  const task = foreground.run(run => { starts.push(run); return new Promise<() => void>(resolve => { release = resolve; }); });
  await tick(); starts[0]!.markFresh(); foreground.setActive(false); background.setActive(false);
  expect(starts[0]!.signal.aborted).toBe(true); expect(child.running.value).toBe(false); expect(background.running.value).toBe(true);
  release(() => { cleaned++; }); await tick(); expect(cleaned).toBe(1);
  foreground.setActive(true); await tick(); expect(starts[1]!.refresh).toBe(true);
  starts[0]!.markFresh(); expect(task.stale.value).toBe(true);
  starts[1]!.markFresh(); task.invalidate(); await tick(); expect(starts).toHaveLength(3); expect(starts[1]!.signal.aborted).toBe(true);
  workspace.setActive(false); expect(background.running.value).toBe(false);
  foreground.dispose(); background.dispose(); child.dispose(); workspace.dispose();
});

test("scope publications and service ownership remain local to each session", async () => {
  const sessions = new KeyedSessions({ create: (_descriptor: SessionDescriptor, mount) => {
    const withdraw = mount.scope.publish("local", { values: {} }); mount.lifetime.defer(withdraw);
    return { dispose() {} };
  } });
  sessions.reconcile([{ key: "one", type: "editor" }, { key: "two", type: "editor" }]);
  await sessions.ensure("one"); await sessions.ensure("two");
  expect(sessions.get("one")!.scope).not.toBe(sessions.get("two")!.scope);
  sessions.dispose();
});


test("descriptor snapshots prevent callers mutating keyed identity and immutable scalar inputs", () => {
  const sessions = new KeyedSessions({ create: () => ({ dispose() {} }) });
  const descriptor = { key: "original", type: "editor", inputs: { id: 1 } };
  sessions.reconcile([descriptor]); descriptor.key = "mutated"; descriptor.inputs.id = 2;
  expect(sessions.get("original")!.descriptor.key).toBe("original");
  expect(sessions.get("original")!.descriptor.inputs?.id).toBe(1);
  expect(() => sessions.reconcile([{ key: "original", type: "editor", inputs: { id: 2 } }])).toThrow("immutable");
  sessions.dispose();
});


test("late creation cannot overwrite a newly reused key and pending updates apply current inputs", async () => {
  let finish!: (resource: { title: string; dispose(): void }) => void; let oldDisposed = 0;
  const sessions = new KeyedSessions<SessionDescriptor, { title: string; dispose(): void }>({
    create: descriptor => descriptor.inputs?.generation === 1 ? new Promise(resolve => { finish = resolve; }) : { title: "new", dispose() {} },
    checkUpdate: () => {}, update: (resource, _previous, next) => { resource.title = String(next.inputs?.title); },
  });
  sessions.reconcile([{ key: "a", type: "editor", inputs: { generation: 1, title: "first" } }]);
  const obsolete = sessions.ensure("a"); await tick(); sessions.remove("a");
  sessions.reconcile([{ key: "a", type: "editor", inputs: { generation: 2, title: "latest" } }]);
  const current = await sessions.ensure("a"); finish({ title: "old", dispose() { oldDisposed++; } });
  await expect(obsolete).rejects.toThrow(); expect(oldDisposed).toBe(1); expect(sessions.get("a")!.value.value).toBe(current);
  expect(current.title).toBe("latest"); sessions.dispose();
});

test("failed acquisition releases partial owned work before retry and owner disposal", async () => {
  let attempts = 0; let released = 0;
  const sessions = new KeyedSessions({ create: (_descriptor: SessionDescriptor, mount) => {
    mount.lifetime.defer(() => { released++; });
    if (++attempts === 1) throw new Error("retryable");
    return { dispose() { released++; } };
  } });
  sessions.reconcile([{ key: "a", type: "editor" }]); await expect(sessions.ensure("a")).rejects.toThrow("retryable");
  expect(released).toBe(1); expect(sessions.get("a")!.status.value).toBe("error");
  await sessions.ensure("a"); sessions.dispose(); expect(released).toBe(3);
});

test("invalidating a paused task defers refresh until resume and task disposal releases subscription", async () => {
  const activity = new SessionActivity({ active: false }); let starts = 0; let released = 0;
  const task = activity.run(run => { starts++; expect(run.refresh).toBe(true); run.markFresh(); return () => { released++; }; });
  task.invalidate(); await tick(); expect(starts).toBe(0);
  activity.setActive(true); await tick(); expect(starts).toBe(1); expect(task.stale.value).toBe(false);
  activity.setActive(false); expect(released).toBe(1); task.invalidate(); await tick(); expect(starts).toBe(1);
  activity.setActive(true); await tick(); expect(starts).toBe(2); task.dispose(); expect(released).toBe(2); activity.dispose();
});


test("malformed JS descriptors reject atomically before removing or updating live sessions", async () => {
  let released = 0;
  const sessions = new KeyedSessions({ create: () => ({ dispose() { released++; } }) });
  sessions.reconcile([{ key: "retained", type: "editor" }]); const retained = await sessions.ensure("retained");
  const invalid: unknown[] = [null, [], { key: 42, type: "editor" }, { key: " ", type: "editor" },
    { key: "new", type: 42 }, { key: "new", type: "" }, { key: "new", type: "editor", lazy: "false" },
    { key: "new", type: "editor", inactive: "typo" }, { key: "new", type: "editor", inputs: [] },
    { key: "new", type: "editor", inputs: null }, { key: "new", type: "editor", inputs: new Date() }];
  for (const descriptor of invalid) {
    expect(() => sessions.reconcile([{ key: "valid-first", type: "editor" }, descriptor] as SessionDescriptor[])).toThrow(TypeError);
    expect(sessions.sessions.value.map(entry => entry.descriptor.key)).toEqual(["retained"]);
    expect(sessions.get("retained")!.value.value).toBe(retained); expect(released).toBe(0);
  }
  const borrowed = { dispose() {} }; const inputs = Object.assign(Object.create(null), { borrowed });
  sessions.reconcile([{ key: "null-prototype", type: "editor", inputs }]);
  expect(sessions.get("null-prototype")!.descriptor.inputs?.borrowed).toBe(borrowed);
  sessions.dispose(); expect(released).toBe(1);
});
