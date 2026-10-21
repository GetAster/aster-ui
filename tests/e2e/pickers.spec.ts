// M4 acceptance 4: pickers search on the server, show columns and groups,
// follow the page scope, hold several values as chips, and create records.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

interface Dump {
  data: {
    Clients: { id: number; name: string; city: string; country: string; industry: string }[];
    Projects: { id: number; clientId: number | null }[];
    TimeEntries: { id: number; personId: number; projectId: number }[];
    Tasks: { id: number; projectId: number; assigneeId: number | null; title: string }[];
    People: { id: number; name: string }[];
  };
}

const dump = (page: Page) => page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<Dump> } } }).aster.mock.dump()).data);

async function project(page: Page, id = 2) {
  await page.goto(`/?memory&debug&time=600&now=${NOW}#project/${id}`);
  const client = page.getByRole("combobox", { name: "Client" });
  await expect(client).toBeVisible();
  return client;
}

test("over 100,000 clients the picker searches on the server while typing, and says how many match", async ({ page }) => {
  const client = await project(page);
  await client.click();
  const list = page.getByRole("listbox", { name: "Client" });
  await expect(list.getByRole("option").first()).toBeVisible();
  const started = Date.now();
  await client.pressSequentially("harbor rob", { delay: 30 });
  const status = page.locator("aster-picker [role=status]").filter({ hasText: "match" });
  await expect(status).toHaveText(/^[\d,]+ matches(, 50 shown)?$/);
  expect(Date.now() - started).toBeLessThan(3000);
  const names = (await list.getByRole("option").allTextContents()).map((t) => t.trim());
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n.toLowerCase()).toContain("harbor rob");
  // The count is the server's, over all 100,000.
  const all = (await dump(page)).Clients;
  const expected = all.filter((c) => c.name.toLowerCase().includes("harbor rob") || c.city.toLowerCase().includes("harbor rob")).length;
  await expect(status).toContainText(`${new Intl.NumberFormat("en-GB").format(expected)} match`);
});

test("columns with a header, headings by country, keyboard through the list, and choosing", async ({ page }) => {
  const client = await project(page);
  await client.click();
  // Few enough matches (about a dozen) to span several countries.
  await client.pressSequentially("harbor robotics oy", { delay: 20 });
  const list = page.getByRole("listbox", { name: "Client" });
  await expect(page.locator("aster-picker [role=status]").filter({ hasText: "match" })).toBeVisible();
  const header = page.getByRole("group", { name: "Sort the options" });
  await expect(header.getByRole("button")).toHaveText(["Client", "City", "Industry"]);
  // Sorting by a column: within each country's heading, by City; again, reversed.
  const cities = async () =>
    list.getByRole("group").evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll("[role=option] .aster-option-col")].filter((_, i) => i % 2 === 0).map((c) => c.textContent!.trim())));
  await header.getByRole("button", { name: "Sort by City" }).click();
  await expect(header.getByRole("button", { name: "Sort by City, now ascending" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await cities()).every((g) => g.join() === [...g].sort().join()) && (await cities()).flat().length > 3).toBe(true);
  await header.getByRole("button", { name: "Sort by City, now ascending" }).click();
  await expect.poll(async () => (await cities()).every((g) => g.join() === [...g].sort().reverse().join())).toBe(true);
  await expect(client).toBeFocused();
  const groups = list.getByRole("group");
  await expect.poll(() => groups.count()).toBeGreaterThan(1);
  const headings = await list.locator(".aster-option-group").allTextContents();
  expect(headings).toEqual([...headings].sort());
  await expect(groups.first()).toHaveAccessibleName(headings[0]!);
  // Home and End, Page Down, then Enter chooses the active option.
  await client.press("End");
  const options = list.getByRole("option");
  const last = await options.last().getAttribute("id");
  await expect(client).toHaveAttribute("aria-activedescendant", last!);
  await expect(options.last()).toHaveText(/^Create/);
  await client.press("Home");
  await client.press("ArrowDown");
  await client.press("ArrowDown");
  const active = page.locator(`#${await client.getAttribute("aria-activedescendant")}`);
  await expect(active).toHaveAttribute("data-active", "");
  const chosen = (await active.locator("span").first().textContent())!.trim();
  await client.press("Enter");
  await expect(list).toBeHidden();
  await expect(client).toHaveValue(chosen);
});

