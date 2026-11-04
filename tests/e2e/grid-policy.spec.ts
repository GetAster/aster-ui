// Grid policy acceptance: capability ceilings, the scalar sugar, schema
// awareness and the drift between a persisted view and what the page allows.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

interface Entry {
  id: number;
  date: string;
  personId: number;
  hours: string;
  billable: boolean;
  status: string;
  note: string | null;
}

const metadata = JSON.parse(readFileSync(new URL("../../fixtures/aster/metadata.json", import.meta.url), "utf8"));

const grid = (page: Page) => page.locator("aster-grid.time-grid");
const rows = (page: Page) => page.locator(".aster-grid-row[data-key]:not(.aster-grid-group)");
const header = (page: Page, field: string) => page.locator(`.aster-grid-header[data-field="${field}"]`);
const total = (page: Page) => page.locator(".aster-grid-total");
const live = (page: Page) => page.locator("p.aster-sr-only[aria-live]").first();

async function time(page: Page): Promise<void> {
  await page.goto(`/?memory&debug&clients=200&time=200&now=${NOW}#time`);
  await page.evaluate(() => document.fonts.ready);
  await expect(rows(page).first()).toBeVisible();
}

async function setPolicy(page: Page, policy: unknown): Promise<void> {
  await grid(page).evaluate((element, value) => ((element as HTMLElement & { policy: unknown }).policy = value), policy);
}

async function setPolicyExpression(page: Page, expression: string): Promise<void> {
  await grid(page).evaluate((element, source) => {
    (element as HTMLElement & { policy: unknown }).policy = new Function(`return (${source});`)();
  }, expression);
}

async function state(page: Page): Promise<{
  policy: unknown;
  view: { sort: readonly { field: string }[]; filters: Record<string, unknown> };
  query: { filter?: unknown; orderBy?: readonly { field: string }[] | undefined } | undefined;
  editable: unknown;
  selectable: boolean;
}> {
  return grid(page).evaluate((element) => {
    const el = element as HTMLElement & {
      policy: unknown;
      view: { sort: readonly { field: string }[]; filters: Record<string, unknown> };
      collection?: { query: { filter?: unknown; orderBy?: readonly { field: string }[] } };
      editable: unknown;
      selectable: boolean;
    };
    return {
      policy: el.policy,
      view: el.view,
      query: el.collection ? { filter: el.collection.query.filter, orderBy: el.collection.query.orderBy } : undefined,
      editable: el.editable,
      selectable: el.selectable,
    };
  });
}

async function entries(page: Page): Promise<Entry[]> {
  return page.evaluate(async () => {
    const aster = (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { TimeEntries: Entry[] } }> } } }).aster;
    return (await aster.mock.dump()).data.TimeEntries;
  });
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);

test("scalar sugar writes policy and preserves the element's defaults", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const element = document.createElement("aster-grid") as unknown as Record<string, unknown> & { policy: unknown };
    const before = { policy: element.policy, selectable: element.selectable, editable: element.editable };
    element.sortable = false;
    element.filterable = ["status"];
    element.selectable = false;
    element.editable = ["hours"];
    return {
      before,
      after: element.policy,
      reads: { sortable: element.sortable, filterable: element.filterable, selectable: element.selectable, editable: element.editable },
    };
  });
  expect(result.before).toEqual({ policy: {}, selectable: true, editable: false });
  expect(result.after).toEqual({ sortable: false, filterable: ["status"], selectable: false, editable: ["hours"] });
  expect(result.reads).toEqual({ sortable: false, filterable: ["status"], selectable: false, editable: ["hours"] });
});

