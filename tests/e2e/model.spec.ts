// M6: the information model screen, after the CAVR scenarios in
// requirements/grid-row-controls-and-expansion.md §7 and
// requirements/change-tracking.md §7.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

interface Field { id: number; parentId: number | null; name: string; label: string; kind: string; help: string | null; position: number }
interface Answer { id: number; fieldId: number; key: string; label: string; position: number }
interface Clause { id: number; fieldId: number; category: string; parentClauseId: number | null; op: string; fieldRef: number | null; value: string | null }
interface Change { id: number; kind: string; fieldId: number; fieldLabel: string; before: string | null; changes: string }
interface Data { Fields: Field[]; Answers: Answer[]; Clauses: Clause[]; Changes: Change[] }

const dump = async (page: Page): Promise<Data> =>
  page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: never }> } } }).aster.mock.dump()).data);
const external = (page: Page, method: string, url: string, body?: object) =>
  page.evaluate(async ([method, url, body]) => {
    const { mock } = (globalThis as unknown as { aster: { mock: { external(r: object): Promise<{ status: number }> } } }).aster;
    return (await mock.external({ method, url, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).status;
  }, [method, url, body] as const);

const URL_BASE = `/?memory&debug&clients=0&time=0&now=${NOW}`;
async function model(page: Page, hash = "#model") {
  await page.goto(`${URL_BASE}${hash}`);
  await expect(page.locator(".model-grid .aster-grid-row[data-key]").first()).toBeVisible();
}
const row = (page: Page, id: number) => page.locator(`.model-grid .aster-grid-row[data-key="[${id}]"]`);
const control = (r: Locator, name: string) => r.locator(".aster-grid-controls").getByRole("button", { name, exact: true });
const tab = (r: Locator, name: RegExp | string) => r.getByRole("tab", { name });

const CLIENT_TYPE = 4;
const INCORPORATED = 5;
let fields: Field[];
const byName = (name: string) => fields.find((f) => f.name === name)!;

test.beforeEach(async ({ page }) => {
  // Once per test, not on the reloads a test makes.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("drafts-cleared")) return;
    indexedDB.deleteDatabase("aster-drafts");
    sessionStorage.setItem("drafts-cleared", "1");
  });
});

