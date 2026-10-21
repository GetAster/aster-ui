import { chooseAppearance } from "./appearance.ts";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("the published build exposes working examples and keeps internal docs out", async ({ page, request }) => {
  await page.goto("/?memory#showcase");
  await expect(page.getByRole("heading", { name: "Component showcase", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar").getByRole("link", { name: "Showcase", exact: true })).toHaveAttribute("aria-current", "page");
  const targets = await page.locator(".showcase-open").evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href));
  expect(targets).toHaveLength(10);
  for (const target of targets) {
    const response = await request.get(target);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
  }
  for (const path of ["/lib/aster-ui.js", "/lib/odata_mock.wasm", "/playground/vendor/echarts.js", "/reference/reference.json", "/guide/", "/guide/getting-started.html"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  for (const path of ["/design/calendar.html", "/requirements/component-integration.html", "/handoffs/"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("all examples preserve appearance and return to the gallery", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`${page.url()}: ${error.message}`));
  const examples = [
    ["Explore fields and layouts", "Fields and layouts"],
    ["Explore tile grids", "TileGrid"],
    ["Build an expression", "Advanced filtering"],
    ["Explore grouped reports", "Grid summaries and export"],
    ["Connect charts and grids", "Third-party components"],
    ["Explore application windows", "Application windows"],
    ["Compose a dashboard", "Dashboard composition"],
    ["Explore DataView", "DataView"],
    ["Explore tabs", "Tabs"],
  ] as const;
  await page.goto("/?memory&identity=harbour&scheme=dark#showcase");
  for (const [action, heading] of examples) {
    await page.getByRole("link", { name: action, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveText("Harbour");
    await expect(page.getByRole("combobox", { name: "Scheme", exact: true })).toHaveText("Dark");
    await expect(page.locator(".showcase-nav [aria-current=page]")).toHaveCount(1);
    await page.getByRole("navigation", { name: "Component examples" }).getByRole("link", { name: "← Component showcase", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Component showcase", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-identity", "harbour");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  }
  expect(errors).toEqual([]);
});

test("example navigation updates its URLs when the appearance changes", async ({ page }) => {
  await page.goto("/playground/filtering.html?theme=harbour&scheme=dark");
  await expect(page.getByRole("heading", { name: "Advanced filtering", exact: true })).toBeVisible();
  await chooseAppearance(page, "Theme", "harbour");
  await chooseAppearance(page, "Scheme", "light");
  await page.getByRole("navigation", { name: "Component examples" }).getByRole("link", { name: "Charts", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveText("Harbour");
  await expect(page.getByRole("combobox", { name: "Scheme", exact: true })).toHaveText("Light");
  await expect(page.locator("#platforms svg")).toBeVisible();
});

test("appearance pickers use Aster chrome, keyboard selection and focus recovery", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/playground/components.html");
  await expect(page.locator("aster-choice#theme .aster-field")).toBeVisible();
  await expect(page.locator("aster-choice#scheme .aster-field")).toBeVisible();
  await expect(page.locator("select#theme, select#scheme")).toHaveCount(0);
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await theme.focus();
  await theme.press("ArrowDown");
  await expect(theme).toHaveAttribute("aria-expanded", "true");
  await theme.press("End");
  await theme.press("Escape");
  await expect(theme).toHaveText("Lamplight");
  await expect(theme).toBeFocused();
  await theme.press("ArrowDown");
  await theme.press("End");
  await theme.press("Enter");
  await expect(theme).toHaveText("Harbour");
  await expect(theme).toBeFocused();
  const scheme = page.getByRole("combobox", { name: "Scheme", exact: true });
  await scheme.focus(); await scheme.press("ArrowDown"); await scheme.press("End"); await scheme.press("Enter");
  await expect(scheme).toHaveText("Dark");
  await expect(scheme).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-identity", "harbour");
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await chooseAppearance(page, "Scheme", "light");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  await theme.click();
  const violations = (await new AxeBuilder({ page }).include(".showcase-appearance").analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(violations.map(v => v.id)).toEqual([]);
});

test("the gallery is keyboard accessible, responsive and themed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const identity of ["lamplight", "harbour"]) {
    for (const scheme of ["light", "dark"]) {
      await page.goto(`/?memory&identity=${identity}&scheme=${scheme}#showcase`);
      await expect(page.locator(".showcase-open")).toHaveCount(10);
      await page.getByRole("link", { name: "Build an expression", exact: true }).focus();
      await expect(page.getByRole("link", { name: "Build an expression", exact: true })).toBeFocused();
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical");
      expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Connect charts and grids", exact: true }).focus();
  await page.getByRole("link", { name: "Connect charts and grids", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Third-party components", exact: true })).toBeVisible();
});

test.describe("mobile discovery", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("Home makes the gallery discoverable without crowding the tab bar", async ({ page }) => {
    await page.goto("/?memory#home");
    const entry = page.getByRole("link", { name: "Explore the components", exact: true });
    await expect(entry).toBeVisible();
    expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await entry.tap();
    await expect(page.getByRole("heading", { name: "Component showcase", exact: true })).toBeVisible();
    const charts = page.getByRole("link", { name: "Connect charts and grids", exact: true });
    await charts.tap();
    await expect(page.getByRole("heading", { name: "Third-party components", exact: true })).toBeVisible();
    expect((await page.locator("#theme .aster-field").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("combobox", { name: "Theme", exact: true }).tap();
    const harbour = page.getByRole("listbox", { name: "Theme", exact: true }).getByRole("option", { name: "Harbour", exact: true });
    expect((await harbour.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await harbour.tap();
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveText("Harbour");
    await page.getByRole("navigation", { name: "Component examples" }).getByRole("link", { name: "← Component showcase", exact: true }).tap();
    await expect(page.getByRole("heading", { name: "Component showcase", exact: true })).toBeVisible();
  });
});
