// The Reports page: one shared filter that a period, project health and a
// chart's bars contribute to, a slicer that shows and removes them, and lists
// that follow what applies to them.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW, settle } from "./fixtures.ts";

interface Entry {
  date: string;
  projectId: number;
  status: string;
  hours: string;
  billable: boolean;
}
interface Data {
  TimeEntries: Entry[];
  Projects: { id: number; health: string }[];
  Tasks: { projectId: number; done: boolean; due: string | null }[];
}

async function data(page: Page): Promise<Data> {
  return page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: never }> } } }).aster.mock.dump()).data);
}

async function axe(page: Page) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const slicer = (page: Page) => page.getByRole("toolbar", { name: "Filtered by" });
const total = (page: Page) => page.locator(".report-grid .aster-grid-total");
const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);

test.beforeEach(async ({ page }) => {
  await page.goto(`/?memory&debug&clients=2000&time=3000&now=${NOW}#reports`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-figure="Entries"]')).toHaveText("3,000");
});

test("period, health and a bar each contribute; the figures and entries follow all three, the tasks only health", async ({ page }) => {
  await page.getByRole("button", { name: "Last 30 days", exact: true }).click();
  await page.getByRole("group", { name: "Project health" }).getByRole("button", { name: "Behind" }).click();
  await page.getByRole("button", { name: /^Approved: / }).click();
  await expect(slicer(page).getByRole("button")).toHaveText(["Last 30 days", "Project health: Behind", "Status: Approved", "Clear all"]);
  await expect(page.getByRole("button", { name: "Last 30 days", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Approved: / })).toHaveAttribute("aria-pressed", "true");

  const d = await data(page);
  const behind = new Set(d.Projects.filter((p) => p.health === "behind").map((p) => p.id));
  const entries = d.TimeEntries.filter((t) => t.date >= "2026-09-08" && behind.has(t.projectId) && t.status === "approved");
  await expect(page.locator('[data-figure="Entries"]')).toHaveText(fmt(entries.length));
  await expect(total(page)).toHaveText(`${fmt(entries.length)} ${entries.length === 1 ? "row" : "rows"}`);
  await expect(page.locator('[data-figure="Hours"]')).toHaveText(fmt(Math.round(entries.reduce((n, t) => n + Number(t.hours), 0))));

  // The chart doesn't follow its own bar, so every status still shows.
  const recent = d.TimeEntries.filter((t) => t.date >= "2026-09-08" && behind.has(t.projectId));
  const draft = Math.round(recent.filter((t) => t.status === "draft").reduce((n, t) => n + Number(t.hours), 0));
  await expect(page.getByRole("button", { name: new RegExp(`^Draft: ${fmt(draft)} hours`) })).toBeVisible();

  const open = d.Tasks.filter((t) => !t.done && t.due !== null && behind.has(t.projectId));
  await expect(page.locator("#report-tasks-title")).toHaveText(`Open tasks ${fmt(open.length)}`);
  const tasks = page.getByRole("region", { name: /Open tasks/ });
  await expect(tasks.locator(".report-follows")).toHaveText(/Follows Project health: Behind\.\s*Doesn’t follow Last 30 days, Status: Approved/);

  // Pressing the bar again withdraws it.
  await page.getByRole("button", { name: /^Approved: / }).click();
  await expect(slicer(page).getByRole("button")).toHaveText(["Last 30 days", "Project health: Behind", "Clear all"]);
  await expect(page.locator('[data-figure="Entries"]')).toHaveText(fmt(recent.length));
});

test("a relative period stays relative: This week is the week of the page's clock", async ({ page }) => {
  await page.getByRole("button", { name: "This week", exact: true }).click();
  await expect(slicer(page).getByRole("button", { name: "Remove filter: This week" })).toBeVisible();
  const d = await data(page);
  const week = d.TimeEntries.filter((t) => t.date >= "2026-10-05");
  await expect(total(page)).toHaveText(`${fmt(week.length)} rows`);
  const dates = await page.locator(".report-grid [role=row] [role=gridcell]:first-child").allTextContents();
  expect(dates.length).toBeGreaterThan(0);
  for (const date of dates) expect(["5 Oct 2026", "6 Oct 2026", "7 Oct 2026"]).toContain(date.trim());
});

