import { chooseAppearance, chooseGrouping } from "./appearance.ts";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const summaries = (page: Page) => page.getByRole("region", { name: "Device costs summaries" });
const value = (page: Page, title: string) => summaries(page).locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${title}$`) }) }).locator("dd");
const row = (page: Page, id: number) => page.locator(`#report .aster-grid-row[data-key="[${id}]"]`);
async function open(page: Page) {
  await page.goto("/playground/reporting.html?debug");
  await expect(value(page, "Devices")).toHaveText("240");
  await expect(row(page, 1)).toBeVisible();
}
async function download(page: Page): Promise<string> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const result = await pending;
  expect(result.suggestedFilename()).toBe("devices.csv");
  return readFile((await result.path())!, "utf8");
}

test("grouping dropdown works alone, defaults to none and restores the selectable table", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("checkbox", { name: "Group by platform" })).toHaveCount(0);
  const grouping = page.getByRole("combobox", { name: "Grouping levels", exact: true });
  await expect(grouping).toHaveText("No grouping");
  await grouping.click();
  await expect(page.getByRole("listbox", { name: "Grouping levels" }).getByRole("option").first()).toHaveText("No grouping");
  await grouping.press("Escape");
  await row(page, 1).locator('[aria-colindex="1"]').click();
  await page.getByRole("checkbox", { name: "Online only" }).check();
  for (const fields of ["platform", "platform,online", "platform,online,site"]) {
    await chooseGrouping(page, fields);
    await expect(page.locator(".aster-grid-group")).toHaveCount(3);
    expect(await page.evaluate(() => (globalThis as any).reportDemo.grouped.view.groupBy)).toEqual(fields.includes(",") ? fields.split(",") : fields);
    await expect(grouping).toBeFocused();
    await expect(value(page, "Devices")).toHaveText("120");
    await expect(page.getByRole("combobox", { name: "Export rows" })).toBeDisabled();
  }
  await chooseGrouping(page, "");
  await expect(page.getByRole("grid", { name: "Device costs", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Export rows" })).toBeEnabled();
  await expect(value(page, "Devices")).toHaveText("120");
  await chooseGrouping(page, "platform");
  await page.getByRole("button", { name: "Grouped by platform ✕", exact: true }).click();
  await expect(grouping).toHaveText("No grouping");
  await expect(page.getByRole("grid", { name: "Device costs", exact: true })).toBeVisible();
});

test("grouping changes keep an invalid inline draft visible and repair the picker value", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (globalThis as any).reportDemo.table.editable = true; });
  await row(page, 1).locator('[aria-colindex="4"]').dblclick();
  const cost = row(page, 1).getByRole("textbox", { name: "cost", exact: true });
  await cost.fill("invalid");
  await page.evaluate(() => {
    const control = document.querySelector("#levels") as any;
    control.value = "platform";
    control.dispatchEvent(new CustomEvent("change", { detail: "platform", bubbles: true }));
  });
  await expect(cost).toHaveValue("invalid");
  await expect(page.getByRole("combobox", { name: "Grouping levels" })).toHaveText("No grouping");
  await expect(page.locator("#status")).toHaveText("Finish editing before changing grouping.");
  await cost.press("Escape");
  await chooseGrouping(page, "platform");
  await expect(page.locator(".aster-grid-group")).toHaveCount(3);
});

test("the scrollbar follows fixed column edges, with full-width flexible and phone layouts", async ({ page }) => {
  await open(page);
  const scroll = page.locator("#report .aster-grid-scroll");
  const geometry = () => scroll.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const last = el.querySelector(".aster-grid-header:last-child")!.getBoundingClientRect();
    return { width: box.width, parent: el.parentElement!.clientWidth,
      gap: box.right - last.right - ((el as HTMLElement).offsetWidth - el.clientWidth),
      overflow: el.scrollWidth - el.clientWidth, vertical: el.scrollHeight > el.clientHeight };
  });
  await expect.poll(async () => Math.abs((await geometry()).gap)).toBeLessThanOrEqual(1);
  expect((await geometry()).width).toBeLessThan((await geometry()).parent - 100);
  expect((await geometry()).overflow).toBeLessThanOrEqual(1);
  expect((await geometry()).vertical).toBe(true);
  await page.evaluate(() => {
    const { table } = (globalThis as any).reportDemo;
    table.view = { ...table.view, columns: table.view.columns.map((c: any) => c.field === "id" ? { ...c, width: 160 } : c) };
  });
  await expect.poll(async () => Math.abs((await geometry()).gap)).toBeLessThanOrEqual(1);
  await expect.poll(async () => (await geometry()).width).toBeGreaterThan(790);
  await page.evaluate(() => {
    const { table } = (globalThis as any).reportDemo;
    table.view = { ...table.view, columns: table.view.columns.map((c: any) => c.field === "name" ? { field: "name" } : c) };
  });
  await expect.poll(async () => Math.abs((await geometry()).parent - (await geometry()).width)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    const { table } = (globalThis as any).reportDemo;
    table.view = { ...table.view, columns: table.view.columns.map((c: any) => ({ ...c, width: 400 })) };
  });
  await expect.poll(async () => (await geometry()).overflow).toBeGreaterThan(500);
  await scroll.evaluate((el) => { el.scrollLeft = 200; });
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Math.abs((await geometry()).parent - (await geometry()).width)).toBeLessThanOrEqual(1);
  await expect.poll(async () => (await geometry()).overflow).toBeLessThanOrEqual(1);
});