test("a field expands into its tabs; edits on two tabs show as pending; one save sends them; the log replays it", async ({ page }) => {
  await model(page, `#model/${CLIENT_TYPE}/definition`);
  const r = row(page, CLIENT_TYPE);
  await expect(r.locator("aster-form")).toBeVisible();
  await expect(r.getByRole("tab")).toHaveText(["Definition", "Answers 5", "Visibility", "Messages 0"]);
  // Tabs build when first chosen.
  await expect(r.locator("aster-list-editor")).toHaveCount(0);

  const field = (name: string) => r.locator("aster-field").filter({ has: page.getByRole("textbox", { name, exact: true }) });
  await r.getByRole("textbox", { name: "Label" }).fill("Type of client");
  await expect(field("Label")).toHaveAttribute("data-pending", "");
  await r.getByRole("textbox", { name: "Help text" }).fill("What the client is, legally.");
  // Changed back by hand, its pending styling clears.
  await r.getByRole("textbox", { name: "Help text" }).fill("");
  await expect(field("Help text")).not.toHaveAttribute("data-pending", "");

  await tab(r, /Answers/).click();
  const list = r.locator("aster-list-editor");
  await list.getByRole("button", { name: "Remove individual", exact: true }).click();
  await expect(list.locator(".aster-list-edit-row[data-removing]")).toHaveCount(1);
  await list.getByRole("button", { name: "Undo removing individual" }).click();
  await list.getByRole("button", { name: "Remove trust", exact: true }).click();
  await list.getByRole("button", { name: "Add answer" }).click();
  const added = list.locator(".aster-list-edit-row[data-new]");
  await added.getByRole("textbox", { name: "Key" }).fill("club");
  await added.getByRole("textbox", { name: "Label" }).fill("Club or society");
  await list.locator('.aster-list-edit-row[data-id="[2]"]').getByRole("textbox", { name: "Label" }).fill("Limited company");

  await r.hover();
  await control(r, "Save").click();
  await expect(r.locator("aster-form, aster-list-editor")).toHaveCount(0);

  const data = await dump(page);
  expect(data.Fields.find((f) => f.id === CLIENT_TYPE)!.label).toBe("Type of client");
  expect(data.Answers.filter((a) => a.fieldId === CLIENT_TYPE).map((a) => a.key)).toEqual(["individual", "company", "partnership", "charity", "club"]);
  expect(data.Answers.find((a) => a.id === 2)!.label).toBe("Limited company");
  const entry = data.Changes.at(-1)!;
  expect(entry.kind).toBe("update");
  const logged = JSON.parse(entry.changes);
  expect(logged.change.changes).toEqual({ label: { from: "Client type", to: "Type of client" } });
  expect(logged.change.owned.answers.map((c: { kind: string }) => c.kind)).toEqual(["delete", "update", "create"]);

  // The log, newest first; the entry replays over the old values, read-only, on the tabs it touched.
  await page.getByRole("tab", { name: "Change log" }).click();
  const first = page.locator(".model-changes .aster-grid-row[data-key]").first();
  await expect(first).toContainText("Type of client");
  await first.dblclick();
  const replay = first.locator(".model-replay");
  await expect(replay.getByRole("tab")).toHaveText(["Definition", "Answers"]);
  await expect(replay.getByRole("textbox", { name: "Label" })).toHaveValue("Type of client");
  const was = replay.locator("aster-field").filter({ has: page.getByRole("textbox", { name: "Label", exact: true }) });
  await expect(was).toHaveAttribute("data-pending", "");
  await expect(was).toHaveAttribute("data-readonly", "");
  await replay.getByRole("tab", { name: "Answers" }).click();
  await expect(replay.locator(".aster-list-edit-row[data-removing]")).toContainText("trust");
  await expect(replay.locator(".aster-list-edit-row[data-new]")).toContainText("club");
  await expect(replay.getByRole("button", { name: /Add answer|Remove/ })).toHaveCount(0);
});

test("the rule editor: add a condition, change one, remove one; revert; the change set holds exactly the add and the remove", async ({ page }) => {
  await model(page);
  fields = (await dump(page)).Fields;
  const highRisk = byName("highRisk");
  await page.evaluate((id) => (location.hash = `#model/${id}/visibility`), highRisk.id);
  const r = row(page, highRisk.id);
  const rule = r.locator("aster-rule-editor");
  await expect(rule.locator(".aster-rule-leaf")).toHaveCount(2);
  const [first, second] = [rule.locator(".aster-rule-leaf").nth(0), rule.locator(".aster-rule-leaf").nth(1)];

  // Change the first condition, then revert it.
  await first.getByRole("checkbox", { name: "Panama" }).uncheck();
  await expect(first).toHaveAttribute("data-pending", "");
  await expect(first.locator(".aster-rule-many")).toHaveAttribute("data-pending", "");
  await first.getByRole("button", { name: /^Revert/ }).click();
  await expect(first).not.toHaveAttribute("data-pending", "");

  // Remove the second: struck through, with Undo.
  await second.getByRole("button", { name: /^Remove/ }).click();
  await expect(second).toHaveAttribute("data-removing", "");
  await expect(second.getByRole("button", { name: /^Undo/ })).toBeVisible();

  // Add one: pending in full.
  await rule.getByRole("button", { name: "Add condition", exact: true }).click();
  const added = rule.locator(".aster-rule-leaf[data-new]");
  await expect(added).toHaveCount(1);
  await added.getByRole("combobox", { name: /field/ }).fill("Client type");
  await page.getByRole("treeitem", { name: "Client type", exact: true }).click();
  await added.getByRole("combobox", { name: /test/ }).click();
  await page.getByRole("option", { name: "is", exact: true }).click();
  await added.getByRole("combobox", { name: /value/ }).click();
  await page.getByRole("option", { name: "Trust" }).click();

  await r.hover();
  await control(r, "Save").click();
  await expect(rule).toHaveCount(0);
  const data = await dump(page);
  const logged = JSON.parse(data.Changes.at(-1)!.changes);
  expect(Object.keys(logged.change.changes)).toEqual([]);
  expect(logged.change.owned.clauses.map((c: { kind: string }) => c.kind)).toEqual(["delete", "create"]);
  const now = data.Clauses.filter((c) => c.fieldId === highRisk.id);
  expect(now.find((c) => c.value === "trust")).toMatchObject({ op: "eq", fieldRef: CLIENT_TYPE, category: "visibility" });
});

