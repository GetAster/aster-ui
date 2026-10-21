import { chooseAppearance } from "./appearance.ts";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle } from "./fixtures.ts";

const grid = (page: Page) => page.getByRole("grid", { name: "Device fleet" });
const tile = (page: Page, n: number) => grid(page).getByRole("gridcell", { name: `Device ${String(n).padStart(6, "0")}`, exact: true });
async function open(page: Page): Promise<void> {
  await page.goto("/playground/tiles.html?debug");
  await expect(page.getByRole("grid", { name: "Files in Home" }).getByRole("gridcell")).toHaveCount(6);
  await page.getByRole("button", { name: "Load large collection", exact: true }).click();
  await expect(tile(page, 1)).toBeVisible();
  await expect(grid(page)).toHaveAttribute("aria-busy", "false");
}

test("100k devices: bounded DOM/pages, logical indices and focused row retention", async ({ page }) => {
  await open(page);
  await tile(page, 1).focus();
  const cols = Number(await grid(page).getAttribute("aria-colcount"));
  await expect(grid(page)).toHaveAttribute("aria-rowcount", String(Math.ceil(100_000 / cols)));
  for (const top of [30_000, 90_000, 400_000]) {
    await grid(page).evaluate((el, value) => { el.scrollTop = value; }, top);
    await expect.poll(() => page.evaluate(() => {
      const { collection } = (globalThis as any).tileDemo.fleet;
      return collection.status.value;
    })).toBe("idle");
    await expect(tile(page, 1)).toBeFocused();
    expect(await grid(page).getByRole("gridcell").count()).toBeLessThan(70);
    expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.collection.keys.value.filter(Boolean).length)).toBeLessThanOrEqual(160);
  }
  const position = await grid(page).locator('.aster-tile-row[aria-rowindex]').last().getAttribute("aria-rowindex");
  expect(Number(position)).toBeGreaterThan(100);
  await grid(page).evaluate((el) => { el.scrollTop = 0; });
  await expect(tile(page, 1)).toBeFocused();
});

test("keyboard reaches unloaded boundaries, selection persists across eviction and return", async ({ page }) => {
  await open(page);
  await tile(page, 1).click();
  await tile(page, 1).press("Control+End");
  await expect(tile(page, 100_000)).toBeFocused();
  await expect(tile(page, 100_000).locator("..")).toHaveAttribute("aria-rowindex", await grid(page).getAttribute("aria-rowcount") ?? "");
  await tile(page, 100_000).press(" ");
  await expect.poll(() => page.evaluate(() => (globalThis as any).tileDemo.fleet.grid.selection.keys.value)).toEqual(["[1]", "[100000]"]);
  await tile(page, 100_000).press("Control+Home");
  await expect(tile(page, 1)).toBeFocused();
  await expect(tile(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(tile(page, 1).locator(".aster-tile-order")).toHaveText("1");
  await tile(page, 1).press("PageDown");
  await expect(tile(page, 1)).not.toBeFocused();
  await page.keyboard.press("PageUp");
  await expect(tile(page, 1)).toBeFocused();
});

test("ordered picks enforce cap, expose rank, reorder, compact and re-add", async ({ page }) => {
  await open(page);
  for (const n of [2, 1, 3, 4]) await tile(page, n).click();
  await expect(page.locator("#fleet-selection")).toHaveText("Selected in order: Device 000002, Device 000001, Device 000003");
  await expect(page.locator("#fleet .aster-tile-status")).toContainText("Select at most 3");
  await expect(tile(page, 4)).toHaveAttribute("aria-selected", "false");
  await tile(page, 1).focus();
  await tile(page, 1).press("Alt+ArrowUp");
  await expect(tile(page, 1).locator(".aster-tile-order")).toHaveText("1");
  await expect(tile(page, 1)).toHaveAccessibleDescription(/Selection 1 of 3/);
  await tile(page, 3).getByRole("button", { name: "Move Device 000003 earlier in selection", exact: true }).click();
  await expect(tile(page, 3).locator(".aster-tile-order")).toHaveText("2");
  await tile(page, 1).getByRole("button", { name: "Deselect Device 000001", exact: true }).click();
  await expect(tile(page, 3).locator(".aster-tile-order")).toHaveText("1");
  await tile(page, 4).getByRole("button", { name: "Select Device 000004", exact: true }).click();
  await expect(tile(page, 4).locator(".aster-tile-order")).toHaveText("3");
  for (const [mode, multi] of [["single", false], ["multiple", true], ["unlimited", true]] as const) {
    await page.getByRole("combobox", { name: "Selection", exact: true }).selectOption(mode);
    for (const n of [1, 2, 3, 4]) await tile(page, n).click({ modifiers: mode === "multiple" ? ["Meta"] : [] });
    expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.grid.selection.count.value)).toBe(multi ? 4 : 1);
    expect(await tile(page, 4).locator(".aster-tile-order").count()).toBe(mode === "unlimited" ? 1 : 0);
  }
});