test("exact summaries cover unloaded pages, follow filters, edits, empty results and reconnect", async ({ page }) => {
  await open(page);
  await expect(value(page, "Total cost")).toHaveText("2424.00");
  await expect(value(page, "Average cost")).toHaveText("10.10");
  await expect(value(page, "Platforms")).toHaveText("3");
  expect(await page.evaluate(() => (globalThis as any).reportDemo.collection.complete.value)).toBe(false);
  await page.getByRole("checkbox", { name: "Online only" }).check();
  await expect(value(page, "Devices")).toHaveText("120");
  await expect(value(page, "Total cost")).toHaveText("1212.00");
  await page.getByRole("button", { name: "Change first device cost" }).click();
  await expect(value(page, "Total cost")).toHaveText("1222.10");
  await expect(value(page, "Highest cost")).toHaveText("20.20");
  await page.evaluate(() => {
    const { table } = (globalThis as any).reportDemo;
    table.remove(); document.querySelector("#out")!.append(table);
  });
  await expect(value(page, "Total cost")).toHaveText("1222.10");
  await page.evaluate(() => (globalThis as any).reportDemo.collection.setQuery({ set: "Devices", filter: { op: "eq", field: "id", value: -1 } }));
  await expect(value(page, "Devices")).toHaveText("0");
});

test("summary failure clears totals, announces and retries by keyboard with valid focus", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Fail next summary" }).click();
  await expect(summaries(page).getByRole("status")).toHaveText("Couldn’t load summaries.");
  await expect(value(page, "Total cost")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry summaries" }).focus();
  await page.keyboard.press("Enter");
  await expect(value(page, "Total cost")).toHaveText("2424.00");
  await expect(page.getByRole("grid", { name: "Device costs", exact: true })).toBeFocused();
  const id = await page.getByRole("grid", { name: "Device costs", exact: true }).getAttribute("aria-activedescendant");
  if (id) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
});

test("group headers and overall summaries use the same filtered query and update on saves", async ({ page }) => {
  await open(page);
  await chooseGrouping(page, "platform");
  await expect(page.getByRole("treegrid", { name: "Device costs" })).toBeVisible();
  await expect(page.locator(".aster-grid-group")).toHaveCount(3);
  const linux = page.locator(".aster-grid-group").filter({ has: page.locator(".aster-grid-group-label", { hasText: "Linux" }) });
  await expect(linux).toContainText("Total cost: 808.00");
  await page.getByRole("checkbox", { name: "Online only" }).check();
  await expect(value(page, "Devices")).toHaveText("120");
  await expect(linux).toContainText("Total cost: 404.00");
  await page.getByRole("button", { name: "Change first device cost" }).click();
  await expect(linux).toContainText("Total cost: 414.10");
  await expect(value(page, "Total cost")).toHaveText("1222.10");
  expect((await download(page)).split("\r\n").length).toBe(122);
  await chooseGrouping(page, "");
  await expect(value(page, "Total cost")).toHaveText("1222.10");
});

test("query export uses visible column order and captured filter and sort without moving the window", async ({ page }) => {
  await open(page);
  await page.getByRole("checkbox", { name: "Online only" }).check();
  await expect(value(page, "Devices")).toHaveText("120");
  await page.evaluate(() => {
    const { table } = (globalThis as any).reportDemo;
    table.view = { ...table.view, columns: [{ field: "cost" }, { field: "name" }, { field: "id", hidden: true }], sort: [{ field: "id", descending: true }] };
  });
  await expect(row(page, 239)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (globalThis as any).reportDemo.collection.keys.value.filter((k: unknown) => k !== undefined).length)).toBe(40);
  await expect.poll(() => page.evaluate(() => (globalThis as any).reportDemo.collection.status.value)).toBe("idle");
  const before = await page.evaluate(() => (globalThis as any).reportDemo.collection.keys.value);
  const csv = await download(page);
  expect(csv.startsWith('\uFEFF"cost","name"\r\n"10.10","Device 239"\r\n')).toBe(true);
  expect(csv.split("\r\n").length).toBe(122);
  expect(await page.evaluate(() => (globalThis as any).reportDemo.collection.keys.value)).toEqual(before);
});

