import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { chooseOption } from "./appearance.ts";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/playground/composition.html");
  await expect(page.locator("#workspace .aster-grid-total")).toHaveText("72 rows");
}

test("YAML binds registered commands/renderers, keeps selection and lazily loads retained details", async ({ page }) => {
  const modules: string[] = [];
  page.on("request", request => { if (request.url().includes("composition-details.js")) modules.push(request.url()); });
  await open(page);
  const draftStatus = page.getByRole("status", { name: "Device draft status" });
  await expect(draftStatus).toHaveText("✓ All changes saved");
  expect(modules).toHaveLength(0);
  const save = page.getByRole("button", { name: "Save device", exact: true });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await page.locator("#workspace aster-grid").getByText("Device 001", { exact: true }).click();
  await page.getByRole("button", { name: "Edit selected", exact: true }).click();
  const form = page.getByRole("region", { name: "Device editor" });
  await expect(form).toBeVisible(); expect(modules).toHaveLength(1);
  const name = form.locator("input").first();
  await name.fill("Design workstation"); await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await expect(draftStatus).toContainText("Unsaved changes");
  await page.getByRole("button", { name: "Tiles", exact: true }).click();
  await expect(page.locator("#workspace aster-tile-grid")).toBeVisible();
  await expect(name).toHaveValue("Design workstation");
  const bounds = await page.locator("#workspace").evaluate(root => {
    const tiles = root.querySelector("aster-tile-grid")!.getBoundingClientRect();
    const editor = root.querySelector('[data-child="details"]')!.getBoundingClientRect();
    const scroll = root.querySelector(".aster-tile-grid") as HTMLElement;
    return { overlaps: tiles.bottom > editor.top, scrolls: scroll.scrollHeight > scroll.clientHeight, contained: getComputedStyle(scroll).overflowY };
  });
  expect(bounds.overlaps).toBe(false); expect(bounds.scrolls).toBe(true); expect(bounds.contained).toBe("auto");
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.instance.model.selection.keys.value)).toEqual(["[1]"]);
  await page.keyboard.press("Control+s");
  await expect(page.locator("#status")).toHaveText("Saved. The shared store updated both views.");
  await expect(draftStatus).toContainText("All changes saved");
  await expect(page.locator("#workspace aster-tile-grid").getByText("Design workstation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator("#workspace aster-grid").getByText("Design workstation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit selected", exact: true }).click();
  await expect(form.locator("input").first()).toHaveValue("Design workstation"); expect(modules).toHaveLength(1);
});

test("PageRules guard direct calls and failed writes preserve a correctable draft", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(async () => {
    const action = (globalThis as any).compositionDemo.instance.commands.save;
    try { await action.execute(); return "unexpected"; } catch { return "refused"; }
  })).toBe("refused");
  await page.locator("#workspace aster-grid").getByText("Device 002", { exact: true }).click();
  await page.getByRole("button", { name: "Edit selected", exact: true }).click();
  const name = page.getByRole("region", { name: "Device editor" }).locator("input").first();
  await name.fill("");
  await page.getByRole("button", { name: "Save device", exact: true }).click();
  await expect(page.locator('[data-child="actions"] .aster-command-error')).toContainText("Review the field errors");
  await expect(name).toHaveValue("");
  await name.fill("Corrected device");
  await page.getByRole("button", { name: "Save device", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Saved.");
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.instance.scope.explain("commands.save").length)).toBe(1);
});

