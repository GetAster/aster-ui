// Appearance configuration: per-column presentation, value maps and formats,
// row/cell class hooks, hilites, the label bag, and the component geometry
// variables. Mounted on the composition playground like the other
// configuration increments.
import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE = {
  metadata: {
    $Version: "4.01",
    $EntityContainer: "Test.Container",
    $Reference: {
      "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] },
      "https://aster.dev/vocabularies/Aster.Data.V1.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
    },
    Test: {
      AppearanceRecord: {
        $Kind: "EntityType",
        $Key: ["id"],
        "@Core.Description": "Record",
        "@AsterData.TitleField": "name",
        id: { $Type: "Edm.Int32", "@Core.Computed": true },
        name: { "@Core.Description": "Name" },
        status: {
          "@Core.Description": "Status",
          "@Validation.AllowedValues": [
            { Value: "active", "@Core.Description": "Active" },
            { Value: "paused", "@Core.Description": "Paused" },
            { Value: "archived", "@Core.Description": "Archived" },
          ],
        },
        due: { $Type: "Edm.Date", $Nullable: true, "@Core.Description": "Due" },
        hours: { $Type: "Edm.Decimal", $Precision: 8, $Scale: 2, "@Core.Description": "Hours" },
        budget: { $Type: "Edm.Decimal", $Precision: 12, $Scale: 2, "@Core.Description": "Budget" },
        flag: { $Type: "Edm.Boolean", "@Core.Description": "Flagged" },
      },
      Node: {
        $Kind: "EntityType",
        $Key: ["id"],
        "@Core.Description": "Node",
        "@AsterData.TitleField": "title",
        id: { $Type: "Edm.Int32" },
        title: { "@Core.Description": "Title" },
        parentId: { $Type: "Edm.Int32", $Nullable: true, "@Core.Description": "Parent" },
      },
      Container: {
        $Kind: "EntityContainer",
        AppearanceRecords: { $Collection: true, $Type: "Test.AppearanceRecord" },
        Nodes: { $Collection: true, $Type: "Test.Node" },
      },
    },
  },
  data: {
    AppearanceRecords: [
      { id: 1, name: "Spring launch", status: "active", due: "2026-10-09", hours: "7.50", budget: "12000.00", flag: true },
      { id: 2, name: "Brand refresh", status: "paused", due: null, hours: "9.00", budget: "4000.00", flag: false },
      { id: 3, name: "Billing v2", status: "paused", due: "2026-11-10", hours: "3.25", budget: "9000.00", flag: true },
      { id: 4, name: "Legacy", status: "archived", due: "2026-01-02", hours: "12.50", budget: "1500.00", flag: false },
    ],
    Nodes: [
      { id: 1, title: "Root", parentId: null },
      { id: 2, title: "Child", parentId: 1 },
      { id: 3, title: "Other root", parentId: null },
    ],
  },
};

const grid = (page: Page) => page.locator("#e2e-appearance");
const rows = (page: Page) => grid(page).locator(".aster-grid-row[data-key]:not(.aster-grid-group)");
const header = (page: Page, field: string) => grid(page).locator(`.aster-grid-header[data-field="${field}"]`);