test("a condition's field is chosen from a tree: a repeated name shows its path, by mouse or keyboard", async ({ page }) => {
  await model(page);
  fields = (await dump(page)).Fields;
  const registered = byName("registeredAddress");
  const trading = byName("tradingAddress");
  const tradingLine1 = fields.find((f) => f.name === "line1" && f.parentId === trading.id)!;
  await page.evaluate((id) => (location.hash = `#model/${id}/visibility`), registered.id);
  const r = row(page, registered.id);
  const rule = r.locator("aster-rule-editor");
  await rule.getByRole("button", { name: "Add a condition" }).click();
  const picker = rule.getByRole("combobox", { name: /field/ });
  const tree = page.getByRole("tree");

  // Typing keeps each match under the groups leading to it; the first match is active.
  await picker.fill("line 1");
  await expect(tree.getByRole("treeitem", { name: "Address line 1", exact: true })).toHaveCount(26);
  await expect(tree.getByRole("treeitem", { name: "Registered address" })).toHaveAttribute("aria-expanded", "true");
  await expect(tree.getByRole("treeitem", { name: "Registered address" })).toHaveAttribute("aria-level", "2");
  const { violations } = await new AxeBuilder({ page }).include(".aster-tree-picker").analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);

  // ↓ moves on from the active match, past the trading address group, to its line 1.
  await picker.press("ArrowDown");
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await expect(tree).toBeHidden();
  await expect(picker).toHaveValue("Address line 1");
  await expect(rule.locator(".aster-tree-picker-trail")).toContainText("Trading address");
  await expect(picker).toHaveAccessibleDescription(/^In Client details\s*, Trading address$/);

  // Opening again shows the chosen field in place; ← goes to the parent, then closes it; → opens it.
  await picker.press("ArrowDown");
  await expect(tree.locator('[role="treeitem"][aria-selected="true"]')).toHaveAttribute("aria-level", "3");
  await picker.press("ArrowDown");
  await picker.press("ArrowLeft");
  const group = tree.getByRole("treeitem", { name: "Trading address" });
  await expect(picker).toHaveAttribute("aria-activedescendant", (await group.getAttribute("id"))!);
  await picker.press("ArrowLeft");
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await picker.press("ArrowRight");
  await expect(group).toHaveAttribute("aria-expanded", "true");
  // A group only opens and closes; it's never the value.
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await picker.press("Escape");
  await expect(picker).toHaveValue("Address line 1");

  await rule.getByRole("combobox", { name: /test/ }).click();
  await page.getByRole("option", { name: "is answered", exact: true }).click();
  await r.hover();
  await control(r, "Save").click();
  await expect(rule).toHaveCount(0);
  const saved = (await dump(page)).Clauses.filter((c) => c.fieldId === registered.id);
  expect(saved.find((c) => c.op === "set")).toMatchObject({ fieldRef: tradingLine1.id, category: "visibility" });
});

