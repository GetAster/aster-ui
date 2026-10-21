// M3 acceptance: the grid at scale, its layout, sync while partly loaded,
// the view a person shapes, grouping, editing, density and accessibility.
// Grid scenarios cover filtering, sorting, editing and keyboard operation.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW, settle } from "./fixtures.ts";

interface Entry {
  id: number;
  date: string;
  personId: number;
  hours: string;
  billable: boolean;
  status: string;
  note: string | null;
}

async function time(page: Page, count = 3000, extra = ""): Promise<void> {
  await page.goto(`/?memory&debug&clients=2000&time=${count}&now=${NOW}${extra}#time`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
}

const grid = (page: Page) => page.locator(".aster-grid-scroll");
const total = (page: Page) => page.locator(".aster-grid-total");
const rows = (page: Page) => page.locator(".aster-grid-row[data-key]:not(.aster-grid-group)");
const cell = (page: Page, row: number, col: number) => rows(page).nth(row).locator(`[aria-colindex="${col}"]`);

async function entries(page: Page): Promise<Entry[]> {
  return page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { TimeEntries: never } }> } } }).aster.mock.dump()).data.TimeEntries);
}

async function external(page: Page, method: "PATCH" | "POST" | "DELETE", url: string, body?: object): Promise<number> {
  return page.evaluate(
    async ([method, url, body]) => {
      const { mock } = (globalThis as unknown as { aster: { mock: { external(r: object): Promise<{ status: number }> } } }).aster;
      const res = await mock.external({ method, url, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return res.status;
    },
    [method, url, body] as const,
  );
}

/** A menu item of any kind (action, check, radio, submenu) by its visible label. */
function menuItem(page: Page, name: string) {
  const exact = new RegExp(`^\\W*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\W*$`);
  return page.locator('[role^="menuitem"]').filter({ hasText: exact }).last();
}

/** Chooses from a column's menu; `item` can go through a submenu: ["Move", "Left"]. */
async function menu(page: Page, field: string, item: string | readonly string[]): Promise<void> {
  await page.locator(`.aster-grid-header[data-field="${field}"]`).hover();
  await page.locator(`.aster-grid-header[data-field="${field}"] .aster-grid-header-menu`).click();
  for (const name of typeof item === "string" ? [item] : item) {
    await menuItem(page, name).click();
  }
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);

test.describe("scale", () => {
  test("100,000 rows: first rows quickly, a bounded DOM, and data wherever you jump (F5)", async ({ page }) => {
    const start = Date.now();
    await time(page, 100_000);
    expect(Date.now() - start).toBeLessThan(4000);
    await expect(total(page)).toHaveText("100,000 rows");
    await expect(grid(page)).toHaveAttribute("aria-rowcount", "100001");
    expect(await page.locator(".aster-grid-row").count()).toBeLessThan(80);
    await grid(page).evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
    await expect.poll(async () => Number(await rows(page).first().getAttribute("data-index"))).toBeGreaterThan(30_000);
    await expect(rows(page).first()).not.toHaveAttribute("data-placeholder", "");
    expect(await page.locator(".aster-grid-row").count()).toBeLessThan(80);
    await expect(cell(page, 0, 1)).not.toBeEmpty();
  });
});

test.describe("layout", () => {
  async function aligned(page: Page): Promise<void> {
    const offsets = await page.evaluate(() => {
      const left = (el: Element | null) => Math.round(el?.getBoundingClientRect().left ?? -1);
      const width = (el: Element | null) => Math.round(el?.getBoundingClientRect().width ?? -1);
      const head = [...document.querySelectorAll(".aster-grid-head [role=columnheader]")];
      const body = [...document.querySelectorAll(".aster-grid-row[data-key]:not(.aster-grid-group)")[3]!.querySelectorAll("[role=gridcell]")];
      return head.map((h, i) => [left(h) - left(body[i]!), width(h) - width(body[i]!)]);
    });
    for (const [dl, dw] of offsets) expect([Math.abs(dl!), Math.abs(dw!)]).toEqual([0, 0]);
  }

  test("header, frozen columns and body stay aligned scrolling both ways, resizing and in compact density (F1–F3)", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await time(page);
    await aligned(page);
    const scroll = grid(page);
    await scroll.evaluate((el) => (el.scrollLeft = 160));
    await page.waitForTimeout(100);
    const frozen = await page.evaluate(() => {
      const scrollLeft = document.querySelector(".aster-grid-scroll")!.getBoundingClientRect().left;
      return [...document.querySelectorAll(".aster-grid-row[data-key] [aria-colindex='2']")].slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().left - scrollLeft));
    });
    expect(new Set(frozen).size).toBe(1);
    expect(frozen[0]).toBe(140);
    await aligned(page);
    await scroll.evaluate((el) => (el.scrollLeft = 0));
    await menu(page, "projectId", ["Width", "Wider"]);
    await aligned(page);
    await page.locator(".density-switch").click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await aligned(page);
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll(".aster-grid-row[data-key]")].slice(0, 12).map((r) => {
        const cells = [...r.querySelectorAll("[role=gridcell]")].map((c) => Math.round(c.getBoundingClientRect().height));
        return Math.max(...cells) - Math.min(...cells);
      }),
    );
    expect(heights.every((d) => d === 0)).toBe(true);
  });
});