async function mount(page: Page): Promise<void> {
  await page.goto("/playground/composition.html");
  await page.evaluate(async (fixture) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const mock = await mockLib.createMockService({ ...fixture, wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    const element = document.createElement("aster-grid") as HTMLElement & Record<string, unknown>;
    element.id = "e2e-appearance";
    element.ctx = ctx;
    element.set = "AppearanceRecords";
    element.label = "Records";
    element.style.cssText = "display:block; height:420px; width:980px;";
    element.view = lib.defaultView(ctx.schema.set("AppearanceRecords").type);
    document.body.append(element);
    (globalThis as unknown as { e2e: unknown }).e2e = { ctx, grid: element, mock, lib };
  }, FIXTURE);
  await expect(rows(page).first()).toBeVisible();
}

function record(page: Page, name: string): Locator {
  return rows(page).filter({ hasText: name });
}

test("an unconfigured grid keeps today's titles, alignment, formatting and labels", async ({ page }) => {
  await mount(page);
  const spring = record(page, "Spring launch");
  await expect(header(page, "name").locator(".aster-grid-sort span")).toHaveText("Name");
  await expect(header(page, "hours")).toHaveAttribute("data-numeric", "");
  await expect(header(page, "name")).not.toHaveAttribute("data-align", /.+/);
  await expect(grid(page).locator(".aster-grid-toolbar")).toHaveAttribute("aria-label", "Records view");
  await expect(grid(page).locator(".aster-grid-total")).toHaveText("4 rows");
  await expect(spring).toHaveAttribute("class", "aster-grid-row");
  await expect(spring.locator(".aster-grid-cell").first()).toHaveAttribute("class", "aster-grid-cell");
  await expect(spring.locator(".aster-grid-cell[data-label='Name']")).toHaveText("Spring launch");
  await expect(spring.locator(".aster-grid-cell[data-label='Status']")).toHaveText("Active");
  await expect(spring.locator(".aster-grid-cell[data-label='Due']")).toHaveText("9 Oct 2026");
  await expect(spring.locator(".aster-grid-cell[data-label='Hours']")).toHaveText("7.50");
  await expect(spring.locator(".aster-grid-cell[data-label='Hours']")).toHaveAttribute("data-numeric", "");
  await expect(spring.locator(".aster-grid-cell[data-label='Flagged']")).toHaveText("Yes");
  await expect(grid(page).locator("[data-tone]")).toHaveCount(0);
});

test("column titles, alignment, value maps and formats are one presentation descriptor", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const element = (globalThis as unknown as { e2e: { grid: Record<string, unknown> } }).e2e.grid;
    element.presentation = {
      columns: {
        name: { title: "Project", align: "center" },
        status: {
          valueMap: {
            active: "Active now",
            paused: { label: "On hold", tone: "caution", class: "e2e-hold" },
          },
        },
        due: { format: { kind: "date", style: "iso" } },
        hours: { format: { kind: "number", style: "integer" } },
        budget: { format: { kind: "number", style: "currency", currency: "GBP" } },
      },
    };
  });
  await expect(header(page, "name").locator(".aster-grid-sort span")).toHaveText("Project");
  await expect(header(page, "name")).toHaveAttribute("data-align", "center");
  await expect(header(page, "name").locator(".aster-grid-sort")).toHaveCSS("justify-content", "center");

  const spring = record(page, "Spring launch");
  await expect(spring.locator(".aster-grid-cell[data-label='Project']")).toHaveText("Spring launch");
  await expect(spring.locator(".aster-grid-cell[data-label='Project']")).toHaveCSS("text-align", "center");
  await expect(spring.locator(".aster-grid-cell[data-label='Status']")).toHaveText("Active now");
  await expect(spring.locator(".aster-grid-cell[data-label='Status']")).not.toHaveAttribute("data-tone", /.+/);
  await expect(spring.locator(".aster-grid-cell[data-label='Due']")).toHaveText("2026-10-09");
  await expect(spring.locator(".aster-grid-cell[data-label='Hours']")).toHaveText("8");
  await expect(spring.locator(".aster-grid-cell[data-label='Budget']")).toHaveText("£12,000.00");

  const brand = record(page, "Brand refresh");
  await expect(brand.locator(".aster-grid-cell[data-label='Status']")).toHaveText("On hold");
  await expect(brand.locator(".aster-grid-cell[data-label='Status']")).toHaveClass(/e2e-hold/);
  await expect(brand.locator(".aster-grid-cell[data-label='Status']")).toHaveAttribute("data-tone", "caution");
  await expect(brand.locator(".aster-grid-cell[data-label='Due']")).toHaveText("");

  // An unknown value keeps the metadata allowed-value label; the map never blanks it.
  const legacy = record(page, "Legacy");
  await expect(legacy.locator(".aster-grid-cell[data-label='Status']")).toHaveText("Archived");
});

