// Grid P1 acceptance: column capabilities, chrome and menu configuration,
// selection and editing features, events, loading and error views, data and
// paging options, tree pass-through and non-focus scrolling.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

const metadata = JSON.parse(readFileSync(new URL("../../fixtures/aster/metadata.json", import.meta.url), "utf8"));

const grid = (page: Page) => page.locator("aster-grid.time-grid");
const rows = (page: Page) => page.locator(".aster-grid-row[data-key]:not(.aster-grid-group)");
const header = (page: Page, field: string) => page.locator(`.aster-grid-header[data-field="${field}"]`);
const total = (page: Page) => page.locator(".aster-grid-total");
const live = (page: Page) => page.locator("p.aster-sr-only[aria-live]").first();
const drift = (page: Page) => grid(page).locator(".aster-grid-drift");

async function time(page: Page, clients = 200): Promise<void> {
  await page.goto(`/?memory&debug&clients=${clients}&time=200&now=${NOW}#time`);
  await page.evaluate(() => document.fonts.ready);
  await expect(rows(page).first()).toBeVisible();
}

async function setPolicy(page: Page, policy: unknown): Promise<void> {
  await grid(page).evaluate((element, value) => ((element as HTMLElement & { policy: unknown }).policy = value), policy);
}

async function setFeatures(page: Page, features: unknown): Promise<void> {
  await grid(page).evaluate((element, value) => ((element as HTMLElement & { features: unknown }).features = value), features);
}

async function setGrid(page: Page, patch: Record<string, unknown>): Promise<void> {
  await grid(page).evaluate((element, values) => Object.assign(element as unknown as Record<string, unknown>, values), patch);
}

/** A menu item of any kind (action, check, radio, submenu) by its visible label. */
function menuItem(page: Page, name: string) {
  const exact = new RegExp(`^\\W*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\W*$`);
  return page.locator('[role^="menuitem"]').filter({ hasText: exact }).last();
}

/** Opens a column's menu. */
async function openColumnMenu(page: Page, field: string): Promise<void> {
  await header(page, field).hover();
  await header(page, field).locator(".aster-grid-header-menu").click();
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);

test("the new capability sugar writes policy and preserves the other entries", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const element = document.createElement("aster-grid") as unknown as Record<string, unknown> & { policy: unknown; features: unknown; multiSort: boolean };
    element.groupable = false;
    element.resizable = ["date"];
    element.movable = (field: string) => field !== "date";
    element.hideable = ["date", "hours"];
    element.freezable = false;
    element.multiSort = false;
    const policy = element.policy;
    const features = element.features;
    element.multiSort = true;
    return { policy, features, after: element.features, reads: {
      groupable: element.groupable, resizable: element.resizable, movable: element.movable, hideable: element.hideable, freezable: element.freezable, multiSort: element.multiSort,
    } };
  });
  expect(result.policy).toMatchObject({ groupable: false, resizable: ["date"], hideable: ["date", "hours"], freezable: false });
  expect(result.features).toEqual([{ kind: "sort", multi: false }]);
  expect(result.after).toEqual([]);
  expect(result.reads).toEqual({ groupable: false, resizable: ["date"], movable: true, hideable: ["date", "hours"], freezable: false, multiSort: true });
});

test("groupable policy refuses the column menu, the grouping action and a saved grouping, with reasons", async ({ page }) => {
  await time(page);

  await setPolicy(page, { groupable: ["status"] });
  await openColumnMenu(page, "date");
  const refused = menuItem(page, "Group by Date");
  await expect(refused).toHaveAttribute("aria-disabled", "true");
  await expect(refused).toHaveAttribute("title", "Grouping by Date isn’t allowed on this page.");
  await page.keyboard.press("Escape");
  await openColumnMenu(page, "status");
  await expect(menuItem(page, "Group by Status")).not.toHaveAttribute("aria-disabled");
  await page.keyboard.press("Escape");
  // A per-field narrowing on top of a permissive global entry.
  await setPolicy(page, { groupable: true, fields: { hours: { groupable: false } } });
  await openColumnMenu(page, "hours");
  await expect(menuItem(page, "Group by Hours")).toHaveAttribute("title", "Grouping by Hours isn’t allowed on this page.");
  await page.keyboard.press("Escape");

  // A grouping stored in the view before the refusal stays, but is not applied.
  await setPolicy(page, {});
  await setGrid(page, { view: { ...(await grid(page).evaluate((element) => (element as HTMLElement & { view: object }).view)), groupBy: "status" } });
  await expect(page.locator(".aster-grid-group")).not.toHaveCount(0);
  await setPolicy(page, { groupable: ["date"] });
  await expect(page.locator(".aster-grid-group")).toHaveCount(0);
  await expect(drift(page)).toContainText("Grouped by Status: Grouping by Status isn’t allowed on this page.");
  const chip = grid(page).locator('.aster-grid-group-tools[data-refused][data-group-field="status"]');
  await expect(chip).toBeVisible();
  await expect(chip.locator("button")).toHaveAttribute("title", /Grouping by Status isn’t allowed on this page. Remove it from the saved view/);
  const stored = await grid(page).evaluate((element) => (element as HTMLElement & { view: { groupBy?: unknown } }).view.groupBy);
  expect(stored).toBe("status");
  await chip.locator("button").click();
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { view: { groupBy?: unknown } }).view.groupBy)).toBeUndefined();
});