test("Create … opens a small form, creates the client, and selects it", async ({ page }) => {
  const client = await project(page);
  await client.click();
  await client.pressSequentially("Zephyr Quanta", { delay: 20 });
  const create = page.getByRole("option", { name: "Create “Zephyr Quanta”…" });
  await expect(create).toBeVisible();
  await client.press("End");
  await client.press("Enter");
  const form = page.getByRole("dialog", { name: "New client" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Client" })).toHaveValue("Zephyr Quanta");
  await expect(form.getByRole("textbox", { name: "City" })).toBeFocused();
  await form.getByRole("textbox", { name: "City" }).fill("Bergen");
  await form.getByRole("textbox", { name: "Country" }).fill("Norway");
  await form.getByRole("textbox", { name: "Industry" }).fill("Energy");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();
  await expect(client).toHaveValue("Zephyr Quanta");
  await expect(client).toBeFocused();
  const made = (await dump(page)).Clients.filter((c) => c.name === "Zephyr Quanta");
  expect(made).toEqual([expect.objectContaining({ city: "Bergen", country: "Norway", industry: "Energy" })]);
  // Saving the project keeps the new client.
  await page.getByRole("button", { name: "Save" }).click();
  // Asked of the mock directly: a whole dump (100,000 clients) is slow under a parallel run.
  const clientOfProject2 = () =>
    page.evaluate(async () => {
      const { mock } = (globalThis as unknown as { aster: { mock: { external(r: object): Promise<{ body?: string }> } } }).aster;
      const res = await mock.external({ method: "GET", url: "Projects(2)?$select=clientId", headers: {} });
      return (JSON.parse(res.body ?? "{}") as { clientId?: number }).clientId;
    });
  await expect.poll(clientOfProject2).toBe(made[0]!.id);
});

test("Escape leaves the create form without creating anything", async ({ page }) => {
  const client = await project(page);
  const before = (await dump(page)).Clients.length;
  await client.click();
  await client.pressSequentially("Nobody Inc", { delay: 20 });
  await page.getByRole("option", { name: /Create “Nobody Inc”/ }).click();
  await expect(page.getByRole("dialog", { name: "New client" }).getByRole("textbox", { name: "City" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New client" })).toHaveCount(0);
  await expect(client).toBeFocused();
  expect((await dump(page)).Clients.length).toBe(before);
});

test("assignees follow who has logged time on the project; an assignee outside that says so, until they log time", async ({ page }) => {
  await project(page);
  const data = await dump(page);
  const logged = new Set(data.TimeEntries.filter((e) => e.projectId === 2).map((e) => e.personId));
  const name = (id: number) => data.People.find((p) => p.id === id)!.name;
  await page.getByRole("tab", { name: /Tasks/ }).click();
  const assignee = page.getByRole("combobox", { name: "Assignee" }).first();
  await assignee.click();
  const list = page.getByRole("listbox", { name: "Assignee" }).first();
  await expect(list.getByRole("option").first()).toBeVisible();
  const offered = (await list.getByRole("option").allTextContents()).map((t) => t.trim()).sort();
  expect(offered).toEqual([...logged].map(name).sort());
  await assignee.press("Escape");

  const outsider = data.Tasks.find((t) => t.projectId === 2 && t.assigneeId !== null && !logged.has(t.assigneeId));
  test.skip(!outsider, "every assignee on this project has logged time");
  const row = page.getByRole("row").filter({ has: page.getByRole("textbox", { name: "Task" }).and(page.locator(`[value="${outsider!.title}"]`)) });
  const note = page.getByText(`${name(outsider!.assigneeId!)} hasn’t logged time on this project.`).first();
  await expect(note).toBeVisible();
  // As another user, they log an hour on the project: the options follow, and the note goes.
  await page.evaluate(async (body) => {
    const { mock } = (globalThis as unknown as { aster: { mock: { external(r: object): Promise<unknown> } } }).aster;
    await mock.external({ method: "POST", url: "TimeEntries", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }, { date: "2026-10-07", personId: outsider!.assigneeId, projectId: 2, hours: "1.00", billable: true, status: "draft", note: null });
  await expect(note).toHaveCount(0);
  void row;
});

test("a multiple picker filters the grid by any of several people, with chips removable by keyboard", async ({ page }) => {
  await page.goto(`/?memory&debug&time=600&now=${NOW}#time`);
  await page.getByRole("button", { name: "Filters" }).click();
  const filter = page.getByRole("combobox", { name: "Filter Person" });
  await filter.click();
  const list = page.getByRole("listbox", { name: "Filter Person" });
  await expect(list).toHaveAttribute("aria-multiselectable", "true");
  await list.getByRole("option", { name: "Ada Lovelace" }).click();
  await filter.pressSequentially("grace");
  await filter.press("Enter");
  await expect(list.getByRole("option", { name: /Grace Hopper/ })).toHaveAttribute("aria-selected", "true");
  await filter.press("Escape");
  const chips = page.locator(".aster-grid-filter .aster-chip");
  await expect(chips).toHaveText(["Ada Lovelace", "Grace Hopper"]);
  const people = page.locator(".aster-grid-row[data-key] [aria-colindex='2']");
  await expect.poll(async () => new Set((await people.allTextContents()).map((t) => t.trim()))).toEqual(new Set(["Ada Lovelace", "Grace Hopper"]));
  // Backspace in the empty input removes the last chip; a chip's button removes it too.
  await filter.press("Backspace");
  await expect(chips).toHaveText(["Ada Lovelace"]);
  await expect.poll(async () => new Set((await people.allTextContents()).map((t) => t.trim()))).toEqual(new Set(["Ada Lovelace"]));
  await page.getByRole("button", { name: "Remove Ada Lovelace" }).click();
  await expect(chips).toHaveCount(0);
  await expect(filter).toBeFocused();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: a picker with columns and groups open, and chips, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const client = await project(page);
    await client.click();
    await client.pressSequentially("juniper", { delay: 20 });
    await expect(page.locator("aster-picker [role=status]").filter({ hasText: "match" })).toBeVisible();
    let results = await new AxeBuilder({ page }).include("aster-picker").analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);

    await page.goto(`/?memory&debug&time=200&now=${NOW}#time`);
    await page.getByRole("button", { name: "Filters" }).click();
    const filter = page.getByRole("combobox", { name: "Filter Person" });
    await filter.click();
    await page.getByRole("option", { name: "Ada Lovelace" }).click();
    results = await new AxeBuilder({ page }).include(".aster-grid-filters").analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}
