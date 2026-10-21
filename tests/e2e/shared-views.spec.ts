import { chooseAppearance } from "./appearance.ts";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle } from "./fixtures.ts";

const table = (page: Page) => page.getByRole("grid", { name: "Device fleet table", exact: true });
const row = (page: Page, id: number) => page.locator(`#fleet-table .aster-grid-row[data-key="[${id}]"]`);
const tile = (page: Page, id: number) => page.locator(`#fleet .aster-tile[data-key="[${id}]"]`);
const chosen = (page: Page) => page.evaluate(() => (globalThis as any).tileDemo.fleet.grid.selection.keys.value);
async function open(page: Page): Promise<void> {
  await page.goto("/playground/tiles.html?debug");
  await expect(page.getByRole("grid", { name: "Files in Home" }).getByRole("gridcell")).toHaveCount(6);
  await page.getByRole("button", { name: "Load large collection", exact: true }).click();
  await expect(tile(page, 1)).toBeVisible();
  await expect(page.getByRole("grid", { name: "Device fleet", exact: true })).toHaveAttribute("aria-busy", "false");
}
async function switchView(page: Page, mode: "table" | "tiles"): Promise<void> {
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption(mode);
  await expect(mode === "table" ? table(page) : page.getByRole("grid", { name: "Device fleet", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "View", exact: true })).toBeEnabled();
}

test("switching shares one collection, query, ordered selection and scope; arrows leave picks intact", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await tile(page, 3).click();
  await tile(page, 1).click();
  await page.evaluate(() => { (globalThis as any).tileDemo.queryBeforeSwitch = (globalThis as any).tileDemo.fleet.collection.query; });
  await switchView(page, "table");
  await expect(row(page, 3)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, 1).getByRole("button", { name: "Deselect Device 000001", exact: true })).toHaveText("2");
  expect(await page.evaluate(() => {
    const { fleet, queryBeforeSwitch } = (globalThis as any).tileDemo;
    return fleet.table.collection === fleet.collection && fleet.table.selection === fleet.grid.selection && fleet.collection.query === queryBeforeSwitch;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => (globalThis as any).tileDemo.scope.value("fleet.keys").value)).toEqual(["[3]", "[1]"]);
  await table(page).press("ArrowDown");
  expect(await chosen(page)).toEqual(["[3]", "[1]"]);
  await table(page).press(" ");
  expect(await chosen(page)).toEqual(["[3]", "[1]", "[2]"]);
  await row(page, 4).locator('[aria-colindex="2"]').click();
  await expect(page.locator("#fleet-table [role=status]")).toContainText("Select at most 3");
  expect(await chosen(page)).toEqual(["[3]", "[1]", "[2]"]);
  await page.evaluate(() => (globalThis as any).tileDemo.fleet.table.focusKey("[2]"));
  await table(page).press("Alt+ArrowUp");
  expect(await chosen(page)).toEqual(["[3]", "[2]", "[1]"]);
  await table(page).press("F2");
  await expect(row(page, 2).getByRole("button", { name: "Deselect Device 000002", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(table(page)).toBeFocused();
  await switchView(page, "tiles");
  await expect(tile(page, 2)).toBeFocused();
  await expect(tile(page, 2).locator(".aster-tile-order")).toHaveText("2");
  expect(await chosen(page)).toEqual(["[3]", "[2]", "[1]"]);
  expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.collection.query === (globalThis as any).tileDemo.queryBeforeSwitch)).toBe(true);
  expect(errors).toEqual([]);
});

test("table sort and filters update the shared query; reconnect preserves them and selected order", async ({ page }) => {
  await open(page);
  await tile(page, 3).click();
  await tile(page, 1).click();
  await switchView(page, "table");
  await page.locator('#fleet-table .aster-grid-header[data-field="name"] .aster-grid-sort').click();
  await page.locator('#fleet-table .aster-grid-header[data-field="name"] .aster-grid-sort').click();
  await expect(page.locator('#fleet-table .aster-grid-header[data-field="name"]')).toHaveAttribute("aria-sort", "descending");
  await expect(row(page, 100_000)).toBeVisible();
  expect(await chosen(page)).toEqual(["[3]", "[1]"]);
  await table(page).press("ArrowDown");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filter = page.getByRole("textbox", { name: "Filter name", exact: true });
  await filter.fill("00000");
  await filter.press("Enter");
  await expect(page.locator("#fleet-table .aster-grid-total")).toHaveText("10 rows");
  expect(await chosen(page)).toEqual(["[3]", "[1]"]);
  const query = await page.evaluate(() => JSON.stringify((globalThis as any).tileDemo.fleet.collection.query));
  await switchView(page, "tiles");
  await expect(tile(page, 9)).toBeVisible();
  await expect(tile(page, 1)).toHaveAttribute("aria-selected", "true");
  await switchView(page, "table");
  await expect(filter).toHaveValue("00000");
  expect(await page.evaluate(() => JSON.stringify((globalThis as any).tileDemo.fleet.collection.query))).toBe(query);
  expect(await chosen(page)).toEqual(["[3]", "[1]"]);
});