test("resizable and movable policy remove their affordances and say why", async ({ page }) => {
  await time(page);

  await setPolicy(page, { resizable: false });
  await expect(page.locator(".aster-grid-resize")).toHaveCount(0);
  await openColumnMenu(page, "date");
  await menuItem(page, "Width").click();
  for (const label of ["Wider", "Narrower", "Fit the space"]) {
    await expect(menuItem(page, label)).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, label)).toHaveAttribute("title", "Resizing Date isn’t allowed on this page.");
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await setPolicy(page, { resizable: true, movable: ["date"] });
  await openColumnMenu(page, "hours");
  await menuItem(page, "Move").click();
  await expect(menuItem(page, "Left")).toHaveAttribute("aria-disabled", "true");
  await expect(menuItem(page, "Left")).toHaveAttribute("title", "Moving Hours isn’t allowed on this page.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // The allowed column still offers its move; the first column is refused structurally.
  await openColumnMenu(page, "date");
  await menuItem(page, "Move").click();
  await expect(menuItem(page, "Left")).toHaveAttribute("title", "It's the first column.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

test("hideable policy refuses hiding with a reason; a saved hidden column is shown and reported", async ({ page }) => {
  await time(page);

  await setPolicy(page, { hideable: ["date"] });
  await openColumnMenu(page, "hours");
  await expect(menuItem(page, "Hide Hours")).toHaveAttribute("aria-disabled", "true");
  await expect(menuItem(page, "Hide Hours")).toHaveAttribute("title", "Hiding Hours isn’t allowed on this page.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Columns" }).click();
  const hours = page.getByRole("checkbox", { name: "Hours", exact: true });
  await expect(hours).toBeDisabled();
  await expect(page.locator('.aster-grid-panel li label[title="Hiding Hours isn’t allowed on this page."]')).toHaveCount(1);
  await page.keyboard.press("Escape");

  // A view that hid Note before the refusal keeps it stored; Note is shown now.
  await setPolicy(page, {});
  await setGrid(page, { view: { ...(await grid(page).evaluate((element) => (element as HTMLElement & { view: object }).view)),
    columns: (await grid(page).evaluate((element) => (element as HTMLElement & { view: { columns: object[] } }).view.columns)).map((column) => ({ ...column, hidden: (column as { field: string }).field === "note" })) } });
  await expect(header(page, "note")).toHaveCount(0);
  await setPolicy(page, { hideable: ["date"] });
  await expect(header(page, "note")).toHaveCount(1);
  await expect(drift(page)).toContainText("Column Note is hidden: Hiding Note isn’t allowed on this page.");
  await setPolicy(page, {});
  await expect(header(page, "note")).toHaveCount(0);
});

test("freezable policy cuts the frozen run and reports the column it cannot freeze", async ({ page }) => {
  await time(page);
  // The page's view freezes Date and Person.
  await expect(header(page, "personId")).toHaveAttribute("data-frozen", "");
  await setPolicy(page, { freezable: ["date"] });
  await expect(header(page, "date")).toHaveAttribute("data-frozen", "");
  await expect(header(page, "personId")).not.toHaveAttribute("data-frozen");
  await expect(drift(page)).toContainText("Column Person is frozen: Freezing Person isn’t allowed on this page.");
  await openColumnMenu(page, "projectId");
  await expect(menuItem(page, "Freeze up to Project")).toHaveAttribute("aria-disabled", "true");
  await expect(menuItem(page, "Freeze up to Project")).toHaveAttribute("title", /Freezing Date isn’t allowed on this page.|Freezing Person isn’t allowed on this page./);
  await page.keyboard.press("Escape");
  await setPolicy(page, {});
  await expect(header(page, "personId")).toHaveAttribute("data-frozen", "");
  await expect(drift(page)).toHaveCount(0);
});

test("multiSort false makes every sort replace the others and removes the add action", async ({ page }) => {
  await time(page);
  await setGrid(page, { multiSort: false });
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { features: unknown }).features)).toEqual([{ kind: "sort", multi: false }]);

  await header(page, "date").locator(".aster-grid-sort").click();
  await expect(header(page, "date")).toHaveAttribute("aria-sort", "ascending");
  await header(page, "hours").locator(".aster-grid-sort").click({ modifiers: ["Shift"] });
  await expect(header(page, "hours")).toHaveAttribute("aria-sort", "ascending");
  await expect(header(page, "date")).not.toHaveAttribute("aria-sort");
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { view: { sort: unknown[] } }).view.sort)).toEqual([{ field: "hours" }]);

  await openColumnMenu(page, "status");
  await expect(menuItem(page, "Add to the sort")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The Sort panel's direction button also replaces rather than adds.
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  const panel = page.getByRole("group", { name: "Sort rows", exact: true });
  await panel.getByRole("button", { name: /^Sort Date(,|$)/ }).click();
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { view: { sort: unknown[] } }).view.sort)).toEqual([{ field: "date" }]);
});

test("headerMenu false removes the per-header menu button and its keyboard route", async ({ page }) => {
  await time(page);
  await expect(page.locator(".aster-grid-header-menu").first()).toBeVisible();
  await setGrid(page, { showHeaderMenu: false });
  await expect(page.locator(".aster-grid-header-menu")).toHaveCount(0);
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { showHeaderMenu: boolean }).showHeaderMenu)).toBe(false);
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { chrome: { headerMenu?: boolean } }).chrome.headerMenu)).toBe(false);

  // The header's keyboard menu is gone with the button.
  await grid(page).locator(".aster-grid-scroll").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await grid(page).evaluate((element) => { (element as HTMLElement & { chrome: { headerMenu?: boolean } }).chrome = { headerMenu: true }; });
  await expect(page.locator(".aster-grid-header-menu").first()).toBeVisible();
});

test("columnMenu adds host actions before the built-in menu items", async ({ page }) => {
  await time(page);
  await grid(page).evaluate((element) => {
    (element as HTMLElement & { columnMenu: (field: string) => unknown }).columnMenu = (field: string) => [
      { label: `Pin ${field}`, run: () => ((globalThis as { pinned?: string }).pinned = field) },
    ];
  });
  await openColumnMenu(page, "date");
  const first = page.locator('[role="menuitem"]').first();
  await expect(first).toHaveText("Pin date");
  await first.click();
  expect(await page.evaluate(() => (globalThis as { pinned?: string }).pinned)).toBe("date");

  // The same actions appear where the column menu is a submenu of the row menu.
  await openColumnMenu(page, "date");
  await expect(menuItem(page, "Pin date")).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("filterOperators narrows the filter row and the advanced dialog to the page's operators", async ({ page }) => {
  await time(page);
  await setGrid(page, { filterOperators: { note: ["startswith"], status: ["gt"], personId: [], hours: ["gt"] } });
  await page.getByRole("button", { name: "Filters", exact: true }).click();

  const note = page.locator(".aster-grid-filters .aster-grid-cell").nth(6);
  await expect(note).toContainText("Not filterable");
  await expect(note.locator(".aster-grid-filter-refused")).toHaveAttribute("title", "Note can’t be filtered by contains on this page.");
  const status = page.locator(".aster-grid-filters .aster-grid-cell").nth(5);
  await expect(status.locator(".aster-grid-filter-refused")).toHaveAttribute("title", "Status can’t be filtered by equals on this page.");
  const person = page.locator(".aster-grid-filters .aster-grid-cell").nth(1);
  await expect(person.locator(".aster-grid-filter-refused")).toHaveAttribute("title", "Person can’t be filtered by is one of on this page.");

  const hours = page.getByRole("textbox", { name: "Filter Hours" });
  await hours.fill("5");
  await hours.press("Enter");
  await expect(page.locator(".aster-grid-filters .aster-error")).toHaveText("Hours can’t be filtered by equals on this page.");
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { view: { filters: object } }).view.filters)).toEqual({});
  await hours.fill(">5");
  await hours.press("Enter");
  await expect(page.locator(".aster-grid-filters .aster-error")).toHaveCount(0);
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { collection: { query: { filter?: unknown } } }).collection.query.filter)).toEqual({ op: "gt", field: "hours", value: "5" });

  // A saved expression using a refused operator is not applied; the dialog says why.
  await setGrid(page, { view: { sort: [], filters: {}, frozen: 0,
    columns: await grid(page).evaluate((element) => (element as HTMLElement & { view: { columns: object[] } }).view.columns.map((column) => ({ field: (column as { field: string }).field }))),
    criteria: { op: "eq", field: "hours", value: "5" } } });
  await page.getByRole("button", { name: "Advanced filter", exact: true }).click();
  await page.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(page.locator(".aster-grid-advanced")).toContainText("Hours can’t be filtered by equals on this page. Change that condition to apply the filter.");
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { view: { criteria?: unknown } }).view.criteria)).toEqual({ op: "eq", field: "hours", value: "5" });
});

