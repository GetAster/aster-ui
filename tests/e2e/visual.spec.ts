// Screenshot baselines per engine. A person accepts a baseline before it is
// committed (`playwright test visual --update-snapshots`); unreviewed
// differences fail.
import { expect, test, type Page } from "@playwright/test";
import data from "../../fixtures/aster/data.json" with { type: "json" };
import { NOW, open, settle } from "./fixtures.ts";

async function timePage(page: Page): Promise<void> {
  await page.goto(`/?memory&debug&clients=2000&time=3000&now=${NOW}#time`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
}

const shots = [
  { name: "projects-light", width: 1280, height: 820, dim: false, share: false },
  { name: "projects-dim", width: 1280, height: 820, dim: true, share: false },
  { name: "projects-phone", width: 390, height: 844, dim: false, share: false },
  { name: "share-dialog", width: 1280, height: 820, dim: false, share: true },
  { name: "projects-harbour", width: 1280, height: 820, dim: false, share: false, identity: "harbour" },
  { name: "projects-harbour-dark", width: 1280, height: 820, dim: true, share: true, identity: "harbour" },
];

const pages = [
  { name: "project-details", hash: "#project/2", ready: "aster-form aster-select", width: 1280, height: 820, tasks: false },
  // Realistic volume: with few time entries, most assignees would be outside the project's team.
  { name: "project-tasks", hash: "#project/2", ready: "aster-form aster-select", width: 1280, height: 820, tasks: true, time: 20000 },
  { name: "people", hash: "#people/2", ready: ".person-detail aster-form", width: 1280, height: 820, tasks: false },
  { name: "people-phone", hash: "#people", ready: ".people-list [role=option]", width: 390, height: 844, tasks: false },
];

for (const shot of pages) {
  test(shot.name, async ({ page }) => {
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await open(page, "#projects/active", "time" in shot ? `&time=${shot.time}` : "");
    await page.evaluate((h) => (location.hash = h), shot.hash);
    await expect(page.locator(shot.ready).first()).toBeVisible();
    if (shot.tasks) await page.getByRole("tab", { name: /Tasks/ }).click();
    await settle(page);
    await expect(page).toHaveScreenshot(`${shot.name}.png`, { caret: "hide" });
  });
}

test("time-grid", async ({ page }) => {
  await timePage(page);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.locator(".aster-grid-row[data-key]", { hasText: "Draft" }).first().locator("[aria-colindex='4']").dblclick();
  await settle(page);
  await expect(page).toHaveScreenshot("time-grid.png", { caret: "hide" });
});

test("time-grouped", async ({ page }) => {
  await timePage(page);
  await page.locator('.aster-grid-header[data-field="status"]').hover();
  await page.locator('.aster-grid-header[data-field="status"] .aster-grid-header-menu').click();
  await page.getByRole("menuitemcheckbox", { name: "Group by Status" }).click();
  await page.locator(".aster-grid-group", { hasText: "Draft" }).locator("[role=gridcell]").click();
  await expect(page.locator(".aster-grid-row[aria-level='2']:not([data-placeholder])").first()).toBeVisible();
  await page.mouse.move(0, 0);
  await settle(page);
  await expect(page).toHaveScreenshot("time-grouped.png", { caret: "hide" });
});

for (const shot of shots) {
  test(shot.name, async ({ page }) => {
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await open(page, "#projects/active", "identity" in shot ? `&identity=${shot.identity}` : "");
    if (shot.dim) await page.locator(".lamp-switch").click();
    if (shot.share) await page.getByRole("button", { name: "Share" }).click();
    await settle(page);
    await expect(page).toHaveScreenshot(`${shot.name}.png`, { caret: "hide" });
  });
}

test("time-phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await timePage(page);
  await settle(page);
  await expect(page).toHaveScreenshot("time-phone.png", { caret: "hide" });
});

test("tasks-tree", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  // The first task of Spring launch with a subtask of its own, opened down to that level.
  const tasks = data.Tasks as { id: number; projectId: number; parentId: number | null }[];
  const parent = (t: { parentId: number | null }) => tasks.find((p) => p.id === t.parentId);
  const third = tasks.find((t) => t.projectId === 1 && parent(t) && parent(parent(t)!))!;
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#tasks/${third.id}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(`.aster-grid-row[data-key="[${third.id}]"]`)).toHaveAttribute("aria-level", "3");
  await page.mouse.move(0, 0);
  await settle(page);
  await expect(page).toHaveScreenshot("tasks-tree.png", { caret: "hide" });
});
