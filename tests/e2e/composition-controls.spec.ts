import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("built-in contracts cover public setters and reject invalid props before mounting", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const missing: string[] = [];
    for (const [name, entry] of Object.entries(lib.asterComponents) as [string, any][]) {
      if (name === "Sidebar") continue; // Declared accessors belong to instances.
      for (let proto = lib[name].prototype; proto && proto !== lib.AsterElement.prototype; proto = Object.getPrototypeOf(proto)) {
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (Object.getOwnPropertyDescriptor(proto, key)?.set && !Object.hasOwn(entry.props, key)) missing.push(`${name}.${key}`);
        }
      }
    }
    const authoring = lib.defineCompositeRegistry({ models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) }, components: lib.asterComponents });
    const diagnostics = (type: string, props: object) => authoring.diagnostics({ version: 1, name: "Controls", model: { type: "empty" }, children: { control: { type, props } }, layout: { child: "control" } });
    return { missing, count: Object.keys(lib.asterComponents).length,
      invalid: [diagnostics("NumberField", { step: "-0.1" }), diagnostics("NumberField", { min: "not a number" }), diagnostics("Breadcrumbs", { items: [{ id: "unsafe", label: "Unsafe", href: "javascript:alert(1)" }] }), diagnostics("Accordion", { items: [{ id: "same", heading: "One" }, { id: "same", heading: "Two" }] }), diagnostics("Grid", { selectable: "yes" }), diagnostics("Tabs", { activation: "sometimes" }), diagnostics("Form", { sections: [null] }), diagnostics("Sidebar", { items: [{ id: "bad", label: "Bad", href: "javascript:alert(1)" }] })],
      valid: diagnostics("Form", { sections: [{ title: "Details", items: ["name"] }] }),
    };
  });
  expect(result.count).toBe(36);
  expect(result.missing).toEqual([]);
  expect(result.valid).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});

test("Sidebar supports controlled navigation, permission changes, groups and native links", async ({ page }) => {
  await page.goto("/playground/composition.html");
  await page.evaluate(async () => {
    const { Sidebar } = await import("/lib/aster-ui.js" as string);
    const sidebar = new Sidebar(); sidebar.id = "test-sidebar"; sidebar.label = "Test navigation";
    sidebar.items = [ { id: "home", label: "Home", href: "#home", badge: "3" },
      { id: "group", label: "Management", children: [ { id: "devices", label: "Devices" }, { id: "admin", label: "Admin", disabled: true, reason: "Administrator permission required" } ] },
      { id: "hidden", label: "Hidden", hidden: true } ];
    sidebar.value = "home";
    sidebar.addEventListener("navigate", (event: any) => { event.preventDefault(); sidebar.value = event.detail; });
    document.querySelector("main")!.prepend(sidebar);
  });
  const nav = page.getByRole("navigation", { name: "Test navigation" });
  await expect(nav.getByRole("link", { name: "Home 3", exact: true })).toHaveAttribute("href", "#home");
  await expect(nav.getByRole("button", { name: "Hidden", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: /Admin/ })).toBeDisabled();
  await nav.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Devices", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Devices", exact: true }).press("Home");
  await expect(nav.getByRole("link", { name: "Home 3", exact: true })).toBeFocused();
  await page.locator("#test-sidebar").evaluate((element: any) => {
    element.compact = true;
    element.items = [{ id: "home", label: "Home", href: "#home" }, { id: "devices", label: "Devices", disabled: true, reason: "Access revoked" }];
  });
  await expect(nav.getByRole("button", { name: /Devices.*Access revoked/ })).toBeDisabled();
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  const violations = (await new AxeBuilder({ page }).include("#test-sidebar").analyze()).violations;
  expect(violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("shared Form and field adapters borrow the same editor and release only owned children", async ({ page }) => {
  await page.goto("/playground/composition.html");
  await page.waitForFunction(() => !!(globalThis as any).compositionDemo);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).compositionDemo.ctx;
    const editor = new lib.EditModel(ctx, "Devices", "[1]");
    const authoring = lib.defineCompositeRegistry({ inputs: { editor: lib.compositeTypes.instance(lib.EditModel) },
      models: { editing: lib.defineCompositeModel({ inputs: { editor: lib.compositeTypes.instance(lib.EditModel) }, exports: { editor: lib.compositeTypes.instance(lib.EditModel) }, create: ({ editor }: any) => ({ values: { editor } }) }) },
      components: { Form: lib.asterComponents.Form, Field: lib.asterComponents.Field },
    });
    const definition = authoring.validate({ version: 1, name: "BorrowedEditor", model: { type: "editing", inputs: { editor: { ref: "inputs.editor" } } },
      children: { form: { type: "Form", props: { model: { ref: "model.editor" }, sections: [{ title: "Shared editor", items: ["name"] }] } },
        field: { type: "Field", props: { model: { ref: "model.editor" }, field: "name", label: "Peer name", labelled: true } } },
      layout: { type: "stack", items: [{ child: "form" }, { child: "field" }] },
    });
    const host = document.createElement("section"); host.id = "borrowed-editor"; document.querySelector("main")!.prepend(host);
    const workspace = new lib.Composite(definition, authoring.registry, { inputs: { editor } }).mount(host);
    (globalThis as any).borrowedEditor = { workspace, editor };
  });
  const host = page.locator("#borrowed-editor");
  await host.locator("aster-form input").fill("Shared adapter edit");
  await expect(host.locator("aster-field").last().locator("input")).toHaveValue("Shared adapter edit");
  const state = await page.evaluate(() => {
    const { workspace, editor } = (globalThis as any).borrowedEditor;
    workspace.dispose();
    editor.set("name", "Still usable");
    const result = { value: editor.values.value.name, children: document.querySelector("#borrowed-editor")!.childElementCount };
    editor.dispose(); return result;
  });
  expect(state.value).toBe("Still usable");
  expect(state.children).toBe(0);
});

