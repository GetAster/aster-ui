// Density is one scale: in each of compact, standard and comfortable the
// controls take `--aster-ctl`, single-line rows take `--aster-row-y`, and
// every kind of element is smaller in compact and larger in comfortable than
// at standard, together.
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

const DENSITIES = ["compact", "standard", "comfortable"] as const;
type Density = (typeof DENSITIES)[number];

interface Measured {
  ctl: number;
  rowY: number;
  heights: Record<string, number>;
}

/** Rows of one line of text, with how many times `--aster-row-y` their height contains. */
const ROWS: Record<string, number> = { "nav item": 2, tab: 2, "menu item": 2, option: 2, "list-editor static row": 4 };

async function height(page: Page, selector: string): Promise<number> {
  const first = page.locator(selector).first();
  await expect(first, selector).toBeVisible();
  return (await first.boundingBox())!.height;
}
const token = (page: Page, name: string) =>
  page.evaluate((n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), name);

async function go(page: Page, hash: string): Promise<void> {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}${hash}`);
  await page.evaluate(() => document.fonts.ready);
}

async function measure(page: Page, density: Density): Promise<Measured> {
  await page.addInitScript((d) => localStorage.setItem("aster-demo-density", d), density);
  const heights: Record<string, number> = {};

  await go(page, "#project/2");
  heights["button"] = await height(page, "aster-button .aster-button");
  heights["field"] = await height(page, "aster-field .aster-field");
  heights["select"] = await height(page, "aster-select .aster-field");
  heights["picker"] = await height(page, "aster-picker .aster-field");
  heights["tab"] = await height(page, "[role=tab]");
  heights["nav item"] = await height(page, ".aster-nav-item");
  await page.locator("aster-picker input").first().click();
  heights["option"] = await height(page, ".aster-picker-list .aster-option");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Tasks/ }).click();
  heights["list-editor row"] = await height(page, ".aster-list-edit-row:not(.aster-list-edit-head)");
  await page.locator(".aster-list-edit-row").getByRole("button", { name: /^Remove / }).first().click();
  heights["list-editor static row"] = await height(page, ".aster-list-edit-row[data-removing]");
  await page.getByRole("button", { name: /^Undo removing / }).click();

  await go(page, "#tasks");
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  heights["grid row"] = await height(page, ".aster-grid-row[data-key]");
  heights["grid toolbar"] = await height(page, ".aster-grid-toolbar");
  await page.locator('.aster-grid-header[data-field="title"]').hover();
  await page.locator('.aster-grid-header[data-field="title"] .aster-grid-header-menu').click();
  heights["menu item"] = await height(page, '.aster-menu [role^="menuitem"]');
  await page.keyboard.press("Escape");
  const row = page.locator(".aster-grid-row[data-key]").first();
  await row.hover();
  await row.locator(".aster-grid-controls button[aria-label='Move to…']").click();
  heights["drill row"] = await height(page, ".aster-drill-row");

  return { ctl: await token(page, "--aster-ctl"), rowY: await token(page, "--aster-row-y"), heights };
}

const heightOf = (m: Measured, kind: string): number => m.heights[kind] ?? Number.NaN;

const measured = {} as Record<Density, Measured>;
test.describe.configure({ mode: "serial" });

for (const density of DENSITIES) {
  test(`${density}: controls follow --aster-ctl, rows follow --aster-row-y`, async ({ page }) => {
    const m = (measured[density] = await measure(page, density));
    expect(m.ctl).toBe({ compact: 26, standard: 30, comfortable: 38 }[density]);
    for (const control of ["field", "select", "picker"]) expect(m.heights[control]).toBeCloseTo(m.ctl, 0);
    expect(m.heights["button"]).toBeCloseTo(m.ctl - 2, 0);
  });
}

test("every kind of element is smaller in compact and larger in comfortable, and rows move by row-y", async () => {
  const { compact, standard, comfortable } = measured;
  for (const kind of Object.keys(standard.heights)) {
    expect(heightOf(compact, kind), `${kind}, compact`).toBeLessThan(heightOf(standard, kind));
    expect(heightOf(comfortable, kind), `${kind}, comfortable`).toBeGreaterThan(heightOf(standard, kind));
  }
  for (const [kind, times] of Object.entries(ROWS)) {
    const extra = (m: Measured) => heightOf(m, kind) - times * m.rowY;
    expect(Math.abs(extra(compact) - extra(standard)), `${kind}, compact`).toBeLessThanOrEqual(1);
    expect(Math.abs(extra(comfortable) - extra(standard)), `${kind}, comfortable`).toBeLessThanOrEqual(1);
  }
});
