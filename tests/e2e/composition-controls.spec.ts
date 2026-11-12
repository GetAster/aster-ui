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
      invalid: [diagnostics("NumberField", { step: "-0.1" }), diagnostics("NumberField", { min: "not a number" }), diagnostics("Breadcrumbs", { items: [{ id: "unsafe", label: "Unsafe", href: "javascript:alert(1)" }] }), diagnostics("Accordion", { items: [{ id: "same", heading: "One" }, { id: "same", heading: "Two" }] }), diagnostics("Grid", { selectable: "yes" }), diagnostics("Grid", { policy: { sortable: "name" } }), diagnostics("Grid", { sortable: (field: string) => field === "name" }), diagnostics("Grid", { features: { kind: "page" } }), diagnostics("Grid", { features: [{ kind: "resize" }] }), diagnostics("Grid", { features: [{ kind: "edit", mode: "form" }] }), diagnostics("Grid", { features: [{ kind: "select", appearance: "checkbox" }] }), diagnostics("Grid", { multiSort: "no" }), diagnostics("Grid", { editMode: "form" }), diagnostics("Grid", { selectionAppearance: "checkbox" }), diagnostics("Grid", { selectionColumn: "yes" }), diagnostics("Grid", { autoFetch: "no" }), diagnostics("Grid", { pageSize: 0 }), diagnostics("Grid", { keepPages: "many" }), diagnostics("Grid", { exactCount: "yes" }), diagnostics("Grid", { toolbar: { expandAll: "no" } }), diagnostics("Grid", { tree: { parentField: "parentId", autoOpen: -1 } }), diagnostics("Grid", { tree: { parentField: "parentId", cascadeSelection: "yes" } }), diagnostics("Grid", { tree: { parentField: "parentId", pageSize: 0 } }), diagnostics("Grid", { loadingMessage: 42 }), diagnostics("Grid", { error: () => undefined }), diagnostics("Grid", { columnMenu: true }), diagnostics("Grid", { filterOperators: { hours: "gt" } }), diagnostics("Grid", { chrome: { headerMenu: "no" } }), diagnostics("Grid", { showHeaderMenu: "no" }), diagnostics("Tabs", { activation: "sometimes" }), diagnostics("Form", { sections: [null] }), diagnostics("Sidebar", { items: [{ id: "bad", label: "Bad", href: "javascript:alert(1)" }] }), diagnostics("Section", { chrome: { status: "sometimes" } }), diagnostics("Disclosure", { open: "yes" }), diagnostics("Sidebar", { items: [{ id: "repo", label: "Repo", description: 42 }] }), diagnostics("Sidebar", { persist: 7 })],
      valid: [diagnostics("Disclosure", { label: "12 errors", open: true }), diagnostics("Sidebar", { persist: "charts" }), diagnostics("Split", { persist: "inspector", collapsible: true }), diagnostics("Sidebar", { items: [{ id: "repo", label: "ferriskey", description: "~/dev/ferriskey", children: [{ id: "chart", label: "Login" }] }] }), diagnostics("Form", { sections: [{ title: "Details", items: ["name"] }] }), diagnostics("Section", { chrome: { titleBar: true, status: "always" }, collapsible: false }), diagnostics("Grid", { features: [{ kind: "sort", multi: false }, { kind: "edit", mode: "cell" }, { kind: "select", appearance: "cell", column: true }, { kind: "page" }] }), diagnostics("Grid", { filterOperators: { hours: ["gt", "ge"] } }), diagnostics("Grid", { autoFetch: false, loadingMessage: "Fetching rows…" }), diagnostics("Grid", { pageSize: 50, keepPages: 4, exactCount: true }), diagnostics("Grid", { toolbar: { expandAll: false }, tree: { parentField: "parentId", draggable: true, reparent: false, dropOnLeaves: false, autoOpen: 2, showOpener: false, cascadeSelection: true, pageSize: 50, matchLimit: 100, openLimit: 20 } })],
      validPolicy: diagnostics("Grid", { policy: { sortable: false, filterable: ["name"], groupable: ["name"], resizable: false, movable: true, hideable: ["name"], freezable: true, fields: { name: { editable: false, groupable: false, resizable: true, movable: false, hideable: true, freezable: false } } } }),
    };
  });
  expect(result.count).toBe(38);
  expect(result.missing).toEqual([]);
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  expect(result.validPolicy).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});