test("composed showcase loads only the requested preview and releases it on navigation", async ({ page }) => {
  const modules: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.resourceType() === "script" && request.frame() === page.mainFrame()) modules.push(request.url()); });
  await page.goto("/?memory#showcase");
  const nav = page.getByRole("navigation", { name: "Showcase categories" });
  await expect(nav).toBeVisible();
  await expect(page.locator(".showcase-open")).toHaveCount(10);
  const initialModules = modules.length;
  await expect(page.locator(".showcase-live-preview")).toHaveCount(0);
  await nav.getByRole("button", { name: "Advanced filtering", exact: true }).click();
  await expect(page.locator(".showcase-live-preview")).toHaveCount(1);
  await expect(page.frameLocator(".showcase-live-preview").getByRole("heading", { name: "Advanced filtering", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Advanced filtering", exact: true })).toHaveAttribute("aria-current", "page");
  expect(modules).toHaveLength(initialModules + 1);
  const preview = page.frameLocator(".showcase-live-preview");
  await preview.locator("html").evaluate(() => { (globalThis as any).appearanceSentinel = "preserved"; });
  await page.getByRole("button", { name: "Dim", exact: true }).click();
  await expect(preview.locator("html")).toHaveAttribute("data-scheme", "dark");
  expect(await preview.locator("html").evaluate(() => (globalThis as any).appearanceSentinel)).toBe("preserved");
  await nav.getByRole("button", { name: "Tabs", exact: true }).click();
  await expect(page.locator(".showcase-live-preview")).toHaveCount(1);
  await expect(page.frameLocator(".showcase-live-preview").getByRole("heading", { name: "Tabs", exact: true })).toBeVisible();
  expect(modules).toHaveLength(initialModules + 1);
  await nav.getByRole("button", { name: "All examples", exact: true }).click();
  await expect(page.locator(".showcase-live-preview")).toHaveCount(0);
  await expect(page.locator(".showcase-open")).toHaveCount(10);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