test("row and cell class hooks and hilites compose in order, with the last tone winning", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const element = (globalThis as unknown as { e2e: { grid: Record<string, unknown> } }).e2e.grid;
    element.presentation = {
      columns: {
        status: {
          valueMap: { paused: { label: "On hold", tone: "caution", class: "mapped-hold" } },
          cellClass: "status-cell",
        },
        hours: {
          cellClass: [
            { when: { field: "hours", op: "gt", value: 8 }, class: "overtime" },
            (cell: { value: unknown }) => cell.value === "7.50" ? "exact-hours" : undefined,
          ],
        },
      },
      rowClass: [{ when: { field: "flag", op: "eq", value: true }, class: "flagged-row" }],
      cellClass: "every-cell",
      hilites: [
        { when: { field: "hours", op: "gt", value: 8 }, class: "heavy-row", tone: "negative" },
        { scope: "cell", field: "status", when: { field: "status", op: "eq", value: "paused" }, class: "paused-first", tone: "caution" },
        { scope: "cell", field: "status", when: { field: "status", op: "eq", value: "paused" }, class: "paused-last", tone: "positive" },
        { scope: "cell", field: "status", when: { field: "status", op: "eq", value: "archived" }, class: "archived-cell" },
      ],
    };
  });

  const spring = record(page, "Spring launch");
  await expect(spring).toHaveClass("aster-grid-row flagged-row");
  await expect(spring).not.toHaveAttribute("data-tone", /.+/);
  await expect(spring.locator(".aster-grid-cell[data-label='Hours']")).toHaveClass(/every-cell/);
  await expect(spring.locator(".aster-grid-cell[data-label='Hours']")).toHaveClass(/exact-hours/);
  await expect(spring.locator(".aster-grid-cell[data-label='Hours']")).not.toHaveClass(/overtime/);
  await expect(spring.locator(".aster-grid-cell[data-label='Status']")).toHaveClass(/status-cell/);

  const brand = record(page, "Brand refresh");
  await expect(brand).toHaveClass("aster-grid-row heavy-row");
  await expect(brand).not.toHaveClass(/flagged-row/);
  await expect(brand).toHaveAttribute("data-tone", "negative");
  await expect(brand.locator(".aster-grid-cell[data-label='Hours']")).toHaveClass(/overtime/);
  const status = brand.locator(".aster-grid-cell[data-label='Status']");
  // Grid hook, column hook, value-map class, then cell hilites in order.
  await expect(status).toHaveClass("aster-grid-cell every-cell status-cell mapped-hold paused-first paused-last");
  await expect(status).toHaveAttribute("data-tone", "positive");

  const legacy = record(page, "Legacy");
  await expect(legacy.locator(".aster-grid-cell[data-label='Status']")).toHaveClass(/archived-cell/);
  await expect(legacy.locator(".aster-grid-cell[data-label='Status']")).not.toHaveAttribute("data-tone", /.+/);
});