test("host filters and query projections survive binding, paging and repeated detach", async ({ page }) => {
  await open(page);
  await page.getByRole("checkbox", { name: "Fleet online only", exact: true }).check();
  await expect(tile(page, 2)).toBeVisible();
  await page.evaluate(() => {
    const { collection } = (globalThis as any).tileDemo.fleet;
    collection.setQuery({ ...collection.query, select: ["id", "name", "platform", "online", "lastSeen"] });
  });
  await expect(tile(page, 2)).toBeVisible();
  await tile(page, 2).click();
  for (const mode of ["table", "tiles", "table"] as const) {
    await switchView(page, mode);
    expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.collection.query.filter)).toEqual({ op: "eq", field: "online", value: true });
    expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.collection.query.select)).toEqual(["id", "name", "platform", "online", "lastSeen"]);
  }
  await page.evaluate(() => (globalThis as any).tileDemo.fleet.table.focusIndex(400));
  await expect(table(page)).toBeFocused();
  const active = await page.evaluate(() => (globalThis as any).tileDemo.fleet.table.activeKey);
  expect(active).toBeDefined();
  await switchView(page, "tiles");
  await expect(page.locator(`#fleet .aster-tile[data-key='${active}']`)).toBeFocused();
  expect(await chosen(page)).toEqual(["[2]"]);
  // Detaching a borrowed collection must not release its store synchronization.
  await page.evaluate(async () => { await (globalThis as any).tileDemo.fleet.ctx.update("Devices", "[2]", { name: "Renamed device" }); });
  await switchView(page, "table");
  expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.table.focusIndex(0))).toBe(true);
  await expect(row(page, 2)).toContainText("Renamed device");
  await expect(row(page, 2)).toHaveAttribute("aria-selected", "true");
});

test("single, multiple, ranges, no-selection binding and empty state have distinct behavior", async ({ page }) => {
  await open(page);
  await switchView(page, "table");
  await page.getByRole("combobox", { name: "Selection", exact: true }).selectOption("single");
  await row(page, 1).locator('[aria-colindex="2"]').click();
  await table(page).press("ArrowDown");
  expect(await chosen(page)).toEqual(["[1]"]);
  await table(page).press(" ");
  expect(await chosen(page)).toEqual(["[2]"]);
  await page.getByRole("combobox", { name: "Selection", exact: true }).selectOption("multiple");
  await row(page, 1).locator('[aria-colindex="2"]').click();
  await row(page, 4).locator('[aria-colindex="2"]').click({ modifiers: ["Shift"] });
  expect(await chosen(page)).toEqual(["[1]", "[2]", "[3]", "[4]"]);
  await row(page, 2).getByRole("button", { name: "Deselect Device 000002", exact: true }).click();
  expect(await chosen(page)).toEqual(["[1]", "[3]", "[4]"]);
  await page.evaluate(() => { (globalThis as any).tileDemo.fleet.table.selection = undefined; });
  await expect(row(page, 5)).not.toHaveAttribute("aria-selected");
  await row(page, 5).locator('[aria-colindex="2"]').click();
  expect(await chosen(page)).toEqual(["[1]", "[3]", "[4]"]);
  await page.evaluate(() => {
    const f = (globalThis as any).tileDemo.fleet;
    f.table.selection = f.grid.selection;
    f.collection.setQuery({ set: "Devices", filter: { op: "lt", field: "id", value: 0 } });
  });
  await expect(page.locator("#fleet-table .aster-grid-total")).toHaveText("0 rows");
  await expect(table(page)).not.toHaveAttribute("aria-activedescendant");
  expect(await chosen(page)).toEqual([]);
});

test("inline save precedes switching; failed saves keep the table and draft", async ({ page }) => {
  await open(page);
  await switchView(page, "table");
  await page.evaluate(() => { (globalThis as any).tileDemo.fleet.table.editable = true; });
  await row(page, 1).locator('[aria-colindex="1"]').dblclick();
  const name = row(page, 1).getByRole("textbox", { name: "name", exact: true });
  await name.fill("Updated from table");
  expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.switchView("tiles"))).toBe(true);
  await expect(tile(page, 1)).toHaveAccessibleName("Updated from table");
  await switchView(page, "table");
  await row(page, 1).locator('[aria-colindex="1"]').dblclick();
  await name.fill("Keep this draft");
  await page.evaluate(() => (globalThis as any).tileDemo.fleet.mock.faults.failNext(503));
  expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.switchView("tiles"))).toBe(false);
  await expect(name).toHaveValue("Keep this draft");
  await expect(table(page)).toBeVisible();
  await name.press("Escape");
});