test("saving with an invalid condition on a tab not shown names it; the row stays open on that tab", async ({ page }) => {
  await model(page, `#model/${INCORPORATED}/visibility`);
  const r = row(page, INCORPORATED);
  await r.locator("aster-rule-editor").getByRole("button", { name: "Add condition", exact: true }).click();
  await tab(r, "Definition").click();
  await r.getByRole("textbox", { name: "Label" }).fill("Incorporated on");
  await r.hover();
  await control(r, "Save").click();
  await expect(r.getByRole("alert").filter({ hasText: "need fixing" })).toContainText("A visibility condition: Operator, Field");
  await expect(tab(r, "Visibility")).toHaveAttribute("aria-selected", "true");
  expect((await dump(page)).Fields.find((f) => f.id === INCORPORATED)!.label).toBe("Date of incorporation");
});

test("a reload before saving brings the working copy back", async ({ page }) => {
  await page.goto(`${URL_BASE}#model/${CLIENT_TYPE}/definition`);
  const r = row(page, CLIENT_TYPE);
  await r.getByRole("textbox", { name: "Label" }).fill("Kind of client");
  await tab(r, /Answers/).click();
  await r.locator("aster-list-editor").getByRole("button", { name: "Remove trust", exact: true }).click();
  await page.waitForTimeout(300);
  await page.reload();
  const again = row(page, CLIENT_TYPE);
  await expect(again.locator(".aster-list-edit-row[data-removing]")).toContainText("trust");
  await tab(again, "Definition").click();
  await expect(again.getByRole("textbox", { name: "Label" })).toHaveValue("Kind of client");
  await expect(again.locator("aster-field").filter({ has: page.getByRole("textbox", { name: "Label", exact: true }) })).toHaveAttribute("data-pending", "");
});

test("another user's change: to a field not edited here, it's taken in; to one edited here, a conflict to settle", async ({ page }) => {
  await model(page, `#model/${CLIENT_TYPE}/definition`);
  const r = row(page, CLIENT_TYPE);
  await r.getByRole("textbox", { name: "Label" }).fill("Mine");
  await external(page, "PATCH", `Fields(${CLIENT_TYPE})`, { help: "Theirs" });
  await expect(r.getByRole("textbox", { name: "Help text" })).toHaveValue("Theirs");
  await expect(r.locator(".field-conflict")).toHaveCount(0);
  await external(page, "PATCH", `Fields(${CLIENT_TYPE})`, { label: "Their label" });
  await expect(r.locator(".field-conflict")).toContainText("Label");
  await r.getByRole("button", { name: "Keep mine" }).click();
  await r.hover();
  await control(r, "Save").click();
  await expect(r.locator("aster-form")).toHaveCount(0);
  const f = (await dump(page)).Fields.find((x) => x.id === CLIENT_TYPE)!;
  expect([f.label, f.help]).toEqual(["Mine", "Theirs"]);
});