test("editMode cell edits only the pressed cell and saves the row", async ({ page }) => {
  await time(page);
  await setGrid(page, { editMode: "cell" });
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { editMode: string }).editMode)).toBe("cell");
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { features: unknown }).features)).toEqual([{ kind: "edit", mode: "cell" }]);

  const row = rows(page).filter({ hasText: "Draft" }).first();
  const key = await row.getAttribute("data-key");
  const hours = row.locator("[aria-colindex='4']");
  await hours.dblclick();
  await expect(row).toHaveAttribute("data-editing", "");
  await expect(hours.locator("input")).toBeVisible();
  // Only the pressed cell becomes a control.
  await expect(row.locator("[aria-colindex='5'] input")).toHaveCount(0);
  await expect(row.locator("[aria-colindex='6'] input")).toHaveCount(0);
  const input = hours.locator("input");
  await input.fill("7.5");
  await input.press("Enter");
  await expect(row).not.toHaveAttribute("data-editing");
  await expect.poll(async () => {
    const data = await page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { TimeEntries: { id: number; hours: unknown }[] } }> } } }).aster.mock.dump()).data.TimeEntries);
    return Number(data.find((entry) => `[${entry.id}]` === key)?.hours);
  }).toBe(7.5);

  // A cell policy refuses starts nothing in cell mode; an allowed cell still edits.
  await setPolicy(page, { editable: ["note"] });
  const second = rows(page).filter({ hasText: "Draft" }).nth(1);
  await second.locator("[aria-colindex='4']").dblclick();
  await expect(second).not.toHaveAttribute("data-editing");
  await second.locator("[aria-colindex='7']").dblclick();
  await expect(second).toHaveAttribute("data-editing", "");
  await expect(second.locator("[aria-colindex='4'] input")).toHaveCount(0);
  await expect(second.locator("[aria-colindex='7'] textarea, [aria-colindex='7'] input")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("selectionAppearance cell marks the active cell instead of the whole row", async ({ page }) => {
  await time(page);
  await expect(page.locator("[data-selected-cell]")).toHaveCount(0);
  await setGrid(page, { selectionAppearance: "cell" });
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { selectionAppearance: string }).selectionAppearance)).toBe("cell");
  const row = rows(page).nth(2);
  await row.locator("[aria-colindex='4']").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(row.locator("[data-selected-cell]")).toHaveCount(1);
  await expect(row.locator("[data-selected-cell]")).toHaveAttribute("aria-colindex", "4");
  await expect(page.locator("[data-selected-cell]")).toHaveCount(1);
  await expect(page.locator(".aster-grid-scroll")).toHaveAttribute("data-selection-appearance", "cell");
});

test("selectionColumn gives owned selection a checkbox per row", async ({ page }) => {
  await time(page);
  await setGrid(page, { selectionColumn: true });
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { selectionColumn: boolean }).selectionColumn)).toBe(true);
  await expect(page.locator(".aster-grid-select-head")).toHaveCount(1);
  // Owned selection chooses one row, so the header has nothing to select in bulk.
  await expect(page.locator(".aster-grid-select-head input")).toHaveCount(0);
  await expect(page.locator(".aster-grid-header[data-col='0']")).toHaveAttribute("aria-colindex", "2");

  const row = rows(page).nth(2);
  const box = row.locator(".aster-grid-select input");
  await box.click();
  await expect(box).toBeChecked();
  const key = await row.getAttribute("data-key");
  await expect.poll(() => grid(page).evaluate((element) => (element as HTMLElement & { selected?: string }).selected)).toBe(key);
  // The old inline pick control is replaced by the column.
  await expect(page.locator(".aster-grid-pick")).toHaveCount(0);
});

