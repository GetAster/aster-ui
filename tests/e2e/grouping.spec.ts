import { chooseAppearance, chooseGrouping } from "./appearance.ts";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const tree = (page: Page) => page.getByRole("treegrid", { name: "Device costs", exact: true });
const group = (page: Page, path: readonly unknown[]) => page.locator(`.aster-grid-group[data-key=${JSON.stringify(`g:${JSON.stringify(path)}`)}]`);
async function open(page: Page, fields = "platform,online,site", persist = false, count = 240) {
  await page.goto(`/playground/reporting.html?debug${persist ? "&persist" : ""}&devices=${count}`);
  await expect(page.locator(".aster-grid-summary dd").first()).toHaveText(count.toLocaleString("en-GB"));
  await chooseGrouping(page, fields);
  await expect(group(page, ["Linux"])).toBeVisible();
}
async function expand(page: Page, path: readonly unknown[]) {
  await group(page, path).getByRole("gridcell").click();
  await expect(group(page, path)).toHaveAttribute("aria-expanded", "true");
  await expect(group(page, path)).toHaveAttribute("aria-busy", "false");
}
async function active(page: Page) {
  const id = await tree(page).getAttribute("aria-activedescendant");
  expect(id).toBeTruthy();
  const cell = page.locator(`[id=${JSON.stringify(id)}]`);
  await expect(cell).toBeVisible();
  return cell.locator("..");
}

test("three levels load only open branches, with exact totals, unique paths, null groups and paged leaves", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await expect(page.locator(".aster-grid-group")).toHaveCount(3);
  await expect(group(page, ["Linux"])).toContainText("Total cost: 808.00");
  const records = () => page.evaluate(() => (globalThis as any).reportDemo.requests.filter((r: any) => r.url.startsWith("Devices?") && !r.url.includes("$apply")).length);
  const before = await records();
  await expand(page, ["Linux"]);
  await expect(group(page, ["Linux", true])).toHaveAttribute("aria-level", "2");
  await expect(group(page, ["Linux", false])).toContainText("Total cost: 404.00");
  await expect(group(page, ["Linux", true])).toContainText("Platforms: 1");
  expect(await records()).toBe(before);
  await expand(page, ["Linux", true]);
  await expect(group(page, ["Linux", true, null])).toContainText("None");
  await expect(group(page, ["Linux", true, "London"])).toHaveAttribute("aria-level", "3");
  await expand(page, ["Linux", true, "London"]);
  const record = page.locator('.aster-grid-row[data-key="[1]"]');
  await expect(record).toBeVisible();
  await expect(record).toHaveAttribute("aria-level", "4");
  await expect(record).toHaveAttribute("aria-posinset", "1");
  await expect(record).toHaveAttribute("aria-setsize", "14");
  expect(await records()).toBeGreaterThan(before);
  await expect(page.locator(".aster-grid-total")).toHaveText("240 rows in 3 groups");
  await expect(page.locator(".aster-grid-summary dd").first()).toHaveText("240");
  expect(errors).toEqual([]);
});

test("Right enters children, Left returns or collapses; removing an active descendant keeps a valid reference", async ({ page }) => {
  await open(page, "platform,online");
  await tree(page).focus();
  await tree(page).press("ArrowRight");
  await expect(group(page, ["Linux", false])).toBeVisible();
  await tree(page).press("ArrowRight");
  await expect(await active(page)).toHaveAttribute("data-key", 'g:["Linux",false]');
  await tree(page).press("ArrowLeft");
  await expect(await active(page)).toHaveAttribute("data-key", 'g:["Linux"]');
  await tree(page).press("ArrowRight");
  await tree(page).press("Enter");
  await expect(group(page, ["Linux", false])).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.aster-grid-row[data-key="[4]"]')).toBeVisible();
  await tree(page).press("ArrowRight");
  await expect(await active(page)).toHaveAttribute("data-key", "[4]");
  await tree(page).press("ArrowLeft");
  await expect(await active(page)).toHaveAttribute("data-key", 'g:["Linux",false]');
  await page.evaluate(() => {
    const model = (globalThis as any).reportDemo.grouped.groupingModel;
    model.collapse('g:["Linux"]');
  });
  await expect(await active(page)).toHaveAttribute("data-key", 'g:["Linux"]');
  expect(await page.evaluate(() => (globalThis as any).reportDemo.grouped.activeKey)).toBeUndefined();
});

