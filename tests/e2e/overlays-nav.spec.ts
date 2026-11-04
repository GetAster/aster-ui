// Overlay and navigation configuration: window and dialog chrome and
// dismissal, menu icons/shortcuts/direction, section and accordion
// capabilities, and the tree navigator's search.
import { expect, test, type Page } from "@playwright/test";

async function mount(page: Page): Promise<void> {
  await page.goto("/playground/composition.html");
  await page.evaluate(async () => { await import("/lib/aster-ui.js" as string); });
}

const windowPanel = (page: Page, id: string) => page.locator(`#${id} .aster-window`);

test("window chrome and its show* sugars keep today's defaults and switch each part", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const w = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    w.id = "chrome-window";
    w.heading = "Help";
    w.content = lib.html`<p>Window body</p>`;
    (window as any).libHtml = lib.html;
    document.body.append(w);
    w.show(null);
  });
  const panel = windowPanel(page, "chrome-window");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".aster-window-bar")).toBeVisible();
  await expect(panel.locator(".aster-window-bar h2")).toHaveText("Help");
  await expect(panel.getByRole("button", { name: "Close Help" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Resize Help" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Minimize|Maximize/ })).toHaveCount(0);
  await expect(panel.locator(".aster-window-footer, .aster-window-status")).toHaveCount(0);

  await page.evaluate(() => {
    const w = document.getElementById("chrome-window") as HTMLElement & Record<string, any>;
    const html = (window as any).libHtml;
    w.chrome = { header: false, title: false, close: false, resizer: false };
    w.footer = html`<button type="button">Apply</button>`;
    w.status = html`Ready`;
  });
  await expect(panel.locator(".aster-window-bar")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Close Help" })).toHaveCount(0);
  await expect(panel).toHaveAttribute("data-resizer", "false");
  await expect(panel).toHaveAttribute("aria-label", "Help");
  await expect(panel.locator(".aster-window-footer").getByRole("button", { name: "Apply" })).toBeVisible();
  await expect(panel.locator(".aster-window-status")).toHaveText("Ready");

  await page.evaluate(() => {
    const w = document.getElementById("chrome-window") as HTMLElement & Record<string, any>;
    w.showFooter = false;
    w.showStatusBar = false;
    w.showHeader = true;
    w.showTitle = true;
    w.showCloseButton = true;
    w.showResizer = true;
    w.managed = true;
    w.showMinimizeButton = false;
    w.showMaximizeButton = true;
  });
  await expect(panel.locator(".aster-window-footer, .aster-window-status")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Minimize Help" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Maximize Help" })).toBeVisible();
});

test("a native modal close through form method=dialog finishes without an error and restores focus", async ({ page }) => {
  await mount(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const opener = document.createElement("button");
    opener.id = "form-modal-opener";
    opener.textContent = "Open";
    document.body.append(opener);
    const w = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    w.id = "form-modal";
    w.heading = "Form modal";
    w.modal = true;
    w.content = lib.html`<form method="dialog"><button type="submit">Finish</button></form>`;
    w.addEventListener("close", () => { (window as any).formModalClosed = true; });
    document.body.append(w);
    opener.focus();
    w.show(opener);
  });
  const panel = windowPanel(page, "form-modal");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Finish" }).click();
  await expect.poll(() => page.evaluate(() => (document.getElementById("form-modal") as any).open)).toBe(false);
  expect(await page.evaluate(() => (window as any).formModalClosed)).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("form-modal-opener");
  expect(errors).toEqual([]);
});

