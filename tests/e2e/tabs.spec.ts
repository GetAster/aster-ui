import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/playground/tabs.html");
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
});

test("lazy panels keep their DOM and drafts until removed", async ({ page }) => {
  const panels = page.locator('#devices > [role="tabpanel"]');
  await expect(panels).toHaveCount(7);
  await expect(page.locator("#devices textarea")).toHaveCount(0);
  await page.getByRole("tab", { name: "Studio workstation 1", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Studio workstation 1", exact: true });
  await expect(panel).toBeVisible();
  const id = await panel.getAttribute("id");
  await expect(page.getByRole("tab", { name: "Studio workstation 1", exact: true })).toHaveAttribute("aria-controls", id!);
  await panel.getByRole("textbox", { name: "Workspace notes" }).fill("Keep this draft");
  await page.locator(`#${id} textarea`).evaluate(el => { el.dataset.retained = "yes"; });
  await page.getByRole("tab", { name: "Studio workstation 2", exact: true }).click();
  await expect(page.locator("#devices textarea")).toHaveCount(2);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: "Studio workstation 1 •", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Workspace notes" })).toHaveValue("Keep this draft");
  await expect(page.getByRole("textbox", { name: "Workspace notes" })).toHaveAttribute("data-retained", "yes");
});

test("close protects dirty content and recovers selection and focus", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Close Overview" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Studio workstation 1", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace notes" }).fill("Unsaved");
  const tab = page.getByRole("tab", { name: "Studio workstation 1 •", exact: true });
  await tab.focus(); await tab.press("Delete");
  await expect(page.getByRole("dialog", { name: "Close unsaved device?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(tab).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Workspace notes" })).toHaveValue("Unsaved");
  await tab.press("Delete");
  await page.getByRole("button", { name: "Discard and close", exact: true }).click();
  await expect(tab).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Studio workstation 2", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Studio workstation 2", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('#devices textarea')).toHaveCount(1);
});

test("data-driven labels and additions update while retaining existing panels", async ({ page }) => {
  await page.getByRole("tab", { name: "Studio workstation 1", exact: true }).click();
  await page.getByRole("textbox", { name: "Device name" }).fill("Reception kiosk");
  await expect(page.getByRole("tab", { name: "Reception kiosk •", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Reception kiosk", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open another device" }).click();
  await expect(page.getByRole("tab", { name: "Studio workstation 7", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#devices textarea")).toHaveCount(2);
});

test("automatic and manual keyboard navigation, disabled items and RTL", async ({ page }) => {
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  await overview.focus(); await overview.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Studio workstation 1", exact: true })).toBeFocused();
  await page.getByRole("checkbox", { name: "Activate with Enter or Space" }).check();
  const first = page.getByRole("tab", { name: "Studio workstation 1", exact: true });
  await first.focus(); await first.press("ArrowRight");
  const second = page.getByRole("tab", { name: "Studio workstation 2", exact: true });
  await expect(second).toBeFocused(); await expect(first).toHaveAttribute("aria-selected", "true");
  await second.press("Enter"); await expect(second).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => {
    const el = document.querySelector("#devices") as any;
    el.style.direction = "rtl";
    el.renderPanel = undefined;
    el.items = [{ value: "a", label: "Alpha" }, { value: "b", label: "Blocked", disabled: true }, { value: "c", label: "Charlie", closable: true }];
    el.value = "a";
    el.activation = "automatic";
    el.addEventListener("change", (e: CustomEvent) => { el.value = e.detail; });
  });
  const alpha = page.getByRole("tab", { name: "Alpha", exact: true });
  await alpha.focus(); await alpha.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Charlie", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Blocked", exact: true })).toBeDisabled();
});

test("narrow strips scroll without page overflow and reveal keyboard selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const viewport = page.locator("#devices .aster-tabs-viewport");
  const forward = page.getByRole("button", { name: "Scroll tabs forward", exact: true });
  await expect(forward).toBeVisible(); await forward.click();
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  const first = page.getByRole("tab", { name: "Overview", exact: true });
  await first.focus(); await first.press("End");
  const last = page.getByRole("tab", { name: "Studio workstation 6", exact: true });
  await expect(last).toBeFocused();
  const tabBox = (await last.boundingBox())!;
  const viewBox = (await viewport.boundingBox())!;
  expect(tabBox.x).toBeGreaterThanOrEqual(viewBox.x - 1);
  expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(viewBox.x + viewBox.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.setViewportSize({ width: 360, height: 844 });
  await expect.poll(async () => {
    const tab = (await last.boundingBox())!;
    const view = (await viewport.boundingBox())!;
    return tab.x >= view.x - 1 && tab.x + tab.width <= view.x + view.width + 1;
  }).toBe(true);
});

test("ARIA relationships, themes and reduced motion", async ({ page }) => {
  await page.getByRole("tab", { name: "Studio workstation 1", exact: true }).click();
  for (const theme of ["lamplight", "harbour"]) {
    for (const scheme of ["light", "dark"]) {
      await page.evaluate(({ theme, scheme }) => {
        (document.querySelector("#identity") as HTMLLinkElement).href = `../lib/themes/${theme}.css`;
        document.documentElement.dataset.scheme = scheme;
      }, { theme, scheme });
      const violations = (await new AxeBuilder({ page }).include(".workspace").analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical");
      expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(",")}`)).toEqual([]);
    }
  }
});

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("tabs, close and scrolling have 44px targets", async ({ page }) => {
    const first = page.getByRole("tab", { name: "Studio workstation 1", exact: true });
    await first.tap();
    const close = page.getByRole("button", { name: "Close Studio workstation 1", exact: true });
    for (const target of [first, close, page.getByRole("button", { name: "Scroll tabs forward", exact: true })]) {
      const box = (await target.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await close.tap(); await expect(first).toHaveCount(0);
  });
});