test("selectionColumn's header selects and clears loaded rows with a mixed state", async ({ page }) => {
  // The composition demo already binds a multiple shared Selection to its grid.
  await page.goto("/playground/composition.html");
  const table = page.locator("aster-grid").first();
  await expect(table.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  await table.evaluate((element) => { (element as HTMLElement & { selectionColumn: boolean }).selectionColumn = true; });
  const loaded = await table.evaluate((element) => (element as HTMLElement & { collection: { keys: { peek(): (string | undefined)[] } } }).collection.keys.peek().filter(Boolean).length);
  const head = table.locator(".aster-grid-select-head input");
  await expect(head).toBeVisible();
  await expect(head).not.toBeChecked();
  await head.click();
  await expect(head).toBeChecked();
  const chosen = await table.evaluate((element) => (element as HTMLElement & { selection: { keys: { peek(): string[] } } }).selection.keys.peek());
  expect(chosen.length).toBe(loaded);

  // Some chosen: the header reports a mixed state.
  await table.locator(".aster-grid-row[data-key]").nth(2).locator(".aster-grid-select input").click();
  await expect(head).not.toBeChecked();
  expect(await head.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(true);
  await head.click();
  await expect(head).toBeChecked();
  expect(await head.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(false);

  // A row checkbox names its record.
  expect(await table.locator(".aster-grid-row[data-key]").first().locator(".aster-grid-select input").getAttribute("aria-label")).toMatch(/^(Select|Deselect) \S/);
});

interface GridEvent {
  name: string;
  detail: Record<string, unknown>;
  cancelable: boolean;
}

async function recordEvents(page: Page, names: readonly string[]): Promise<void> {
  await page.evaluate((types) => {
    const element = document.querySelector("aster-grid.time-grid")!;
    const log: GridEvent[] = ((globalThis as { __gridEvents?: GridEvent[] }).__gridEvents = []);
    for (const name of types) {
      element.addEventListener(name, (event) => {
        const e = event as CustomEvent;
        const detail = e.detail && typeof e.detail === "object"
          ? Object.fromEntries(Object.entries(e.detail as object).map(([key, value]) => [key, key === "originalEvent" ? !!value : value]))
          : {};
        log.push({ name, detail, cancelable: e.cancelable });
        const flags = globalThis as { __vetoCellClick?: boolean; __vetoEditSave?: boolean; __vetoContext?: boolean };
        if (name === "cell-click" && flags.__vetoCellClick) e.preventDefault();
        if (name === "edit-save" && flags.__vetoEditSave) e.preventDefault();
        if (name === "cell-context-menu" && flags.__vetoContext) e.preventDefault();
      });
    }
  }, names);
}

async function events(page: Page): Promise<GridEvent[]> {
  return page.evaluate(() => (globalThis as { __gridEvents?: GridEvent[] }).__gridEvents ?? []);
}

async function countOf(page: Page, name: string): Promise<number> {
  return (await events(page)).filter((entry) => entry.name === name).length;
}

test("view and selection changes are notified once, after the fact", async ({ page }) => {
  await time(page);
  await recordEvents(page, ["sort-change", "filter-change", "criteria-change", "selection-change"]);

  await header(page, "hours").locator(".aster-grid-sort").click();
  await expect.poll(() => countOf(page, "sort-change")).toBe(1);
  let log = await events(page);
  expect(log.find((entry) => entry.name === "sort-change")).toMatchObject({ cancelable: false, detail: { sort: [{ field: "hours" }] } });

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Filter Status" }).click();
  await page.getByRole("option", { name: "Approved", exact: true }).click();
  await expect.poll(() => countOf(page, "filter-change")).toBe(1);
  log = await events(page);
  expect(log.find((entry) => entry.name === "filter-change")).toMatchObject({
    cancelable: false, detail: { filters: { status: { op: "eq", field: "status", value: "approved" } } },
  });

  const row = rows(page).filter({ hasText: "Approved" }).nth(2);
  const key = await row.getAttribute("data-key");
  await row.locator("[aria-colindex='4']").click();
  await expect.poll(() => countOf(page, "selection-change")).toBe(1);
  log = await events(page);
  expect(log.find((entry) => entry.name === "selection-change")).toMatchObject({ cancelable: false, detail: { keys: [key] } });

  await grid(page).evaluate((element) => {
    const el = element as HTMLElement & { view: object; criteria?: unknown };
    el.view = { ...el.view, criteria: { op: "eq", field: "status", value: "draft" } };
  });
  await expect.poll(() => countOf(page, "criteria-change")).toBe(1);
  log = await events(page);
  expect(log.find((entry) => entry.name === "criteria-change")).toMatchObject({
    cancelable: false, detail: { criteria: { op: "eq", field: "status", value: "draft" } },
  });
});

test("pointer and edit events carry their target, and action events veto the default", async ({ page }) => {
  await time(page);
  await recordEvents(page, ["cell-click", "row-click", "cell-double-click", "cell-context-menu", "edit-start", "edit-save", "edit-error", "cell-change"]);

  const row = rows(page).nth(2);
  const key = await row.getAttribute("data-key");
  const index = Number(await row.getAttribute("data-index"));
  await row.locator("[aria-colindex='4']").click();
  await expect.poll(() => countOf(page, "cell-click")).toBe(1);
  await expect.poll(() => countOf(page, "row-click")).toBe(1);
  let log = await events(page);
  expect(log.find((entry) => entry.name === "cell-click")).toMatchObject({
    cancelable: true, detail: { key, field: "hours", row: index, column: 3, originalEvent: true },
  });
  expect(log.find((entry) => entry.name === "row-click")).toMatchObject({ cancelable: true, detail: { key, row: index, originalEvent: true } });

  // Vetoing cell-click keeps the active row where it was; row-click still fires.
  await page.evaluate(() => { (globalThis as { __vetoCellClick?: boolean }).__vetoCellClick = true; });
  const before = await grid(page).evaluate((element) => (element as HTMLElement & { activeKey?: string }).activeKey);
  await rows(page).nth(3).locator("[aria-colindex='4']").click();
  await expect.poll(() => countOf(page, "cell-click")).toBe(2);
  await expect.poll(() => countOf(page, "row-click")).toBe(2);
  expect(await grid(page).evaluate((element) => (element as HTMLElement & { activeKey?: string }).activeKey)).toBe(before);
  await page.evaluate(() => { (globalThis as { __vetoCellClick?: boolean }).__vetoCellClick = false; });

  // A double-click announces its target, then starts an edit on the pressed field.
  const editable = rows(page).filter({ hasText: "Draft" }).first();
  const editableKey = await editable.getAttribute("data-key");
  await editable.locator("[aria-colindex='7']").dblclick();
  await expect.poll(() => countOf(page, "edit-start")).toBe(1);
  await expect.poll(() => countOf(page, "cell-double-click")).toBeGreaterThan(0);
  log = await events(page);
  expect(log.find((entry) => entry.name === "cell-double-click")).toMatchObject({ cancelable: true, detail: { key: editableKey, field: "note" } });
  expect(log.find((entry) => entry.name === "edit-start")).toMatchObject({ cancelable: true, detail: { key: editableKey, field: "note" } });
  await expect(editable).toHaveAttribute("data-editing", "");

  // Typing notifies the draft change; vetoing edit-save keeps the row open.
  const note = editable.locator("[aria-colindex='7'] textarea, [aria-colindex='7'] input");
  await note.fill("Team standup");
  await expect.poll(() => countOf(page, "cell-change")).toBeGreaterThan(0);
  log = await events(page);
  expect(log.filter((entry) => entry.name === "cell-change").at(-1)).toMatchObject({ cancelable: false, detail: { key: editableKey, field: "note", value: "Team standup" } });
  await page.evaluate(() => { (globalThis as { __vetoEditSave?: boolean }).__vetoEditSave = true; });
  await note.press("Enter");
  await expect.poll(() => countOf(page, "edit-save")).toBe(1);
  await expect(editable).toHaveAttribute("data-editing", "");
  log = await events(page);
  expect(log.find((entry) => entry.name === "edit-save")).toMatchObject({ cancelable: true, detail: { key: editableKey, changes: { note: "Team standup" } } });
  await page.evaluate(() => { (globalThis as { __vetoEditSave?: boolean }).__vetoEditSave = false; });
  await note.press("Enter");
  await expect(editable).not.toHaveAttribute("data-editing");

  // A failed save reports the row and keeps its draft.
  const failing = rows(page).filter({ hasText: "Submitted" }).first();
  const failingKey = await failing.getAttribute("data-key");
  await failing.locator("[aria-colindex='7']").dblclick();
  await expect.poll(() => countOf(page, "edit-start")).toBe(2);
  const failingNote = failing.locator("[aria-colindex='7'] textarea, [aria-colindex='7'] input");
  await failingNote.fill("This will fail");
  await page.evaluate(() => {
    (globalThis as unknown as { aster: { mock: { faults: { failNext(status: number, error: object): void } } } }).aster.mock.faults.failNext(500, { code: "MockFault", message: "Injected failure." });
  });
  await failingNote.press("Enter");
  await expect.poll(() => countOf(page, "edit-error")).toBe(1);
  log = await events(page);
  const failure = log.find((entry) => entry.name === "edit-error");
  expect(failure).toMatchObject({ cancelable: false, detail: { key: failingKey } });
  expect(typeof failure!.detail.error).toBe("string");
  await expect(failing).toHaveAttribute("data-editing", "");
  await page.keyboard.press("Escape");

  // The context-menu action fires before the menu and can veto it.
  await page.evaluate(() => { (globalThis as { __vetoContext?: boolean }).__vetoContext = true; });
  await rows(page).first().locator("[aria-colindex='4']").click({ button: "right" });
  await expect.poll(() => countOf(page, "cell-context-menu")).toBe(1);
  log = await events(page);
  expect(log.find((entry) => entry.name === "cell-context-menu")).toMatchObject({ cancelable: true, detail: { field: "hours", originalEvent: true } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.evaluate(() => { (globalThis as { __vetoContext?: boolean }).__vetoContext = false; });
  await rows(page).first().locator("[aria-colindex='4']").click({ button: "right" });
  await expect.poll(() => countOf(page, "cell-context-menu")).toBe(2);
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.keyboard.press("Escape");
});

/** A fresh grid in the composition example, configured before it connects. */
async function freshGrid(page: Page, props: Record<string, unknown> = {}) {
  await page.goto("/playground/composition.html");
  await page.waitForFunction(() => (globalThis as { compositionDemo?: unknown }).compositionDemo !== undefined);
  await page.evaluate(async (values) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const { ctx } = (globalThis as unknown as { compositionDemo: { ctx: { schema: { set(name: string): { type: object } } } } }).compositionDemo;
    const element = document.createElement("aster-grid") as HTMLElement & Record<string, unknown>;
    element.id = "fresh-grid";
    element.ctx = ctx;
    element.set = "Devices";
    element.view = (lib as unknown as { defaultView(type: object): object }).defaultView(ctx.schema.set("Devices").type);
    element.style.height = "300px";
    Object.assign(element, values);
    document.querySelector("main")!.append(element);
  }, props);
  return page.locator("#fresh-grid");
}

test("autoFetch false defers until refresh, then shows the content-area loading message", async ({ page }) => {
  const fresh = await freshGrid(page, { autoFetch: false, loadingMessage: "Fetching devices…" });
  await expect(fresh.locator(".aster-grid-total")).toHaveText("Not loaded");
  await expect(fresh.locator(".aster-grid-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(fresh.locator(".aster-grid-row[data-key]")).toHaveCount(0);
  await expect(fresh.locator(".aster-grid-loading")).toHaveCount(0);

  await page.evaluate(() => {
    const demo = (globalThis as unknown as { compositionDemo: { mock: { faults: { latencyMs: number } } } }).compositionDemo;
    demo.mock.faults.latencyMs = 500;
    void (document.querySelector("#fresh-grid") as HTMLElement & { refresh(): Promise<void> }).refresh();
  });
  await expect(fresh.locator(".aster-grid-loading")).toHaveText("Fetching devices…");
  await expect(fresh.locator(".aster-grid-scroll")).toHaveAttribute("aria-busy", "true");
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  await expect(fresh.locator(".aster-grid-loading")).toHaveCount(0);
  await expect(fresh.locator(".aster-grid-total")).toContainText("rows");
  await page.evaluate(() => {
    (globalThis as unknown as { compositionDemo: { mock: { faults: { latencyMs: number } } } }).compositionDemo.mock.faults.latencyMs = 0;
  });
});

test("autoFetch false loads on the first interaction with the grid", async ({ page }) => {
  const fresh = await freshGrid(page, { autoFetch: false });
  await expect(fresh.locator(".aster-grid-total")).toHaveText("Not loaded");
  await fresh.locator(".aster-grid-scroll").click();
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  await expect(fresh.locator(".aster-grid-total")).not.toHaveText("Not loaded");
});

test("a root collection failure shows a retry, and refresh recovers", async ({ page }) => {
  const fresh = await freshGrid(page);
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  await page.evaluate(() => {
    const demo = (globalThis as unknown as { compositionDemo: { mock: { faults: { failNext(status: number, error: object): void } } } }).compositionDemo;
    demo.mock.faults.failNext(500, { code: "MockFault", message: "Injected failure." });
    void (document.querySelector("#fresh-grid") as HTMLElement & { refresh(): Promise<void> }).refresh();
  });
  const failure = fresh.locator(".aster-grid-failure");
  await expect(failure).toContainText("Couldn’t load rows.");
  await expect(failure.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(fresh.locator(".aster-grid-scroll")).toHaveAttribute("aria-busy", "false");
  // The rows already loaded stay visible behind the banner.
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  await failure.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
});

test("pageSize, keepPages and exactCount configure the owned collection", async ({ page }) => {
  const fresh = await freshGrid(page, { pageSize: 7, keepPages: 2, exactCount: true });
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  const state = await fresh.evaluate((element) => {
    const grid = element as HTMLElement & { pageSize: number; keepPages?: number; exactCount: boolean; collection: { pageSize: number; keepPages: number } };
    return { pageSize: grid.pageSize, keepPages: grid.keepPages, exactCount: grid.exactCount, dataPageSize: grid.collection.pageSize, dataKeepPages: grid.collection.keepPages };
  });
  expect(state).toEqual({ pageSize: 7, keepPages: 2, exactCount: true, dataPageSize: 7, dataKeepPages: 2 });
  // No page feature: rows still load as they scroll, without a paging bar.
  await expect(fresh.locator(".aster-grid-paging")).toHaveCount(0);

  // A later page-size change rebuilds the owned collection with the new size.
  await fresh.evaluate((element) => { (element as HTMLElement & { pageSize: number }).pageSize = 12; });
  await expect.poll(() => fresh.evaluate((element) => (element as HTMLElement & { collection: { pageSize: number } }).collection.pageSize)).toBe(12);
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
});

test("a page feature loads one page at a time with a paging bar", async ({ page }) => {
  const fresh = await freshGrid(page, { features: [{ kind: "page" }], pageSize: 10 });
  const paging = fresh.locator(".aster-grid-paging");
  await expect(fresh.locator(".aster-grid-row[data-key]")).toHaveCount(10);
  await expect(paging).toContainText("Page 1 of 8");
  await expect(paging.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await expect(paging.getByRole("button", { name: "Next page", exact: true })).toBeEnabled();
  const firstKey = await fresh.locator(".aster-grid-row[data-key]").first().getAttribute("data-key");

  await paging.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(paging).toContainText("Page 2 of 8");
  await expect(fresh.locator(".aster-grid-row[data-key]")).toHaveCount(10);
  await expect.poll(() => fresh.locator(".aster-grid-row[data-key]").first().getAttribute("data-key")).not.toBe(firstKey);

  await paging.getByRole("button", { name: "Last page", exact: true }).click();
  await expect(paging).toContainText("Page 8 of 8");
  await expect(fresh.locator(".aster-grid-row[data-key]")).toHaveCount(2);
  await expect(paging.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await expect(paging.getByRole("button", { name: "Last page", exact: true })).toBeDisabled();

  // A new query starts at the first page.
  await fresh.locator('.aster-grid-header[data-field="name"] .aster-grid-sort').click();
  await expect(paging).toContainText("Page 1 of 8");
  await expect(fresh.locator(".aster-grid-row[data-key]")).toHaveCount(10);

  // Hiding the bar leaves paged loading in force; the bar is chrome, not mode.
  await fresh.evaluate((element) => { (element as HTMLElement & { showPagingBar: boolean }).showPagingBar = false; });
  await expect(fresh.locator(".aster-grid-paging")).toHaveCount(0);
  await expect(fresh.locator(".aster-grid-row[data-key]")).toHaveCount(10);
});

test("shift-selection on a later page chooses that page's records, by pointer and keyboard", async ({ page }) => {
  await page.goto("/playground/composition.html");
  await page.waitForFunction(() => (globalThis as { compositionDemo?: unknown }).compositionDemo !== undefined);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const { ctx } = (globalThis as unknown as { compositionDemo: { ctx: { store: object; schema: { set(name: string): { type: object } }; collection(options: object, extras?: object): object } } }).compositionDemo;
    const col = ctx.collection({ set: "Devices" }, { pageSize: 5 });
    const selection = new (lib as unknown as { Selection: new (store: object, collection: object, options: object) => { keys: { peek(): unknown[] } } }).Selection(ctx.store, col, { multiple: true });
    const element = document.createElement("aster-grid") as HTMLElement & Record<string, unknown>;
    element.id = "paged-select";
    element.ctx = ctx;
    element.set = "Devices";
    element.view = (lib as unknown as { defaultView(type: object): object }).defaultView(ctx.schema.set("Devices").type);
    element.features = [{ kind: "page" }];
    element.pageSize = 5;
    element.selection = selection;
    element.style.height = "300px";
    document.querySelector("main")!.append(element);
    (globalThis as unknown as { __pagedSelection: { keys: { peek(): unknown[] } } }).__pagedSelection = selection;
  });
  const table = page.locator("#paged-select");
  await expect(table.locator(".aster-grid-row[data-key]")).toHaveCount(5);
  const paging = table.locator(".aster-grid-paging");
  await expect(paging).toContainText("Page 1 of 15");
  await paging.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(paging).toContainText("Page 2 of 15");

  const chosen = () => page.evaluate(() =>
    (globalThis as unknown as { __pagedSelection: { keys: { peek(): unknown[] } } }).__pagedSelection.keys.peek().map(String));
  const pageRows = table.locator(".aster-grid-row[data-key]");
  const rowKeys = await pageRows.evaluateAll((els) => els.map((el) => el.getAttribute("data-key")));

  // Pointer: the first and third rows of page two are the sixth to eighth records.
  await pageRows.nth(0).locator("[role=gridcell]").first().click();
  await pageRows.nth(2).locator("[role=gridcell]").first().click({ modifiers: ["Shift"] });
  await expect.poll(chosen).toEqual(rowKeys.slice(0, 3));

  // Keyboard: from the page's first row, Shift+ArrowDown extends by position on the page.
  await pageRows.nth(0).locator("[role=gridcell]").first().click();
  await expect.poll(chosen).toEqual([rowKeys[0]]);
  await table.locator(".aster-grid-scroll").focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(chosen).toEqual(rowKeys.slice(0, 2));
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(chosen).toEqual(rowKeys.slice(0, 3));
});

interface TaskRow { id: number; title: string; parentId: number | null }

/**
 * A small tree over the composition page's data layer: seven tasks at three
 * levels, with the grid's tree options configured before it connects.
 */
async function treeGrid(page: Page, tree: Record<string, unknown> = {}, props: Record<string, unknown> = {}, shared: boolean | { ordered?: number } = false) {
  await page.goto("/playground/composition.html");
  await page.waitForFunction(() => (globalThis as { compositionDemo?: unknown }).compositionDemo !== undefined);
  await page.evaluate(async ([treeOptions, extra, withSelection]) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const { createMockService } = await import("/lib/aster-ui-mock.js" as string);
    const metadata = {
      $Version: "4.01",
      $EntityContainer: "Demo.Container",
      $Reference: {
        "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] },
        "https://aster.dev/vocabularies/Aster.Data.V1.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
      },
      Demo: {
        Task: {
          $Kind: "EntityType", $Key: ["id"], "@AsterData.TitleField": "title",
          id: { $Type: "Edm.Int32" },
          title: { $Type: "Edm.String", "@Core.Description": "Title" },
          parentId: { $Type: "Edm.Int32", $Nullable: true, "@Core.Description": "Parent" },
        },
        Container: { $Kind: "EntityContainer", Tasks: { $Collection: true, $Type: "Demo.Task" } },
      },
    };
    const data = { Tasks: [
      { id: 1, title: "Root A", parentId: null },
      { id: 2, title: "Child A1", parentId: 1 },
      { id: 3, title: "Grandchild A1a", parentId: 2 },
      { id: 4, title: "Root B", parentId: null },
      { id: 5, title: "Child B1", parentId: 4 },
      { id: 6, title: "Root C", parentId: null },
      { id: 7, title: "Child A2", parentId: 1 },
    ] };
    const mock = await (createMockService as (options: object) => Promise<{ transport: object; dump(): { data: { Tasks: TaskRow[] } } }>)({
      metadata, data, wasm: new URL("../lib/odata_mock.wasm", location.href),
    });
    const ctx = await (lib as unknown as { DataContext: { connect(transport: object): Promise<{ store: object; schema: { set(name: string): { type: object } }; collection(options: object): { loadAll(): Promise<void> } }> } }).DataContext.connect(mock.transport);
    const options: Record<string, unknown> = { parentField: "parentId", ...treeOptions };
    if (options.folderIcon === "test") options.folderIcon = (lib as unknown as { html: (strings: TemplateStringsArray) => unknown }).html`<span class="test-folder-icon">F</span>`;
    if (options.nodeIcon === "test") options.nodeIcon = (lib as unknown as { html: (strings: TemplateStringsArray) => unknown }).html`<span class="test-node-icon">N</span>`;
    const element = document.createElement("aster-grid") as HTMLElement & Record<string, unknown>;
    element.id = "tree-grid";
    element.ctx = ctx;
    element.set = "Tasks";
    element.label = "Tasks";
    element.view = (lib as unknown as { defaultView(type: object): object }).defaultView(ctx.schema.set("Tasks").type);
    element.tree = options;
    element.style.height = "420px";
    Object.assign(element, extra);
    document.querySelector("main")!.append(element);
    if (withSelection) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const flat = ctx.collection({ set: "Tasks" });
      await flat.loadAll();
      const selection = new (lib as unknown as { Selection: new (store: object, collection: object, options: object) => unknown }).Selection(ctx.store, flat, {
        multiple: true,
        ...(typeof withSelection === "object" && withSelection.ordered !== undefined
          ? { ordered: true, maxOrdered: withSelection.ordered }
          : {}),
      });
      element.selection = selection;
      (globalThis as { __treeSelection?: unknown }).__treeSelection = selection;
    }
    (globalThis as { __treeMock?: unknown }).__treeMock = mock;
    return true;
  }, [tree, props, shared] as const);
  return page.locator("#tree-grid");
}

const treeRow = (page: Page, id: number) => page.locator(`#tree-grid .aster-grid-row[data-key="[${id}]"]`);

async function treeData(page: Page): Promise<TaskRow[]> {
  return page.evaluate(() => (globalThis as unknown as { __treeMock: { dump(): { data: { Tasks: TaskRow[] } } } }).__treeMock.dump().data.Tasks);
}

async function dragTreeRow(page: Page, from: number, to: number): Promise<void> {
  await treeRow(page, from).scrollIntoViewIfNeeded();
  await treeRow(page, to).scrollIntoViewIfNeeded();
  const a = await treeRow(page, from).boundingBox();
  const b = await treeRow(page, to).boundingBox();
  if (!a || !b) throw new Error("both rows must be visible");
  await page.mouse.move(a.x + Math.min(a.width - 4, 80), a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + Math.min(a.width - 4, 80) + 20, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + Math.min(b.width - 4, 80), b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("tree autoOpen, icons, opener visibility, expand/collapse and data options", async ({ page }) => {
  const grid = await treeGrid(page, {
    autoOpen: 2, openLimit: 20, showOpener: false, folderIcon: "test", nodeIcon: "test",
    pageSize: 2, matchLimit: 50,
  }, { editable: true });
  await expect(treeRow(page, 1)).toHaveAttribute("aria-expanded", "true");
  await expect(treeRow(page, 2)).toHaveAttribute("aria-expanded", "true");
  await expect(treeRow(page, 3)).toBeVisible();
  await expect(grid.locator("button.aster-grid-opener")).toHaveCount(0);
  await expect(grid.locator(".test-folder-icon").first()).toBeVisible();
  await expect(grid.locator(".test-node-icon").first()).toBeVisible();

  await grid.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(grid.locator(".aster-grid-row[data-key]")).toHaveCount(3);
  await grid.getByRole("button", { name: "Expand all", exact: true }).click();
  await expect(grid.locator(".aster-grid-row[data-key]")).toHaveCount(7);

  const options = await grid.evaluate((element) => {
    const tree = (element as HTMLElement & { treeModel: { options: { pageSize?: number; matchLimit?: number; openLimit?: number } } }).treeModel;
    return { pageSize: tree.options.pageSize, matchLimit: tree.options.matchLimit, openLimit: tree.options.openLimit };
  });
  expect(options).toEqual({ pageSize: 2, matchLimit: 50, openLimit: 20 });

  await grid.evaluate((element) => { (element as HTMLElement & { toolbar: object }).toolbar = { expandAll: false }; });
  await expect(grid.getByRole("button", { name: "Expand all", exact: true })).toHaveCount(0);
});

test("tree reparent false refuses a move to another parent, with a reason", async ({ page }) => {
  const grid = await treeGrid(page, { draggable: true, reparent: false }, { editable: true });
  await expect(treeRow(page, 1)).toBeVisible();
  await dragTreeRow(page, 1, 4);
  await expect(grid.locator(".aster-grid-refused")).toHaveText("Rows can’t be moved to another parent on this page.");
  expect((await treeData(page)).find((task) => task.id === 1)?.parentId).toBeNull();
});

test("tree dropOnLeaves false refuses a drop on a leaf, and accepts a folder", async ({ page }) => {
  const grid = await treeGrid(page, { draggable: true, dropOnLeaves: false }, { editable: true });
  await expect(treeRow(page, 4)).toBeVisible();
  await dragTreeRow(page, 4, 6);
  await expect(grid.locator(".aster-grid-refused")).toHaveText("A row can’t be dropped on a leaf; drop it on a folder or the top level.");
  expect((await treeData(page)).find((task) => task.id === 4)?.parentId).toBeNull();

  await dragTreeRow(page, 4, 1);
  await expect.poll(async () => (await treeData(page)).find((task) => task.id === 4)?.parentId).toBe(1);
});

test("cascadeSelection applies picks to loaded descendants and settles ancestors", async ({ page }) => {
  const grid = await treeGrid(page, { cascadeSelection: true, autoOpen: 2 }, { selectionColumn: true }, true);
  await expect(treeRow(page, 3)).toBeVisible();
  const keys = () => page.evaluate(() => (globalThis as unknown as { __treeSelection: { keys: { peek(): string[] } } }).__treeSelection.keys.peek());

  // Choosing the root chooses its loaded descendants.
  await treeRow(page, 1).locator(".aster-grid-select input").click();
  await expect.poll(keys).toEqual(expect.arrayContaining(["[1]", "[2]", "[3]", "[7]"]));
  expect((await keys()).length).toBe(4);

  // Clearing a child clears its subtree and the ancestor that is no longer complete.
  await treeRow(page, 2).locator(".aster-grid-select input").click();
  await expect.poll(keys).toEqual(["[7]"]);

  // Choosing the last child completes its ancestors.
  await treeRow(page, 3).locator(".aster-grid-select input").click();
  await expect.poll(keys).toEqual(expect.arrayContaining(["[7]", "[2]", "[3]", "[1]"]));

  // A folder with only some descendants chosen shows a mixed state.
  await treeRow(page, 1).locator(".aster-grid-select input").click();
  await expect.poll(keys).toEqual([]);
  await treeRow(page, 2).locator(".aster-grid-select input").click();
  await expect.poll(keys).toEqual(expect.arrayContaining(["[2]", "[3]"]));
  const rootBox = treeRow(page, 1).locator(".aster-grid-select input");
  await expect(rootBox).not.toBeChecked();
  expect(await rootBox.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(true);

  // Choosing the mixed folder completes it.
  await rootBox.click();
  await expect(rootBox).toBeChecked();
  expect(await rootBox.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(false);
  expect((await keys()).length).toBe(4);
});

test("scrollToRow and scrollToCell scroll without moving focus or the active cell", async ({ page }) => {
  await time(page);
  await grid(page).evaluate((element) => {
    const grid = element as HTMLElement & { view: { columns: readonly object[] } };
    grid.style.width = "700px";
    grid.style.gridTemplateColumns = "minmax(0, 1fr)";
    grid.view = { ...grid.view, columns: grid.view.columns.map((column) => ({ ...column, width: 200 })) };
  });
  const scroll = grid(page).locator(".aster-grid-scroll");
  await scroll.evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
  const before = await grid(page).evaluate((element) => (element as HTMLElement & { activeKey?: string }).activeKey);
  const result = await page.evaluate(async () => {
    const element = document.querySelector("aster-grid.time-grid") as HTMLElement & {
      activeKey?: string; contains(node: Node | null): boolean;
      scrollToRow(index: number, align?: string): Promise<boolean>;
      scrollToCell(index: number, column: number, align?: string): Promise<boolean>;
    };
    const view = element.querySelector<HTMLElement>(".aster-grid-scroll")!;
    const row = await element.scrollToRow(150, "start");
    const top = view.scrollTop;
    const cell = await element.scrollToCell(150, 5, "center");
    return { row, cell, top, left: view.scrollLeft, active: element.activeKey, focused: element.contains(document.activeElement) };
  });
  expect(result.row).toBe(true);
  expect(result.cell).toBe(true);
  expect(result.top).toBeGreaterThan(0);
  expect(result.left).toBeGreaterThan(0);
  expect(result.active).toBe(before);
  expect(result.focused).toBe(false);
  await expect.poll(() => rows(page).evaluateAll((all) => all.map((row) => Number((row as HTMLElement).dataset.index)))).toContain(150);
});

test("scrollToRow switches to the page that holds the row in paged mode", async ({ page }) => {
  const fresh = await freshGrid(page, { features: [{ kind: "page" }], pageSize: 10 });
  await expect(fresh.locator(".aster-grid-paging")).toContainText("Page 1 of 8");
  const result = await fresh.evaluate(async (element) => {
    const grid = element as HTMLElement & { scrollToRow(index: number): Promise<boolean>; activeKey?: string };
    const ok = await grid.scrollToRow(25);
    return { ok, active: grid.activeKey };
  });
  expect(result).toEqual({ ok: true, active: undefined });
  await expect(fresh.locator(".aster-grid-paging")).toContainText("Page 3 of 8");
  await expect.poll(() => fresh.locator(".aster-grid-row[data-key]").evaluateAll((all) => all.map((row) => Number((row as HTMLElement).dataset.index)))).toContain(5);
});

test("custom loading and error templates replace the built-in content states", async ({ page }) => {
  const fresh = await freshGrid(page, { autoFetch: false });
  await fresh.evaluate(async (element) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const html = (lib as unknown as { html: (strings: TemplateStringsArray, ...values: unknown[]) => unknown }).html;
    const grid = element as HTMLElement & { loading: unknown; error: unknown };
    grid.loading = html`<p id="custom-loading">Fetching rows…</p>`;
    grid.error = (error: unknown, retry: () => void) => html`<p id="custom-failure" role="alert">Failed: ${String(error)} <button type="button" @click=${retry}>Again</button></p>`;
  });
  await page.evaluate(() => {
    const demo = (globalThis as unknown as { compositionDemo: { mock: { faults: { latencyMs: number } } } }).compositionDemo;
    demo.mock.faults.latencyMs = 400;
    void (document.querySelector("#fresh-grid") as HTMLElement & { refresh(): Promise<void> }).refresh();
  });
  await expect(fresh.locator("#custom-loading")).toBeVisible();
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  await expect(fresh.locator("#custom-loading")).toHaveCount(0);
  await page.evaluate(() => {
    (globalThis as unknown as { compositionDemo: { mock: { faults: { latencyMs: number } } } }).compositionDemo.mock.faults.latencyMs = 0;
    const demo = (globalThis as unknown as { compositionDemo: { mock: { faults: { failNext(status: number, error: object): void } } } }).compositionDemo;
    demo.mock.faults.failNext(500, { code: "MockFault", message: "Injected failure." });
    void (document.querySelector("#fresh-grid") as HTMLElement & { refresh(): Promise<void> }).refresh();
  });
  await expect(fresh.locator("#custom-failure")).toContainText("Failed:");
  await fresh.locator("#custom-failure").getByRole("button", { name: "Again", exact: true }).click();
  await expect(fresh.locator("#custom-failure")).toHaveCount(0);
  await expect(fresh.locator(".aster-grid-row[data-key]").first()).toBeVisible();
});

test("the advanced dialog offers only a field's allowed operators", async ({ page }) => {
  await time(page);
  await setGrid(page, { filterOperators: { hours: ["gt"] } });
  await page.getByRole("button", { name: "Advanced filter", exact: true }).click();
  const dialog = page.locator(".aster-grid-advanced");
  await dialog.getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Advanced filter, condition 1: field", exact: true }).click();
  await page.getByRole("option", { name: "Hours", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Advanced filter, condition 1: test", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toHaveText("greater than");
});
