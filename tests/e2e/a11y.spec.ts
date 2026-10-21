// M1 acceptance 6: axe-clean in every state a person can reach.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { open, row, settle } from "./fixtures.ts";

async function axe(page: Page) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test.beforeEach(async ({ page }) => open(page));

test("projects screen, light and dimmed", async ({ page }) => {
  expect(await axe(page)).toEqual([]);
  await page.locator(".lamp-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  await page.waitForTimeout(600);
  expect(await axe(page)).toEqual([]);
});

test("share dialog, both views, with an error showing", async ({ page }) => {
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("textbox", { name: "Invite by name or email" }).press("Enter");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Link settings" }).click();
  expect(await axe(page)).toEqual([]);
});

test("row menu and an empty tab", async ({ page }) => {
  await row(page, "Spring launch").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Home" }).click();
  expect(await axe(page)).toEqual([]);
});

test("the Harbour identity, light and dim", async ({ page }) => {
  await open(page, "#projects/active", "&identity=harbour");
  expect(await axe(page)).toEqual([]);
  await page.locator(".lamp-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("textbox", { name: "Invite by name or email" }).press("Enter");
  expect(await axe(page)).toEqual([]);
});

async function goTo(page: Page, hash: string, ready: string) {
  await page.evaluate((h) => (location.hash = h), hash);
  await expect(page.locator(ready).first()).toBeVisible();
}

test("project page: details with an error, tasks with pending rows, light and dimmed", async ({ page }) => {
  await goTo(page, "#project/2", "aster-form aster-select");
  await page.getByRole("textbox", { name: "Project", exact: true }).fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Project", exact: true })).toHaveAttribute("aria-invalid", "true");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("combobox", { name: "Status" }).click();
  await expect(page.getByRole("listbox", { name: "Status" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("button", { name: /^Remove / }).first().click();
  expect(await axe(page)).toEqual([]);
  await page.locator(".lamp-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  await page.waitForTimeout(600);
  expect(await axe(page)).toEqual([]);
});

test("an archived project, read-only with its reasons", async ({ page }) => {
  await page.getByRole("tab", { name: "Archived" }).click();
  await row(page, (await page.locator("#projects-list .name").first().textContent())!).dblclick();
  await expect(page.locator(".aster-hint").first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("people page with an open picker and a changed field, in Harbour dim", async ({ page }) => {
  await open(page, "#projects/active", "&identity=harbour");
  await page.locator(".lamp-switch").click();
  await goTo(page, "#people/3", ".person-detail aster-form");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("alan@xerox.example");
  expect(await axe(page)).toEqual([]);
  await goTo(page, "#project/1", "aster-form aster-picker");
  await page.getByRole("combobox", { name: "Lead" }).click();
  await expect(page.getByRole("listbox", { name: "Lead" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("phone: the tab bar reaches every page and the lamp, and is axe-clean", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).toBeHidden();
  const tabs = page.locator(".tabbar");
  await expect(tabs.getByRole("link", { name: /Projects/ })).toHaveAttribute("aria-current", "page");
  expect(await axe(page)).toEqual([]);
  await tabs.getByRole("link", { name: "People" }).click();
  await expect(page.locator(".people-list")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.locator(".tasks-phone aster-tree-navigator")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await axe(page)).toEqual([]);
  await tabs.getByRole("button", { name: /Dim/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  await page.waitForTimeout(600);
  expect(await axe(page)).toEqual([]);
  const box = (await tabs.boundingBox())!;
  const content = (await page.locator(".app").boundingBox())!;
  expect(content.y + content.height).toBeLessThanOrEqual(box.y);
});