test("the label bag overrides toolbar, menu, paging, state, announcement and drift text", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const element = (globalThis as unknown as { e2e: { grid: Record<string, unknown> } }).e2e.grid;
    element.labels = {
      toolbarLabel: "{label} table",
      sort: "Order",
      filters: "Filter",
      filtersActive: "Filter ({count})",
      advancedFilter: "Expression",
      columns: "Fields",
      views: "Saves",
      rows: "{count} entries",
      row: "1 entry",
      pageOf: "Sheet {page}/{pages}",
      pageRows: " · {first}–{last} of {total}",
      sortBy: "Order by {field}",
      addToSort: " (Shift for more)",
      columnOptions: "{field} options",
      menuSort: "Order",
      ascending: "up",
      descending: "down",
      directionAscending: "up",
      directionDescending: "down",
      notSorted: "Unordered",
      groupBy: "Group on {field}",
      freezeUpTo: "Pin through {field}",
      menuMove: "Shift",
      menuWidth: "Size",
      hideField: "Remove {field}",
      columnsEllipsis: "Fields…",
      sortedBy: "Ordered by {sorts}",
      sortEntry: "{field} {direction}",
      sortSeparator: " / ",
      loadFailed: "No rows could be loaded.",
      retry: "Try again",
      empty: "Nothing here",
      notLoaded: "Not fetched",
      driftNote: "Saved view changed: {entries}",
      driftSort: "Ordered by {field}",
      driftEntry: "{what} ({reason})",
      sortPolicyRefused: "{field} blocked",
      dismiss: "Close",
    };
    element.features = [{ kind: "page" }];
    element.pageSize = 2;
  });
  await expect(grid(page).locator(".aster-grid-toolbar")).toHaveAttribute("aria-label", "Records table");
  await expect(grid(page).getByRole("button", { name: "Order", exact: true })).toBeVisible();
  await expect(grid(page).getByRole("button", { name: "Filter", exact: true })).toBeVisible();
  await expect(grid(page).getByRole("button", { name: "Expression", exact: true })).toBeVisible();
  await expect(grid(page).getByRole("button", { name: "Fields", exact: true })).toBeVisible();
  await expect(grid(page).locator(".aster-grid-total")).toHaveText("4 entries");
  await expect(grid(page).locator(".aster-grid-paging")).toContainText("Sheet 1/2 · 1–2 of 4");

  // Header tooltip and column menu labels.
  const sortButton = header(page, "name").locator(".aster-grid-sort");
  await expect(sortButton).toHaveAttribute("title", /Order by Name \(Shift for more\)/);
  await expect(header(page, "name").locator(".aster-grid-header-menu")).toHaveAttribute("aria-label", "Name options");
  await header(page, "name").locator(".aster-grid-header-menu").click();
  const menu = page.getByRole("menu", { name: "Name column" });
  await expect(menu.getByRole("group", { name: "Order" })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "up" })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "down" })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Unordered" })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Group on Name" })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Pin through Name" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Announcements use the same direction words.
  await sortButton.click();
  await expect(page.locator("p.aster-sr-only[aria-live]").first()).toHaveText("Ordered by Name up");

  // Drift: the saved sort survives, the effective sort is dropped and the note is reworded.
  await page.evaluate(() => {
    const element = (globalThis as unknown as { e2e: { grid: Record<string, unknown> } }).e2e.grid;
    element.policy = { sortable: false };
  });
  const drift = grid(page).locator(".aster-grid-drift");
  await expect(drift).toContainText("Saved view changed: Ordered by Name (Name blocked)");
  await expect(drift.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await expect(page.locator("p.aster-sr-only[aria-live]").first()).toContainText("Saved view changed:");

  // Failure and empty states keep the overridden words.
  await page.evaluate(() => {
    const e2e = (globalThis as unknown as { e2e: { grid: Record<string, unknown>; mock: { faults: { failNext(status: number, error: object): void } } } }).e2e;
    e2e.mock.faults.failNext(500, { code: "MockFault", message: "Injected failure." });
    void (e2e.grid as unknown as { refresh(): Promise<void> }).refresh();
  });
  await expect(grid(page).locator(".aster-grid-failure")).toContainText("No rows could be loaded.");
  await expect(grid(page).locator(".aster-grid-failure").getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await grid(page).locator(".aster-grid-failure").getByRole("button", { name: "Try again", exact: true }).click();
  await expect(grid(page).locator(".aster-grid-failure")).toHaveCount(0);
  await page.evaluate(() => {
    const element = (globalThis as unknown as { e2e: { grid: Record<string, unknown> } }).e2e.grid;
    element.policy = {};
    element.base = { op: "eq", field: "id", value: 999 };
  });
  await expect(grid(page).locator(".aster-grid-empty")).toHaveText("Nothing here");
});