test("contextual query and guarded recreation do not silently discard drafts", async ({ page }) => {
  await open(page);
  await page.getByRole("searchbox", { name: "Find a device" }).fill("012");
  await expect(page.locator("#workspace .aster-grid-total")).toHaveText("1 row");
  await page.locator("#workspace aster-grid").getByText("Device 012", { exact: true }).click();
  await page.getByRole("button", { name: "Edit selected", exact: true }).click();
  const name = page.getByRole("region", { name: "Device editor" }).locator("input").first();
  await name.fill("Unsaved device");
  await page.getByRole("button", { name: "Recreate workspace", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(name).toHaveValue("Unsaved device");
  await page.getByRole("button", { name: "Recreate workspace", exact: true }).click();
  await page.getByRole("button", { name: "Discard and recreate", exact: true }).click();
  await expect(page.locator("#workspace .aster-grid-total")).toHaveText("72 rows");
  await expect(page.getByRole("region", { name: "Device editor" })).toBeHidden();
});

test("shared lazy modules and late child factories respect instance lifetimes", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js";
    const { Composite, CompositeRegistry, defineComposite } = await import(url);
    const registry = new CompositeRegistry(); let loads = 0; let disposed = 0; let created = 0;
    registry.model("empty", { inputs: {}, exports: {}, create: () => ({ values: {} }) });
    let finishLoad: any;
    registry.component("Lazy", { props: {}, load: () => { loads++; return new Promise(resolve => { finishLoad = resolve; }); } });
    const definition = defineComposite({ version: 1, name: "Probe", model: { type: "empty" }, children: { view: { type: "Lazy", create: "on-demand" } }, layout: { child: "view" } });
    const first = new Composite(definition, registry); const second = new Composite(definition, registry);
    const pending = second.children.view.ensure();
    await Promise.resolve(); await Promise.resolve(); first.dispose();
    finishLoad(() => { created++; return { element: document.createElement("div"), dispose: () => { disposed++; } }; });
    await pending; second.dispose();
    let finishCreate: any;
    registry.component("Late", { props: {}, create: () => new Promise(resolve => { finishCreate = resolve; }) });
    const late = new Composite({ ...definition, children: { view: { type: "Late" } } }, registry);
    const latePending = late.children.view.ensure().catch(() => {});
    await Promise.resolve(); await Promise.resolve(); late.dispose();
    const node = document.createElement("div");
    finishCreate({ element: node, dispose: () => { disposed++; } }); await latePending;
    return { loads, created, disposed, mountedLate: node.isConnected, closed: late.children.view.status.value };
  });
  expect(result).toEqual({ loads: 1, created: 1, disposed: 2, mountedLate: false, closed: "disposed" });
});

test("failed lazy loads can retry; nonretained views release on deactivation", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { Composite, CompositeRegistry, signal } = await import(url);
    const active = signal(true); let attempts = 0; let releases = 0;
    const registry = new CompositeRegistry(); registry.model("probe", { inputs: {}, exports: { active: { validate: () => true } }, create: () => ({ values: { active } }) });
    registry.component("Retry", { props: {}, load: async () => { if (++attempts === 1) throw new Error("Offline"); return () => ({ element: document.createElement("div"), dispose: () => { releases++; } }); } });
    const owner = new Composite({ version: 1, name: "RetryProbe", model: { type: "probe" }, children: { view: { type: "Retry", create: "on-demand", retain: false } }, layout: { type: "outlet", active: { bind: "model.active" }, content: { child: "view" } } }, registry).mount(document.querySelector("main")!);
    (globalThis as any).retryProbe = { owner, active, attempts: () => attempts, releases: () => releases };
  });
  await page.getByRole("button", { name: "Retry view", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).retryProbe.owner.children.view.status.value)).toBe("ready");
  await page.evaluate(() => { (globalThis as any).retryProbe.active.value = false; });
  expect(await page.evaluate(() => (globalThis as any).retryProbe.releases())).toBe(1);
  await page.evaluate(() => { (globalThis as any).retryProbe.active.value = true; });
  await expect.poll(() => page.evaluate(() => (globalThis as any).retryProbe.owner.children.view.status.value)).toBe("ready");
  expect(await page.evaluate(() => (globalThis as any).retryProbe.attempts())).toBe(2);
  await page.evaluate(() => { (globalThis as any).retryProbe.owner.dispose(); });
  expect(await page.evaluate(() => (globalThis as any).retryProbe.releases())).toBe(2);
});

test("public references and registrations fail with source-located diagnostics", async ({ page }) => {
  await open(page);
  const message = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { Composite } = await import(url);
    const demo = (globalThis as any).compositionDemo;
    const definition = structuredClone(demo.definition); definition.children.tiles.props.renderTile.renderer = "missing";
    try { new Composite(definition, demo.registry, { inputs: { ctx: demo.ctx }, sources: demo.sources }); return "unexpected"; }
    catch (error) { return (error as Error).message; }
  });
  expect(message).toMatch(/composition.ui.yaml:\d+:\d+:/);
  expect(message).toContain("children.tiles.props.renderTile"); expect(message).toContain("missing");
});

