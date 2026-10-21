// M5: the drill-down navigator: moving a task through it, refusing a move
// into its own subtree, and the Tasks page at phone width.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

interface Task { id: number; projectId: number; parentId: number | null; title: string }
const all = async (page: Page): Promise<Task[]> =>
  page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { Tasks: Task[] } }> } } }).aster.mock.dump()).data.Tasks);
const row = (page: Page, id: number) => page.locator(`.aster-grid-row[data-key="[${id}]"]`);

async function tasks(page: Page) {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#tasks`);
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
}

test("Move to… drills down a level, moves the task under the chosen one, and Undo puts it back", async ({ page }) => {
  await tasks(page);
  const data = await all(page);
  const project1 = data.filter((t) => t.projectId === 1);
  const target = project1.find((t) => t.parentId === null && data.some((c) => c.parentId === t.id))!;
  const into = data.find((c) => c.parentId === target.id)!;
  const moving = project1.find((t) => t.parentId === null && t.id !== target.id && !data.some((c) => c.parentId === t.id))!;
  const r = row(page, moving.id);
  await r.hover();
  await r.locator(".aster-grid-controls button[aria-label='Move to…']").click();
  const dialog = page.getByRole("dialog", { name: `Move ${moving.title}` });
  await expect(dialog.locator(".aster-drill-heading")).toBeFocused();
  await expect(dialog.locator(".aster-drill-heading")).toHaveText("Top level");
  await dialog.getByRole("button", { name: `Open ${target.title}` }).click();
  await expect(dialog.locator(".aster-drill-heading")).toHaveText(target.title);
  await expect(dialog.locator(".aster-drill-heading")).toBeFocused();
  await expect(dialog.getByRole("navigation", { name: "Path" }).getByRole("button")).toHaveText(["Top level", target.title]);
  // Back and forward between levels.
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.locator(".aster-drill-heading")).toHaveText("Top level");
  await dialog.getByRole("button", { name: "Forward" }).click();
  await expect(dialog.locator(".aster-drill-heading")).toHaveText(target.title);
  await dialog.getByRole("button", { name: `Move under ${into.title}` }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(into.id);
  await expect(row(page, moving.id)).toHaveAttribute("aria-level", "3");
  await page.locator(".aster-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(null);
  await expect(row(page, moving.id)).toHaveAttribute("aria-level", "1");
});

test("a task can be opened but not chosen under itself or its subtasks, and says why", async ({ page }) => {
  await tasks(page);
  const data = await all(page);
  const parent = data.find((t) => t.parentId === null && t.projectId === 1 && data.some((c) => c.parentId === t.id))!;
  const child = data.find((c) => c.parentId === parent.id)!;
  const r = row(page, parent.id);
  await r.hover();
  await r.locator(".aster-grid-controls button[aria-label='Move to…']").click();
  const dialog = page.getByRole("dialog", { name: `Move ${parent.title}` });
  const self = dialog.getByRole("button", { name: `Move under ${parent.title}` });
  await expect(self).toHaveAttribute("aria-disabled", "true");
  await expect(self).toHaveAttribute("title", "A task can’t move under itself or one of its own subtasks.");
  await dialog.getByRole("button", { name: `Open ${parent.title}` }).click();
  await expect(dialog.getByRole("button", { name: `Move under ${child.title}` })).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.locator(".aster-drill-heading")).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(dialog.locator(".aster-drill-heading")).toHaveText("Top level");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the tree is a navigator; choosing a task opens its editor; saving keeps the change", async ({ page }) => {
    await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#tasks`);
    await expect(page.locator(".aster-drill-row").first()).toBeVisible();
    const data = await all(page);
    const parent = data.find((t) => t.parentId === null && data.some((c) => c.parentId === t.id))!;
    const child = data.find((c) => c.parentId === parent.id)!;
    await expect(page.locator("aster-grid")).toHaveCount(0);
    await page.getByRole("button", { name: `Open ${parent.title}` }).click();
    await expect(page.locator(".aster-drill-heading")).toHaveText(parent.title);
    await page.getByRole("button", { name: `Edit ${child.title}` }).click();
    const editor = page.getByRole("region", { name: "Task", exact: true });
    const title = editor.getByRole("textbox", { name: "Task", exact: true });
    await expect(title).toHaveValue(child.title);
    await title.fill(`${child.title} (phone)`);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await all(page)).find((t) => t.id === child.id)!.title).toBe(`${child.title} (phone)`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: the move dialog a level down, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await tasks(page);
    const r = page.locator(".aster-grid-row[data-key]").nth(4);
    await r.hover();
    await r.locator(".aster-grid-controls button[aria-label='Move to…']").click();
    await page.getByRole("dialog").getByRole("button", { name: /^Open / }).first().click();
    await expect(page.getByRole("dialog").locator(".aster-drill-row").first()).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}
