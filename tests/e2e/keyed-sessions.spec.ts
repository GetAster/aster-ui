import { test, expect } from "@playwright/test";

test("registered keyed sessions retain DOM, validate updates, guard close and release late factories", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    let created = 0; let disposed = 0; let accepted = false;
    const registry = new lib.CompositeRegistry();
    registry.component("Editor", {
      props: { id: lib.compositeTypes.number, title: lib.compositeTypes.string }, mutableInputs: ["title"],
      create: () => { created++; const element = document.createElement("input"); return { element, canClose: () => accepted, dispose: () => { disposed++; } }; },
      apply: (element: HTMLInputElement, props: { title: string }) => { element.title = props.title; },
    });
    const sessions = new lib.CompositeSessions(registry.seal());
    const descriptors = [{ key: "a", type: "Editor", inputs: { id: 1, title: "First" } }, { key: "b", type: "Editor", inputs: { id: 2, title: "Second" } }];
    sessions.reconcile(descriptors); const initiallyLazy = created === 0;
    sessions.activate("a"); const first = await sessions.ensure("a"); document.querySelector("main")!.append(first.element);
    const input = first.element.firstElementChild as HTMLInputElement; input.value = "Unsent text";
    sessions.activate("b"); await sessions.ensure("b"); const hidden = first.element.hidden && first.element.inert;
    sessions.reconcile([descriptors[1], { ...descriptors[0], inputs: { id: 1, title: "Updated" } }]);
    sessions.activate("a"); const retained = await sessions.ensure("a") === first && input.value === "Unsent text" && input.title === "Updated";
    let immutableRejected = false;
    try { sessions.reconcile([{ key: "a", type: "Editor", inputs: { id: 9, title: "Invalid" } }]); } catch { immutableRejected = true; }
    const refused = !await sessions.requestClose("a"); accepted = true; const closed = await sessions.requestClose("a"); sessions.dispose();
    let finish!: (session: { element: HTMLElement; dispose(): void }) => void; let lateDisposed = 0;
    const lateRegistry = new lib.CompositeRegistry(); lateRegistry.component("Late", { props: {}, create: () => new Promise(resolve => { finish = resolve; }) });
    const late = new lib.CompositeSessions(lateRegistry.seal()); late.reconcile([{ key: "x", type: "Late" }]); const pending = late.ensure("x");
    for (let i = 0; i < 8; i++) await Promise.resolve(); late.remove("x");
    finish({ element: document.createElement("div"), dispose() { lateDisposed++; } });
    await pending.catch(() => {}); late.dispose();
    return { initiallyLazy, hidden, retained, immutableRejected, refused, closed, created, disposed, lateDisposed };
  });
  expect(result).toEqual({ initiallyLazy: true, hidden: true, retained: true, immutableRejected: true, refused: true, closed: true, created: 2, disposed: 2, lateDisposed: 1 });
});

test("registered compiled composites inherit continue and pause activity without remounting", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    let modelActivity: any; let modelCreates = 0;
    const childRegistry = new lib.CompositeRegistry();
    childRegistry.model("Child", { inputs: {}, exports: {}, create: (_inputs: unknown, _lifetime: unknown, activity: unknown) => { modelCreates++; modelActivity = activity; return { values: {} }; } });
    childRegistry.component("View", { props: {}, create: () => ({ element: document.createElement("p") }) });
    const definition = lib.defineComposite({ version: 1, name: "Child", model: { type: "Child" }, children: { view: { type: "View" } }, layout: { child: "view" } });
    const registry = new lib.CompositeRegistry(); registry.component("Nested", lib.compositeComponent(definition, childRegistry.seal(), {}));
    const workspace = new lib.SessionActivity(); const sessions = new lib.CompositeSessions(registry.seal(), { activity: workspace });
    sessions.reconcile([{ key: "nested", type: "Nested", inactive: "continue" }]); sessions.activate("nested"); const first = await sessions.ensure("nested");
    sessions.activate(undefined); const continued = modelActivity.running.value;
    workspace.setActive(false); const paused = !modelActivity.running.value;
    workspace.setActive(true); const resumed = modelActivity.running.value;
    const retained = await sessions.ensure("nested") === first;
    sessions.dispose(); workspace.dispose();
    return { continued, paused, resumed, retained, modelCreates, disposed: modelActivity.lifetime.disposed };
  });
  expect(result).toEqual({ continued: true, paused: true, resumed: true, retained: true, modelCreates: 1, disposed: true });
});