test("labels.notLoaded keeps a deferred grid's idle state reworded", async ({ page }) => {
  await page.goto("/playground/composition.html");
  await page.evaluate(async (fixture) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const mock = await mockLib.createMockService({ ...fixture, wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    const element = document.createElement("aster-grid") as HTMLElement & Record<string, unknown>;
    element.id = "e2e-deferred";
    element.ctx = ctx;
    element.set = "AppearanceRecords";
    element.autoFetch = false;
    element.labels = { notLoaded: "Not fetched" };
    element.view = lib.defaultView(ctx.schema.set("AppearanceRecords").type);
    document.body.append(element);
  }, FIXTURE);
  await expect(page.locator("#e2e-deferred .aster-grid-total")).toHaveText("Not fetched");
});

test("the component variable contract tunes grid, menu, window and dialog geometry", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const e2e = (globalThis as unknown as { e2e: { ctx: unknown; lib: any; grid: HTMLElement & Record<string, any> } }).e2e;
    e2e.grid.style.setProperty("--aster-grid-header-height", "60px");
    e2e.grid.style.setProperty("--aster-grid-toolbar-height", "70px");
    e2e.grid.style.setProperty("--aster-grid-row-min-height", "80px");
    e2e.grid.style.setProperty("--aster-grid-summary-height", "50px");
    e2e.grid.summaries = [{ method: "count", label: "Records" }];

    const tree = document.createElement("aster-grid") as HTMLElement & Record<string, any>;
    tree.id = "e2e-tree";
    tree.ctx = e2e.ctx;
    tree.set = "Nodes";
    tree.label = "Nodes";
    tree.style.cssText = "display:block; height:260px; width:600px; --aster-grid-tree-indent:24px;";
    tree.view = e2e.lib.defaultView((e2e.ctx as any).schema.set("Nodes").type);
    tree.tree = { parentField: "parentId", autoOpen: 1 };
    document.body.append(tree);
  });
  await expect(grid(page).locator(".aster-grid-summary")).toBeVisible();
  expect((await header(page, "name").boundingBox())!.height).toBeGreaterThanOrEqual(60);
  expect((await grid(page).locator(".aster-grid-toolbar").boundingBox())!.height).toBeGreaterThanOrEqual(70);
  expect((await record(page, "Spring launch").locator(".aster-grid-cell").first().boundingBox())!.height).toBeGreaterThanOrEqual(80);
  expect((await grid(page).locator(".aster-grid-summary").boundingBox())!.height).toBeGreaterThanOrEqual(50);
  expect(await grid(page).locator(".aster-grid-summary").evaluate((element) => getComputedStyle(element).minHeight)).toBe("50px");

  const child = page.locator('#e2e-tree .aster-grid-row[data-key="[2]"] .aster-grid-tree');
  await expect(child).toBeVisible();
  expect(await child.evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("24px");

  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const anchor = document.createElement("button");
    anchor.id = "e2e-menu-anchor";
    anchor.textContent = "Actions";
    anchor.style.cssText = "position:fixed; left:420px; top:120px;";
    const menu = document.createElement("aster-menu") as HTMLElement & Record<string, any>;
    menu.id = "e2e-menu";
    menu.style.setProperty("--aster-menu-cell-height", "40px");
    menu.style.setProperty("--aster-menu-icon-size", "20px");
    document.body.append(anchor, menu);
    menu.openFrom(anchor, [{ label: "Rename", icon: lib.html`<svg class="e2e-icon" viewBox="0 0 16 16"></svg>`, run: () => {} }], "Actions");
  });
  const item = page.getByRole("menuitem", { name: "Rename" });
  await expect(item).toBeVisible();
  expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  expect((await item.locator(".e2e-icon").boundingBox())!.width).toBeCloseTo(20, 0);
  await page.keyboard.press("Escape");

  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const windowElement = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    windowElement.id = "e2e-window";
    windowElement.heading = "Sized";
    windowElement.content = lib.html`<p>Body</p>`;
    windowElement.style.setProperty("--aster-window-header-height", "64px");
    windowElement.style.setProperty("--aster-window-title-size", "20px");
    windowElement.style.setProperty("--aster-window-control-size", "40px");
    windowElement.style.setProperty("--aster-window-inset", "5px");
    windowElement.style.setProperty("--aster-window-body-padding-block", "3px");
    windowElement.style.setProperty("--aster-window-body-padding-inline", "0px");
    document.body.append(windowElement);
    windowElement.show(null);

    const dialog = document.createElement("aster-dialog") as HTMLElement & Record<string, any>;
    dialog.id = "e2e-dialog";
    dialog.title = "Sized dialog";
    dialog.content = lib.html`<p style="width:800px">Wide content</p>`;
    dialog.style.setProperty("--aster-dialog-max-width", "300px");
    document.body.append(dialog);
    dialog.show(null);
  });
  const bar = page.locator("#e2e-window .aster-window-bar");
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  expect(await page.locator("#e2e-window .aster-window-bar h2").evaluate(e => getComputedStyle(e).fontSize)).toBe("20px");
  expect((await page.locator("#e2e-window .aster-window-bar button").first().boundingBox())!.width).toBe(40);
  expect(await page.locator("#e2e-window .aster-window-body").evaluate(e => getComputedStyle(e).padding)).toBe("3px 0px");
  expect(await bar.evaluate(e => getComputedStyle(e).paddingLeft)).toBe("5px");
  const panel = page.locator("#e2e-dialog .aster-dialog-panel");
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(301);
});