test("sortable policy: false, an allowlist, a predicate, and per-field narrowing each refuse with a reason", async ({ page }) => {
  await time(page);

  await setPolicy(page, { sortable: ["hours"] });
  await expect(header(page, "date")).toHaveAttribute("data-sortable", "false");
  await expect(header(page, "date").locator(".aster-grid-sort")).toHaveAttribute("title", /Sorting by Date isn’t allowed on this page/);
  await header(page, "date").locator(".aster-grid-sort").click();
  await expect(header(page, "date")).not.toHaveAttribute("aria-sort");
  await expect.poll(async () => (await live(page).textContent()) ?? "").toContain("Sorting by Date isn’t allowed on this page");
  await expect(header(page, "hours")).toHaveAttribute("data-sortable", "true");
  await header(page, "hours").locator(".aster-grid-sort").click();
  await expect(header(page, "hours")).toHaveAttribute("aria-sort", "ascending");

  await setPolicyExpression(page, `{ sortable: (field) => field === "status" }`);
  await expect(header(page, "status")).toHaveAttribute("data-sortable", "true");
  await expect(header(page, "hours")).toHaveAttribute("data-sortable", "false");

  await setPolicyExpression(page, `{ sortable: true, fields: { hours: { sortable: false } } }`);
  await expect(header(page, "hours")).toHaveAttribute("data-sortable", "false");
  await expect(header(page, "hours").locator(".aster-grid-sort")).toHaveAttribute("title", /Sorting by Hours isn’t allowed on this page/);
  await expect(header(page, "date")).toHaveAttribute("data-sortable", "true");

  // The panel keeps the stored sort visible and clearable, with the reason,
  // but offers no direction toggle for a refused column.
  await setPolicy(page, { sortable: false });
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  const panel = page.getByRole("group", { name: "Sort rows", exact: true });
  const refused = panel.locator('li[data-field="hours"]');
  await expect(refused).toHaveAttribute("data-refused", "");
  await expect(refused).toContainText("Sorting by Hours isn’t allowed on this page.");
  await expect(refused.locator(".aster-grid-sort-direction")).toHaveCount(0);
  await panel.getByRole("button", { name: "Clear Hours sorting", exact: true }).click();
  await expect(panel).toContainText("This grid has no sortable columns.");
  await expect(panel.locator("li")).toHaveCount(0);
});

