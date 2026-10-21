// M5: floating row controls and expansion editors on the Tasks page, after
// the CAVR scenario in requirements/grid-row-controls-and-expansion.md §7.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

interface Task { id: number; parentId: number | null; title: string; due: string | null; done: boolean }
const all = async (page: Page): Promise<Task[]> =>
  page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { Tasks: Task[] } }> } } }).aster.mock.dump()).data.Tasks);
const external = (page: Page, method: string, url: string, body?: object) =>
  page.evaluate(async ([method, url, body]) => {
    const { mock } = (globalThis as unknown as { aster: { mock: { external(r: object): Promise<{ status: number }> } } }).aster;
    return (await mock.external({ method, url, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).status;
  }, [method, url, body] as const);

async function tasks(page: Page) {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#tasks`);
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
}
const row = (page: Page, id: number) => page.locator(`.aster-grid-row[data-key="[${id}]"]`);
const controls = (r: Locator) => r.locator(".aster-grid-controls button");

/** The first top-level task with at least two subtasks. */
async function parentWithSubtasks(page: Page): Promise<{ parent: Task; children: Task[] }> {
  const data = await all(page);
  const parent = data.filter((t) => t.parentId === null).find((t) => data.filter((c) => c.parentId === t.id).length >= 2)!;
  return { parent, children: data.filter((c) => c.parentId === parent.id) };
}

test("controls show on hover, focus and selection, and follow the row's state", async ({ page }) => {
  await tasks(page);
  const { parent } = await parentWithSubtasks(page);
  const r = row(page, parent.id);
  await r.scrollIntoViewIfNeeded();
  const box = r.locator(".aster-grid-controls");
  await expect(box).toHaveCSS("opacity", "0");
  await r.hover();
  await expect(box).toHaveCSS("opacity", "1");
  await expect(controls(r).nth(0)).toHaveAccessibleName("Edit");
  await expect(controls(r).nth(1)).toHaveAccessibleName("Add subtask");
  await expect(controls(r).nth(2)).toHaveAccessibleName("Move to…");
  await expect(controls(r).nth(3)).toHaveAccessibleName("Remove");
  await controls(r).nth(0).click();
  await expect(controls(r)).toHaveCount(2);
  await expect(controls(r).nth(0)).toHaveAccessibleName("Save");
  await expect(controls(r).nth(1)).toHaveAccessibleName("Cancel");
  await controls(r).nth(1).click();
  await expect(r.locator(".aster-grid-expansion")).toHaveCount(0);
  // Locked: Edit becomes View, add and remove go, and the editor is read-only.
  await page.getByRole("button", { name: "Lock editing" }).click();
  await r.hover();
  await expect(controls(r)).toHaveCount(1);
  await expect(controls(r).nth(0)).toHaveAccessibleName("View");
  await controls(r).nth(0).click();
  await expect(r.getByRole("textbox", { name: "Task" })).toHaveAttribute("readonly", "");
  await r.getByRole("tab", { name: /Subtasks/ }).click();
  await expect(r.getByRole("button", { name: "Add subtask" })).toHaveCount(0);
});

test("several rows expand at once; single mode closes the other; a limit refuses with a message", async ({ page }) => {
  await tasks(page);
  const ids = (await all(page)).filter((t) => t.parentId === null).slice(0, 3).map((t) => t.id);
  for (const id of ids.slice(0, 2)) await row(page, id).dblclick();
  await expect(page.locator(".aster-grid-expansion")).toHaveCount(2);
  await page.evaluate(() => {
    const g = document.querySelector("aster-grid") as unknown as { expansion: object };
    g.expansion = { ...g.expansion, limit: 2 };
  });
  await row(page, ids[2]!).dblclick();
  await expect(page.locator(".aster-grid-expansion")).toHaveCount(2);
  await expect(page.locator(".aster-grid-refused")).toHaveText("Only 2 tasks can be open at once. Close one first.");
  await page.evaluate(() => {
    const g = document.querySelector("aster-grid") as unknown as { expansion: object };
    g.expansion = { ...g.expansion, limit: undefined, single: true };
  });
  for (const id of ids.slice(0, 2)) await row(page, id).locator(".aster-grid-controls button[aria-label='Cancel']").click({ force: true });
  await row(page, ids[0]!).dblclick();
  await row(page, ids[1]!).dblclick();
  await expect(page.locator(".aster-grid-expansion")).toHaveCount(1);
  await expect(row(page, ids[1]!).locator(".aster-grid-expansion")).toHaveCount(1);
});

test("tabs build when first chosen; an invalid field on a tab not shown is reported, then one save sends both tabs' changes", async ({ page }) => {
  await tasks(page);
  const { parent, children } = await parentWithSubtasks(page);
  const r = row(page, parent.id);
  await r.dblclick();
  await expect(r.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await expect(r.locator("aster-list-editor")).toHaveCount(0);
  const title = r.getByRole("textbox", { name: "Task", exact: true });
  await expect(title).toBeFocused();
  await title.fill("");
  await r.getByRole("tab", { name: /Subtasks/ }).click();
  await expect(r.locator("aster-list-editor")).toHaveCount(1);
  const first = r.getByRole("textbox", { name: "Task" }).first();
  await first.fill(`${children[0]!.title}, checked`);
  await r.locator(".aster-grid-controls button[aria-label='Save']").click();
  // The editor names the failing fields, and the field shows its own error.
  await expect(r.locator(".task-editor-problems")).toContainText("Task");
  await expect(r.getByRole("textbox", { name: "Task", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(r.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await expect(r.locator(".aster-grid-expansion")).toHaveCount(1);
  await r.getByRole("textbox", { name: "Task", exact: true }).fill("Confirm the legal terms");
  await r.locator(".aster-grid-controls button[aria-label='Save']").click();
  await expect(r.locator(".aster-grid-expansion")).toHaveCount(0);
  await expect(r).toContainText("Confirm the legal terms");
  const data = await all(page);
  expect(data.find((t) => t.id === parent.id)!.title).toBe("Confirm the legal terms");
  expect(data.find((t) => t.id === children[0]!.id)!.title).toBe(`${children[0]!.title}, checked`);
});

test("closing over unsaved changes asks: keep editing, discard, or save; edits survive scrolling away and another user's change", async ({ page }) => {
  await tasks(page);
  const { parent } = await parentWithSubtasks(page);
  const r = row(page, parent.id);
  await r.dblclick();
  const title = r.getByRole("textbox", { name: "Task", exact: true });
  await title.fill("Typed, not saved");
  // Away and back: the virtualized row goes, the editor's state doesn't.
  // Firefox can apply the scroll before measured heights grow the area, so scroll until the row has gone.
  await expect(async () => {
    await page.locator(".aster-grid-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(r).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.locator(".aster-grid-scroll").evaluate((el) => (el.scrollTop = 0));
  await r.scrollIntoViewIfNeeded();
  await expect(r.getByRole("textbox", { name: "Task", exact: true })).toHaveValue("Typed, not saved");
  // Another user changes a different field: the typed title stays.
  expect(await external(page, "PATCH", `Tasks(${parent.id})`, { due: "2026-12-01" })).toBeLessThan(300);
  await expect(r.getByRole("textbox", { name: "Task", exact: true })).toHaveValue("Typed, not saved");
  await r.getByRole("textbox", { name: "Task", exact: true }).press("Escape");
  const asking = r.getByRole("alertdialog", { name: "Unsaved changes" });
  await expect(asking).toBeVisible();
  await asking.getByRole("button", { name: "Keep editing" }).click();
  await expect(asking).toHaveCount(0);
  await r.getByRole("textbox", { name: "Task", exact: true }).press("Escape");
  await r.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(r.locator(".aster-grid-expansion")).toHaveCount(0);
  await expect(r).toContainText(parent.title);
});

test("subtasks: remove one, undo it, remove another and save; only the second goes", async ({ page }) => {
  await tasks(page);
  const { parent, children } = await parentWithSubtasks(page);
  const r = row(page, parent.id);
  await r.dblclick();
  await r.getByRole("tab", { name: /Subtasks/ }).click();
  const removes = r.locator("aster-list-editor").getByRole("button", { name: /^Remove/ });
  await removes.nth(0).click();
  await r.locator("aster-list-editor").getByRole("button", { name: /^Undo|^Restore|^Keep/ }).first().click();
  await removes.nth(1).click();
  await r.locator(".aster-grid-controls button[aria-label='Save']").click();
  await expect(r.locator(".aster-grid-expansion")).toHaveCount(0);
  const left = (await all(page)).filter((t) => t.parentId === parent.id).map((t) => t.id);
  expect(left).toContain(children[0]!.id);
  expect(left).not.toContain(children[1]!.id);
});

test("add a subtask from the row; remove a task with its subtasks after a confirmation that lists them", async ({ page }) => {
  await tasks(page);
  const { parent, children } = await parentWithSubtasks(page);
  const r = row(page, parent.id);
  await r.hover();
  await r.locator(".aster-grid-controls button[aria-label='Add subtask']").click();
  const dialog = page.getByRole("dialog", { name: `Add a subtask to ${parent.title}` });
  await expect(dialog.getByRole("textbox", { name: "Task" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Task" }).fill("Book the print slot");
  await dialog.getByRole("button", { name: "Add subtask" }).click();
  await expect(dialog).toHaveCount(0);
  const added = (await all(page)).find((t) => t.title === "Book the print slot")!;
  expect(added.parentId).toBe(parent.id);
  await expect(row(page, added.id)).toHaveAttribute("aria-level", "2");
  await expect(row(page, parent.id)).toHaveAttribute("aria-expanded", "true");

  await r.hover();
  await r.locator(".aster-grid-controls button[aria-label='Remove']").click();
  const confirm = page.getByRole("dialog", { name: `Remove ${parent.title}?` });
  await expect(confirm).toContainText(`Its ${children.length + 1} subtasks go too`);
  await expect(confirm).toContainText("Book the print slot");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(row(page, parent.id)).toHaveCount(0);
  const ids = new Set((await all(page)).map((t) => t.id));
  for (const id of [parent.id, added.id, ...children.map((c) => c.id)]) expect(ids.has(id)).toBe(false);
});

test("by keyboard: Tab reaches the active row's controls, Enter opens the editor, Escape comes back", async ({ page }) => {
  await tasks(page);
  await page.locator(".aster-grid-scroll").focus();
  await page.keyboard.press("ArrowDown");
  const active = page.locator(".aster-grid-row[data-active-row]");
  await page.keyboard.press("Tab");
  await expect(active.locator(".aster-grid-controls button").first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(active.locator(".aster-grid-controls button").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(active.getByRole("textbox", { name: "Task", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(active.locator(".aster-grid-expansion")).toHaveCount(0);
  await expect(active.locator(".aster-grid-controls button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".aster-grid-scroll")).toBeFocused();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: a row expanded on each tab, with its controls, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await tasks(page);
    const { parent } = await parentWithSubtasks(page);
    const r = row(page, parent.id);
    await r.dblclick();
    await expect(r.locator("aster-form")).toBeVisible();
    let results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    await r.getByRole("tab", { name: /Subtasks/ }).click();
    await expect(r.locator("aster-list-editor")).toBeVisible();
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}

test("a deep link opens a task's editor on a tab; choosing tabs is history, and Back and Forward follow it", async ({ page }) => {
  await tasks(page);
  const data = await all(page);
  const deep = data.find((t) => t.title.startsWith("Level 5"))!;
  await page.evaluate((id) => (location.hash = `#tasks/${id}/subtasks`), deep.id);
  const r = row(page, deep.id);
  await expect(r).toHaveAttribute("aria-level", "5");
  await expect(r.getByRole("tab", { name: /Subtasks/ })).toHaveAttribute("aria-selected", "true");
  await expect(r.locator("aster-list-editor")).toBeVisible();
  await r.getByRole("tab", { name: "Details" }).click();
  await expect(page).toHaveURL(new RegExp(`#tasks/${deep.id}$`));
  await r.getByRole("tab", { name: /Subtasks/ }).click();
  await expect(page).toHaveURL(new RegExp(`#tasks/${deep.id}/subtasks$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#tasks/${deep.id}$`));
  await expect(r.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(r.getByRole("tab", { name: /Subtasks/ })).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(r.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
});
