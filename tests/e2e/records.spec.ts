// M2 acceptance: the project and People pages, page rules, change tracking,
// layout and lazy loading.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { externalPatch, NOW, row, server, settle } from "./fixtures.ts";

const metadata = JSON.parse(readFileSync(new URL("../../fixtures/aster/metadata.json", import.meta.url), "utf8"));

/** Opens a page of the demo and waits for its main content. */
async function visit(page: Page, hash: string, ready: string, extra = ""): Promise<void> {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}${extra}${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(ready).first()).toBeVisible();
}

const project = (page: Page, id: number) => visit(page, `#project/${id}`, "aster-form aster-select");
const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });
const save = (page: Page) => page.getByRole("button", { name: "Save", exact: true });
/** The label the Save button shows now; the others are stacked, hidden, in the same cell. */
/** Chooses an option of a select-only combobox, as a person would. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("listbox", { name: label }).getByRole("option", { name: option, exact: true }).click();
}
const saveLabel = (page: Page) => page.locator("aster-button.save .aster-label-swap > :not([data-off])");

test("the form is laid out from metadata: titles, lengths and allowed values", async ({ page }) => {
  const changed = structuredClone(metadata);
  changed.AsterDemo.Project.name["@Core.Description"] = "Title";
  changed.AsterDemo.Project.name.$MaxLength = 10;
  changed.AsterDemo.Project.health["@Validation.AllowedValues"][2]["@Core.Description"] = "Running late";
  await page.addInitScript((m) => Object.assign(globalThis, { asterMetadata: m }), changed);
  await project(page, 1);
  await expect(field(page, "Title")).toHaveValue("Spring launch");
  await page.getByRole("combobox", { name: "Status" }).click();
  await expect(page.getByRole("option", { name: "Running late" })).toBeVisible();
  await page.keyboard.press("Escape");
  await field(page, "Title").fill("Spring launch 2027");
  await save(page).click();
  await expect(page.locator("aster-field .aster-error")).toHaveText("Title can be at most 10 characters; this is 18.");
});

test("Days behind appears and is required only while Status is Behind", async ({ page }) => {
  await project(page, 1);
  await expect(page.getByLabel("Days behind")).toHaveCount(0);
  await choose(page, "Status", "Behind");
  await expect(page.getByLabel("Days behind")).toBeVisible();
  await save(page).click();
  await expect(page.getByText("Days behind is required.")).toBeVisible();
  await expect(page.getByLabel("Days behind")).toBeFocused();
  await page.getByLabel("Days behind").fill("3");
  await save(page).click();
  await expect(saveLabel(page)).toHaveText("Saved");
  const p1 = (await server(page)).Projects.find((p) => p.id === 1) as unknown as { health: string; behindDays: number };
  expect([p1.health, p1.behindDays]).toEqual(["behind", 3]);

  await choose(page, "Status", "On track");
  await expect(page.getByLabel("Days behind")).toHaveCount(0);
  await save(page).click();
  await expect(saveLabel(page)).toHaveText("Saved");
  const after = (await server(page)).Projects.find((p) => p.id === 1) as unknown as { behindDays: number | null };
  expect(after.behindDays).toBeNull();
});

test("an archived project is read-only with its reason, until State restores it", async ({ page }) => {
  await visit(page, "#projects/archived", "#projects-list [role=option]");
  const archived = (await server(page)).Projects.find((p) => p.state === "archived")!;
  await project(page, archived.id);
  const reason = "Archived projects can't be edited. Set State to Active to restore it.";
  await expect(field(page, "Project")).toHaveAttribute("readonly", "");
  await expect(page.getByText(reason).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add task" })).toHaveCount(0);

  await page.getByRole("button", { name: "Simulate" }).click();
  await expect(page.getByRole("dialog", { name: "Simulate" })).toBeFocused();
  await field(page, "Project").focus();
  // The window is non-modal: the page stays usable, and Why follows its focus.
  await expect(page.getByRole("dialog", { name: "Simulate" })).toBeVisible();
  await expect(page.locator(".debug-window .why")).toContainText('readOnly applies');
  await expect(page.locator(".debug-window .why")).toContainText('project.record.state = "archived"');

  await choose(page, "State", "Active");
  await save(page).click();
  await expect(field(page, "Project")).not.toHaveAttribute("readonly", "");
});

test("change tracking: pending fields, revert, a new task, and a deletion with Undo", async ({ page }) => {
  await project(page, 4);
  const name = field(page, "Project");
  const original = await name.inputValue();
  await name.fill("Renamed");
  const host = page.locator("aster-field", { has: name });
  await expect(host).toHaveAttribute("data-pending", "");
  await host.getByRole("button", { name: `Revert Project to ${original}` }).click();
  await expect(name).toHaveValue(original);
  await expect(host).not.toHaveAttribute("data-pending", "");
  await expect(save(page)).toHaveAttribute("title", "No changes to save.");

  await page.getByRole("tab", { name: /Tasks/ }).click();
  const tasksBefore = (await server(page)).Tasks.filter((t) => t.projectId === 4).length;
  const first = page.locator(".aster-list-edit-row:not(.aster-list-edit-head)").first();
  const firstTitle = await first.getByRole("textbox").first().inputValue();
  await first.getByRole("button", { name: `Remove ${firstTitle}` }).click();
  await expect(page.locator(".aster-list-edit-row[data-removing]")).toContainText(firstTitle);
  await page.getByRole("button", { name: `Undo removing ${firstTitle}` }).click();
  await expect(page.locator(".aster-list-edit-row[data-removing]")).toHaveCount(0);
  await page.getByRole("button", { name: `Remove ${firstTitle}` }).click();

  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.locator(".aster-list-edit-row[data-new] input").first()).toBeFocused();
  await page.keyboard.type("Write the launch post");
  await expect(page.locator(".aster-list-edit-row[data-new]")).toHaveCount(1);
  await save(page).click();
  await expect(saveLabel(page)).toHaveText("Saved");
  const tasks = (await server(page)).Tasks as unknown as { projectId: number; title: string }[];
  const mine = tasks.filter((t) => t.projectId === 4);
  expect(mine.length).toBe(tasksBefore);
  expect(mine.map((t) => t.title)).toContain("Write the launch post");
  expect(mine.map((t) => t.title)).not.toContain(firstTitle);
  await expect(page.locator(".aster-list-edit-row[data-new], .aster-list-edit-row[data-removing]")).toHaveCount(0);
});

test("a task that can't be saved stays pending with its error", async ({ page }) => {
  await project(page, 4);
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await save(page).click();
  await expect(page.locator(".aster-list-edit-row[data-new] .aster-error")).toBeVisible();
  await expect(page.locator(".aster-list-edit-row[data-new] input").first()).toBeFocused();
});

test("leaving with unsaved changes asks first, from a link or Back", async ({ page }) => {
  await visit(page, "#projects/active", "#projects-list [role=option]");
  await row(page, "Spring launch").dblclick();
  await expect(field(page, "Project")).toBeVisible();
  await field(page, "Project").fill("Spring launch, edited");
  await page.locator(".aster-nav-item", { hasText: "People" }).click();
  await expect(page.locator(".leave")).toContainText("You have unsaved changes.");
  await page.getByRole("button", { name: "Stay" }).click();
  await expect(page).toHaveURL(/#project\/1$/);

  await page.goBack();
  await expect(page.locator(".leave")).toBeVisible();
  await expect(page).toHaveURL(/#project\/1$/);
  await page.getByRole("button", { name: "Discard them" }).click();
  await expect(page).toHaveURL(/#projects\/active$/);
  await expect(row(page, "Spring launch")).toBeVisible();
});

test("saved edits show at once on the Projects screen", async ({ page }) => {
  await project(page, 1);
  await field(page, "Project").fill("Spring relaunch");
  await save(page).click();
  await expect(saveLabel(page)).toHaveText("Saved");
  await page.locator(".back").click();
  await expect(row(page, "Spring relaunch")).toBeVisible();
  await expect(page.locator(".aster-nav-item", { hasText: "Spring relaunch" })).toBeVisible();
});

test("another user's edit reaches an open form: other fields rebase, the same field conflicts", async ({ page }) => {
  await project(page, 2);
  await field(page, "Project").fill("Brand refresh 2027");
  await externalPatch(page, "Projects(2)", { spent: "100.00" });
  await expect(field(page, "Spent")).toHaveValue("100.00");
  await expect(field(page, "Project")).toHaveValue("Brand refresh 2027");
  await externalPatch(page, "Projects(2)", { name: "Brand reboot" });
  await expect(page.getByRole("alert").filter({ hasText: "Someone else changed Project" })).toBeVisible();
  await page.getByRole("button", { name: "Keep mine" }).click();
  await save(page).click();
  await expect(saveLabel(page)).toHaveText("Saved");
});

test("People: the detail lists follow the selection, and drafts stay per person", async ({ page }) => {
  await visit(page, "#people", ".people-list [role=option]");
  const people = page.getByRole("listbox", { name: "People" });
  await people.getByRole("option", { name: /Grace Hopper/ }).click();
  await expect(page.locator(".person-head h2")).toHaveText("Grace Hopper");
  const data = (await server(page)) as unknown as { Projects: { leadId: number }[] };
  await expect(page.locator("#leads-title")).toHaveText(`Leads ${data.Projects.filter((p) => p.leadId === 2).length}`);
  await expect(page).toHaveURL(/#people\/2$/);

  await field(page, "Email").fill("grace@navy.example");
  await people.getByRole("option", { name: /Alan Kay/ }).click();
  await expect(page.locator(".person-head h2")).toHaveText("Alan Kay");
  await expect(people.getByRole("option", { name: /Grace Hopper\W+unsaved changes/ })).toBeVisible();
  await people.getByRole("option", { name: /Grace Hopper/ }).click();
  await expect(field(page, "Email")).toHaveValue("grace@navy.example");
  await save(page).click();
  await expect(people.getByRole("option", { name: /grace@navy\.example/ })).toBeVisible();
});

test("the split resizes by keyboard and pointer, and keeps its width", async ({ page }) => {
  await visit(page, "#people", ".people-list [role=option]");
  const bar = page.getByRole("separator", { name: "Resize the people list" });
  const start = Number(await bar.getAttribute("aria-valuenow"));
  await bar.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(bar).toHaveAttribute("aria-valuenow", String(start + 32));
  const box = (await page.locator(".aster-split-pane[data-pane=start]").boundingBox())!;
  expect(Math.round(box.width)).toBe(start + 32);
  const handle = (await bar.boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + 64, handle.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(bar).toHaveAttribute("aria-valuenow", String(start + 92));
  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize the people list" })).toHaveAttribute("aria-valuenow", String(start + 92));
  await page.keyboard.press("Tab");
  await page.getByRole("separator").focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("separator")).toHaveAttribute("aria-valuenow", "220");
});

test("the split's width stays on the split, so a drag doesn't restyle its panes", async ({ page }) => {
  await visit(page, "#people", ".people-list [role=option]");
  const bar = page.getByRole("separator", { name: "Resize the people list" });
  const before = Number(await bar.getAttribute("aria-valuenow"));
  await bar.focus();
  await page.keyboard.press("ArrowRight");
  await expect(bar).toHaveAttribute("aria-valuenow", String(before + 16));
  const width = await bar.getAttribute("aria-valuenow");
  const value = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).getPropertyValue("--split-start").trim());
  expect(await value("aster-split")).toBe(`${width}px`);
  // The registered initial value: the pane doesn't inherit the width.
  expect(await value(".aster-split-pane[data-pane=start]")).toBe("320px");
  expect(width).not.toBe("320");
});

test("a section collapses, and says how many changes it hides", async ({ page }) => {
  await project(page, 1);
  await field(page, "Budget").fill("50000.00");
  const head = page.getByRole("button", { name: "Budget", exact: true });
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".aster-section-summary")).toHaveText("1 change");
  await expect(page.getByRole("region", { name: "Budget" })).toHaveAttribute("inert", "");
  await head.click();
  await expect(field(page, "Budget")).toBeVisible();
});

test("the project and People pages load as separate chunks on first visit", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (r) => r.resourceType() === "script" && scripts.push(r.url()));
  await visit(page, "#projects/active", "#projects-list [role=option]");
  const initial = scripts.length;
  await page.evaluate(() => (location.hash = "#project/1"));
  await expect(page.locator("aster-form")).toBeVisible();
  expect(scripts.length).toBeGreaterThan(initial);
  const afterProject = scripts.length;
  await page.evaluate(() => (location.hash = "#people"));
  await expect(page.locator(".people-list")).toBeVisible();
  expect(scripts.length).toBeGreaterThan(afterProject);
});

test("at phone width People shows the list, then the person with Back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, "#people", ".people-list [role=option]");
  await expect(page.locator(".person-detail")).toBeHidden();
  await page.getByRole("option", { name: /Barbara Liskov/ }).click();
  await expect(page.locator(".person-head h2")).toHaveText("Barbara Liskov");
  await expect(page.locator(".people-list")).toBeHidden();
  await page.locator(".people-back").click();
  await expect(page.locator(".people-list")).toBeVisible();
  await settle(page);
});

test("a select works from the keyboard: open, type-ahead, choose, Escape", async ({ page }) => {
  await project(page, 1);
  const status = page.getByRole("combobox", { name: "Status" });
  await status.focus();
  await page.keyboard.press("ArrowDown");
  await expect(status).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("b");
  await expect(page.getByRole("option", { name: "Behind", exact: true })).toHaveAttribute("data-active", "");
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Behind");
  await expect(status).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("textbox", { name: "Days behind" })).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  await expect(status).toHaveText("Behind");
  await expect(status).toBeFocused();
});

test("a collapsed section opens when an error newly appears, and a collapse holds while it stays", async ({ page }) => {
  await project(page, 1);
  const section = await page.evaluateHandle(() => {
    const s = document.createElement("aster-section") as HTMLElement & { heading: string; open: boolean; body: Node };
    s.id = "probe-section";
    s.heading = "Probe";
    s.open = false;
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Probe input");
    input.setAttribute("aria-invalid", "true");
    s.body = input;
    document.body.append(s);
    return s;
  });
  const head = page.getByRole("button", { name: "Probe", exact: true });
  const rerender = (heading: string) => section.evaluate((s, h) => ((s as unknown as { heading: string }).heading = h), heading);
  const invalid = (on: boolean) => section.evaluate((s, v) => s.querySelector("input")!.toggleAttribute("aria-invalid", v), on);
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await rerender("Probe 2");
  await rerender("Probe 3");
  await expect(page.getByRole("button", { name: "Probe 3", exact: true })).toHaveAttribute("aria-expanded", "false");
  // The error clears, then a new one appears.
  await invalid(false);
  await rerender("Probe 4");
  await expect(page.getByRole("button", { name: "Probe 4", exact: true })).toHaveAttribute("aria-expanded", "false");
  await section.evaluate((s) => s.querySelector("input")!.setAttribute("aria-invalid", "true"));
  await rerender("Probe 5");
  await expect(page.getByRole("button", { name: "Probe 5", exact: true })).toHaveAttribute("aria-expanded", "true");
});

test("the split re-clamps its width when min or max change, in any order, and persist re-reads", async ({ page }) => {
  await visit(page, "#people", ".people-list [role=option]");
  const bar = page.getByRole("separator", { name: "Resize the people list" });
  const split = page.locator("aster-split");
  const set = (props: Record<string, unknown>) => split.evaluate((s, p) => Object.assign(s, p), props);
  await set({ width: 400 });
  await expect(bar).toHaveAttribute("aria-valuenow", "400");
  await set({ max: 300 });
  await expect(bar).toHaveAttribute("aria-valuenow", "300");
  await set({ min: 450, max: 500 });
  await expect(bar).toHaveAttribute("aria-valuenow", "450");
  // A stored width read before the limits are widened still applies once they are.
  await page.evaluate(() => localStorage.setItem("aster-split:probe", "480"));
  await set({ min: 220, max: 400, persist: "probe" });
  await expect(bar).toHaveAttribute("aria-valuenow", "400");
  await set({ max: 520 });
  await expect(bar).toHaveAttribute("aria-valuenow", "480");
  await page.evaluate(() => localStorage.setItem("aster-split:probe-2", "360"));
  await set({ persist: "probe-2" });
  await expect(bar).toHaveAttribute("aria-valuenow", "360");
});

test("tabs have ids, and the panel is labelled by the selected tab", async ({ page }) => {
  await project(page, 1);
  const panel = page.locator("#project-panel");
  const details = page.getByRole("tab", { name: "Details" });
  const tasks = page.getByRole("tab", { name: /^Tasks/ });
  const id = (l: typeof details) => l.getAttribute("id");
  const [detailsId, tasksId] = [await id(details), await id(tasks)];
  expect(detailsId).toBeTruthy();
  expect(tasksId).toBeTruthy();
  expect(tasksId).not.toBe(detailsId);
  await expect(details).toHaveAttribute("aria-controls", "project-panel");
  await expect(panel).toHaveAttribute("aria-labelledby", detailsId!);
  await tasks.click();
  await expect(panel).toHaveAttribute("aria-labelledby", tasksId!);
  await expect(panel).toHaveAccessibleName(/^Tasks/);
});