test("answers reorder by keyboard and by drag; the positions save", async ({ page }) => {
  await model(page, `#model/${CLIENT_TYPE}/answers`);
  const list = row(page, CLIENT_TYPE).locator("aster-list-editor");
  const keys = () => list.locator(".aster-list-edit-row[data-id] .aster-list-edit-static").allTextContents();
  await expect.poll(keys).toEqual(["individual", "company", "trust", "partnership", "charity"]);
  await list.getByRole("button", { name: "Move charity", exact: true }).focus();
  await expect(list.getByRole("button", { name: "Move charity", exact: true })).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(keys).toEqual(["individual", "company", "trust", "charity", "partnership"]);
  await expect(list.getByRole("button", { name: "Move charity", exact: true })).toBeFocused();
  await expect(list.locator("[aria-live]")).toHaveText("charity, moved to 4 of 5");
  const [from, to] = [await list.getByRole("button", { name: "Move individual", exact: true }).boundingBox(), await list.getByRole("button", { name: "Move trust", exact: true }).boundingBox()];
  await page.mouse.move(from!.x + 8, from!.y + 8);
  await page.mouse.down();
  await page.mouse.move(to!.x + 8, to!.y + to!.height + 4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(keys).toEqual(["company", "trust", "individual", "charity", "partnership"]);
  const r = row(page, CLIENT_TYPE);
  await r.hover();
  await control(r, "Save").click();
  await expect(list).toHaveCount(0);
  const saved = (await dump(page)).Answers.filter((a) => a.fieldId === CLIENT_TYPE).sort((a, b) => a.position - b.position).map((a) => a.key);
  expect(saved).toEqual(["company", "trust", "individual", "charity", "partnership"]);
});

test("removing a field shows what reads it; confirming repairs those rules in the same log entry", async ({ page }) => {
  await model(page, `#model/${CLIENT_TYPE}`);
  fields = (await dump(page)).Fields;
  const before = (await dump(page)).Clauses.filter((c) => c.fieldRef === CLIENT_TYPE);
  const r = row(page, CLIENT_TYPE);
  await r.hover();
  await control(r, "Remove").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".model-impact li")).toContainText(["Date of incorporation", "Company number", "Charity number"]);
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(row(page, CLIENT_TYPE)).toHaveCount(0);
  const data = await dump(page);
  expect(data.Clauses.filter((c) => c.fieldRef === CLIENT_TYPE)).toEqual([]);
  expect(before.length).toBeGreaterThan(5);
  expect(data.Answers.filter((a) => a.fieldId === CLIENT_TYPE)).toEqual([]);
  const entry = data.Changes.at(-1)!;
  expect(entry.kind).toBe("delete");
  expect(JSON.parse(entry.changes).repairs.length).toBe(new Set(before.map((c) => c.fieldId)).size);
  await page.getByRole("tab", { name: "Change log" }).click();
  const first = page.locator(".model-changes .aster-grid-row[data-key]").first();
  await first.dblclick();
  await first.getByRole("tab", { name: "Dependency updates" }).click();
  await expect(first.locator(".model-repairs section").first()).toBeVisible();
  await expect(first.locator(".model-repairs .aster-rule-leaf[data-removing]").first()).toBeVisible();
});

