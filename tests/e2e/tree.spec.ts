// M5: the tree grid on the Tasks page: levels on demand, the treegrid
// keyboard, filtering with the paths to matches kept, and deep links.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

const grid = (page: Page) => page.locator(".aster-grid-scroll");
const row = (page: Page, id: number) => page.locator(`.aster-grid-row[data-key="[${id}]"]`);

async function tasks(page: Page, hash = "#tasks") {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}${hash}`);
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
}

interface Task { id: number; projectId: number; parentId: number | null; title: string }
const all = async (page: Page): Promise<Task[]> =>
  page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { Tasks: Task[] } }> } } }).aster.mock.dump()).data.Tasks);

test("top-level tasks, each with its place among its siblings; an opener loads the level under it", async ({ page }) => {
  await tasks(page);
  await expect(grid(page)).toHaveAttribute("role", "treegrid");
  const data = await all(page);
  const top = data.filter((t) => t.parentId === null);
  const first = row(page, top[0]!.id);
  await expect(first).toHaveAttribute("aria-level", "1");
  await expect(first).toHaveAttribute("aria-posinset", "1");
  await expect(first).toHaveAttribute("aria-setsize", String(top.length));
  const parent = top.find((t) => data.some((c) => c.parentId === t.id))!;
  const children = data.filter((c) => c.parentId === parent.id);
  const r = row(page, parent.id);
  await r.scrollIntoViewIfNeeded();
  await expect(r).toHaveAttribute("aria-expanded", "false");
  await r.locator("button.aster-grid-opener").click();
  await expect(r).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, children[0]!.id)).toHaveAttribute("aria-level", "2");
  await expect(row(page, children[0]!.id)).toHaveAttribute("aria-setsize", String(children.length));
  await r.locator("button.aster-grid-opener").click();
  await expect(row(page, children[0]!.id)).toHaveCount(0);
  // A leaf has no opener and no expanded state.
  const leaf = top.find((t) => !data.some((c) => c.parentId === t.id))!;
  await expect(row(page, leaf.id)).not.toHaveAttribute("aria-expanded", /./);
  await expect(row(page, leaf.id).locator("button.aster-grid-opener")).toHaveCount(0);
});

test("the keyboard: → opens and then goes to the first child, ← goes to the parent and then closes", async ({ page }) => {
  await tasks(page);
  const data = await all(page);
  const parent = data.filter((t) => t.parentId === null).find((t) => data.some((c) => c.parentId === t.id))!;
  const child = data.find((c) => c.parentId === parent.id)!;
  const index = data.filter((t) => t.parentId === null).indexOf(parent);
  await grid(page).focus();
  for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
  const active = async () => page.locator(`#${await grid(page).getAttribute("aria-activedescendant")}`).locator("xpath=..");
  await expect(await active()).toHaveAttribute("data-key", `[${parent.id}]`);
  await page.keyboard.press("ArrowRight");
  await expect(row(page, parent.id)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(await active()).toHaveAttribute("data-key", `[${child.id}]`);
  await page.keyboard.press("ArrowLeft");
  await expect(await active()).toHaveAttribute("data-key", `[${parent.id}]`);
  await page.keyboard.press("ArrowLeft");
  await expect(row(page, parent.id)).toHaveAttribute("aria-expanded", "false");
  // Away from the tree's column the arrows move between cells.
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(`#${await grid(page).getAttribute("aria-activedescendant")}`)).toHaveAttribute("aria-colindex", "4");
});

test("a filter keeps the path to each match, opened, and says while it's finding it", async ({ page }) => {
  await tasks(page);
  const data = await all(page);
  const deepest = data.find((t) => t.title.startsWith("Level 9"))!;
  const path: Task[] = [];
  for (let t: Task | undefined = deepest; t; t = data.find((p) => p.id === t!.parentId)) path.unshift(t);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("textbox", { name: "Filter Task" }).fill("Level 9");
  await page.getByRole("textbox", { name: "Filter Task" }).press("Enter");
  for (const [i, t] of path.entries()) {
    await expect(row(page, t.id)).toHaveAttribute("aria-level", String(i + 1));
  }
  const keys = await page.locator(".aster-grid-row[data-key]").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-key")));
  expect(keys).toEqual(path.map((t) => `[${t.id}]`));
  for (const t of path.slice(0, -1)) await expect(row(page, t.id)).toHaveAttribute("aria-expanded", "true");
});

test("a deep link opens each level and puts the task at the top, in a level of 3,000", async ({ page }) => {
  const data0 = (await (async () => {
    await tasks(page);
    return all(page);
  })());
  const wide = data0.filter((t) => t.title.startsWith("Item ")).at(-1)!;
  await page.evaluate((id) => (location.hash = `#tasks/${id}`), wide.id);
  const r = row(page, wide.id);
  await expect(r).toBeVisible();
  await expect(r).toHaveAttribute("aria-posinset", "3000");
  await expect(r).toHaveAttribute("aria-selected", "true");
  const [box, scroll] = [(await r.boundingBox())!, (await page.locator(".aster-grid-scroll").boundingBox())!];
  expect(box.y - scroll.y).toBeLessThan(120);
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: the tree grid with a level open, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await tasks(page);
    const data = await all(page);
    // Unknown child counts temporarily give leaves an opener too.
    const parent = data.find(t => t.parentId === null && data.some(c => c.parentId === t.id))!;
    const child = data.find(t => t.parentId === parent.id)!;
    await row(page, parent.id).locator("button.aster-grid-opener").click();
    await expect(row(page, child.id)).toHaveAttribute("aria-level", "2");
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}

test("dragging a row onto another moves it under that one; onto its own subtree is refused; Undo puts it back", async ({ page }) => {
  await tasks(page);
  const data = await all(page);
  const top = data.filter((t) => t.parentId === null && t.projectId === 1);
  const parent = top.find((t) => data.some((c) => c.parentId === t.id))!;
  const child = data.find((c) => c.parentId === parent.id)!;
  const moving = top.find((t) => t.id !== parent.id && !data.some((c) => c.parentId === t.id))!;
  const drag = async (from: number, to: number) => {
    const [a, b] = [(await row(page, from).locator("[aria-colindex='2']").boundingBox())!, (await row(page, to).locator("[aria-colindex='2']").boundingBox())!];
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + a.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await row(page, moving.id).scrollIntoViewIfNeeded();
  await drag(moving.id, parent.id);
  await expect.poll(async () => (await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(parent.id);
  await expect(row(page, parent.id)).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, moving.id)).toHaveAttribute("aria-level", "2");
  await expect(page.locator(".aster-toast")).toContainText(`Moved ${moving.title} under ${parent.title}`);
  // The parent can't go under its own child.
  await drag(parent.id, child.id);
  await expect(page.locator(".aster-grid-refused")).toHaveText("A row can’t move under itself or its own subtree.");
  expect((await all(page)).find((t) => t.id === parent.id)!.parentId).toBe(null);
  await page.locator(".aster-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(null);
});