test("failed navigation keeps focus and retry loads its target", async ({ page }) => {
  await open(page);
  await tile(page, 1).focus();
  await page.evaluate(() => (globalThis as any).tileDemo.fleet.mock.faults.failNext(503));
  expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.grid.focusIndex(900))).toBe(false);
  await expect(tile(page, 1)).toBeFocused();
  const retry = page.getByRole("button", { name: "Retry loading tiles", exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(tile(page, 901)).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(grid(page)).toHaveAttribute("aria-busy", "false");
});

test("failed scroll has stable placeholders, bounded retry and no selectable phantom", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Fail next page", exact: true }).click();
  await grid(page).scrollIntoViewIfNeeded();
  await grid(page).evaluate((el) => { el.scrollTop = 80_000; });
  await expect(page.getByRole("button", { name: "Retry loading tiles", exact: true })).toBeVisible();
  const before = await grid(page).evaluate((el) => el.scrollTop);
  const placeholders = grid(page).locator(".aster-tile-placeholder");
  await expect(placeholders.first()).toHaveAttribute("aria-disabled", "true");
  const point = await grid(page).evaluate((el) => {
    const viewport = el.getBoundingClientRect();
    const cell = [...el.querySelectorAll(".aster-tile-placeholder")].map((c) => c.getBoundingClientRect())
      .find((r) => r.top >= viewport.top && r.bottom <= viewport.bottom)!;
    return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#fleet-selection")).toHaveText("No devices selected.");
  await page.getByRole("button", { name: "Retry loading tiles", exact: true }).click();
  await expect(placeholders).toHaveCount(0);
  expect(await grid(page).evaluate((el) => el.scrollTop)).toBe(before);
});

test("unknown and estimated totals stay honest and End loads a bounded reachable frontier", async ({ page }) => {
  await open(page);
  for (const mode of ["unknown", "estimated"]) {
    await page.getByRole("combobox", { name: "Count", exact: true }).selectOption(mode);
    await expect(tile(page, 1)).toBeVisible();
    await expect(grid(page)).toHaveAttribute("aria-busy", "false");
    await expect(grid(page)).toHaveAttribute("aria-rowcount", "-1");
    await expect(page.locator("#fleet .aster-tile-status")).not.toContainText("120000 records");
    if (mode === "unknown") {
      const count = await page.evaluate(() => (globalThis as any).tileDemo.fleet.collection.count.value);
      const requests = await page.evaluate(() => (globalThis as any).tileDemo.fleet.requests.length);
      await tile(page, 1).focus();
      await tile(page, 1).press("Control+End");
      await expect(tile(page, count)).toBeFocused();
      expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.requests.length)).toBeLessThan(requests + 6);
    }
  }
});

test("resize anchors logical position, keeps focused tile and accommodates enlarged text with F2", async ({ page }) => {
  await open(page);
  await grid(page).evaluate((el) => { el.scrollTop = 80_000; });
  await expect(grid(page)).toHaveAttribute("aria-busy", "false");
  const firstVisible = () => grid(page).evaluate((el) => {
    const top = el.getBoundingClientRect().top + 4;
    const row = [...el.querySelectorAll('.aster-tile-row[data-pinned="false"]')].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top <= top && rect.bottom > top;
    });
    return row ? (Number(row.getAttribute("aria-rowindex")) - 1) * Number(el.getAttribute("aria-colcount")) : -1;
  });
  await expect.poll(firstVisible).toBeGreaterThan(0);
  const anchor = await firstVisible();
  await page.setViewportSize({ width: 650, height: 820 });
  await expect(grid(page)).toHaveAttribute("aria-colcount", "2");
  await expect.poll(firstVisible).toBe(Math.floor(anchor / 2) * 2);
  await page.evaluate(() => (globalThis as any).tileDemo.fleet.grid.focusIndex(500));
  await expect(tile(page, 501)).toBeFocused();
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--aster-font-size", "26px");
    (globalThis as any).tileDemo.fleet.grid.style.setProperty("--tile-height", "12rem");
  });
  await tile(page, 501).press("F2");
  const content = tile(page, 501).locator(".aster-tile-content");
  await expect(content).toBeFocused();
  await content.press("Escape");
  await expect(tile(page, 501)).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(tile(page, 501)).toHaveCSS("transition-duration", "0s");
  expect(await grid(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await settle(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a query change discards delayed navigation and returns to the first page", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { collection, grid, mock } = (globalThis as any).tileDemo.fleet;
    mock.faults.latencyMs = 300;
    const navigation = grid.focusIndex(50_000);
    collection.setQuery({ set: "Devices", filter: { op: "lt", field: "id", value: 10 }, orderBy: [{ field: "id" }] });
    await navigation;
  });
  await expect(tile(page, 1)).toBeVisible();
  await expect(grid(page)).toHaveAttribute("aria-busy", "false");
  expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.collection.count.value)).toBe(9);
  expect(await grid(page).evaluate((el) => el.scrollTop)).toBe(0);
  expect(await tile(page, 50_001).count()).toBe(0);
});


