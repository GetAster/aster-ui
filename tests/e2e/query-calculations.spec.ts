import { test, expect, pageUrl } from "./cdp.ts";

test.beforeEach(async ({ page }) => {
  await page.goto(pageUrl("/playground/query-calculations.html"));
  await expect(page.locator("#total")).toHaveText("4 matching lines · Total 162.5000 GBP");
});

test("nested calculations format values and retain whole-parent totals across paging and configuration", async ({ page }) => {
  await page.locator("#layout").getByRole("combobox").click();
  await page.locator("#layout").getByRole("option", { name: "Expandable regions", exact: true }).click();
  await page.getByRole("button", { name: "Open Order lines", exact: true }).click();
  const lines = page.locator('[data-occurrence="lines"]');
  await expect(lines.locator("tbody")).toContainText("£100.00");
  await expect(lines.getByRole("navigation")).toContainText("1–1 of 4");
  await lines.getByRole("button", { name: "Next", exact: true }).click();
  await expect(lines.locator("tbody")).toContainText("£37.50");
  await expect(page.locator("#total")).toContainText("162.5000");
  await page.locator("#minimum").check();
  await expect(page.locator("#total")).toHaveText("2 matching lines · Total 137.5000 GBP");
  await page.locator("#calculation").getByRole("combobox").click();
  await page.locator("#calculation").getByRole("option", { name: "Quantity × double unit price", exact: true }).click();
  await expect(page.locator("#total")).toHaveText("3 matching lines · Total 325.0000 GBP");
  await page.getByRole("button", { name: "Open Order lines", exact: true }).click();
  await expect(lines.locator("tbody")).toContainText("£200.00");
  expect(await page.evaluate(() => (window as any).calculationDemo.context.store.get("Lines", "[3]")?.entity.LineTotal)).toBeUndefined();
  await expect(page.locator('[role="alert"]')).toBeEmpty();
});

test("custom forms display scoped totals and elapsed hours for complete parent keys", async ({ page }) => {
  await page.locator("#view").getByRole("combobox").click();
  await page.locator("#view").getByRole("option", { name: "Custom form", exact: true }).click();
  await page.getByRole("button", { name: "Open Time entries", exact: true }).click();
  await expect(page.locator('[data-occurrence="time"] [data-value-type="Edm.Decimal"]')).toHaveText("2.50");
  await page.getByRole("button", { name: "Open Order lines", exact: true }).click();
  await expect(page.locator('[data-occurrence="lines"] .project-facts')).toContainText("£100.00");
  await page.locator("#order").getByRole("combobox").click();
  await page.locator("#order").getByRole("option", { name: "Support", exact: true }).click();
  await expect(page.locator("#total")).toHaveText("1 matching lines · Total 7.0000 GBP");
  await expect(page.locator(".project-card > header")).toContainText("Support");
  await page.getByRole("button", { name: "Open Time entries", exact: true }).click();
  await expect(page.locator('[data-occurrence="time"] [data-value-type="Edm.Decimal"]')).toHaveText("1");
  await page.setViewportSize({ width: 360, height: 820 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