test("filterable policy: an allowlist, a predicate, false, and per-field narrowing", async ({ page }) => {
  await time(page);
  const data = await entries(page);

  await setPolicy(page, { filterable: ["status"] });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Filter Status" })).toBeVisible();
  const noteCell = page.locator(".aster-grid-filters .aster-grid-cell").nth(6);
  await expect(noteCell).toContainText("Not filterable");
  await expect(noteCell.locator(".aster-grid-filter-refused")).toHaveAttribute("title", /Filtering by Note isn’t allowed on this page/);
  await page.getByRole("combobox", { name: "Filter Status" }).click();
  await page.getByRole("option", { name: "Approved", exact: true }).click();
  const approved = data.filter((entry) => entry.status === "approved").length;
  await expect(total(page)).toHaveText(`${fmt(approved)} rows`);
  for (const status of await rows(page).locator("[aria-colindex='6']").allTextContents()) expect(status.trim()).toBe("Approved");

  await setPolicyExpression(page, `{ filterable: (field) => field === "note" }`);
  await expect(page.getByRole("textbox", { name: "Filter Note" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter Status" })).toHaveCount(0);
  await expect(page.locator(".aster-grid-filters .aster-grid-cell").nth(5)).toContainText("Not filterable");

  await setPolicy(page, { filterable: true, fields: { note: { filterable: false } } });
  await expect(page.getByRole("textbox", { name: "Filter Note" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Filter Status" })).toBeVisible();
  await expect(page.locator(".aster-grid-filters .aster-grid-cell").nth(6)).toContainText("Not filterable");
});

test("filterable false disables the filtering affordances with a reason", async ({ page }) => {
  await time(page);
  await setPolicy(page, { filterable: false });
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  const advanced = page.getByRole("button", { name: "Advanced filter", exact: true });
  await expect(filters).toBeDisabled();
  await expect(filters).toHaveAttribute("title", /Filtering by Date isn’t allowed on this page/);
  await expect(advanced).toBeDisabled();
  await expect(advanced).toHaveAttribute("title", /Filtering by Date isn’t allowed on this page/);
});

test("the schema ceiling refuses sorting and filtering before policy is consulted", async ({ page }) => {
  const changed = structuredClone(metadata);
  changed.AsterDemo.Container.TimeEntries["@Capabilities.SortRestrictions"] = { NonSortableProperties: ["hours", "person"] };
  changed.AsterDemo.Container.TimeEntries["@Capabilities.FilterRestrictions"] = { NonFilterableProperties: ["note"] };
  await page.addInitScript((m) => Object.assign(globalThis, { asterMetadata: m }), changed);
  await time(page);

  await expect(header(page, "hours")).toHaveAttribute("data-sortable", "false");
  await expect(header(page, "hours").locator(".aster-grid-sort")).toHaveAttribute("title", /Hours can’t be sorted by this service/);
  await header(page, "hours").locator(".aster-grid-sort").click();
  await expect(header(page, "hours")).not.toHaveAttribute("aria-sort");
  // A lookup column sorts through its navigation, which the service can restrict too.
  await expect(header(page, "personId").locator(".aster-grid-sort")).toHaveAttribute("title", /Person can’t be sorted by this service/);

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const noteCell = page.locator(".aster-grid-filters .aster-grid-cell").nth(6);
  await expect(noteCell).toContainText("Not filterable");
  await expect(noteCell.locator(".aster-grid-filter-refused")).toHaveAttribute("title", /Note can’t be filtered by this service/);
  // A sortable, filterable column beside them still works.
  await expect(header(page, "status")).toHaveAttribute("data-sortable", "true");
  await expect(page.getByRole("textbox", { name: "Filter Hours" })).toBeVisible();
});

test("drift: a refused saved sort and filter leave the query but stay in the view, with a dismissible note outside the toolbar", async ({ page }) => {
  await time(page);
  const data = await entries(page);
  const approved = data.filter((entry) => entry.status === "approved").length;

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Filter Status" }).click();
  await page.getByRole("option", { name: "Approved", exact: true }).click();
  await expect(total(page)).toHaveText(`${fmt(approved)} rows`);

  await setPolicy(page, { sortable: false, filterable: false });
  const drift = grid(page).locator(".aster-grid-drift");
  await expect(drift).toBeVisible();
  await expect(drift).toContainText("Sorted by Date");
  await expect(drift).toContainText("Filtered by Status");
  await expect(drift).toContainText("Sorting by Date isn’t allowed on this page");
  await expect(drift).toContainText("Filtering by Status isn’t allowed on this page");
  await expect.poll(async () => (await live(page).textContent()) ?? "").toContain("Filtered by Status");

  // The derived query drops both entries; the stored view keeps them.
  const refused = await state(page);
  expect(refused.query).toEqual({ filter: undefined, orderBy: undefined });
  expect(refused.view.sort).toEqual([{ field: "date", descending: true }]);
  expect(refused.view.filters.status).toEqual({ op: "eq", field: "status", value: "approved" });
  await expect(total(page)).toHaveText(`${fmt(data.length)} rows`);

  // Hiding the toolbar cannot hide the note: it lives outside it.
  await grid(page).evaluate((element) => { (element as HTMLElement & { showToolbar: boolean }).showToolbar = false; });
  await expect(page.locator(".aster-grid-toolbar")).toHaveCount(0);
  await expect(drift).toBeVisible();
  await grid(page).getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(drift).toHaveCount(0);

  // Relaxing policy resumes the person's intent without a rewrite.
  await setPolicy(page, {});
  await expect(grid(page).getByText("saved view can’t fully apply")).toHaveCount(0);
  const relaxed = await state(page);
  expect(relaxed.query).toEqual({ filter: { op: "eq", field: "status", value: "approved" }, orderBy: [{ field: "date", descending: true }] });
  expect(relaxed.view.sort).toEqual([{ field: "date", descending: true }]);
  expect(relaxed.view.filters.status).toEqual({ op: "eq", field: "status", value: "approved" });
  await expect(total(page)).toHaveText(`${fmt(approved)} rows`);
});

test("editable policy narrows fields, keeps page read-only reasons, and false refuses editing", async ({ page }) => {
  await time(page);

  await setPolicy(page, { editable: false });
  expect((await state(page)).editable).toBe(false);
  await rows(page).first().locator("[aria-colindex='7']").dblclick();
  await expect(page.locator("[data-editing]")).toHaveCount(0);

  await setPolicyExpression(page, `{ editable: (field) => field === "note" }`);
  const first = rows(page).first();
  await expect(first.locator("[aria-colindex='7']")).toBeVisible();
  await first.locator("[aria-colindex='7']").dblclick();
  await expect(first).toHaveAttribute("data-editing", "");
  await expect(first.getByRole("textbox", { name: "Note" })).toBeVisible();
  await expect(first.locator(".aster-hint").filter({ hasText: "Editing Date isn’t allowed on this page." })).toHaveCount(1);
  await expect(first.locator("[aria-colindex='4'] input")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await setPolicy(page, { editable: true, fields: { date: { editable: false } } });
  const second = rows(page).nth(1);
  await second.locator("[aria-colindex='7']").dblclick();
  await expect(second).toHaveAttribute("data-editing", "");
  await expect(second.locator(".aster-hint").filter({ hasText: "Editing Date isn’t allowed on this page." })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // A page rule's reason still refuses an approved row under a permissive policy.
  const approved = rows(page).filter({ hasText: "Approved" }).first();
  await approved.locator("[aria-colindex='7']").dblclick();
  await expect(approved.getByRole("textbox", { name: "Hours" })).toHaveAttribute("readonly", "");
  await expect(approved.locator(".aster-hint").filter({ hasText: "Approved time can't be changed." })).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("selectable policy false stops owned-row selection; the sugar restores it", async ({ page }) => {
  await time(page);
  await setPolicy(page, { selectable: false });
  await expect(grid(page)).not.toHaveAttribute("aria-multiselectable");
  await rows(page).nth(2).locator("[role=gridcell]").first().click();
  await expect(page.locator('.aster-grid-row[aria-selected="true"]')).toHaveCount(0);
  expect((await state(page)).selectable).toBe(false);

  await grid(page).evaluate((element) => {
    (element as HTMLElement & { selectable: boolean }).selectable = true;
  });
  await rows(page).nth(2).locator("[role=gridcell]").first().click();
  await expect(page.locator('.aster-grid-row[aria-selected="true"]')).toHaveCount(1);
  expect((await state(page)).selectable).toBe(true);
});

test("a shared grid drops filters and criteria the policy refuses from the shared query, keeping them in the view", async ({ page }) => {
  await page.goto("/playground/composition.html");
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const fixture = {
      metadata: {
        $Version: "4.01",
        $EntityContainer: "Test.Container",
        Test: {
          Entry: {
            $Kind: "EntityType",
            $Key: ["id"],
            "@AsterData.TitleField": "name",
            id: { $Type: "Edm.Int32", "@Core.Computed": true },
            name: { "@Core.Description": "Name" },
            owner: { "@Core.Description": "Owner" },
          },
          Container: { $Kind: "EntityContainer", Entries: { $Collection: true, $Type: "Test.Entry" } },
        },
      },
      data: { Entries: [
        { id: 1, name: "Alpha", owner: "Ada" },
        { id: 2, name: "Beta", owner: "Ken" },
        { id: 3, name: "Gamma", owner: "Ada" },
      ] },
    };
    const mock = await mockLib.createMockService({ ...fixture, wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    const col = ctx.collection({ set: "Entries", orderBy: [{ field: "id" }] });
    const selection = new lib.Selection(ctx.store, col, { multiple: true });
    const element = document.createElement("aster-grid") as HTMLElement & Record<string, unknown>;
    element.id = "shared-grid";
    element.ctx = ctx;
    element.set = "Entries";
    element.view = lib.defaultView(ctx.schema.set("Entries").type);
    element.selection = selection;
    element.style.height = "300px";
    document.querySelector("main")!.append(element);
    (globalThis as unknown as { __shared: { col: { query: { filter: unknown } } } }).__shared = { col };
  });
  const table = page.locator("#shared-grid");
  await expect(table.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  const sharedFilter = () => page.evaluate(() => ((globalThis as unknown as { __shared: { col: { query: { filter: unknown } } } }).__shared.col.query.filter ?? null));

  // A filter applied through the filter row reaches the shared collection.
  await table.getByRole("button", { name: "Filters", exact: true }).click();
  const nameFilter = table.getByRole("textbox", { name: "Filter Name" });
  await nameFilter.fill("Beta");
  await nameFilter.press("Enter");
  const containsName = { op: "contains", field: "name", value: "Beta", caseInsensitive: true };
  await expect.poll(sharedFilter).toEqual(containsName);

  // An advanced expression compares two fields; policy refuses its right operand.
  await table.evaluate((element) => {
    const el = element as HTMLElement & { view: { criteria?: unknown } };
    el.view = { ...el.view, criteria: { op: "eq", field: "name", other: "owner" } };
  });
  await expect.poll(sharedFilter).toEqual({ op: "and", args: [containsName, { op: "eq", field: "name", other: "owner" }] });

  // filterable false refuses both: the shared query drops them while the view keeps them.
  await table.evaluate((element) => { (element as HTMLElement & { policy: unknown }).policy = { filterable: false }; });
  const drift = table.locator(".aster-grid-drift");
  await expect(drift).toBeVisible();
  await expect(drift).toContainText("Filtering by Name isn’t allowed on this page");
  await expect(drift).toContainText("Filtering by Owner isn’t allowed on this page");
  await expect.poll(sharedFilter).toBeNull();
  const kept = await table.evaluate((element) => {
    const el = element as HTMLElement & { view: { filters: Record<string, unknown>; criteria?: unknown } };
    return { name: el.view.filters.name, criteria: el.view.criteria };
  });
  expect(kept.name).toEqual(containsName);
  expect(kept.criteria).toEqual({ op: "eq", field: "name", other: "owner" });

  // Allowing the fields again resumes the person's filters without a rewrite.
  await table.evaluate((element) => { (element as HTMLElement & { policy: unknown }).policy = {}; });
  await expect.poll(sharedFilter).toEqual({ op: "and", args: [containsName, { op: "eq", field: "name", other: "owner" }] });
});
