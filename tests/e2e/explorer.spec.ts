import { test, expect, type FrameLocator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function choose(frame: FrameLocator | Page, name: string, option: string) {
  await frame.getByRole("combobox", { name, exact: true }).click();
  await frame.getByRole("listbox", { name, exact: true }).getByRole("option", { name: option, exact: true }).click();
}

test("table and tiles share filters, picked keys and an open edit draft", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/examples/tile-grid.html?q=Studio");
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("gridcell", { name: "Studio workstation", exact: true })).toBeVisible();
  await frame.getByRole("gridcell", { name: "Studio workstation", exact: true }).click();
  await expect(frame.locator("#selected-summary")).toContainText("1 selected: Studio workstation");
  await frame.getByRole("button", { name: "Edit first selected", exact: true }).click();
  const name = frame.getByRole("textbox", { name: "Name", exact: true });
  expect(await frame.locator("#dataset [role=combobox]").evaluate(element => {
    (element as HTMLElement).focus();
    return element === document.activeElement;
  })).toBe(false);
  await name.fill("Studio workstation updated");
  await choose(frame, "Presentation", "Table");
  await expect(name).toHaveValue("Studio workstation updated");
  await expect(frame.locator(".aster-grid-row[data-key]").filter({ hasText: "Studio workstation" })).toBeVisible();
  await expect(frame.locator("#selected-summary")).toContainText("1 selected: Studio workstation");
  await frame.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(frame.locator("#status")).toContainText("Saved to the shared record store");
  await expect(frame.locator(".aster-grid-row[data-key]").filter({ hasText: "Studio workstation updated" })).toBeVisible();
  await choose(frame, "Presentation", "Tiles");
  await expect(frame.getByRole("gridcell", { name: "Studio workstation updated", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("deep links, live controls and full-size links describe the same example", async ({ page }) => {
  await page.goto("/examples/grid.html?dataset=devices&view=tiles&platform=Linux&q=Studio&size=large&selection=ordered");
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("gridcell", { name: "Studio workstation", exact: true })).toBeVisible();
  await expect(frame.getByRole("combobox", { name: "Platform", exact: true })).toHaveText("Linux");
  await choose(frame, "Presentation", "Table");
  await expect(page).toHaveURL(/view=table/);
  await expect(page.locator("#standalone-example")).toHaveAttribute("href", /view=table/);
  await frame.getByRole("searchbox", { name: "Find by name" }).fill("Team");
  await expect(page).toHaveURL(/q=Team/);
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text: string) => { document.body.dataset.exampleLink = text; },
  } }); });
  await page.getByRole("button", { name: "Copy example link", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-example-link", page.url());
  await page.reload();
  await expect(frame.getByRole("searchbox", { name: "Find by name" })).toHaveValue("Team");
  await expect(frame.getByRole("combobox", { name: "Presentation", exact: true })).toHaveText("Table");
  await expect(frame.locator(".aster-grid-row[data-key]").first()).toContainText("Linux");
});

test("folder presentation and ordered selection use real collection controls", async ({ page }) => {
  await page.goto("/examples/tile-grid.html?selection=ordered");
  const frame = page.frameLocator("iframe");
  await choose(frame, "Sample data", "Workspace folders");
  const grid = frame.getByRole("grid", { name: "Workspace folder tiles", exact: true });
  await expect(grid).toBeVisible();
  for (const name of ["Brand assets", "Client projects", "Design system"]) {
    const cell = frame.getByRole("gridcell", { name, exact: true });
    await cell.focus(); await cell.press("Space");
  }
  await expect(frame.locator("#selected-summary")).toContainText("3 selected in pick order: Brand assets, Client projects, Design system");
  const fourth = frame.getByRole("gridcell", { name: "Finance", exact: true });
  await fourth.focus(); await fourth.press("Space");
  await expect(fourth).toHaveAttribute("aria-selected", "false");
  await choose(frame, "Presentation", "Table");
  await expect(frame.locator("#selected-summary")).toContainText("3 selected in pick order");
  await choose(frame, "Presentation", "Tiles");
  await expect(frame.getByRole("gridcell", { name: "Brand assets", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(frame.getByRole("combobox", { name: "Platform", exact: true })).toHaveCount(0);
});

test("source, guides and examples are discoverable from the documentation", async ({ page }) => {
  await page.goto("/reference/");
  await page.getByRole("navigation", { name: "Documentation", exact: true }).getByRole("link", { name: "All examples", exact: true }).click();
  await page.locator("main").getByRole("link", { name: /TileGrid: folders and devices/ }).click();
  await page.locator(".example-source summary").click();
  await expect(page.locator('[data-source-file="collection-demo.js"]')).toBeVisible();
  await expect(page.locator('[data-source-file="collection-demo.js"] code')).toContainText("new Selection");
  await page.getByLabel("Source file", { exact: true }).selectOption("collection-demo.html");
  await expect(page.locator('[data-source-file="collection-demo.js"]')).toBeHidden();
  await expect(page.locator('[data-source-file="collection-demo.html"]')).toBeVisible();
  await page.getByRole("link", { name: "How it works", exact: false }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Share data between table and tile views");
});

test("explorer is accessible in both schemes and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/examples/tile-grid.html?dataset=folders");
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("grid", { name: "Workspace folder tiles", exact: true })).toBeVisible();
  for (const scheme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "Colour scheme" }).selectOption(scheme);
    await expect(frame.locator("html")).toHaveAttribute("data-scheme", scheme);
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
  }
});