test("JS parents compose compiled YAML children with isolated scopes and borrowed resources", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { Composite, CompositeRegistry, PageScope, compositeComponent, scopeOf, signal, valuesPublication } = await import(url);
    const parent = new PageScope(); parent.publish("user", valuesPublication({ allowed: signal(true) }));
    const demo = (globalThis as any).compositionDemo;
    const registry = new CompositeRegistry();
    registry.model("empty", { inputs: {}, exports: {}, create: () => ({ values: {} }) });
    registry.component("YamlWorkspace", compositeComponent(demo.definition, demo.registry, { ctx: { validate: (ctx: any) => ctx === demo.ctx } }));
    const definition = { version: 1, name: "JsParent", model: { type: "empty" }, children: { workspace: { type: "YamlWorkspace", props: { ctx: { ref: "inputs.ctx" } } } }, layout: { child: "workspace" } };
    const first = new Composite(definition, registry, { parentScope: parent, inputs: { ctx: demo.ctx } }).mount(document.querySelector("main")!);
    const second = new Composite(definition, registry, { parentScope: parent, inputs: { ctx: demo.ctx } });
    const one = await first.children.workspace.ensure(); const two = await second.children.workspace.ensure();
    const oneScope = scopeOf(one); const twoScope = scopeOf(two);
    const inherited = oneScope.available("user.allowed").value;
    const isolated = oneScope !== twoScope && oneScope.keys().includes("editor") && !first.scope.keys().includes("editor");
    first.dispose(); second.dispose();
    await demo.instance.model.collection.refresh();
    return { inherited, isolated, withdrawn: oneScope.keys(), rows: demo.instance.model.collection.count.value, parentKeys: parent.keys() };
  });
  expect(result).toEqual({ inherited: true, isolated: true, withdrawn: ["user"], rows: 72, parentKeys: ["user"] });
});