test("Grid chrome and toolbar validator accepts the YAML data forms and rejects the rest", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const authoring = lib.defineCompositeRegistry({ models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) }, components: lib.asterComponents });
    const diagnostics = (props: object) => authoring.diagnostics({ version: 1, name: "Chrome", model: { type: "empty" }, children: { grid: { type: "Grid", props } }, layout: { child: "grid" } });
    return {
      valid: diagnostics({ chrome: { toolbar: false, header: false, filterRow: "auto", headerMenu: false, pagingBar: false }, toolbar: { count: true, sort: false, filters: false, advanced: false, columns: false, views: false }, showHeader: false, showToolbar: false, showFilterRow: false, showHeaderMenu: false, showPagingBar: false }),
      forcedFilterRow: diagnostics({ chrome: { filterRow: true } }),
      badFilterRow: diagnostics({ chrome: { filterRow: "sometimes" } }),
      badChrome: diagnostics({ chrome: { header: "no" } }),
      badHeaderMenu: diagnostics({ chrome: { headerMenu: "no" } }),
      badToolbar: diagnostics({ toolbar: false }),
      badExtra: diagnostics({ toolbar: { extra: "not a view" } }),
      badSugar: diagnostics({ showHeader: "no" }),
    };
  });
  expect(result.valid).toEqual([]);
  expect(result.forcedFilterRow).toEqual([]);
  for (const diagnostics of [result.badFilterRow, result.badChrome, result.badHeaderMenu, result.badToolbar, result.badExtra, result.badSugar]) expect(diagnostics).toHaveLength(1);
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
  const chevron = () => nav.locator("summary").first().evaluate(el => {
    const after = getComputedStyle(el, "::after");
    return { content: after.content, width: parseFloat(after.width), em: parseFloat(after.fontSize) };
  });
  await nav.locator("summary").first().evaluate(el => (el.parentElement as HTMLDetailsElement).open = false);
  const closed = await chevron();
  expect(closed.content).toBe('"›"');
  // A flex item that may shrink clips the glyph; the chevron keeps a whole em.
  expect(closed.width).toBeGreaterThanOrEqual(closed.em * 0.99);
  await nav.locator("summary").first().evaluate(el => (el.parentElement as HTMLDetailsElement).open = true);
  await nav.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Devices", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Devices", exact: true }).press("Home");
  await expect(nav.getByRole("link", { name: "Home 3", exact: true })).toBeFocused();
  // The caret marks the current item; a folded group that hides it carries the caret instead.
  const caret = nav.locator("aster-caret-group > .aster-caret");
  await expect(caret).toHaveCSS("opacity", "1");
  const caretTop = async () => (await caret.boundingBox())!.y;
  const devices = nav.getByRole("button", { name: "Devices", exact: true });
  await expect.poll(async () => Math.abs(await caretTop() - (await devices.boundingBox())!.y)).toBeLessThan(12);
  const group = nav.locator("summary").first();
  await group.click();
  await expect(group).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => Math.abs(await caretTop() - (await group.boundingBox())!.y)).toBeLessThan(12);
  await group.click();
  await expect(group).not.toHaveAttribute("aria-current");
  // Counts use the figure face; an item without an icon shows none outside the compact rail.
  await expect(nav.locator(".aster-count").first()).toHaveClass(/aster-figure-text/);
  await expect(nav.getByRole("link", { name: "Home 3", exact: true }).locator(".aster-sidebar-icon")).toHaveCount(0);
  // A group that doesn't fold is a labelled section.
  await page.locator("#test-sidebar").evaluate((element: any) => {
    element.items = [{ id: "home", label: "Home", href: "#home" }, { id: "pinned", label: "Pinned", collapsible: false, children: [{ id: "spring", label: "Spring launch" }] }];
  });
  await expect(nav.locator("summary")).toHaveCount(0);
  await expect(nav.getByRole("list", { name: "Pinned", exact: true }).getByRole("button", { name: "Spring launch", exact: true })).toBeVisible();
  await expect(nav.locator(".aster-nav-label")).toHaveText("Pinned");
  const invalid = await page.locator("#test-sidebar").evaluate((element: any) => {
    try { element.items = [{ id: "home", label: "Home", href: "#home", collapsible: false }]; return "accepted"; } catch (error) { return (error as Error).name; }
  });
  expect(invalid).toBe("TypeError");
  // A description is the tooltip and the accessible description, on groups, items and sections.
  await page.locator("#test-sidebar").evaluate((element: any) => {
    element.items = [{ id: "repo", label: "ferriskey", description: "~/dev/ferriskey", children: [{ id: "login", label: "Login", href: "#login", description: "Sign-in flow" }] },
      { id: "pinned", label: "Pinned", collapsible: false, description: "Kept at the top", children: [{ id: "spring", label: "Spring launch" }] }];
  });
  await expect(nav.locator("summary")).toHaveAttribute("title", "~/dev/ferriskey");
  await expect(nav.locator("summary")).toHaveAccessibleDescription("~/dev/ferriskey");
  await expect(nav.getByRole("link", { name: "Login", exact: true })).toHaveAccessibleDescription("Sign-in flow");
  await expect(nav.getByRole("list", { name: "Pinned", exact: true })).toHaveAccessibleDescription("Kept at the top");
  await expect(nav.locator(".aster-nav-label")).toHaveAttribute("title", "Kept at the top");
  await page.locator("#test-sidebar").evaluate((element: any) => {
    element.compact = true;
    element.items = [{ id: "home", label: "Home", href: "#home" }, { id: "devices", label: "Devices", disabled: true, reason: "Access revoked" }];
  });
  await expect(nav.getByRole("button", { name: /Devices.*Access revoked/ })).toBeDisabled();
  await expect(nav.getByRole("button", { name: /Devices/ })).toHaveAttribute("title", "Devices\nAccess revoked");
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home", exact: true }).locator(".aster-sidebar-icon")).toHaveText("H");
  const violations = (await new AxeBuilder({ page }).include("#test-sidebar").analyze()).violations;
  expect(violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("Sidebar keeps a viewer's folded groups across reloads with persist", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const items = [{ id: "ferriskey", label: "ferriskey", children: [{ id: "login", label: "Login" }] },
    { id: "webdata", label: "webdata", children: [{ id: "query", label: "Query" }] }];
  const mount = (stored?: string) => page.evaluate(async ({ items, stored }) => {
    if (stored === undefined) localStorage.removeItem("aster-sidebar:charts"); else localStorage.setItem("aster-sidebar:charts", stored);
    const { Sidebar } = await import("/lib/aster-ui.js" as string);
    document.querySelector("#persist-sidebar")?.remove();
    const sidebar = new Sidebar(); sidebar.id = "persist-sidebar"; sidebar.label = "Charts";
    sidebar.items = items; sidebar.persist = "charts";
    document.querySelector("main")!.prepend(sidebar);
  }, { items, stored });
  const nav = page.getByRole("navigation", { name: "Charts" });
  const group = (name: string) => nav.locator("summary", { hasText: name });
  const isOpen = (name: string) => group(name).evaluate(el => (el.parentElement as HTMLDetailsElement).open);
  const stored = () => page.evaluate(() => localStorage.getItem("aster-sidebar:charts"));
  await mount();
  expect(await isOpen("ferriskey")).toBe(true);
  await group("ferriskey").click();
  await expect.poll(stored).toBe('["ferriskey"]');
  // Remounting reads the stored folds; a stored group that has gone is ignored, and dropped on the next save.
  await mount('["ferriskey","gone"]');
  expect(await isOpen("ferriskey")).toBe(false);
  expect(await isOpen("webdata")).toBe(true);
  await group("webdata").click();
  await expect.poll(stored).toBe('["ferriskey","webdata"]');
  await group("ferriskey").click();
  await expect.poll(stored).toBe('["webdata"]');
  // Bad data leaves every group open and doesn't throw.
  for (const bad of ["{not json", '{"ferriskey":true}', "[1,null]"]) {
    await mount(bad);
    expect([bad, await isOpen("ferriskey"), await isOpen("webdata")]).toEqual([bad, true, true]);
  }
  await page.evaluate(() => { localStorage.removeItem("aster-sidebar:charts"); document.querySelector("#persist-sidebar")?.remove(); });
});