test("initialPlacement, autoCenter and keepInParentRect are declarative geometry", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const placed = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    placed.id = "placed-window";
    placed.heading = "Placed";
    placed.content = lib.html`<p>Placed</p>`;
    placed.initialPlacement = { state: "normal", bounds: { x: 120, y: 80, width: 300, height: 260 } };
    document.body.append(placed);
    placed.show(null);

    const centred = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    centred.id = "centred-window";
    centred.heading = "Centred";
    centred.content = lib.html`<p>Centred</p>`;
    centred.autoCenter = true;
    document.body.append(centred);
    centred.show(null);

    const host = document.createElement("div");
    host.id = "parent-rect";
    host.style.cssText = "position:fixed; left:100px; top:60px; width:420px; height:320px; outline:1px solid;";
    const kept = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    kept.id = "kept-window";
    kept.heading = "Kept";
    kept.content = lib.html`<p>Kept</p>`;
    kept.keepInParentRect = true;
    kept.initialPlacement = { state: "normal", bounds: { x: 0, y: 0, width: 240, height: 160 } };
    host.append(kept);
    document.body.append(host);
    kept.show(null);
  });

  await expect.poll(async () => {
    const box = await windowPanel(page, "placed-window").boundingBox();
    return box && [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
  }).toEqual([120, 80, 300, 260]);

  await expect.poll(async () => {
    const box = await windowPanel(page, "centred-window").boundingBox();
    return box && [Math.round(box.x), Math.round(box.y)];
  }).toEqual([470, 200]);

  const parent = (await page.locator("#parent-rect").boundingBox())!;
  const kept = (await windowPanel(page, "kept-window").boundingBox())!;
  expect(kept.x).toBeGreaterThanOrEqual(parent.x - 1);
  expect(kept.y).toBeGreaterThanOrEqual(parent.y - 1);
  expect(kept.x + kept.width).toBeLessThanOrEqual(parent.x + parent.width + 1);
  expect(kept.y + kept.height).toBeLessThanOrEqual(parent.y + parent.height + 1);
});

test("a modal window is a native modal dialog, and Escape obeys dismissOnEscape", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const outside = document.createElement("button");
    outside.id = "outside";
    outside.textContent = "Outside";
    document.body.append(outside);
    const w = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    w.id = "modal-window";
    w.heading = "Settings";
    w.content = lib.html`<button type="button">Inside</button>`;
    w.modal = true;
    w.dismissOnEscape = false;
    document.body.append(w);
    w.show(null);
  });
  const panel = windowPanel(page, "modal-window");
  await expect(panel).toBeVisible();
  const host = page.locator("dialog.aster-window-modal");
  await expect(host).toHaveCount(1);
  expect(await host.evaluate((el) => el.matches(":modal"))).toBe(true);
  expect(await page.evaluate(() => document.querySelector("#modal-window .aster-window")!.contains(document.activeElement))).toBe(true);
  // The rest of the page is inert: focus cannot leave the modal dialog.
  await page.evaluate(() => (document.getElementById("outside") as HTMLElement).focus());
  expect(await page.evaluate(() => document.getElementById("modal-window")!.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (document.getElementById("modal-window") as any).open)).toBe(true);
  expect(await host.evaluate((el) => el.matches(":modal"))).toBe(true);

  await page.evaluate(() => { (document.getElementById("modal-window") as any).dismissOnEscape = true; });
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (document.getElementById("modal-window") as any).open)).toBe(false);

  await page.evaluate(() => (document.getElementById("modal-window") as any).show(null));
  await expect(host).toHaveCount(1);
  await page.locator("#modal-window").getByRole("button", { name: "Close Settings" }).click();
  await expect.poll(() => page.evaluate(() => (document.getElementById("modal-window") as any).open)).toBe(false);
});