test("the grid settles in the frame it's resized in: new rows are measured before paint", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await time(page);
  // Compact rows are shorter than the grid's estimate, so rows it hasn't shown change height when measured.
  await page.locator(".density-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await settle(page);
  // The frames, counted from the change, in which the grid's DOM changed.
  const changedIn = (change: string) =>
    page.evaluate(async (change) => {
      const grid = document.querySelector<HTMLElement>("aster-grid")!;
      let frame = 0;
      const changed = new Set<number>();
      const watch = new MutationObserver(() => changed.add(frame));
      watch.observe(grid, { subtree: true, childList: true, attributes: true, characterData: true });
      (0, eval)(change)(grid);
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        frame++;
      }
      watch.disconnect();
      return [...changed];
    }, change);
  // Rows loaded but never shown, so the jump below waits for no data.
  await page.evaluate(() => (document.querySelector("aster-grid") as unknown as { collection: { ensure(start: number, end: number): Promise<void> } }).collection.ensure(600, 1100));
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.evaluate(() => addEventListener("error", (e) => console.error((e as ErrorEvent).message)));
  for (const change of [
    "(g) => (g.querySelector('.aster-grid-scroll').scrollTop = 30000)",
    "(g) => (g.querySelector('.aster-grid-scroll').style.height = '1400px')",
    "(g) => (g.querySelector('.aster-grid-scroll').style.height = '200px')",
    "(g) => (g.querySelector('.aster-grid-scroll').style.height = '')",
    "(g) => (g.style.width = '700px')",
    "(g) => (g.style.width = '')",
  ]) {
    expect((await changedIn(change)).every((f) => f <= 1), change).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("editors fit their cells, the date editor included, in every column", async ({ page }) => {
  await time(page);
  const key = (await rows(page).filter({ hasText: "Draft" }).first().getAttribute("data-key"))!;
  await page.locator(`.aster-grid-row[data-key="${key}"] [aria-colindex='1']`).dblclick();
  await expect(page.locator("[data-editing]")).toHaveCount(1);
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("[data-editing] [role=gridcell]")].flatMap((c) => {
      const frame = c.querySelector(".aster-field")?.getBoundingClientRect();
      const cell = c.getBoundingClientRect();
      return frame ? [Math.round(frame.right - cell.right), Math.round(cell.left - frame.left)] : [];
    }),
  );
  expect(overflow.every((d) => d <= 0)).toBe(true);
});