test("the dependency viewer lists dependents by field and by answer; Go to field opens it", async ({ page }) => {
  await model(page, `#model/${CLIENT_TYPE}`);
  const r = row(page, CLIENT_TYPE);
  await r.hover();
  await control(r, "Dependencies").click();
  const win = page.locator("aster-window.model-deps [role=dialog]");
  await expect(win).toBeVisible();
  await expect(win.getByRole("heading", { name: "Rules that read it" })).toBeVisible();
  const company = win.locator(".model-deps-answers > li").filter({ hasText: /^Company/ });
  await expect(company).toContainText("Company number");
  await company.getByRole("button", { name: "Go to Company number" }).click();
  await expect(page).toHaveURL(/#model\/\d+\/visibility$/);
  await expect(page.locator(".model-grid aster-rule-editor")).toBeVisible();
});

test("locked: Edit becomes View, adding and removing go, every tab is read-only", async ({ page }) => {
  await model(page, `#model/${CLIENT_TYPE}`);
  await page.getByRole("button", { name: "Lock editing" }).click();
  const r = row(page, CLIENT_TYPE);
  await r.hover();
  await expect(r.locator(".aster-grid-controls button")).toHaveCount(2);
  await expect(r.locator(".aster-grid-controls button").nth(0)).toHaveAccessibleName("View");
  await expect(r.locator(".aster-grid-controls button").nth(1)).toHaveAccessibleName("Dependencies");
  await control(r, "View").click();
  await expect(r.locator("aster-field").filter({ has: page.getByRole("textbox", { name: "Label", exact: true }) })).toHaveAttribute("data-readonly", "");
  await tab(r, /Answers/).click();
  await expect(r.getByRole("button", { name: "Add answer" })).toHaveCount(0);
  await tab(r, "Visibility").click();
  await expect(r.locator("aster-rule-editor").getByRole("button", { name: /Condition|Remove/ })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: a field's tabs and a replay, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await model(page, `#model/${INCORPORATED}/definition`);
    const r = row(page, INCORPORATED);
    const check = async () => {
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    };
    await check();
    await tab(r, "Visibility").click();
    await expect(r.locator("aster-rule-editor")).toBeVisible();
    await check();
    await tab(r, /Messages/).click();
    await check();
  });
}

test("a deep link three levels down opens each level, expands the field on its tab; Back and Forward follow", async ({ page }) => {
  await model(page);
  fields = (await dump(page)).Fields;
  const country = fields.find((f) => f.name === "country" && fields.find((p) => p.id === f.parentId)?.name === "registeredAddress")!;
  await page.evaluate((id) => (location.hash = `#model/${id}/messages`), country.id);
  const r = row(page, country.id);
  await expect(r).toHaveAttribute("aria-level", "3");
  await expect(tab(r, /Messages/)).toHaveAttribute("aria-selected", "true");
  await expect(r.locator("aster-rule-editor .aster-rule-group")).toHaveCount(1);
  await tab(r, "Definition").click();
  await expect(page).toHaveURL(new RegExp(`#model/${country.id}$`));
  await page.goBack();
  await expect(tab(r, /Messages/)).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(tab(r, "Definition")).toHaveAttribute("aria-selected", "true");
});

test("with a mouse: the row under the pointer has the controls; a double-click or Escape closes a row with nothing unsaved", async ({ page }) => {
  await model(page);
  const rows = page.locator(".model-grid .aster-grid-row[data-key]");
  const [a, b] = [rows.nth(0), rows.nth(1)];
  const cell = (r: Locator) => r.locator("[role=gridcell]").nth(1);
  const controls = (r: Locator) => r.locator(".aster-grid-controls");
  const expansion = (r: Locator) => r.locator(".aster-grid-expansion");

  // A clicked row keeps its controls until the pointer moves to another row.
  await cell(a).click();
  await expect(a).toHaveAttribute("aria-selected", "true");
  await expect(controls(a)).toHaveCSS("opacity", "1");
  await cell(b).hover();
  await expect(controls(b)).toHaveCSS("opacity", "1");
  await expect(controls(a)).toHaveCSS("opacity", "0");

  // An expanded row keeps them; a second double-click closes it.
  await cell(a).dblclick();
  await expect(expansion(a)).toBeVisible();
  await cell(b).hover();
  await expect(controls(a)).toHaveCSS("opacity", "1");
  await cell(a).dblclick();
  await expect(expansion(a)).toHaveCount(0);

  // Escape closes it from the grid too, after clicking away and back.
  await cell(a).dblclick();
  await expect(expansion(a)).toBeVisible();
  await cell(b).click();
  await cell(a).click();
  await page.keyboard.press("Escape");
  await expect(expansion(a)).toHaveCount(0);

  // With unsaved changes a double-click leaves it open, and Escape asks.
  await cell(a).dblclick();
  await a.getByRole("textbox", { name: "Label" }).fill("Changed");
  await cell(a).dblclick();
  await expect(expansion(a)).toBeVisible();
  await expect(a.getByRole("alertdialog", { name: "Unsaved changes" })).toHaveCount(0);
  await cell(a).click();
  await page.keyboard.press("Escape");
  await expect(a.getByRole("alertdialog", { name: "Unsaved changes" })).toBeVisible();
  await a.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(expansion(a)).toHaveCount(0);
});

test("by keyboard: Enter on a row opens its editor, a save from the controls, Escape comes back", async ({ page }) => {
  await model(page, `#model/${INCORPORATED}`);
  const grid = page.locator(".model-grid .aster-grid-scroll");
  const r = row(page, INCORPORATED);
  await expect(r).toHaveAttribute("aria-selected", "true");
  await grid.focus();
  await page.keyboard.press("Enter");
  await expect(r.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(r.getByRole("textbox", { name: "Label" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Date of incorporation (date)");
  await page.keyboard.press("Escape");
  await expect(r.getByRole("alertdialog", { name: "Unsaved changes" })).toBeVisible();
  await r.getByRole("alertdialog").getByRole("button", { name: "Save" }).press("Enter");
  await expect(r.locator("aster-form")).toHaveCount(0);
  expect((await dump(page)).Fields.find((f) => f.id === INCORPORATED)!.label).toBe("Date of incorporation (date)");
});


test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  /** Visible controls and text in the fields grid that come nearer the screen's sides than the 16px gutter. */
  const outside = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll(".model-grid .aster-grid-row[data-key] :is(input, button, select, textarea, label, [role=combobox], .aster-rule-static), .aster-tree-picker-list:popover-open")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.left < 16 || r.right > innerWidth - 16))
        .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.left)}..${Math.round(r.right)}`),
    );

  test("the tab bar reaches the Model screen and marks it current", async ({ page }) => {
    await page.goto(`${URL_BASE}#home`);
    const bar = page.getByRole("navigation", { name: "Main" }).and(page.locator(".tabbar"));
    await expect(bar.getByRole("link")).toHaveText(["Home", /Projects/, "People", "Tasks", "Model", "Time"]);
    await bar.getByRole("link", { name: "Model" }).tap();
    await expect(page).toHaveURL(/#model$/);
    await expect(page.locator(".model-grid .aster-grid-row[data-key]").first()).toBeVisible();
    await expect(bar.getByRole("link", { name: "Model" })).toHaveAttribute("aria-current", "page");
    await expect(bar.locator("[aria-current]")).toHaveCount(1);
    await expect(bar.getByRole("button", { name: /Theme/ })).toBeVisible();
  });

  test("fields are cards; a field's editor, its rules and the field picker fit inside the gutter; axe-clean", async ({ page }) => {
    await model(page);
    const data = await dump(page);
    const highRisk = data.Fields.find((f) => f.name === "highRisk")!;
    const group = data.Fields.find((f) => f.id === highRisk.parentId)!;
    // A tree card: opener and title on one line as its heading, no space kept for controls it isn't showing.
    const card = row(page, group.id);
    const heading = card.locator("[aria-colindex='1']");
    const [opener, title] = [(await heading.locator(".aster-grid-opener").boundingBox())!, (await heading.getByText(group.label).boundingBox())!];
    expect(Math.abs(opener.y + opener.height / 2 - (title.y + title.height / 2))).toBeLessThan(4);
    await expect(card.locator(".aster-grid-controls")).toBeHidden();
    await heading.tap();
    await expect(card).toHaveAttribute("aria-selected", "true");
    await expect(control(card, "Move to…")).toBeVisible();

    await page.evaluate((id) => (location.hash = `#model/${id}/visibility`), highRisk.id);
    const r = row(page, highRisk.id);
    await expect(r.locator("aster-rule-editor .aster-rule-leaf").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.locator(".model-grid .aster-grid-scroll").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await outside(page)).toEqual([]);
    // The field picker opens its tree in the gutter too, and a tap in the editor is the editor's.
    const picker = r.locator("aster-tree-picker [role=combobox]").first();
    await picker.scrollIntoViewIfNeeded();
    await picker.tap();
    await expect(page.locator(".aster-tree-picker-list:popover-open")).toBeVisible();
    await expect(page.locator("aster-menu.aster-grid-menu [role=menu]:visible")).toHaveCount(0);
    expect(await outside(page)).toEqual([]);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    await page.keyboard.press("Escape");
    await tab(r, "Definition").tap();
    await expect(r.locator("aster-form")).toBeVisible();
    expect(await outside(page)).toEqual([]);
  });
});