test("dialog title, header, footer, close control and dismissal policies", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const dialog = document.createElement("aster-dialog") as HTMLElement & Record<string, any>;
    dialog.id = "probe-dialog";
    dialog.content = lib.html`<button type="button" id="inside">Inside</button>`;
    document.body.append(dialog);
  });
  const dialog = page.locator("#probe-dialog");
  const native = dialog.locator("dialog.aster-dialog");
  await expect(native).toHaveCount(1);

  // Defaults: modal, no header, no close button, Escape and backdrop dismiss.
  await page.evaluate(() => (document.getElementById("probe-dialog") as any).show(null));
  expect(await native.evaluate((el) => el.matches(":modal"))).toBe(true);
  expect(await page.evaluate(() => document.querySelector("#probe-dialog dialog")!.contains(document.activeElement))).toBe(true);
  await expect(dialog.locator(".aster-dialog-head, .aster-dialog-footer")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (document.getElementById("probe-dialog") as any).open)).toBe(false);

  // Header, title, footer and the close control.
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const d = document.getElementById("probe-dialog") as HTMLElement & Record<string, any>;
    d.title = "Invite someone";
    d.footer = lib.html`<button type="button">Send</button>`;
    d.showCloseButton = true;
    d.show(null);
  });
  await expect(dialog.getByRole("heading", { name: "Invite someone" })).toBeVisible();
  await expect(dialog.locator(".aster-dialog-footer").getByRole("button", { name: "Send" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => page.evaluate(() => (document.getElementById("probe-dialog") as any).open)).toBe(false);

  // Non-modal uses dialog.show(): the page stays usable.
  await page.evaluate(() => {
    const d = document.getElementById("probe-dialog") as HTMLElement & Record<string, any>;
    d.modal = false;
    d.show(null);
  });
  expect(await native.evaluate((el) => (el as HTMLDialogElement).open && !el.matches(":modal"))).toBe(true);
  await page.evaluate(() => (document.getElementById("inside") as HTMLElement).focus());
  expect(await native.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.evaluate(() => (document.getElementById("probe-dialog") as any).close());

  // Escape and backdrop policies.
  await page.evaluate(() => {
    const d = document.getElementById("probe-dialog") as HTMLElement & Record<string, any>;
    d.modal = true;
    d.dismissOnEscape = false;
    d.dismissOnBackdrop = false;
    d.show(null);
  });
  await page.keyboard.press("Escape");
  expect(await native.evaluate((el) => (el as HTMLDialogElement).open)).toBe(true);
  await page.mouse.click(4, 4);
  expect(await native.evaluate((el) => (el as HTMLDialogElement).open)).toBe(true);
  await page.evaluate(() => {
    const d = document.getElementById("probe-dialog") as HTMLElement & Record<string, any>;
    d.dismissOnEscape = true;
    d.dismissOnBackdrop = true;
  });
  await page.mouse.click(4, 4);
  await expect.poll(() => page.evaluate(() => (document.getElementById("probe-dialog") as any).open)).toBe(false);

  // Focus policy: none leaves a non-modal dialog's focus outside; dialog focuses the panel.
  await page.evaluate(() => {
    const outside = document.createElement("button");
    outside.id = "dialog-outside";
    outside.textContent = "Outside";
    document.body.append(outside);
    outside.focus();
    const d = document.getElementById("probe-dialog") as HTMLElement & Record<string, any>;
    d.modal = false;
    d.initialFocus = "none";
    d.show(null);
  });
  expect(await page.evaluate(() => document.querySelector("#probe-dialog dialog")!.contains(document.activeElement))).toBe(false);
  await page.evaluate(() => (document.getElementById("probe-dialog") as any).close());
  await page.evaluate(() => {
    const d = document.getElementById("probe-dialog") as HTMLElement & Record<string, any>;
    d.modal = true;
    d.initialFocus = "dialog";
    d.show(null);
  });
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("DIALOG");
});

test("menu icons, shortcuts, submenu direction, autoDismiss and emptyMessage", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await mount(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const anchor = document.createElement("button");
    anchor.id = "menu-anchor";
    anchor.textContent = "Actions";
    anchor.style.cssText = "position:fixed; left:420px; top:120px;";
    const menu = document.createElement("aster-menu");
    menu.id = "probe-menu";
    document.body.append(anchor, menu);
    (window as any).menuLib = lib;
  });
  const open = async (props: object, items: unknown[]) => page.evaluate(({ props, items }) => {
    const lib = (window as any).menuLib;
    const el = document.getElementById("probe-menu") as HTMLElement & Record<string, any>;
    Object.assign(el, props);
    const build = (item: any): any => {
      if (item.kind === "separator") return { kind: "separator" };
      if (item.kind === "submenu") return { kind: "submenu", label: item.label, items: item.items.map(build) };
      return {
        label: item.label,
        shortcut: item.shortcut,
        icon: item.icon === "spark" ? lib.html`<svg class="probe-icon" viewBox="0 0 16 16"></svg>` : undefined,
        run: () => { (window as any).ran = item.label; },
      };
    };
    el.openFrom(document.getElementById("menu-anchor") as HTMLElement, items.map(build), "Actions");
  }, { props, items });

  await open({ showIcons: true, showShortcuts: true }, [
    { label: "Rename", icon: "spark", shortcut: "Ctrl+R" },
    { kind: "separator" },
    { kind: "submenu", label: "Move to", items: [{ label: "Archive" }] },
  ]);
  const surface = page.getByRole("menu", { name: "Actions" });
  const rename = surface.getByRole("menuitem", { name: "Rename" });
  await expect(rename).toHaveAttribute("aria-keyshortcuts", "Control+R");
  await expect(rename.locator(".aster-menu-icon .probe-icon")).toHaveCount(1);
  await expect(rename.locator(".aster-menu-shortcut")).toHaveText("Ctrl+R");
  await page.keyboard.press("Escape");

  await open({ showIcons: false, showShortcuts: false }, [
    { label: "Rename", icon: "spark", shortcut: "Ctrl+R" },
  ]);
  await expect(page.getByRole("menuitem", { name: "Rename" })).not.toHaveAttribute("aria-keyshortcuts");
  await expect(page.locator("#probe-menu .aster-menu-icon, #probe-menu .aster-menu-shortcut")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Submenu direction is CSS geometry: end puts it after the item, start before.
  for (const direction of ["end", "start"] as const) {
    await open({ submenuDirection: direction }, [{ kind: "submenu", label: "Move to", items: [{ label: "Archive" }] }]);
    const item = page.getByRole("menuitem", { name: "Move to" });
    await item.focus();
    await page.keyboard.press("Enter");
    const sub = page.getByRole("menu", { name: "Move to" });
    await expect(sub).toBeVisible();
    const [itemBox, subBox] = [(await item.boundingBox())!, (await sub.boundingBox())!];
    if (direction === "end") expect(subBox.x).toBeGreaterThanOrEqual(itemBox.x + itemBox.width - 2);
    else expect(subBox.x + subBox.width).toBeLessThanOrEqual(itemBox.x + 2);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }

  // autoDismiss: false keeps the menu open after an action runs.
  await open({ autoDismiss: false }, [{ label: "Rename" }]);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  expect(await page.evaluate(() => (window as any).ran)).toBe("Rename");
  await expect(page.getByRole("menu", { name: "Actions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await open({ autoDismiss: true }, [{ label: "Rename" }]);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(page.getByRole("menu", { name: "Actions" })).toHaveCount(0);

  // Empty menus explain themselves and keep Escape reachable.
  await open({ emptyMessage: "No actions here" }, []);
  await expect(page.locator("#probe-menu .aster-menu-empty")).toHaveText("No actions here");
  await page.keyboard.press("Escape");
  await expect(page.locator("#probe-menu .aster-menu-empty")).toHaveCount(0);
});

test("section and accordion close, collapse-all and reorder policies", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const section = document.createElement("aster-section") as HTMLElement & Record<string, any>;
    section.id = "policy-section";
    section.heading = "Single";
    section.chrome = { close: true };
    section.canClose = false;
    document.body.append(section);

    const accordion = document.createElement("aster-accordion") as HTMLElement & Record<string, any>;
    accordion.id = "policy-accordion";
    accordion.items = [
      { id: "a", heading: "Alpha", body: document.createElement("p") },
      { id: "b", heading: "Beta", body: document.createElement("p") },
      { id: "c", heading: "Gamma", body: document.createElement("p") },
    ];
    document.body.append(accordion);
  });
  const section = page.locator("#policy-section");
  const accordion = page.locator("#policy-accordion");
  await expect(section.getByRole("button", { name: "Close Single" })).toHaveCount(0);
  await page.evaluate(() => { (document.getElementById("policy-section") as any).canClose = true; });
  await expect(section.getByRole("button", { name: "Close Single" })).toBeVisible();

  // Defaults add no controls.
  await expect(accordion.locator(".aster-accordion-tools, .aster-accordion-reorder, .aster-section-close")).toHaveCount(0);

  // canClose shows a close control that asks before anything changes.
  await page.evaluate(() => {
    const el = document.getElementById("policy-accordion") as any;
    el.canClose = true;
    el.addEventListener("close", (event: CustomEvent) => {
      (window as any).closedId = event.detail;
      event.preventDefault();
    });
  });
  await accordion.locator(".aster-section-close").first().click();
  expect(await page.evaluate(() => (window as any).closedId)).toBe("a");
  await expect(accordion.locator(".aster-accordion-item")).toHaveCount(3);

  // canReorder emits the requested order; the host applies it.
  await page.evaluate(() => {
    const el = document.getElementById("policy-accordion") as any;
    el.canReorder = true;
    el.addEventListener("reorder", (event: CustomEvent) => { (window as any).reorder = event.detail; });
  });
  await accordion.getByRole("button", { name: "Move Alpha down" }).click();
  expect(await page.evaluate(() => (window as any).reorder)).toEqual({ id: "a", from: 0, to: 1, order: ["b", "a", "c"] });
  await expect(accordion.getByRole("button", { name: "Move Alpha up" })).toBeDisabled();
  await expect(accordion.getByRole("button", { name: "Move Gamma down" })).toBeDisabled();

  // canCollapseAll collapses what is open and reports it.
  await page.evaluate(() => {
    const el = document.getElementById("policy-accordion") as any;
    el.canCollapseAll = true;
    el.multiple = true;
    el.expanded = ["a", "b"];
  });
  await expect(accordion.getByRole("button", { name: "Collapse all" })).toBeVisible();
  await accordion.getByRole("button", { name: "Collapse all" }).click();
  expect(await page.evaluate(() => (document.getElementById("policy-accordion") as any).expanded)).toEqual([]);

  // visibilityMode is the structured form of multiple.
  await page.evaluate(() => {
    const el = document.getElementById("policy-accordion") as any;
    el.visibilityMode = "multiple";
    el.expanded = ["a", "b"];
  });
  await expect(accordion.locator(".aster-accordion-item[data-accordion-id='a'] aster-section[data-open]")).toHaveCount(1);
  await expect(accordion.locator(".aster-accordion-item[data-accordion-id='b'] aster-section[data-open]")).toHaveCount(1);
  expect(await page.evaluate(() => (document.getElementById("policy-accordion") as any).multiple)).toBe(true);
  await page.evaluate(() => { (document.getElementById("policy-accordion") as any).visibilityMode = "mutex"; });
  await accordion.getByRole("button", { name: "Gamma", exact: true }).click();
  const open = await page.evaluate(() => (document.getElementById("policy-accordion") as any).expanded);
  expect(open).toEqual(["c"]);
});

