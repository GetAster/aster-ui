// M4 acceptance 5: the playground runs plain JavaScript against aster-ui.js
// from the static site, with no build step.
import { expect, test, type Page } from "@playwright/test";

function result(page: Page) {
  return page.frameLocator("#result");
}

test("the first example binds a grid, a form and a picker to the same data", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/playground/");
  const out = result(page);
  const row = out.locator(".aster-grid-row[data-key]").filter({ hasText: "Atlas audit" });
  await expect(row).toBeVisible();
  await row.click();
  const name = out.getByRole("textbox", { name: "Project" });
  await expect(name).toHaveValue("Atlas audit");
  await name.fill("Atlas audit, phase two");
  await out.getByRole("combobox", { name: "Lead" }).click();
  await out.getByRole("option", { name: "Alan Kay" }).click();
  await out.getByRole("button", { name: "Save" }).click();
  const saved = out.locator(".aster-grid-row[data-key]").filter({ hasText: "Atlas audit, phase two" });
  await expect(saved).toContainText("Alan Kay");
  expect(errors).toEqual([]);
});

test("every example runs, and edited code runs as written", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/playground/");
  const pick = page.getByRole("combobox", { name: "Example" });
  await pick.selectOption({ label: "Page rules" });
  const out = result(page);
  await expect(out.getByRole("combobox", { name: "Status" })).toBeVisible();
  await expect(out.getByText("Days behind")).toBeVisible();
  await out.getByRole("combobox", { name: "Status" }).click();
  await out.getByRole("option", { name: "On track" }).click();
  await expect(out.getByText("Days behind")).toHaveCount(0);

  await pick.selectOption({ label: "Pickers: search, columns, chips" });
  const reviewers = out.getByRole("combobox", { name: "Reviewers" });
  await reviewers.click();
  await out.getByRole("option", { name: /Grace Hopper/ }).click();
  await reviewers.press("Escape");
  await expect(out.locator("#chosen")).toHaveText("2");

  const source = page.getByRole("textbox", { name: "Code" });
  // Into the editor first: with focus in the result's frame, Firefox doesn't take a fill.
  await source.click();
  await source.fill(`import { html, render } from "../lib/aster-ui.js";\nrender(html\`<aster-button .label=\${"Hello from the playground"}></aster-button>\`, document.querySelector("#out"));`);
  await page.getByRole("button", { name: "Run" }).click();
  await expect(out.getByRole("button", { name: "Hello from the playground" })).toBeVisible();
  expect(errors).toEqual([]);
});