test.describe("sync while partly loaded", () => {
  test("another user's edit, insert and delete keep rows, positions and the total right", async ({ page }) => {
    await time(page, 5000);
    const before = (await entries(page)).length;
    const firstId = Number(JSON.parse((await rows(page).first().getAttribute("data-key"))!)[0]);
    expect(await external(page, "PATCH", `TimeEntries(${firstId})`, { hours: "11.75" })).toBeLessThan(300);
    await expect(rows(page).first().locator("[aria-colindex='4']")).toHaveText("11.75");

    expect(await external(page, "POST", "TimeEntries", { date: "2026-10-08", personId: 3, projectId: 5, hours: "1.00", billable: true, status: "draft", note: "Tomorrow, already" })).toBeLessThan(300);
    await expect(rows(page).first()).toContainText("Tomorrow, already");
    await expect(total(page)).toHaveText(`${fmt(before + 1)} rows`);

    expect(await external(page, "DELETE", `TimeEntries(${firstId})`)).toBeLessThan(300);
    await expect(page.locator(`.aster-grid-row[data-key="[${firstId}]"]`)).toHaveCount(0);
    await expect(total(page)).toHaveText(`${fmt(before)} rows`);
    expect((await entries(page)).length).toBe(before);
  });
});

test.describe("the view", () => {
  test("sort by header and Shift-click; filters match the server; a filter while deep starts at the top (S2)", async ({ page }) => {
    await time(page, 5000);
    await page.locator('.aster-grid-header[data-field="hours"] .aster-grid-sort').click();
    await expect(page.locator('.aster-grid-header[data-field="hours"]')).toHaveAttribute("aria-sort", "ascending");
    await page.locator('.aster-grid-header[data-field="status"] .aster-grid-sort').click({ modifiers: ["Shift"] });
    await expect(page.locator('.aster-grid-header[data-field="status"] small')).toHaveText("2");
    await expect(cell(page, 0, 4)).toHaveText("0.25");

    await grid(page).evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("textbox", { name: "Filter Note" }).fill("vendor");
    await page.getByRole("textbox", { name: "Filter Hours" }).fill(">=6");
    const data = await entries(page);
    const expected = data.filter((e) => (e.note ?? "").toLowerCase().includes("vendor") && Number(e.hours) >= 6).length;
    await expect(total(page)).toHaveText(`${fmt(expected)} rows`);
    expect(await grid(page).evaluate((el) => el.scrollTop)).toBe(0);
    await page.getByRole("textbox", { name: "Filter Hours" }).fill("lots");
    await expect(page.getByText("Use a number, optionally after >, >=, < or <=, or a range a..b")).toBeVisible();
  });

  test("hide, move, freeze and resize from the header menu; the column picker", async ({ page }) => {
    await time(page);
    await menu(page, "billable", "Hide Billable");
    await expect(page.locator('.aster-grid-header[data-field="billable"]')).toHaveCount(0);
    await menu(page, "status", ["Move", "Left"]);
    const order = await page.locator(".aster-grid-header").evaluateAll((hs) => hs.map((h) => (h as HTMLElement).dataset.field));
    expect(order.indexOf("status")).toBe(order.indexOf("hours") - 1);
    await menu(page, "projectId", "Freeze up to Project");
    await expect(page.locator('.aster-grid-header[data-field="projectId"]')).toHaveAttribute("data-frozen", "");
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("checkbox", { name: "Billable" }).check();
    await expect(page.locator('.aster-grid-header[data-field="billable"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  test("Person sorts by the person's name, on the server; a row whose person changes moves to its place", async ({ page }) => {
    await time(page);
    const names = () => page.locator(".aster-grid-row[data-key] [aria-colindex='2']").allTextContents().then((t) => t.map((s) => s.trim()));
    const sorted = (xs: string[], desc = false) => [...xs].sort((a, b) => (desc ? -1 : 1) * a.localeCompare(b, "en", { sensitivity: "base" }));
    await page.locator('.aster-grid-header[data-field="personId"] .aster-grid-sort').click();
    await expect(page.locator('.aster-grid-header[data-field="personId"]')).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(async () => { const n = await names(); return n.length > 5 && n.join() === sorted(n).join(); }).toBe(true);
    const first = (await names())[0];
    await menu(page, "personId", "Descending");
    await expect.poll(async () => { const n = await names(); return n.length > 5 && n.join() === sorted(n, true).join(); }).toBe(true);
    // Another user gives the top row the person who sorts first: in descending order it leaves the top.
    const top = (await page.locator(".aster-grid-row[data-key]").first().getAttribute("data-key"))!;
    const people = await page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { People: { id: number; name: string }[] } }> } } }).aster.mock.dump()).data.People);
    const firstPerson = people.find((p) => p.name === first)!;
    expect(await external(page, "PATCH", `TimeEntries(${JSON.parse(top)[0]})`, { personId: firstPerson.id })).toBeLessThan(300);
    await expect(page.locator(`.aster-grid-row[data-key="${top}"]`)).toHaveCount(0);
    await expect.poll(async () => { const n = await names(); return n.length > 5 && n.join() === sorted(n, true).join(); }).toBe(true);
  });

  test("the view is kept on reload, saved by name, published, and reset", async ({ page }) => {
    await time(page);
    await menu(page, "note", "Hide Note");
    await page.locator('.aster-grid-header[data-field="hours"] .aster-grid-sort').click();
    await page.getByRole("button", { name: "Views" }).click();
    await page.getByRole("textbox", { name: "Name for this view" }).fill("Short");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const published = () =>
      page.evaluate(() => {
        const scope = (globalThis as unknown as { aster: { scope: { value(p: string): { value: unknown } } } }).aster.scope;
        return { total: scope.value("time.total").value, sort: (scope.value("time.view").value as { sort: unknown[] }).sort };
      });
    expect(await published()).toMatchObject({ total: 3000, sort: [{ field: "hours" }] });
    await page.reload();
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator('.aster-grid-header[data-field="note"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Views" }).click();
    await page.getByRole("button", { name: "Reset to the page’s view" }).click();
    await expect(page.locator('.aster-grid-header[data-field="note"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Views" }).click();
    await page.getByRole("button", { name: "Short", exact: true }).click();
    await expect(page.locator('.aster-grid-header[data-field="note"]')).toHaveCount(0);
  });
});

test.describe("grouping", () => {
  test("groups count from the server, expand and load, follow the sort's direction, and recount (G3, G4)", async ({ page }) => {
    await time(page, 5000);
    await menu(page, "status", "Group by Status");
    const data = await entries(page);
    const count = (s: string) => fmt(data.filter((e) => e.status === s).length);
    const groups = page.locator(".aster-grid-group");
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toContainText(new RegExp(`Approved\\s*${count("approved")}`));
    await expect(total(page)).toHaveText("5,000 rows in 3 groups");
    await groups.filter({ hasText: "Draft" }).locator("[role=gridcell]").click();
    await expect(groups.filter({ hasText: "Draft" })).toHaveAttribute("aria-expanded", "true");
    await expect(rows(page).first()).toContainText("Draft");
    await menu(page, "status", "Descending");
    await expect(groups.nth(0)).toContainText("Submitted");
    await groups.filter({ hasText: "Draft" }).locator("[role=gridcell]").click();
    const draftId = data.find((e) => e.status === "draft")!.id;
    await external(page, "PATCH", `TimeEntries(${draftId})`, { status: "approved" });
    await expect(groups.filter({ hasText: "Approved" })).toContainText(fmt(data.filter((e) => e.status === "approved").length + 1));
    await page.getByRole("button", { name: /Grouped by Status/ }).click();
    await expect(groups).toHaveCount(0);
  });
});

test.describe("editing", () => {
  test("Enter edits, errors keep you on the row, Escape cancels, Enter saves (E1, E3, V2)", async ({ page }) => {
    await time(page);
    const data = await entries(page);
    const draft = data.filter((e) => e.status !== "approved").sort((a, b) => b.date.localeCompare(a.date) || a.id - b.id)[0]!;
    const row = page.locator(`.aster-grid-row[data-key="[${draft.id}]"]`);
    await row.locator("[aria-colindex='4']").click();
    await page.keyboard.press("Enter");
    const hours = row.getByRole("textbox", { name: "Hours" });
    await expect(hours).toBeFocused();
    await hours.fill("30");
    await page.keyboard.press("Enter");
    await expect(row.locator(".aster-error")).toHaveText("Hours must be at most 24.");
    await expect(row).toHaveAttribute("data-editing", "");
    await page.keyboard.press("Escape");
    await expect(row).not.toHaveAttribute("data-editing", "");
    await expect(row.locator("[aria-colindex='4']")).toHaveText(Number(draft.hours).toFixed(2));
    await expect(grid(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await row.getByRole("textbox", { name: "Hours" }).fill("7.5");
    await page.keyboard.press("Enter");
    await expect(row).not.toHaveAttribute("data-editing", "");
    await expect(row.locator("[aria-colindex='4']")).toHaveText("7.50");
    expect(Number((await entries(page)).find((e) => e.id === draft.id)!.hours)).toBe(7.5);
  });

  test("an approved row's date and hours are read-only, with the reason once (rules per row)", async ({ page }) => {
    await time(page);
    const approved = rows(page).filter({ hasText: "Approved" }).first();
    await approved.locator("[aria-colindex='7']").dblclick();
    await expect(approved.getByRole("textbox", { name: "Hours" })).toHaveAttribute("readonly", "");
    await expect(approved.locator(".aster-hint")).toHaveText(["Approved time can't be changed. Set the status back to Submitted first."]);
    await expect(approved.getByRole("textbox", { name: "Note" })).toBeFocused();
  });

  test("a change by someone else to the field being edited is a conflict, not lost (E13)", async ({ page }) => {
    await time(page);
    const key = (await rows(page).filter({ hasNotText: "Approved" }).first().getAttribute("data-key"))!;
    const draft = page.locator(`.aster-grid-row[data-key="${key}"]`);
    const id = Number(JSON.parse(key)[0]);
    await draft.locator("[aria-colindex='7']").dblclick();
    await draft.getByRole("textbox", { name: "Note" }).fill("Mine");
    await external(page, "PATCH", `TimeEntries(${id})`, { note: "Theirs" });
    await expect(draft.getByRole("alert")).toContainText("Someone else changed Note while you were editing.");
    await expect(draft.getByRole("textbox", { name: "Note" })).toHaveValue("Mine");
    await draft.getByRole("button", { name: "Keep mine" }).click();
    await draft.getByRole("textbox", { name: "Note" }).press("Enter");
    await expect.poll(async () => (await entries(page)).find((e) => e.id === id)!.note).toBe("Mine");
  });

  test("an edit that moves the row in the sort keeps it focused (E2c)", async ({ page }) => {
    await time(page);
    const key = (await rows(page).filter({ hasNotText: "Approved" }).first().getAttribute("data-key"))!;
    const draft = page.locator(`.aster-grid-row[data-key="${key}"]`);
    await draft.locator("[aria-colindex='1']").dblclick();
    await draft.getByRole("textbox", { name: "Date" }).fill("2026-10-09");
    await page.keyboard.press("Enter");
    await expect(rows(page).first()).toHaveAttribute("data-key", key);
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(grid(page)).toBeFocused();
  });
});

test("keyboard: arrows move the active cell and select its row; Shift+F10 opens the column menu", async ({ page }) => {
  await time(page);
  await grid(page).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  const active = await grid(page).getAttribute("aria-activedescendant");
  await expect(page.locator(`#${active}`)).toHaveAttribute("aria-colindex", "2");
  await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+End");
  const last = page.locator(`#${await grid(page).getAttribute("aria-activedescendant")}`);
  await expect(last).toBeVisible();
  // A row still loading has no record yet, so its menu would be the column's alone.
  await expect(page.locator(".aster-grid-row", { has: last })).not.toHaveAttribute("data-placeholder", "");
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Row" })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Row" }).getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "Note column" })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Note column" }).getByRole("menuitemradio", { name: "Ascending" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("menu", { name: "Note column" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Note column" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(grid(page)).toBeFocused();
});

