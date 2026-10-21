// Derived values in the demo: moving a time entry to another project
// suggests whether it's billable, from whether that project has a client,
// until you choose for yourself.
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

interface Data {
  TimeEntries: { id: number; projectId: number; billable: boolean; status: string }[];
  Projects: { id: number; name: string; clientId: number | null }[];
}

async function data(page: Page): Promise<Data> {
  return page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: never }> } } }).aster.mock.dump()).data);
}

test("a billable suggestion follows the project until you set it", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#time`);
  await page.evaluate(() => document.fonts.ready);
  const rows = page.locator(".aster-grid-row[data-key]");
  await expect(rows.first()).toBeVisible();
  const d = await data(page);
  const withClient = d.Projects.find((p) => p.clientId !== null)!;
  const without = d.Projects.find((p) => p.clientId === null)!;
  // A billable entry that isn't approved, on a project with a client, among the rows drawn.
  const drawn = new Set((await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key!))).map((k) => Number(JSON.parse(k)[0])));
  const hasClient = (id: number) => d.Projects.find((p) => p.id === id)?.clientId !== null;
  const entry = d.TimeEntries.find((t) => drawn.has(t.id) && t.status !== "approved" && t.billable && hasClient(t.projectId))!;
  const row = page.locator(`.aster-grid-row[data-key="[${entry.id}]"]`);
  await row.locator("[aria-colindex='3']").dblclick();
  const project = row.getByRole("combobox", { name: "Project" });
  const billable = row.getByRole("checkbox", { name: "Billable" });
  await expect(billable).toBeChecked();
  // Opening the row changes nothing: the stored value stands.
  await expect(row.locator("[data-pending]")).toHaveCount(0);

  await project.fill(without.name);
  await page.getByRole("option", { name: without.name, exact: true }).first().click();
  await expect(billable).not.toBeChecked();
  // The suggestion is a pending change, said as one.
  await expect(billable).toHaveAccessibleDescription(/Changed, not saved yet.*Suggested value/);
  await expect(row.locator("[data-suggested]")).toHaveCount(1);
  await expect(row.getByText("Suggested value", { exact: true })).toBeVisible();
  await project.fill(withClient.name);
  await page.getByRole("option", { name: withClient.name, exact: true }).first().click();
  await expect(billable).toBeChecked();

  // Your choice sticks: the suggestion goes false and then true again, and you keep false.
  // A click, with focus in the row's text field: WebKit doesn't focus a clicked checkbox, and the row stays in edit.
  await expect(project).toBeFocused();
  // Held as long as a person holds a press, so frames pass between down and up.
  const box = (await billable.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect(billable).not.toBeChecked();
  await expect(row).toHaveAttribute("data-editing", "");
  await expect(row.locator("[data-suggested]")).toHaveCount(0);
  for (const p of [without, withClient]) {
    await project.fill(p.name);
    await page.getByRole("option", { name: p.name, exact: true }).first().click();
    await expect(project).toHaveValue(p.name);
  }
  await expect(billable).not.toBeChecked();
});
