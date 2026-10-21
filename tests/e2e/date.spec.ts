// M4 acceptance 3: the APG date-picker dialog, by keyboard; typed dates
// still work; the same in a form's list, a grid editor and a filter.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

async function tasks(page: Page) {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#project/1`);
  await page.getByRole("tab", { name: /Tasks/ }).click();
  return page.getByRole("textbox", { name: "Due" }).first();
}

test("the calendar by keyboard: arrows, Page Up/Down, Home/End, Enter; Escape returns focus", async ({ page }) => {
  const due = await tasks(page);
  const button = page.getByRole("button", { name: "Choose Due" }).first();
  await due.focus();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Choose Due" });
  await expect(dialog).toBeVisible();
  // An empty field opens on today, the clock's 7 October 2026.
  await expect(dialog.getByRole("heading")).toHaveText("October 2026");
  await expect(dialog.getByRole("gridcell", { name: "Wednesday, 7 October 2026" })).toBeFocused();
  await expect(dialog.getByRole("gridcell", { name: "Wednesday, 7 October 2026" })).toHaveAttribute("aria-current", "date");
  for (const [key, name] of [
    ["ArrowRight", "Thursday, 8 October 2026"],
    ["ArrowDown", "Thursday, 15 October 2026"],
    ["Home", "Monday, 12 October 2026"],
    ["End", "Sunday, 18 October 2026"],
    ["PageDown", "Wednesday, 18 November 2026"],
    ["Shift+PageUp", "Tuesday, 18 November 2025"],
    ["PageUp", "Saturday, 18 October 2025"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(dialog.getByRole("gridcell", { name })).toBeFocused();
  }
  await expect(dialog.getByRole("heading")).toHaveText("October 2025");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(due).toHaveValue("");

  await page.keyboard.press("Space");
  await expect(dialog.getByRole("gridcell", { name: "Wednesday, 7 October 2026" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(due).toHaveValue("8 Oct 2026");
  await expect(due).toBeFocused();
  // Opening again starts on the chosen day, marked selected.
  await button.click();
  await expect(dialog.getByRole("gridcell", { name: "Thursday, 8 October 2026" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("gridcell", { name: "Thursday, 8 October 2026" })).toBeFocused();
});

test("Tab stays inside the dialog; buttons turn the page; a press outside closes it", async ({ page }) => {
  await tasks(page);
  await page.getByRole("button", { name: "Choose Due" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Choose Due" });
  await expect(dialog.getByRole("gridcell", { name: "Wednesday, 7 October 2026" })).toBeFocused();
  const names: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    names.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""));
  }
  expect(names).toEqual(["Previous year", "Previous month", "Next month", "Next year", "Wednesday, 7 October 2026"]);
  await dialog.getByRole("button", { name: "Next month" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("November 2026");
  await dialog.getByRole("button", { name: "Previous year" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("November 2025");
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});

test("typed dates in the forms people write them, shown as dates; nonsense is an error in words", async ({ page }) => {
  const due = await tasks(page);
  await due.fill("9/10/2026");
  await due.blur();
  await expect(due).toHaveValue("9 Oct 2026");
  await due.fill("Oct 12");
  await due.blur();
  await expect(due).toHaveValue("12 Oct 2026");
  await due.fill("someday");
  await due.blur();
  await expect(due).toHaveValue("someday");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(due).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("must be a date, like 7 Oct 2026.")).toBeVisible();
});

test("in a grid editor: the calendar opens from the cell, picks a date, and Enter saves the row", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#time`);
  const key = await page.locator(".aster-grid-row[data-key]").filter({ hasNotText: "Approved" }).first().getAttribute("data-key");
  const row = page.locator(`.aster-grid-row[data-key="${key}"]`);
  await row.locator("[aria-colindex='1']").dblclick();
  const date = row.getByRole("textbox", { name: "Date" });
  await expect(date).toBeVisible();
  const before = await date.inputValue();
  await row.getByRole("button", { name: "Choose Date" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose Date" });
  await expect(dialog.locator("[role=gridcell][tabindex='0']")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(date).not.toHaveValue(before);
  // The calendar closing doesn't end the row's edit; Enter in the field does, and saves.
  await expect(row).toHaveAttribute("data-editing", "");
  const chosen = await date.inputValue();
  await date.press("Enter");
  await expect(page.locator(".aster-grid-row[data-editing]")).toHaveCount(0);
  await expect(page.locator(".aster-grid-row[data-key]").filter({ hasText: chosen }).first()).toBeVisible();
});

test("in a filter: the calendar keeps a typed operator, and typed dates filter too", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=2000&time=400&now=${NOW}#time`);
  await page.getByRole("button", { name: "Filters" }).click();
  const filter = page.getByRole("textbox", { name: "Filter Date" });
  await filter.fill(">=");
  await page.getByRole("button", { name: "Choose a date to filter Date" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a date to filter Date" });
  await expect(dialog.getByRole("gridcell", { name: "Wednesday, 7 October 2026" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(filter).toHaveValue(">=2026-10-06");
  await expect(page.getByRole("button", { name: "Choose a date to filter Date" })).toBeFocused();
  const dates = page.locator(".aster-grid-row[data-key] [aria-colindex='1']");
  await expect(dates.first()).toBeVisible();
  await expect
    .poll(async () => (await dates.allTextContents()).every((t) => ["6 Oct 2026", "7 Oct 2026", "8 Oct 2026"].includes(t.trim())))
    .toBe(true);
  await filter.fill("6 oct");
  await expect.poll(async () => new Set((await dates.allTextContents()).map((t) => t.trim()))).toEqual(new Set(["6 Oct 2026"]));
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: the calendar open, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await tasks(page);
    await page.getByRole("button", { name: "Choose Due" }).nth(8).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page }).include(".aster-calendar").analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}