test("tree navigator search narrows the loaded rows and Escape clears it", async ({ page }) => {
  await page.goto("/playground/composition.html");
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const fixture = {
      metadata: {
        $Version: "4.01", $EntityContainer: "Test.Container",
        Test: {
          Node: {
            $Kind: "EntityType", $Key: ["id"], "@Core.Description": "Node", "@AsterData.TitleField": "name",
            id: { $Type: "Edm.Int32", "@Core.Computed": true },
            name: { "@Core.Description": "Name" },
            parentId: { $Type: "Edm.Int32", $Nullable: true, "@Core.Description": "Parent" },
          },
          Container: { $Kind: "EntityContainer", Nodes: { $Collection: true, $Type: "Test.Node" } },
        },
      },
      data: { Nodes: [
        { id: 1, name: "Alpha", parentId: null },
        { id: 2, name: "Beta", parentId: null },
        { id: 3, name: "Child of Alpha", parentId: 1 },
      ] },
    };
    const mock = await mockLib.createMockService({ ...fixture, wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    const tree = new lib.Tree(ctx, { set: "Nodes", parentField: "parentId", orderBy: lib.signal([{ field: "id" }]) });
    const nav = document.createElement("aster-tree-navigator") as HTMLElement & Record<string, any>;
    nav.id = "search-nav";
    nav.tree = tree;
    nav.label = "Nodes";
    nav.display = "name";
    nav.search = true;
    document.body.append(nav);

    const plain = document.createElement("aster-tree-navigator") as HTMLElement & Record<string, any>;
    plain.id = "plain-nav";
    plain.tree = new lib.Tree(ctx, { set: "Nodes", parentField: "parentId" });
    plain.label = "Plain";
    plain.display = "name";
    document.body.append(plain);
  });
  const nav = page.locator("#search-nav");
  await expect(nav.locator(".aster-drill-choose")).toHaveCount(2);
  const search = nav.locator(".aster-drill-search input");
  await expect(search).toHaveAttribute("aria-label", "Search Nodes");
  await expect(page.locator("#plain-nav .aster-drill-search")).toHaveCount(0);

  await search.fill("be");
  await expect(nav.locator(".aster-drill-choose")).toHaveCount(1);
  await expect(nav.locator(".aster-drill-choose")).toContainText("Beta");
  await search.fill("zzz");
  await expect(nav.locator(".aster-drill-choose")).toHaveCount(0);
  await expect(nav.getByText("Nothing matches.")).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(nav.locator(".aster-drill-choose")).toHaveCount(2);
});