test("axe: the Time page with filters, a group open and a row being edited, then Harbour dim", async ({ page }) => {
  const axe = async () => {
    await settle(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  };
  await time(page);
  await page.getByRole("button", { name: "Filters" }).click();
  expect(await axe()).toEqual([]);
  await rows(page).first().locator("[aria-colindex='4']").dblclick();
  expect(await axe()).toEqual([]);
  await page.keyboard.press("Escape");
  await menu(page, "status", "Group by Status");
  await page.locator(".aster-grid-group").first().locator("[role=gridcell]").click();
  expect(await axe()).toEqual([]);
  await time(page, 3000, "&identity=harbour");
  await page.locator(".lamp-switch").click();
  await page.waitForTimeout(500);
  expect(await axe()).toEqual([]);
});

test("a filter applies at once on Enter or on leaving its input, not only after the pause", async ({ page }) => {
  await page.clock.install();
  await time(page);
  await page.getByRole("button", { name: "Filters" }).click();
  const rowsLabel = page.locator(".aster-grid-toolbar").getByText(/rows/);
  const before = await rowsLabel.textContent();
  // With the clock paused, the debounce's timer never fires: only Enter can apply the filter.
  await page.clock.pauseAt(Date.parse("2030-01-01T00:00:00Z"));
  const note = page.getByRole("textbox", { name: "Filter Note" });
  await note.fill("flaky build");
  await note.press("Enter");
  await expect(rowsLabel).not.toHaveText(before!);
  for (const t of await page.locator(".aster-grid-row[data-key] [aria-colindex='7']").allTextContents()) expect(t.toLowerCase()).toContain("flaky build");
  const filtered = await rowsLabel.textContent();
  const hours = page.getByRole("textbox", { name: "Filter Hours" });
  await hours.fill(">5");
  await hours.press("Tab");
  await expect(rowsLabel).not.toHaveText(filtered!);
});

test("keyboard: the header and filter rows are part of the grid; sort changes are announced", async ({ page }) => {
  await time(page);
  await page.getByRole("button", { name: "Filters" }).click();
  await grid(page).focus();
  const active = async () => page.locator(`#${await grid(page).getAttribute("aria-activedescendant")}`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await expect(await active()).toHaveClass(/aster-grid-filter/);
  await page.keyboard.press("ArrowUp");
  await expect(await active()).toHaveAttribute("role", "columnheader");
  await expect(await active()).toHaveAttribute("data-field", "personId");
  // Enter sorts by the header's column (Person, by name), and says so.
  await page.keyboard.press("Enter");
  await expect(page.locator('.aster-grid-header[data-field="personId"]')).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("p.aster-sr-only[aria-live]")).toHaveText("Sorted by Person, ascending");
  await expect(await active()).toHaveAttribute("data-field", "personId");
  // Shift+F10 opens the column's menu; Escape comes back to the grid, on the header.
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Person column" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid(page)).toBeFocused();
  await expect(await active()).toHaveAttribute("data-field", "personId");
  // Into a filter with Enter, out with Escape, then down into the records.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Filter Hours" })).toBeFocused();
  await page.keyboard.type(">7");
  await page.keyboard.press("Escape");
  await expect(grid(page)).toBeFocused();
  await expect(await active()).toHaveAttribute("aria-colindex", "4");
  // Leaving the filter applied it.
  await expect(page.locator(".aster-grid-row[data-key]:not([data-placeholder]) [aria-colindex='4']").first()).toHaveText(/^\s*(7\.[2-9]|[89]|1\d|2[0-4])/);
  await page.keyboard.press("ArrowDown");
  await expect(await active()).toHaveAttribute("role", "gridcell");
  await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("records are cards of labelled values: nothing scrolls sideways, the keyboard and editing still work", async ({ page }) => {
    await time(page);
    const first = rows(page).first();
    const cells = first.locator('[role="gridcell"]');
    const [a, b] = [(await cells.nth(0).boundingBox())!, (await cells.nth(1).boundingBox())!];
    expect(b.y).toBeGreaterThan(a.y);
    expect(Math.abs(b.x - a.x)).toBeLessThan(1);
    // The label is drawn, not text: the cell's text and accessible name are its value.
    expect(await cells.nth(1).evaluate((el) => getComputedStyle(el, "::before").content)).toContain("Person");
    expect((await cells.nth(1).textContent())!.trim()).not.toContain("Person");
    expect(await grid(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await grid(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    const key = (await rows(page).filter({ hasNotText: "Approved" }).first().getAttribute("data-key"))!;
    const card = page.locator(`.aster-grid-row[data-key="${key}"]`);
    await card.locator("[aria-colindex='7']").dblclick();
    const note = card.getByRole("textbox", { name: "Note" });
    await expect(note).toBeVisible();
    const box = (await note.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await note.press("Escape");
    const { violations } = await new (await import("@axe-core/playwright")).default({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