test("Disclosure opens its content in the line of text it sits in", async ({ page }) => {
  await page.goto("/playground/composition.html");
  await page.evaluate(async () => {
    const { html, render } = await import("/lib/aster-ui.js" as string);
    const host = document.createElement("div"); host.id = "test-disclosure";
    document.querySelector("main")!.prepend(host);
    render(html`<p>authorize(request) raises <aster-disclosure .label=${"4 errors"}
      .body=${html`<code>invalid_grant</code>, <a href="#scope">invalid_scope</a>, <code>access_denied</code>, <code>server_error</code>`}></aster-disclosure></p>`, host);
  });
  const host = page.locator("#test-disclosure");
  // It stays inside the paragraph, unlike a native <details>, which the parser moves out of it.
  await expect(host.locator("p > aster-disclosure")).toHaveCount(1);
  const toggle = host.getByRole("button", { name: "4 errors", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(host.getByText("invalid_grant")).toBeHidden();
  const text = await host.locator("p").evaluate(p => { const r = document.createRange(); r.setStart(p.firstChild!, 0); r.setEnd(p.firstChild!, 5); return r.getBoundingClientRect().y; });
  expect(Math.abs((await toggle.boundingBox())!.y - text)).toBeLessThan(6);
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(host.locator("aster-disclosure")).toHaveAttribute("data-open", "");
  await expect(host.getByText("invalid_grant")).toBeVisible();
  // Closing with focus inside the content returns focus to the button.
  await host.getByRole("link", { name: "invalid_scope" }).focus();
  await host.locator("aster-disclosure").evaluate((element: any) => { element.open = false; });
  await expect(toggle).toBeFocused();
  await expect(host.getByText("invalid_grant")).toBeHidden();
  await toggle.click();
  await expect(host.getByText("invalid_grant")).toBeVisible();
  const violations = (await new AxeBuilder({ page }).include("#test-disclosure").analyze()).violations;
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
  await nav.getByRole("link", { name: "Advanced filtering", exact: true }).click();
  await expect(page.locator(".showcase-live-preview")).toHaveCount(1);
  await expect(page.frameLocator(".showcase-live-preview").getByRole("heading", { name: "Advanced filtering", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Advanced filtering", exact: true })).toHaveAttribute("aria-current", "page");
  expect(modules).toHaveLength(initialModules + 1);
  const preview = page.frameLocator(".showcase-live-preview");
  await preview.locator("html").evaluate(() => { (globalThis as any).appearanceSentinel = "preserved"; });
  await page.getByRole("button", { name: "Dim", exact: true }).click();
  await expect(preview.locator("html")).toHaveAttribute("data-scheme", "dark");
  expect(await preview.locator("html").evaluate(() => (globalThis as any).appearanceSentinel)).toBe("preserved");
  await nav.getByRole("link", { name: "Tabs", exact: true }).click();
  await expect(page.locator(".showcase-live-preview")).toHaveCount(1);
  await expect(page.frameLocator(".showcase-live-preview").getByRole("heading", { name: "Tabs", exact: true })).toBeVisible();
  expect(modules).toHaveLength(initialModules + 1);
  await expect(page).toHaveURL(/#showcase\/tabs$/);
  await page.goBack();
  await expect(preview.getByRole("heading", { name: "Advanced filtering", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Advanced filtering", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(preview.getByRole("heading", { name: "Tabs", exact: true })).toBeVisible();
  await page.reload();
  await expect(preview.getByRole("heading", { name: "Tabs", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "All examples", exact: true }).click();
  await expect(page.locator(".showcase-live-preview")).toHaveCount(0);
  await expect(page.locator(".showcase-open")).toHaveCount(10);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