test("shared table ranks pass axe, reduced motion and narrow layout", async ({ page }) => {
  await open(page);
  await tile(page, 1).click();
  await tile(page, 2).click();
  await switchView(page, "table");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const identity of ["lamplight", "harbour"]) {
    await chooseAppearance(page, "Theme", identity);
    for (const scheme of ["light", "dark"]) {
      await chooseAppearance(page, "Scheme", scheme);
      await settle(page);
      expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await table(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  await settle(page);
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});


test("binding guards reject incompatible trees, grouping and mismatched selections", async ({ page }) => {
  await open(page);
  const errors = await page.evaluate(() => {
    const { ctx, collection, grid } = (globalThis as any).tileDemo.fleet;
    const attempt = (run: () => void) => { try { run(); return "accepted"; } catch (e) { return (e as Error).message; } };
    const other = ctx.collection({ set: "Devices" });
    const result = [
      attempt(() => { const table = document.createElement("aster-grid") as any; table.collection = collection; table.tree = { parentField: "id" }; }),
      attempt(() => { const table = document.createElement("aster-grid") as any; table.collection = collection; table.view = { columns: [], filters: {}, sort: [], frozen: 0, groupBy: "platform" }; }),
      attempt(() => { const table = document.createElement("aster-grid") as any; table.collection = other; table.selection = grid.selection; }),
    ];
    ctx.release(other);
    return result;
  });
  expect(errors).toEqual([expect.stringContaining("flat rows"), expect.stringContaining("flat rows"), expect.stringContaining("same collection")]);
});

test("keyboard loads missing rows without changing picks, and deletion recovers focus", async ({ page }) => {
  await open(page);
  await tile(page, 2).click();
  await switchView(page, "table");
  await table(page).press("Control+End");
  await expect(row(page, 100_000)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (globalThis as any).tileDemo.fleet.table.activeKey)).toBe("[100000]");
  expect(await chosen(page)).toEqual(["[2]"]);
  await table(page).press(" ");
  expect(await chosen(page)).toEqual(["[2]", "[100000]"]);
  await table(page).press("F2");
  await expect(row(page, 100_000).getByRole("button", { name: "Deselect Device 100000", exact: true })).toBeFocused();
  await page.evaluate(async () => { await (globalThis as any).tileDemo.fleet.ctx.remove("Devices", "[100000]"); });
  await expect.poll(() => page.evaluate(() => (globalThis as any).tileDemo.fleet.table.activeKey)).toBe("[99999]");
  expect(await chosen(page)).toEqual(["[2]"]);
  await expect(table(page)).toBeFocused();
  const id = await table(page).getAttribute("aria-activedescendant");
  expect(id).toBeTruthy();
  await expect(page.locator(`#${id}`)).toBeAttached();
});


test("a newer switch cancels delayed view removal while an inline save finishes", async ({ page }) => {
  await open(page);
  await switchView(page, "table");
  await page.evaluate(() => { (globalThis as any).tileDemo.fleet.table.editable = true; });
  await row(page, 1).locator('[aria-colindex="1"]').dblclick();
  await row(page, 1).getByRole("textbox", { name: "name", exact: true }).fill("Saved while staying in table");
  const result = await page.evaluate(async () => {
    const f = (globalThis as any).tileDemo.fleet;
    f.mock.faults.writeLatencyMs = 300;
    const leaving = f.switchView("tiles");
    const staying = await f.switchView("table");
    return { leaving: await leaving, staying };
  });
  expect(result).toEqual({ leaving: false, staying: true });
  await expect(table(page)).toBeVisible();
  await expect(row(page, 1)).toContainText("Saved while staying in table");
});


test.describe("shared touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("table pick and reorder actions work by touch and names stay in the value column", async ({ page }) => {
    await open(page);
    await switchView(page, "table");
    await row(page, 1).getByRole("button", { name: "Select Device 000001", exact: true }).tap();
    await row(page, 2).getByRole("button", { name: "Select Device 000002", exact: true }).tap();
    await row(page, 2).getByRole("button", { name: "Move Device 000002 earlier in selection", exact: true }).tap();
    expect(await chosen(page)).toEqual(["[2]", "[1]"]);
    const cell = await row(page, 1).locator('[aria-colindex="1"]').boundingBox();
    const value = await row(page, 1).locator(".aster-grid-selection-value").boundingBox();
    expect(value!.x - cell!.x).toBeGreaterThan(50);
    await switchView(page, "tiles");
    await expect(tile(page, 2).locator(".aster-tile-order")).toHaveText("1");
    await expect(tile(page, 1).locator(".aster-tile-order")).toHaveText("2");
  });
});