test("mobile preview fits the page and grows to include its editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/examples/tile-grid.html?q=Studio");
  const frame = page.frameLocator("iframe");
  const cell = frame.getByRole("gridcell", { name: "Studio workstation", exact: true });
  await cell.click();
  await frame.getByRole("button", { name: "Edit first selected", exact: true }).click();
  await expect(frame.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await frame.locator("html").evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await frame.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(frame.locator("#status")).toHaveText("Draft discarded.");
});


test("table headers and cells have distinct aligned columns", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of ["/examples/grid.html", "/examples/grid.html?dataset=folders", "/guide/getting-started.html"]) {
    await page.goto(path);
    const frame = page.frameLocator("iframe");
    const headers = frame.locator(".aster-grid-head [role=columnheader]");
    const cells = frame.locator(".aster-grid-row[data-key]").first().locator(":scope > .aster-grid-cell");
    await expect(headers).toHaveCount(3);
    await expect(cells).toHaveCount(3);
    await expect(cells.first()).toBeVisible();
    const geometry = await headers.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(); return { x: box.x, right: box.right, width: box.width };
    }));
    const row = await cells.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(); return { x: box.x, right: box.right, width: box.width };
    }));
    for (let i = 0; i < 3; i++) {
      expect(geometry[i]!.width, path).toBeGreaterThanOrEqual(70);
      expect(row[i]!.width, path).toBeGreaterThanOrEqual(70);
      expect(Math.abs(row[i]!.x - geometry[i]!.x), path).toBeLessThanOrEqual(1);
      if (i > 0) {
        expect(geometry[i]!.x, path).toBeGreaterThanOrEqual(geometry[i - 1]!.right - 1);
        expect(row[i]!.x, path).toBeGreaterThanOrEqual(row[i - 1]!.right - 1);
      }
    }
  }
});

for (const width of [1280, 390]) {
  test(`collection tile actions open the editor and keep their positions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/playground/collection-demo.html?view=tiles&size=compact");
    const tile = page.getByRole("gridcell", { name: "Design MacBook", exact: true });
    await expect(tile).toBeVisible();
    await expect(tile.getByRole("button", { name: "View content of Design MacBook", exact: true })).toBeHidden();
    const select = tile.getByRole("button", { name: "Select Design MacBook", exact: true });
    const open = tile.getByRole("button", { name: "Open Design MacBook", exact: true });
    const selectBefore = await select.boundingBox();
    const openBefore = await open.boundingBox();
    await select.click();
    const deselect = tile.getByRole("button", { name: "Deselect Design MacBook", exact: true });
    await expect(deselect).toHaveAttribute("aria-pressed", "true");
    const selectAfter = await deselect.boundingBox();
    const openAfter = await open.boundingBox();
    expect(selectAfter!.width).toBeCloseTo(selectBefore!.width, 0);
    expect(openAfter!.x).toBeCloseTo(openBefore!.x, 0);
    expect(openAfter!.y).toBeCloseTo(openBefore!.y, 0);
    await open.click();
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toHaveValue("Design MacBook");
    await name.fill("Design laptop draft");
    await page.getByRole("gridcell", { name: "Build server", exact: true }).getByRole("button", { name: "Open Build server", exact: true }).click();
    await expect(name).toHaveValue("Design laptop draft");
    await expect(page.locator("#status")).toContainText("Save or discard the current draft");
    await choose(page, "Presentation", "Table");
    await expect(name).toHaveValue("Design laptop draft");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("grid", { name: "Device fleet table", exact: true })).toContainText("Design laptop draft");
  });
}
