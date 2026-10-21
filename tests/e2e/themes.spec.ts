// M4 acceptance 6: the theme menu, and Harbour (a theme made from the guide
// alone) working across the demo, axe-clean in both schemes.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { open, settle } from "./fixtures.ts";

async function axe(page: Page) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("retired theme URLs fall back and only the two supported themes ship", async ({ page, request }) => {
  await open(page, "#projects/active", "&identity=kasm");
  await expect(page.getByRole("button", { name: "Theme: Lamplight" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-identity", "kasm");
  expect((await request.get("/lib/themes/kasm.css")).status()).toBe(404);
  await page.goto("/playground/components.html?theme=kasm");
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(theme).toHaveText("Lamplight");
  await theme.click();
  await expect(page.getByRole("listbox", { name: "Theme" }).getByRole("option")).toHaveText(["Lamplight", "Harbour"]);
});

test("the theme menu: radio items, the choice applies, is remembered, and ?identity= overrides it", async ({ page }) => {
  await open(page);
  const button = page.getByRole("button", { name: "Theme: Lamplight" });
  await button.click();
  const menu = page.getByRole("menu", { name: "Theme" });
  await expect(menu.getByRole("menuitemradio")).toHaveText([/Lamplight/, /Harbour/]);
  await expect(menu.getByRole("menuitemradio", { name: /Lamplight/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-identity", "harbour");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Theme: Harbour" })).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-identity", "harbour");
  await open(page, "#projects/active", "&identity=lamplight");
  await expect(page.locator("html")).not.toHaveAttribute("data-identity", /./);
});

for (const scheme of ["light", "dark"] as const) {
  test(`Harbour, ${scheme}: every main screen is axe-clean`, async ({ page }) => {
    await page.addInitScript((s) => localStorage.setItem("aster-demo-scheme", s), scheme);
    await open(page, "#projects/active", "&identity=harbour");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", scheme);
    expect(await axe(page)).toEqual([]);
    await page.getByRole("button", { name: "Share" }).click();
    await page.getByRole("textbox", { name: "Invite by name or email" }).press("Enter");
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Escape");
    for (const [hash, ready] of [
      ["#project/2", "aster-form aster-picker"],
      ["#people/3", ".person-detail aster-form"],
      ["#tasks", ".aster-grid-row[data-key]"],
      ["#home", "aster-carousel"],
      ["#time", ".aster-grid-row[data-key]"],
    ] as const) {
      await page.evaluate((h) => (location.hash = h), hash);
      await expect(page.locator(ready).first()).toBeVisible();
      expect([hash, await axe(page)]).toEqual([hash, []]);
    }
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("combobox", { name: "Filter Person" }).click();
    await page.getByRole("option").first().click();
    expect(await axe(page)).toEqual([]);
  });
}

test("Harbour dim: the Tasks page with a row expanded and the move dialog, axe-clean", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aster-demo-scheme", "dark"));
  await open(page, "#projects/active", "&identity=harbour");
  await page.evaluate(() => (location.hash = "#tasks"));
  const r = page.locator(".aster-grid-row[data-key]").nth(6);
  await expect(r).toBeVisible();
  await r.dblclick();
  await expect(r.locator("aster-form")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await r.locator(".aster-grid-controls button[aria-label='Cancel']").click();
  await r.hover();
  await r.locator(".aster-grid-controls button[aria-label='Move to…']").click();
  await expect(page.getByRole("dialog").locator(".aster-drill-row").first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
