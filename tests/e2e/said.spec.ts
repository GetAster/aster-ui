// What's drawn is also said: a changed field describes its change, a row
// marked for removal or new says so, for screen readers.
import { expect, test } from "@playwright/test";
import { NOW } from "./fixtures.ts";

test("a changed field is described as changed, with what it was; a new or removed row says so", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=0&time=0&now=${NOW}#model/4/answers`);
  const r = page.locator('.model-grid .aster-grid-row[data-key="[4]"]');
  const list = r.locator("aster-list-editor");
  await expect(list.locator(".aster-list-edit-row[data-id]")).toHaveCount(5);
  const label = list.locator('.aster-list-edit-row[data-id="[2]"]').getByRole("textbox", { name: "Label" });
  await label.fill("Limited company");
  await expect(label).toHaveValue("Limited company");
  await expect(label).toHaveAccessibleDescription("Changed, not saved yet; was Company");
  await list.getByRole("button", { name: "Remove trust", exact: true }).click();
  await expect(list.locator(".aster-list-edit-row[data-removing] .aster-list-edit-static").first()).toHaveText("To be removed: trust");
  await list.getByRole("button", { name: "Add answer" }).click();
  const added = list.locator(".aster-list-edit-row[data-new]");
  await expect(added.locator("[role=cell]").nth(1)).toContainText("New:");
});

test("an empty read-only reason still makes the list read-only, with no Add", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=0&time=0&now=${NOW}#model/4/answers`);
  const list = page.locator('.model-grid .aster-grid-row[data-key="[4]"] aster-list-editor');
  await expect(list.getByRole("button", { name: "Add answer" })).toBeVisible();
  await list.evaluate((el) => ((el as unknown as { readOnlyReason: string }).readOnlyReason = ""));
  await expect(list.getByRole("button", { name: "Add answer" })).toHaveCount(0);
  await expect(list.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await expect(list.getByRole("textbox", { name: "Label" })).toHaveCount(0);
  await list.evaluate((el) => ((el as unknown as { readOnlyReason: string | undefined }).readOnlyReason = undefined));
  await expect(list.getByRole("button", { name: "Add answer" })).toBeVisible();
});