test("the composition validator accepts the overlay data forms and rejects bad values", async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const authoring = lib.defineCompositeRegistry({
      models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) },
      components: lib.asterComponents,
    });
    const diagnostics = (type: string, props: object) => authoring.diagnostics({
      version: 1, name: "overlay-test", model: { type: "empty" }, children: { control: { type, props } }, layout: { child: "control" },
    });
    return {
      valid: [
        diagnostics("Window", {
          chrome: { header: false, title: false, close: false, minimize: false, maximize: false, resizer: false, footer: true, statusBar: true },
          initialPlacement: { state: "normal", bounds: { x: 10, y: 20, width: 300, height: 200 } },
          modal: true, dismissOnEscape: false, keepInParentRect: true, autoCenter: true,
          showHeader: false, showTitle: false, showCloseButton: false, showMinimizeButton: false, showMaximizeButton: false,
          showResizer: false, showFooter: true, showStatusBar: true,
        }),
        diagnostics("Dialog", {
          title: "Invite", header: true, showCloseButton: true, modal: false,
          dismissOnEscape: false, dismissOnBackdrop: false, initialFocus: "dialog",
        }),
        diagnostics("Menu", { showIcons: false, showShortcuts: false, submenuDirection: "start", autoDismiss: false, emptyMessage: "Nothing here" }),
        diagnostics("Accordion", { visibilityMode: "multiple", canClose: true, canReorder: true, canCollapseAll: true, multiple: false }),
        diagnostics("Section", { canClose: false, chrome: { close: true } }),
        diagnostics("TreeNavigator", { search: true }),
      ],
      invalid: [
        diagnostics("Window", { chrome: { header: "no" } }),
        diagnostics("Window", { chrome: { shadows: true } }),
        diagnostics("Window", { initialPlacement: { state: "docked" } }),
        diagnostics("Window", { initialPlacement: { state: "normal", bounds: { x: 0, y: 0, width: 0, height: 100 } } }),
        diagnostics("Window", { autoCenter: () => true }),
        diagnostics("Window", { showHeader: "no" }),
        diagnostics("Dialog", { modal: "yes" }),
        diagnostics("Dialog", { initialFocus: "second" }),
        diagnostics("Dialog", { header: "yes" }),
        diagnostics("Menu", { submenuDirection: "up" }),
        diagnostics("Menu", { emptyMessage: 42 }),
        diagnostics("Accordion", { visibilityMode: "single" }),
        diagnostics("Accordion", { canReorder: "yes" }),
        diagnostics("Section", { canClose: "no" }),
        diagnostics("TreeNavigator", { search: "yes" }),
      ],
    };
  });
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});
