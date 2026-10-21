import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/playground/foundations.html");
  const picker = page.locator("#folder-picker");
  await expect(picker.getByRole("button", { name: "Select Projects", exact: true })).toBeVisible();
  return picker;
}

test("selecting a folder is separate from opening it; choices survive history", async ({ page }) => {
  const picker = await open(page);
  await picker.getByRole("button", { name: "Select Projects", exact: true }).click();
  await expect(picker.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).folderPickerDemo.requests)).toEqual(["workspace"]);
  await picker.getByRole("button", { name: "Open Projects", exact: true }).click();
  await expect(picker.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Select Launch notes.md", exact: true }).click();
  await picker.getByRole("button", { name: "Back in folder history" }).click();
  await expect(picker.getByRole("button", { name: "Select Projects", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("button", { name: "Open Projects", exact: true })).toBeFocused();
  await picker.getByRole("button", { name: "Forward in folder history" }).click();
  await expect(picker.getByRole("button", { name: "Select Launch notes.md", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).folderPickerDemo.selected)).toEqual(["projects", "launch"]);
  await picker.getByRole("button", { name: "Use selected sources" }).click();
  await expect(picker.locator(".folder-confirmation")).toHaveText("2 sources are ready to use in this example.");
  await picker.getByRole("button", { name: "Remove Projects", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Remove Projects", exact: true })).toHaveCount(0);
});

test("failed loads retain confirmed location and selection; retry and empty folders work", async ({ page }) => {
  const picker = await open(page);
  await picker.getByRole("button", { name: "Select Welcome.md", exact: true }).click();
  await picker.getByRole("button", { name: "Fail next folder request" }).click();
  await picker.getByRole("button", { name: "Open Archive", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("Your current location and choices are unchanged");
  await expect(picker.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Remove Welcome.md" })).toBeVisible();
  await picker.getByRole("button", { name: "Retry opening folder" }).click();
  await expect(picker.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expect(picker.getByText("This folder is empty.", { exact: false })).toBeVisible();
  await picker.getByRole("button", { name: "Choose this folder" }).click();
  expect(await page.evaluate(() => (window as any).folderPickerDemo.selected)).toEqual(["welcome", "archive"]);
});

test("a later folder request wins and confirmed rows remain while loading", async ({ page }) => {
  const picker = await open(page);
  await page.evaluate(() => (window as any).folderPickerDemo.delayMs = 600);
  await picker.getByRole("button", { name: "Open Projects", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Select Welcome.md", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Open Shared", exact: true }).click();
  await expect(picker.getByRole("heading", { name: "Shared", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Select Installer.exe", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).folderPickerDemo.path)).toEqual(["workspace", "shared"]);
  await picker.getByRole("button", { name: "Back in folder history" }).click();
  await expect(picker.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Back in folder history" })).toBeDisabled();
});

test("folder-only policy preserves existing choices for explicit correction", async ({ page }) => {
  const picker = await open(page);
  await picker.getByRole("button", { name: "Select Welcome.md", exact: true }).click();
  await picker.getByLabel("Choose folders only").check();
  await expect(picker.getByRole("button", { name: "Use selected sources" })).toBeDisabled();
  await expect(picker.locator(".folder-confirmation")).toContainText("Remove selected files");
  await picker.getByRole("button", { name: "Remove Welcome.md", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Select Welcome.md", exact: true })).toBeDisabled();
  await picker.getByRole("button", { name: "Select Projects", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Use selected sources" })).toBeEnabled();
});

test("keyboard selection, reduced motion, narrow layout and accessibility", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const picker = await open(page);
  const choose = picker.getByRole("button", { name: "Select Projects", exact: true });
  await choose.focus(); await choose.press("Space");
  await expect(choose).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "Open Projects", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("heading", { name: "Projects", exact: true })).toBeFocused();
  expect(await picker.locator(".aster-hierarchy-level:not([hidden])").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const { violations } = await new AxeBuilder({ page }).include("#folder-picker").analyze();
  expect(violations).toEqual([]);
});

test("folder history restores the long listing's scroll and focused choice", async ({ page }) => {
  const picker = await open(page);
  await picker.getByRole("button", { name: "Open Shared", exact: true }).click();
  await picker.getByRole("button", { name: "Open Reviews", exact: true }).click();
  const choice = picker.getByRole("button", { name: "Select Review 20.md", exact: true });
  await choice.click();
  const list = picker.locator('[data-folder-list="reviews"]');
  const top = await list.evaluate(el => el.scrollTop);
  expect(top).toBeGreaterThan(0);
  await picker.getByRole("button", { name: "Back in folder history" }).click();
  await expect(picker.getByRole("heading", { name: "Shared", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Forward in folder history" }).click();
  await expect(choice).toBeFocused();
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(top);
  await expect(choice).toHaveAttribute("aria-pressed", "true");
});

test("touch can choose and open independently with 44px controls", async ({ browser, browserName, baseURL }) => {
  test.skip(browserName === "firefox", "Firefox does not support touch context emulation");
  const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage(), picker = await open(page);
    const openFolder = picker.getByRole("button", { name: "Open Projects", exact: true });
    const box = await openFolder.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    await picker.getByRole("button", { name: "Select Projects", exact: true }).tap();
    await openFolder.tap();
    await expect(picker.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Remove Projects", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
