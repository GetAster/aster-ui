import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("published home, docs search and API use the canonical routes", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Keep your data and interface in sync");
  await page.screenshot({ path: info.outputPath("home.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
  await page.goto("/docs/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Build connected interfaces");
  const search = page.getByRole("searchbox", { name: "Search documentation" });
  await search.fill("Why Aster");
  await page.locator("#results").getByRole("link", { name: /Why Aster UI/ }).click();
  await expect(page).toHaveURL(/\/docs\/guide\/why-aster.html$/);
  await search.fill("Grid.view");
  const result = page.locator("#results a").first();
  await expect(result).toHaveAttribute("href", /\/docs\/reference\/#/);
  await result.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Grid.view");
  await page.screenshot({ path: info.outputPath("reference.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("published previews load and source navigation returns to the live example", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/docs/guide/getting-started.html");
  await page.locator("iframe").scrollIntoViewIfNeeded();
  await expect(page.frameLocator("iframe").getByRole("grid", { name: "Projects", exact: true })).toBeVisible();
  await page.goto("/examples/composition.html");
  await expect(page.frameLocator("iframe").getByRole("grid").first()).toBeVisible();
  await page.frameLocator("iframe").getByRole("link", { name: "YAML definition" }).click();
  await expect(page.locator("#source-file")).toHaveValue("composition.ui.yaml");
  await expect(page.locator('#application-source [data-source-file="composition.ui.yaml"] .hljs-attr').first()).toBeVisible();
  await page.getByRole("button", { name: "Back to live preview" }).click();
  await expect(page.frameLocator("iframe").getByRole("link", { name: "YAML definition" })).toBeFocused();
  await page.screenshot({ path: info.outputPath("composition.png"), fullPage: true });
  const response = await page.request.get("/deployment.json");
  const receipt = await response.json();
  expect(receipt.site).toBe("https://ui.getaster.now");
  expect(receipt.files["docs/reference/reference.json"]).toMatch(/^[a-f0-9]{64}$/);
  expect((await page.request.get("/does-not-exist")).status()).toBe(404);
  expect((await page.request.get("/docs/design/publication.md")).status()).toBe(404);
  expect(errors).toEqual([]);
});