test("reactive contract failures become retryable child errors without uncaught exceptions", async ({ page }) => {
  await open(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { Composite, CompositeRegistry, compositeElement, signal } = await import(url);
    const label = signal("Valid"); const registry = new CompositeRegistry();
    registry.model("state", { inputs: {}, exports: { label: { validate: () => true } }, create: () => ({ values: { label } }) });
    registry.component("Label", compositeElement("div", { textContent: { validate: (value: unknown) => typeof value === "string" } }));
    const owner = new Composite({ version: 1, name: "Bindings", model: { type: "state" }, children: { label: { type: "Label", props: { textContent: { bind: "model.label" } } } }, layout: { child: "label" } }, registry).mount(document.querySelector("main")!);
    await owner.children.label.ensure(); (globalThis as any).bindingProbe = { owner, label }; label.value = 42;
  });
  await expect(page.getByRole("button", { name: "Retry label", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await page.evaluate(() => { (globalThis as any).bindingProbe.label.value = "Recovered"; });
  await page.getByRole("button", { name: "Retry label", exact: true }).click();
  await expect(page.locator('[data-composite="Bindings"]')).toHaveText("Recovered");
  await page.evaluate(() => { (globalThis as any).bindingProbe.owner.dispose(); });
});

test("themes, reduced motion, keyboard actions and narrow layouts remain accessible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await open(page);
  await page.locator("#workspace aster-grid").getByText("Device 001", { exact: true }).click();
  await page.getByRole("button", { name: "Edit selected", exact: true }).click();
  for (const scheme of ["light", "dark"]) {
    await page.evaluate(scheme => { document.documentElement.dataset.scheme = scheme; document.documentElement.style.colorScheme = scheme; }, scheme);
    await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" "))}`)).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Tiles", exact: true }).click();
  await expect(page.locator("#workspace aster-tile-grid")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("per-view selection can be disabled without changing the shared selection policy", async ({ page }) => {
  await open(page);
  await chooseOption(page, "Workspace variant", "Display-only table");
  const grid = page.locator("#workspace aster-grid");
  await expect(grid.locator(".aster-grid-pick")).toHaveCount(0);
  await grid.getByText("Device 001", { exact: true }).click();
  await page.keyboard.press("Space"); await page.keyboard.press("Shift+ArrowDown");
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.instance.model.selection.keys.value)).toEqual([]);
  await page.getByRole("button", { name: "Tiles", exact: true }).click();
  await page.locator("#workspace aster-tile-grid").getByText("Device 002", { exact: true }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(grid.locator('[data-key="[2]"][aria-selected="true"]')).toBeVisible();
  await grid.getByText("Device 003", { exact: true }).click();
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.instance.model.selection.keys.value)).toEqual(["[2]"]);
  await page.getByRole("button", { name: "Tiles", exact: true }).click();
  await page.evaluate(() => { (document.querySelector("#workspace aster-tile-grid") as any).selectable = false; });
  const tiles = page.locator("#workspace aster-tile-grid");
  await tiles.getByText("Device 003", { exact: true }).click(); await page.keyboard.press("Space");
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.instance.model.selection.keys.value)).toEqual(["[2]"]);
  await expect(tiles.getByRole("button", { name: /^Deselect / })).toHaveCount(0);
});

test("declared model inputs and public child replacement produce independent variants", async ({ page }) => {
  await open(page);
  await chooseOption(page, "Workspace variant", "Single selection");
  const grid = page.locator("#workspace aster-grid");
  await grid.getByText("Device 001", { exact: true }).click();
  await grid.getByText("Device 002", { exact: true }).click();
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.instance.model.selection.keys.value)).toEqual(["[2]"]);
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.instance.model.selection.multiple)).toBe(false);
  expect(await page.evaluate(() => (globalThis as any).compositionDemo.definition.model.inputs.selection.multiple)).toBe(true);
  await chooseOption(page, "Workspace variant", "Compact inspector");
  await grid.getByText("Device 001", { exact: true }).click();
  await page.getByRole("button", { name: "Edit selected", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Device inspector", exact: true })).toBeVisible();
  const form = page.getByRole("region", { name: "Device editor" });
  await form.locator("input").first().fill("Guarded variant");
  await chooseOption(page, "Workspace variant", "Standard");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Workspace variant", exact: true })).toHaveText("Compact inspector");
  await expect(form.locator("input").first()).toHaveValue("Guarded variant");
});

test("suppressed lazy children never import and instance overrides preserve owner commands", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { Composite, CompositeRegistry, defineComposite, command } = await import(url);
    const registry = new CompositeRegistry(); let imports = 0; let calls = 0;
    registry.model("probe", { inputs: {}, exports: {}, create: (_: any, lifetime: any) => ({ values: {}, commands: { save: lifetime.own(command({ label: "Save", run: () => ++calls })) } }) });
    registry.component("Lazy", { props: {}, load: async () => { imports++; return () => ({ element: document.createElement("div") }); } });
    const definition = defineComposite({ version: 1, name: "Suppressed", model: { type: "probe" }, commands: { save: { use: "model.commands.save" } }, children: { view: { type: "Lazy", create: "on-demand" } }, customize: { children: { view: { optional: true } } }, layout: { child: "view" } });
    const instance = new Composite(definition, registry, { overrides: { children: { view: { enabled: false } } } });
    let rejected = false; try { await instance.children.view.ensure(); } catch { rejected = true; }
    await instance.commands.save.execute();
    const status = instance.children.view.status.value; instance.dispose();
    return { imports, calls, rejected, status, original: definition.children.view.enabled };
  });
  expect(result).toEqual({ imports: 0, calls: 1, rejected: true, status: "suppressed", original: undefined });
});

test("a modal outside its opener DOM inherits rules and explicitly consumes shared criteria", async ({ page }) => {
  await open(page);
  await page.locator("#workspace aster-grid").getByText("Device 001", { exact: true }).click();
  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { Composite, CompositeRegistry, SharedFilters, command, compositeElement, computed } = await import(url);
    const demo = (globalThis as any).compositionDemo; const filters = new SharedFilters(demo.ctx.schema);
    filters.set({ by: "platform", label: "Linux", set: "Devices", criteria: { op: "eq", field: "platform", value: "Linux" } });
    const registry = new CompositeRegistry();
    registry.model("modal", { inputs: { ctx: { validate: () => true }, filters: { validate: () => true } }, exports: { count: { validate: () => true } }, create: ({ ctx, filters }: any, lifetime: any) => {
      const collection = ctx.collection(filters.query({ set: "Devices" }));
      lifetime.defer(() => ctx.release(collection));
      void collection.loadAll();
      return { values: { count: computed(() => `${collection.count.value ?? 0} contextual devices`) }, commands: { inspect: lifetime.own(command({ label: "Inspect", run: () => "inspected" })) } };
    } });
    registry.component("Count", compositeElement("output", { textContent: { validate: (value: unknown) => typeof value === "string" } }));
    const modal = document.createElement("dialog"); modal.setAttribute("aria-label", "Contextual devices"); document.body.append(modal);
    const instance = new Composite({ version: 1, name: "ContextModal", model: { type: "modal", inputs: { ctx: { ref: "inputs.ctx" }, filters: { ref: "inputs.filters" } } }, commands: { inspect: { use: "model.commands.inspect", enabledWhen: "devices.any" } }, children: { count: { type: "Count", props: { textContent: { bind: "model.count" } } } }, layout: { child: "count" } }, registry, { inputs: { ctx: demo.ctx, filters }, parentScope: demo.instance.scope }).mount(modal);
    modal.showModal(); (globalThis as any).modalProbe = { modal, instance, filters };
  });
  const modal = page.getByRole("dialog", { name: "Contextual devices" });
  await expect(modal).toContainText("24 contextual devices");
  expect(await page.evaluate(() => (globalThis as any).modalProbe.instance.commands.inspect.enabled.value)).toBe(true);
  await page.evaluate(() => {
    (globalThis as any).compositionDemo.instance.model.selection.clear();
    (globalThis as any).modalProbe.filters.clear();
  });
  await expect(modal).toContainText("72 contextual devices");
  expect(await page.evaluate(() => (globalThis as any).modalProbe.instance.commands.inspect.enabled.value)).toBe(false);
  await page.evaluate(() => { const probe = (globalThis as any).modalProbe; probe.instance.dispose(); probe.modal.close(); probe.modal.remove(); });
  await expect(page.locator("#workspace .aster-grid-total")).toHaveText("72 rows");
});

test("declared component properties drive accessors, defaults, YAML validation and metadata", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js";
    const { defineElement, elementProperty, compositeTypes: t, compositeElement, describeCompositeContract, Composite, CompositeRegistry, html } = await import(url);
    const before = document.createElement("probe-declared-status") as any;
    before.caption = "Before upgrade";
    document.body.append(before);
    const fields = {
      caption: elementProperty(t.string, () => "Ready", "Status caption"),
      items: elementProperty(t.array(t.string), () => [], "Status items"),
    };
    const Status = defineElement({ tag: "probe-declared-status", properties: fields,
      render: ({ caption, items }: any) => html`<span>${caption}: ${items.join(",")}</span>` });
    const first = new Status(); const second = new Status();
    first.items = ["one"];
    document.body.append(first, second);
    first.caption = "Updated";
    let badAssignment = "";
    try { first.caption = 42; } catch (error) { badAssignment = String(error); }
    let reserved = "";
    try { defineElement({ tag: "probe-reserved", properties: { connectedCallback: elementProperty(t.string, () => "", "Invalid") }, render: () => html`` }); } catch (error) { reserved = String(error); }
    let badDefault = "";
    const Broken = defineElement({ tag: "probe-invalid-default", properties: { caption: elementProperty(t.string, () => 42, "Caption") }, render: () => html`` });
    try { new Broken(); } catch (error) { badDefault = String(error); }
    let undefinedRejected = false;
    try { first.caption = undefined; } catch { undefinedRejected = true; }
    // A registration derives its allowed keys from the declaration snapshot.
    fields.caption = elementProperty(t.number, () => 0, "Mutated caller declaration");
    const adapter = compositeElement(Status);
    const registry = new CompositeRegistry();
    registry.model("empty", { inputs: {}, exports: {}, create: () => ({ values: {} }) });
    registry.component("Status", adapter);
    const definition = { version: 1, name: "Probe", model: { type: "empty" }, children: { status: { type: "Status", props: { caption: 42 } } }, layout: { child: "status" } };
    let badYaml = "";
    try { new Composite(definition, registry, { sources: { "definition.children.status.props.caption": { file: "probe.ui.yaml", line: 7, column: 5 } } }); } catch (error) { badYaml = String(error); }
    let unknown = "";
    try { new Composite({ ...definition, children: { status: { type: "Status", props: { typo: true } } } }, registry); } catch (error) { unknown = String(error); }
    const host = document.createElement("div"); document.body.append(host);
    const valid = new Composite({ ...definition, children: { status: { type: "Status" } } }, registry).mount(host);
    await valid.children.status.ensure();
    await Promise.resolve(); await Promise.resolve();
    const values = { upgraded: before.textContent, first: first.textContent, second: second.textContent, defaults: host.textContent,
      badAssignment, reserved, badDefault, undefinedRejected, badYaml, unknown,
      metadata: describeCompositeContract(Status.contract), frozen: Object.isFrozen(Status.properties) };
    valid.dispose(); host.remove(); before.remove(); first.remove(); second.remove();
    return values;
  });
  expect(result.upgraded).toBe("Before upgrade: ");
  expect(result.first).toBe("Updated: one");
  expect(result.second).toBe("Ready: ");
  expect(result.defaults).toContain("Ready: ");
  expect(result.badAssignment).toContain("expected string");
  expect(result.badDefault).toContain("expected string");
  expect(result.reserved).toContain("Reserved element property");
  expect(result.undefinedRejected).toBe(true);
  expect(result.badYaml).toContain("probe.ui.yaml:7:5");
  expect(result.badYaml).toContain("children.status.props.caption");
  expect(result.unknown).toContain("unknown input/property");
  expect(result.metadata).toMatchObject({ caption: { description: "Status caption", optional: true, schema: { type: "string" } } });
  expect(result.frozen).toBe(true);
});

test("registry tooling exports a usable schema and checks YAML without mounting models", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const { authoring, definition } = (globalThis as any).compositionDemo;
    const dirty = authoring.complete(definition, "definition.children.status.props.dirty.bind").map((item: any) => item.label);
    const props = authoring.complete(definition, "definition.children.status.props").map((item: any) => item.label);
    const broken = structuredClone(definition); broken.children.status.props.dirty = { bind: "model.message" };
    return { dirty, props, diagnostics: authoring.diagnostics(broken), schema: authoring.schema(definition).$schema };
  });
  expect(result.dirty).toContain("model.dirty"); expect(result.dirty).not.toContain("model.message");
  expect(result.props).toEqual(["label", "dirty", "busy"]);
  expect(result.diagnostics).toEqual([{ path: "definition.children.status.props.dirty", message: "Reference 'model.message' is incompatible with 'dirty'" }]);
  expect(result.schema).toContain("2020-12");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download YAML schema" }).click();
  expect((await download).suggestedFilename()).toBe("composition.schema.json");
});

test("semantic placement keeps activation, retained drafts, scope and ownership", async ({ page }) => {
  await open(page);
  await chooseOption(page, "Workspace variant", "Semantic layout");
  const region = page.getByRole("region", { name: "Device workspace", exact: true });
  await expect(region).toBeVisible();
  await expect(region.locator("header [data-child='actions']")).toBeVisible();
  await region.locator("aster-grid").getByText("Device 001", { exact: true }).click();
  await page.getByRole("button", { name: "Edit selected", exact: true }).click();
  const editor = page.getByRole("region", { name: "Device editor" });
  await editor.locator("input").first().fill("Semantic draft");
  await page.getByRole("button", { name: "Tiles", exact: true }).click();
  await expect(region.locator("aster-grid")).toBeHidden();
  await expect(region.locator("aster-tile-grid")).toBeVisible();
  await expect(editor.locator("input").first()).toHaveValue("Semantic draft");
  await page.getByRole("button", { name: "Save device", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Saved.");
  const failures = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { Composite, html } = await import(url);
    const demo = (globalThis as any).compositionDemo;
    const results = [];
    for (const kind of ["missing", "duplicate", "unknown", "unused"]) {
      try {
        new Composite(demo.definition, demo.registry, { inputs: { ctx: demo.ctx }, ctx: demo.ctx,
          placement: (place: any) => {
            if (kind === "missing") return html`<section></section>`;
            if (kind === "duplicate") return html`${place("status")}${place("status")}`;
            if (kind === "unknown") return html`${place("missing")}`;
            Object.keys(demo.definition.children).forEach(place); return html`<section></section>`;
          },
        });
        results.push("unexpected");
      } catch (error) { results.push(String(error)); }
    }
    return results;
  });
  expect(failures[0]).toContain("has no placement");
  expect(failures[1]).toContain("duplicate placement");
  expect(failures[2]).toContain("unknown child");
  expect(failures[3]).toContain("has no placement");
  expect((await new AxeBuilder({ page }).include("#workspace").analyze()).violations).toEqual([]);
});

test("catalog host inputs fail before factories and catalog capabilities stay sealed", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js";
    const { Composite, defineCompositeRegistry, defineCompositeModel, compositeTypes: t, compositeElement } = await import(url);
    let factories = 0;
    const authoring = defineCompositeRegistry({ inputs: { label: t.string }, models: { empty: defineCompositeModel({ inputs: {}, exports: {}, create: () => { factories++; return { values: {} }; } }) }, components: {} });
    const definition = { version: 1, name: "Host", model: { type: "empty" }, children: {}, layout: { type: "stack", items: [] } };
    const failures = [];
    for (const inputs of [{}, { label: false }, { label: "valid", extra: true }]) {
      try { new Composite(definition, authoring.registry, { inputs }); } catch (error) { failures.push(String(error)); }
    }
    const beforeValid = factories;
    const valid = new Composite(definition, authoring.registry, { inputs: { label: "valid" } }); valid.dispose();
    let sealed = "";
    try { authoring.registry.component("Added", compositeElement("div", {})); } catch (error) { sealed = String(error); }
    return { failures, beforeValid, factories, sealed };
  });
  expect(result.beforeValid).toBe(0); expect(result.factories).toBe(1);
  expect(result.failures).toHaveLength(3);
  expect(result.failures[0]).toContain("inputs.label");
  expect(result.failures[1]).toContain("inputs.label");
  expect(result.failures[2]).toContain("inputs.extra");
  expect(result.sealed).toContain("Registry is sealed");
});

test("forward command aliases resolve consistently and root placement reuses the declared layout", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const url = "/lib/aster-ui.js";
    const { Composite, defineCompositeRegistry, defineCompositeModel, compositeTypes: t, Command, command, html, compositeElement } = await import(url);
    let calls = 0; let disposed = 0;
    const authoring = defineCompositeRegistry({ models: { actions: defineCompositeModel({ inputs: {}, exports: {}, commands: { save: t.instance(Command) }, create: (_: unknown, lifetime: any) => {
      lifetime.defer(() => { disposed++; }); return { values: {}, commands: { save: lifetime.own(command({ label: "Save", run: () => ++calls })) } };
    } }) }, components: { Text: compositeElement("output", { textContent: t.string }) } });
    const definition = { version: 1, name: "Forward", model: { type: "actions" }, commands: { first: { use: "commands.later" }, later: { use: "model.commands.save" } }, children: { message: { type: "Text", props: { textContent: "Ready" } } }, layout: { type: "stack", items: [{ child: "message" }] } };
    const diagnostics = authoring.diagnostics(definition);
    const suggestions = authoring.complete(definition, "definition.commands.first.use").map((item: any) => item.label);
    const schema = authoring.schema(definition) as any;
    const host = document.createElement("div"); document.body.append(host);
    const instance = new Composite(definition, authoring.registry, { placement: authoring.placement(definition, (place: any) => html`<section aria-label="Wrapped screen">${place()}</section>`) }).mount(host);
    await instance.children.message.ensure(); await instance.commands.first.execute();
    const rendered = host.querySelector("section .aster-composite-stack output")?.textContent;
    const commandOrder = Object.keys(instance.commands);
    instance.dispose(); host.remove();
    const cycle = { ...definition, commands: { first: { use: "commands.later" }, later: { use: "commands.first" } } };
    let cycleError = "";
    try { new Composite(cycle, authoring.registry); } catch (error) { cycleError = String(error); }
    return { diagnostics, suggestions, schemaAllows: schema.oneOf[0].properties.commands.properties.first.properties.use.enum.includes("commands.later"), calls, rendered, commandOrder, disposed, cycleError };
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.suggestions).toContain("commands.later"); expect(result.schemaAllows).toBe(true);
  expect(result.calls).toBe(1); expect(result.rendered).toBe("Ready");
  expect(result.commandOrder).toEqual(["first", "later"]);
  expect(result.disposed).toBe(2); expect(result.cycleError).toContain("Command reference cycle");
});