test("the slicer: one tab stop, arrows move, Delete removes and focus goes to the neighbour, all said", async ({ page }) => {
  await expect(page.locator(".aster-slicer-empty")).toHaveText("Nothing. Showing all time.");
  await page.getByRole("button", { name: "Last 90 days", exact: true }).click();
  await page.getByRole("group", { name: "Project health" }).getByRole("button", { name: "On track" }).click();
  await page.getByRole("button", { name: /^Draft: / }).click();
  const chips = slicer(page).getByRole("button");
  await expect(chips).toHaveText(["Last 90 days", "Project health: On track", "Status: Draft", "Clear all"]);
  await expect(chips.nth(0)).toHaveAccessibleName("Remove filter: Last 90 days");
  // One tab stop.
  await expect(slicer(page).locator('[tabindex="0"]')).toHaveCount(1);

  await chips.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(chips.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Clear all" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(chips.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Clear all" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(chips.nth(1)).toBeFocused();

  await page.keyboard.press("Delete");
  await expect(chips).toHaveText(["Last 90 days", "Status: Draft", "Clear all"]);
  await expect(slicer(page).getByRole("button", { name: "Remove filter: Status: Draft" })).toBeFocused();
  await expect(page.locator("p.aster-sr-only[aria-live]")).toHaveText("Removed filter: Project health: On track. 2 filters left.");
  // The health buttons agree with the chips.
  await expect(page.getByRole("group", { name: "Project health" }).getByRole("button", { name: "On track" })).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Enter");
  await expect(chips).toHaveText(["Last 90 days"]);
  await expect(slicer(page).getByRole("button", { name: "Remove filter: Last 90 days" })).toBeFocused();
  await expect(page.getByRole("button", { name: /^Draft: / })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".aster-slicer-empty")).toBeFocused();
  await expect(page.locator("p.aster-sr-only[aria-live]")).toHaveText("Removed filter: Last 90 days. No filters.");
  await expect(page.locator('[data-figure="Entries"]')).toHaveText("3,000");
});

test("Clear all removes every chip and leaves focus on the empty text", async ({ page }) => {
  await page.getByRole("button", { name: "Last 30 days", exact: true }).click();
  await page.getByRole("button", { name: /^Submitted: / }).click();
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.locator(".aster-slicer-empty")).toBeFocused();
  await expect(page.locator("p.aster-sr-only[aria-live]")).toHaveText("Cleared all filters.");
  await expect(page.locator('[data-figure="Entries"]')).toHaveText("3,000");
});

test("axe-clean with filters applied, light and dim", async ({ page }) => {
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Last 30 days", exact: true }).click();
  await page.getByRole("group", { name: "Project health" }).getByRole("button", { name: "Behind" }).click();
  await page.getByRole("button", { name: /^Approved: / }).click();
  await expect(slicer(page).getByRole("button")).toHaveCount(4);
  expect(await axe(page)).toEqual([]);
  await page.locator(".lamp-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  await page.waitForTimeout(600);
  expect(await axe(page)).toEqual([]);
});

test("in a short window the page scrolls by wheel to the time entries, which take a click", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  const grid = page.locator(".report-grid");
  await expect(grid).not.toBeInViewport({ ratio: 0.5 });
  const content = await page.locator(".content.report").boundingBox();
  await page.mouse.move(content!.x + content!.width / 2, content!.y + 40);
  await expect(async () => {
    await page.mouse.wheel(0, 400);
    await expect(grid).toBeInViewport({ ratio: 0.5, timeout: 200 });
  }).toPass();
  const row = grid.locator(".aster-grid-row[data-key]").first();
  await row.locator("[role=gridcell]").first().click();
  await expect(row).toHaveAttribute("aria-selected", "true");
});


test("screen filters survive reload and leaving the screen, including clearing", async ({ page }) => {
  const period = page.getByRole("button", { name: "This week", exact: true });
  await period.click();
  await page.getByRole("group", { name: "Project health" }).getByRole("button", { name: "Behind" }).click();
  await expect(total(page)).toHaveText(/rows?$/);
  const totalBefore = await total(page).textContent();
  await page.reload();
  await expect(period).toHaveAttribute("aria-pressed", "true");
  await expect(slicer(page).getByRole("button")).toHaveText(["This week", "Project health: Behind", "Clear all"]);
  await expect(total(page)).toHaveText(totalBefore!);
  await page.evaluate(() => { location.hash = "projects/active"; });
  await expect(page.locator("#projects-list")).toBeVisible();
  await page.evaluate(() => { location.hash = "reports"; });
  await expect(period).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.reload();
  await expect(page.locator(".aster-slicer-empty")).toBeVisible();
  await expect(page.locator('[data-figure="Entries"]')).toHaveText("3,000");
});
