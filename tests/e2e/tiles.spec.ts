import { chooseAppearance } from "./appearance.ts";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle } from "./fixtures.ts";

async function open(page: Page): Promise<void> {
  await page.goto("/playground/tiles.html?debug");
  await expect(page.getByRole("grid", { name: "Files in Home" }).getByRole("gridcell")).toHaveCount(6);
}
const file = (page: Page, name: string) => page.getByRole("grid", { name: /Files in/ }).getByRole("gridcell", { name, exact: true });

test("showcase tiles are square for folders and landscape for devices at every size", async ({ page }) => {
  await open(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const size of [168, 248]) {
      await page.getByRole("slider", { name: "Tile size" }).fill(String(size));
      await expect.poll(() => file(page, "Documents").evaluate(el => Math.abs(el.clientWidth - el.clientHeight))).toBeLessThan(2);
      const device = (await page.locator("#devices .aster-tile").first().boundingBox())!;
      expect(device.width).toBeGreaterThan(device.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test("folders: spatial focus, multiple selection, activation and focus return", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const documents = file(page, "Documents");
  await documents.focus();
  await documents.press("ArrowRight");
  const pictures = file(page, "Pictures");
  await expect(pictures).toBeFocused();
  await expect(documents).toHaveAttribute("aria-selected", "false");
  await pictures.press(" ");
  await expect(pictures).toHaveAttribute("aria-selected", "true");
  await pictures.press("Shift+ArrowRight");
  await expect(file(page, "Empty folder")).toHaveAttribute("aria-selected", "true");
  await expect(pictures).toHaveAttribute("aria-selected", "true");
  await documents.focus();
  await documents.press("Enter");
  await expect(page.getByRole("grid", { name: "Files in Documents" })).toBeVisible();
  await expect(file(page, "Project brief.pdf")).toBeFocused();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(documents).toBeFocused();
  await expect(page.getByRole("grid", { name: "Files in Home" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("actions have a keyboard path, do not activate the tile, and restore focus", async ({ page }) => {
  await open(page);
  const grid = page.getByRole("grid", { name: "Your devices" });
  const mac = grid.getByRole("gridcell", { name: "Work MacBook", exact: true });
  await mac.focus();
  await mac.press("F2");
  await expect(mac.getByRole("button", { name: "Open Work MacBook" })).toBeFocused();
  await page.keyboard.press("Tab");
  const actions = mac.getByRole("button", { name: "Actions for Work MacBook" });
  await expect(actions).toBeFocused();
  await actions.press("Enter");
  const menu = page.getByRole("menu", { name: "Actions for Work MacBook" });
  await expect(menu).toBeVisible();
  await expect(page.locator("#opened")).toBeEmpty();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await actions.press("Escape");
  await expect(mac).toBeFocused();
  await mac.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mac).toBeFocused();
  await mac.press("F2");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Clear device selection" })).toBeFocused();
});

test("device status follows the store and details; removal recovers focus", async ({ page }) => {
  await open(page);
  const grid = page.getByRole("grid", { name: "Your devices" });
  const mac = grid.getByRole("gridcell", { name: "Work MacBook", exact: true });
  await mac.click();
  await expect(page.locator("#device-detail")).toHaveText("Selected: Work MacBook · Online");
  await page.getByRole("button", { name: "Simulate status change" }).click();
  await expect(mac).toHaveAccessibleDescription("macOS, Offline, last seen Just now");
  await expect(page.locator("#device-detail")).toHaveText("Selected: Work MacBook · Offline");
  await mac.focus();
  await page.evaluate(async () => {
    const { ctx } = (globalThis as any).tileDemo;
    await ctx.remove("Devices", "[1]");
  });
  await expect(grid.getByRole("gridcell", { name: "Home desktop", exact: true })).toBeFocused();
  await expect(page.locator("#device-detail")).toHaveText("Select a device to see its details.");
});

test("resize keeps a surviving focused tile, grid indices and narrow layout agree", async ({ page }) => {
  await open(page);
  const pictures = file(page, "Pictures");
  await pictures.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pictures).toBeFocused();
  const grid = page.getByRole("grid", { name: "Files in Home" });
  await expect(grid).toHaveAttribute("aria-colcount", "2");
  await expect(pictures.locator("..")).toHaveAttribute("aria-rowindex", "1");
  await pictures.press("ArrowDown");
  await expect(file(page, "Read me.txt")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 820 });
  await expect(file(page, "Read me.txt")).toBeFocused();
});

test("empty folders, missing images, custom content and reduced motion", async ({ page }) => {
  await open(page);
  await file(page, "Empty folder").getByRole("button", { name: "Open Empty folder" }).click();
  const empty = page.getByRole("grid", { name: "Files in Empty folder" });
  await expect(empty).toBeFocused();
  await expect(empty).toContainText("This folder is empty.");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await file(page, "Pictures").getByRole("button", { name: "Open Pictures" }).click();
  const missing = file(page, "Missing preview.png");
  await expect(missing.locator("img")).toBeHidden();
  await expect(missing.locator("svg")).toBeVisible();
  const before = await missing.boundingBox();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => missing.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  expect(await missing.boundingBox()).toEqual(before);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => missing.evaluate((el) => getComputedStyle(el).transitionDuration)).not.toBe("0s");
});

test("axe in each identity and scheme, including empty state and contextual actions", async ({ page }) => {
  await open(page);
  for (const identity of ["lamplight", "harbour"]) {
    await chooseAppearance(page, "Theme", identity);
    for (const scheme of ["light", "dark"]) {
      await chooseAppearance(page, "Scheme", scheme);
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLLinkElement>("#identity")?.sheet !== null)).toBe(true);
      await settle(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    }
  }
  await file(page, "Empty folder").dblclick();
  await expect(page.getByRole("grid", { name: "Files in Empty folder" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("type-ahead, RTL, range selection and page-scope publication", async ({ page }) => {
  await open(page);
  const documents = file(page, "Documents");
  await documents.focus();
  await documents.press("p");
  const pictures = file(page, "Pictures");
  await expect(pictures).toBeFocused();
  await pictures.press(" ");
  await expect.poll(() => page.evaluate(() => (globalThis as any).tileDemo.scope.value("files.count").value)).toBe(1);
  await page.getByRole("grid", { name: "Files in Home" }).evaluate((el) => { (el as HTMLElement).dir = "rtl"; });
  await pictures.press("ArrowRight");
  await expect(documents).toBeFocused();
  await documents.press(" ");
  await expect(page.locator('#files [aria-selected="true"]')).toHaveCount(2);
  await page.getByRole("grid", { name: "Files in Home" }).evaluate((el) => { (el as HTMLElement).dir = "ltr"; });
  await documents.press("Shift+ArrowRight");
  await expect(page.locator('#files [aria-selected="true"]')).toHaveCount(2);
  await page.evaluate(() => (globalThis as any).tileDemo.fileGrid.remove());
  await expect.poll(() => page.evaluate(() => (globalThis as any).tileDemo.scope.value("files.count").value)).toBe(undefined);
});

test("content tiles grow for enlarged text and nested controls keep their keys", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { html } = await import("/lib/aster-ui.js" as string);
    const { deviceGrid } = (globalThis as any).tileDemo;
    deviceGrid.layout = "content";
    deviceGrid.renderTile = (device: { name: string }) => html`<label>Note for ${device.name}<input aria-label=${`Note for ${device.name}`} value="Keep this note"></label>`;
    document.documentElement.style.setProperty("--aster-font-size", "26px");
  });
  const mac = page.getByRole("gridcell", { name: "Work MacBook", exact: true });
  await mac.focus();
  await mac.press("F2");
  const input = mac.getByRole("textbox", { name: "Note for Work MacBook" });
  await expect(input).toBeFocused();
  await input.fill("Draft");
  await input.press("ArrowLeft");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Draft");
  expect(await mac.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await input.press("Escape");
  await expect(mac).toBeFocused();
  await mac.press("F2");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Draft");
  await page.getByRole("button", { name: "Clear device selection" }).focus();
  await expect.poll(() => input.getAttribute("tabindex")).toBe("-1");
});

test.describe("touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("Open is visible and works without double-tap or long press", async ({ page }) => {
    await open(page);
    const documents = file(page, "Documents");
    const button = documents.getByRole("button", { name: "Open Documents" });
    await expect(documents.locator(".aster-tile-actions")).toHaveCSS("opacity", "1");
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await documents.locator(".aster-tile-title").tap();
    await expect(documents).toHaveAttribute("aria-selected", "true");
    await button.tap();
    await expect(page.getByRole("grid", { name: "Files in Documents" })).toBeVisible();
  });
});

test("changing tile size updates logical columns while keeping square proportions", async ({ page }) => {
  await open(page);
  const grid = page.getByRole("grid", { name: "Files in Home" });
  const before = await grid.boundingBox();
  await grid.evaluate((el) => {
    (el.parentElement as HTMLElement).style.setProperty("--tile-min-width", "250px");
  });
  await expect(grid).toHaveAttribute("aria-colcount", "4");
  const pictures = file(page, "Pictures");
  await pictures.focus();
  await pictures.press("ArrowDown");
  await expect(file(page, "仕様書とメモ.txt")).toBeFocused();
  expect((await grid.boundingBox())!.width).toBe(before!.width);
  const box = (await pictures.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
});