test("nested group failure is announced, Enter retries and a collapsed late response cannot reopen it", async ({ page }) => {
  await open(page, "platform,online");
  await page.getByRole("button", { name: "Fail next summary" }).click();
  await expect(page.getByRole("button", { name: "Retry groups", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry groups", exact: true }).click();
  await expect(group(page, ["Linux"])).toBeVisible();
  await expect(tree(page)).toHaveAttribute("aria-busy", "false");
  await page.evaluate(async () => {
    const { mock, grouped } = (globalThis as any).reportDemo;
    mock.faults.failNext(503);
    await grouped.groupingModel.expand('g:["Linux"]');
  });
  await expect(group(page, ["Linux"]).getByRole("button", { name: "Retry group Linux", exact: true })).toBeVisible();
  await group(page, ["Linux"]).getByRole("button", { name: "Retry group Linux", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(group(page, ["Linux", false])).toBeVisible();
  await expect(tree(page)).toBeFocused();
  await page.evaluate(async () => {
    const { grouped, mock } = (globalThis as any).reportDemo;
    mock.faults.latencyMs = 150;
    const pending = grouped.groupingModel.retry('g:["Linux"]');
    grouped.groupingModel.collapse('g:["Linux"]');
    await pending;
  });
  await expect(group(page, ["Linux"])).toHaveAttribute("aria-expanded", "false");
  await expect(group(page, ["Linux", false])).toHaveCount(0);
});

test("saved grouping order survives reload and a hidden dimension can be removed or reordered", async ({ page }) => {
  await open(page, "platform,online,site", true);
  await page.getByRole("button", { name: "Move site grouping earlier" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (globalThis as any).reportDemo.grouped.view.groupBy)).toEqual(["platform", "site", "online"]);
  await expect(page.getByRole("button", { name: "Move site grouping earlier" })).toBeFocused();
  await page.reload();
  await expect(page.locator(".aster-grid-summary dd").first()).toHaveText("240");
  await expect(group(page, ["Linux"])).toBeVisible();
  expect(await page.evaluate(() => (globalThis as any).reportDemo.grouped.view.groupBy)).toEqual(["platform", "site", "online"]);
  await expand(page, ["Linux"]);
  await expect(group(page, ["Linux", "London"])).toBeVisible();
  await page.getByRole("button", { name: "Then by site ✕", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).reportDemo.grouped.view.groupBy)).toEqual(["platform", "online"]);
  await expect(group(page, ["Linux"])).toHaveAttribute("aria-expanded", "false");
});

test("filters and live membership moves update every prefix; removed paths release their descendants", async ({ page }) => {
  await open(page, "platform,online");
  await expand(page, ["Linux"]);
  await expand(page, ["Linux", true]);
  await expect(page.locator('.aster-grid-row[data-key="[1]"]')).toBeVisible();
  await page.getByRole("button", { name: "Change first device cost" }).click();
  await expect(group(page, ["Linux", true])).toContainText("Total cost: 414.10");
  await expect(group(page, ["Linux"])).toContainText("Total cost: 818.10");
  await page.evaluate(async () => {
    const { ctx } = (globalThis as any).reportDemo;
    await ctx.update("Devices", "[1]", { online: false });
  });
  await expect(group(page, ["Linux", true])).toContainText("Total cost: 393.90");
  await expect(group(page, ["Linux", false])).toContainText("Total cost: 424.20");
  await expect(page.locator('.aster-grid-row[data-key="[1]"]')).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Online only" }).check();
  await expect(group(page, ["Linux", false])).toHaveCount(0);
  await expect(page.locator(".aster-grid-total")).toHaveText("119 rows in 3 groups");
  await expect(page.locator(".aster-grid-summary dd").first()).toHaveText("119");
});

test("nested groups retain bounded DOM and page windows on a large leaf", async ({ page }) => {
  await open(page, "platform,online", false, 100_000);
  await expand(page, ["Linux"]);
  await expand(page, ["Linux", true]);
  await tree(page).evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await expect(page.locator(".aster-grid-row[data-placeholder]")).toHaveCount(0);
  expect(await page.locator(".aster-grid-row").count()).toBeLessThan(65);
  expect(await page.evaluate(() => {
    const model = (globalThis as any).reportDemo.grouped.groupingModel;
    const record = model.rows.value.find((r: any) => r.kind === "row");
    return record.collection.keys.value.filter((k: unknown) => k !== undefined).length;
  })).toBeLessThanOrEqual(400);
});

test("collapse and regroup refuse to hide an invalid inline draft", async ({ page }) => {
  await open(page, "platform,online");
  await expand(page, ["Linux"]); await expand(page, ["Linux", true]);
  await page.evaluate(() => { (globalThis as any).reportDemo.grouped.editable = true; });
  const record = page.locator('.aster-grid-row[data-key="[1]"]');
  await record.locator('[aria-colindex="1"]').dblclick();
  const cost = record.locator('[aria-colindex="4"] input');
  await cost.fill("invalid");
  await group(page, ["Linux"]).getByRole("gridcell").click();
  await expect(group(page, ["Linux"])).toHaveAttribute("aria-expanded", "true");
  await expect(cost).toHaveValue("invalid");
  await expect(cost).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Then by online ✕", exact: true }).click();
  expect(await page.evaluate(() => (globalThis as any).reportDemo.grouped.view.groupBy)).toEqual(["platform", "online"]);
  await expect(cost).toHaveValue("invalid");
  await cost.press("Escape");
  await group(page, ["Linux"]).getByRole("gridcell").click();
  await expect(group(page, ["Linux"])).toHaveAttribute("aria-expanded", "false");
});

test("nested headers, summaries and retries pass themes, low motion, narrow and forced-colour checks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expand(page, ["Linux"]); await expand(page, ["Linux", true]);
  await expand(page, ["Linux", true, "London"]);
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
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