test("the composition catalog accepts plain presentation and labels and rejects functions and bad shapes", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const authoring = lib.defineCompositeRegistry({
      models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) },
      components: lib.asterComponents,
    });
    const diagnostics = (props: object) => authoring.diagnostics({
      version: 1, name: "appearance-test", model: { type: "empty" }, children: { table: { type: "Grid", props } }, layout: { child: "table" },
    });
    return {
      valid: [
        diagnostics({
          presentation: {
            columns: {
              name: { title: "Project", align: "center" },
              status: {
                valueMap: { active: "Active now", paused: { label: "On hold", tone: "caution", class: "hold" } },
                cellClass: [{ when: { field: "hours", op: "lt", value: 8 }, class: "short" }],
              },
              due: { format: { kind: "date", style: "short" } },
              hours: { format: { kind: "number", style: "currency", currency: "GBP", maximumFractionDigits: 0 } },
            },
            rowClass: [{ when: { field: "flag", op: "eq", value: true }, class: "flagged" }],
            cellClass: "cell",
            hilites: [
              { when: { field: "hours", op: "between", value: [8, 24] }, class: "long", tone: "caution" },
              { scope: "cell", field: "status", when: { field: "status", op: "in", value: ["paused", "archived"] }, class: "off" },
            ],
          },
          labels: { sort: "Order", rows: "{count} entries", pageOf: "Sheet {page}/{pages}" },
        }),
      ],
      invalid: [
        diagnostics({ presentation: { rowClass: () => "x" } }),
        diagnostics({ presentation: { columns: { name: { align: "middle" } } } }),
        diagnostics({ presentation: { columns: { due: { format: { kind: "date", style: "long" } } } } }),
        diagnostics({ presentation: { columns: { hours: { format: { kind: "number", style: "currency" } } } } }),
        diagnostics({ presentation: { hilites: [{ scope: "cell", when: { field: "status", op: "eq", value: "active" } }] } }),
        diagnostics({ presentation: { hilites: [{ test: () => true }] } }),
        diagnostics({ presentation: { columns: { name: { cellClass: [{ class: "x", test: () => true }] } } } }),
        diagnostics({ labels: { sort: 42 } }),
        diagnostics({ labels: { nonsense: "x" } }),
      ],
    };
  });
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});