test("group failures have keyboard retry and reconnect starts live aggregates again", async ({ page }) => {
  await open(page);
  await chooseGrouping(page, "platform");
  await expect(page.locator(".aster-grid-group")).toHaveCount(3);
  await page.getByRole("button", { name: "Fail next summary" }).click();
  await expect(page.getByRole("button", { name: "Retry groups" })).toBeVisible();
  await expect(page.locator(".aster-grid-group-summary")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry groups" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".aster-grid-group-summary").first()).toHaveText("Total cost: 808.00");
  await expect(page.getByRole("treegrid", { name: "Device costs" })).toBeFocused();
  await chooseGrouping(page, "");
  await page.getByRole("button", { name: "Change first device cost" }).click();
  await expect(value(page, "Total cost")).toHaveText("2434.10");
  await chooseGrouping(page, "platform");
  await expect(page.locator(".aster-grid-group-summary").first()).toHaveText("Total cost: 818.10");
});

test("export rejects unsaved inline drafts and tree reporting requires an explicit query", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (globalThis as any).reportDemo.table.editable = true; });
  await row(page, 1).locator('[aria-colindex="1"]').dblclick();
  const input = row(page, 1).locator("input").first();
  await input.fill("Changed device");
  expect(await page.evaluate(async () => {
    try { await (globalThis as any).reportDemo.table.exportCsv(); return "unexpected"; }
    catch (error) { return (error as Error).message; }
  })).toBe("Finish editing before exporting");
  await input.press("Escape");
  expect(await page.evaluate(() => {
    const grid = document.createElement("aster-grid") as any;
    grid.summaries = [{ method: "count" }];
    try { grid.tree = { parentField: "parentId" }; return "unexpected"; }
    catch (error) { return (error as Error).message; }
  })).toContain("explicit query");
});

test("selection export preserves rank and excludes unloaded unselected records", async ({ page }) => {
  await open(page);
  await row(page, 3).locator('[aria-colindex="2"]').click();
  await row(page, 1).locator('[aria-colindex="2"]').click();
  await page.getByRole("combobox", { name: "Export rows" }).selectOption("selection");
  const csv = await download(page);
  expect(csv.split("\r\n").slice(1, 3)).toEqual([
    '"Device 003","Windows","true","10.10","3"',
    '"Device 001","Linux","true","10.10","1"',
  ]);
  expect(csv.split("\r\n").length).toBe(4);
});

test("export limits, transport errors and cancellation return no partial download and allow retry", async ({ page }) => {
  await open(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("spinbutton", { name: "Maximum rows" }).fill("10");
  await page.getByRole("button", { name: "Download CSV" }).click();
  await expect(page.locator("#status")).toContainText("exceeds 10 rows");
  await page.getByRole("spinbutton", { name: "Maximum rows" }).fill("1000");
  await page.getByRole("button", { name: "Fail next export" }).click();
  await page.getByRole("button", { name: "Download CSV" }).click();
  await expect(page.locator("#status")).toContainText("Couldn’t export");
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeEnabled();
  await page.evaluate(() => { (globalThis as any).reportDemo.mock.faults.latencyMs = 300; });
  await page.getByRole("button", { name: "Download CSV" }).click();
  await expect(page.locator("#status")).toContainText(/Exporting \d+ rows/);
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect(page.locator("#status")).toHaveText("Export cancelled.");
  expect(downloads).toBe(0);
  expect((await download(page)).split("\r\n").length).toBe(242);
});

test("summaries and export controls meet automated accessibility across themes, narrow width and low motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  for (const theme of ["lamplight", "harbour"]) {
    await chooseAppearance(page, "Theme", theme);
    for (const scheme of ["light", "dark"]) {
      await chooseAppearance(page, "Scheme", scheme);
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLLinkElement>("#identity")?.sheet !== null)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(value(page, "Total cost")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await chooseGrouping(page, "platform");
  await expect(page.locator(".aster-grid-group-summary").first()).toBeVisible();
  await expect(page.locator(".aster-grid-group > .aster-grid-cell").first()).toHaveCSS("display", "flex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
