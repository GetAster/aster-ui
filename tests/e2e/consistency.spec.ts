// M1 acceptance 3: after every action, every figure, badge, tab and row
// agrees with the server's data.
import { expect, test } from "@playwright/test";
import { expectConsistent, externalPatch, open, row, server } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  await open(page);
  await expectConsistent(page);
});

test("new project appears where it lives, and Undo takes it out", async ({ page }) => {
  await page.getByRole("button", { name: "New project" }).click();
  const created = row(page, "Untitled project");
  await expect(created).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".aster-toast")).toContainText("Created Untitled project");
  await expectConsistent(page);

  await page.locator(".aster-toast").getByRole("button", { name: "Undo" }).click();
  await expect(created).toHaveCount(0);
  await expectConsistent(page);
});

test("changing a project's state from its menu moves it between tabs, and Undo moves it back", async ({ page }) => {
  await row(page, "Brand refresh").click();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Pause" }).click();
  await expect(row(page, "Brand refresh")).toHaveCount(0);
  await expectConsistent(page);

  await page.getByRole("tab", { name: "Paused" }).click();
  await expect(row(page, "Brand refresh")).toHaveCount(1);
  await expectConsistent(page);

  await page.locator(".aster-toast").getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Brand refresh")).toHaveCount(0);
  await expectConsistent(page);
});

test("another user's edits reach every view", async ({ page }) => {
  await row(page, "Billing v2").click();
  await page.getByRole("button", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Add a task to it" }).click();
  await expect(row(page, "Billing v2").locator(".open")).toHaveText("18");
  await expectConsistent(page);

  await page.getByRole("button", { name: "Rename it" }).click();
  await expect(row(page, "Billing v2 (revised)")).toHaveCount(1);
  await expect(page.locator(".sidebar")).toContainText("Billing v2 (revised)");
  await expectConsistent(page);

  await row(page, "Billing v2 (revised)").click();
  await page.getByRole("button", { name: "Pause or resume it" }).click();
  await expect(row(page, "Billing v2 (revised)")).toHaveCount(0);
  await expectConsistent(page);
});

test("a failed save changes nothing and says so in place", async ({ page }) => {
  await row(page, "Spring launch").click();
  await page.getByRole("button", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Fail the next save" }).click();
  await row(page, "Spring launch").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive" }).click();
  const error = row(page, "Spring launch").locator(".row-note");
  await expect(error).toContainText("Couldn’t move Spring launch to Archived");
  await expect(error).toContainText("It’s still active.");
  expect((await server(page)).Projects.find((p) => p.name === "Spring launch")?.state).toBe("active");
  await expectConsistent(page);
});

test("editing a project that someone else renames is flagged as a conflict, not overwritten", async ({ page }) => {
  await row(page, "Brand refresh").click();
  await page.keyboard.press("F2");
  const input = page.getByRole("textbox", { name: "Project name" });
  await input.fill("Brand refresh 2027");
  await externalPatch(page, "Projects(2)", { name: "Brand refresh (revised)" });
  const note = page.locator(".row-note");
  await expect(note).toContainText("Someone else renamed this to “Brand refresh (revised)”");
  await expect(input).toHaveValue("Brand refresh 2027");

  await note.getByRole("button", { name: "Keep mine" }).click();
  await input.press("Enter");
  await expect(row(page, "Brand refresh 2027")).toHaveCount(1);
  expect((await server(page)).Projects.find((p) => p.id === 2)?.name).toBe("Brand refresh 2027");
  await expectConsistent(page);
});

test("a switch that fails to save goes back and explains", async ({ page }) => {
  await page.getByRole("button", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Fail the next save" }).click();
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Link settings" }).click();
  const downloads = page.getByRole("switch", { name: "Allow downloads" });
  await downloads.click();
  await expect(downloads).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("aster-switch .aster-error")).toContainText("Couldn’t turn this on");
  await downloads.click();
  await expect(downloads).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("aster-switch .aster-error")).toHaveCount(0);
});