test("rapid scrolling coalesces page work and delayed navigation cannot steal focus", async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => {
    const f = (globalThis as any).tileDemo.fleet;
    f.mock.faults.latencyMs = 400;
    return f.requests.length;
  });
  await grid(page).evaluate(async (el) => {
    for (let i = 1; i <= 10; i++) {
      el.scrollTop = i * 10_000;
      await new Promise(requestAnimationFrame);
    }
  });
  await expect(grid(page)).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => page.evaluate(() => {
    const f = (globalThis as any).tileDemo.fleet;
    const e = f.grid.querySelector("[role=grid]");
    const cols = Number(e.getAttribute("aria-colcount"));
    const row = e.querySelector(".aster-tile-row");
    const stride = row.getBoundingClientRect().height + parseFloat(getComputedStyle(e).rowGap);
    return f.collection.keys.value[Math.floor(e.scrollTop / stride) * cols] !== undefined;
  })).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).tileDemo.fleet.requests.length)).toBeLessThan(before + 6);
  await page.evaluate(() => (globalThis as any).tileDemo.fleet.grid.focusIndex(900));
  await expect(tile(page, 901)).toBeFocused();
  await page.evaluate(() => {
    (globalThis as any).tileDemo.pendingNavigation = (globalThis as any).tileDemo.fleet.grid.focusIndex(50_000);
  });
  await page.getByRole("combobox", { name: "Selection", exact: true }).focus();
  expect(await page.evaluate(() => (globalThis as any).tileDemo.pendingNavigation)).toBe(false);
  await expect(page.getByRole("combobox", { name: "Selection", exact: true })).toBeFocused();
});


test("paged ordered tiles pass axe across all themes and schemes", async ({ page }) => {
  await open(page);
  await tile(page, 1).click();
  await tile(page, 2).click();
  for (const identity of ["lamplight", "harbour"]) {
    await chooseAppearance(page, "Theme", identity);
    for (const scheme of ["light", "dark"]) {
      await chooseAppearance(page, "Scheme", scheme);
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLLinkElement>("#identity")?.sheet !== null)).toBe(true);
      await settle(page);
      expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    }
  }
});

test.describe("paged touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("selection and content access have visible touch actions", async ({ page }) => {
    await open(page);
    const first = tile(page, 1);
    await expect(first.locator(".aster-tile-actions")).toHaveCSS("opacity", "1");
    await first.getByRole("button", { name: "Select Device 000001", exact: true }).tap();
    await expect(first.locator(".aster-tile-order")).toHaveText("1");
    await first.getByRole("button", { name: "View content of Device 000001", exact: true }).tap();
    await expect(first).toHaveAttribute("data-interaction", "true");
    await first.getByRole("button", { name: "Deselect Device 000001", exact: true }).tap();
    await expect(first).toHaveAttribute("aria-selected", "false");
  });
});


test("typeahead includes prefetched records outside the rendered window", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const { grid } = (globalThis as any).tileDemo.fleet;
    grid.presentTile = (device: { id: number; name: string }) => ({ title: device.id === 60 ? "Zebra device" : device.name });
  });
  await tile(page, 1).focus();
  await tile(page, 1).press("z");
  await expect(grid(page).getByRole("gridcell", { name: "Zebra device", exact: true })).toBeFocused();
});


test("100k tall tiles at phone width reach the last row by keyboard and scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(grid(page)).toHaveAttribute("aria-colcount", "1");
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "100000");
  const extent = await grid(page).locator(".aster-tile-canvas").evaluate((el) => el.getBoundingClientRect().height);
  expect(extent).toBeGreaterThan(0);
  expect(extent).toBeLessThanOrEqual(8_000_000);
  await tile(page, 1).focus();
  await tile(page, 1).press("Control+End");
  await expect(tile(page, 100_000)).toBeFocused();
  await expect(tile(page, 100_000)).toBeInViewport();
  await tile(page, 100_000).press("Control+Home");
  await expect(tile(page, 1)).toBeFocused();
  await grid(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(tile(page, 100_000)).toBeInViewport();
  await expect(tile(page, 1)).toBeFocused();
  expect(await grid(page).getByRole("gridcell").count()).toBeLessThan(12);
  await page.getByRole("link", { name: "Back to the playground", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(tile(page, 1)).toBeFocused();
  await expect(tile(page, 1)).toBeInViewport();
});
