// aster-odata's markers in the UI: an estimated count says it's an estimate,
// and a value hidden from the person on one record says so instead of
// showing as empty.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { NOW, server } from "./fixtures.ts";

const metadata = JSON.parse(readFileSync(new URL("../../fixtures/aster/metadata.json", import.meta.url), "utf8"));
const data = JSON.parse(readFileSync(new URL("../../fixtures/aster/data.json", import.meta.url), "utf8")) as {
  Projects: { id: number; name: string; state: string; budget: string }[];
};

async function visit(page: Page, hash: string, extra = ""): Promise<void> {
  await page.goto(`/?memory&debug&clients=2000&time=250&now=${NOW}${extra}${hash}`);
  await page.evaluate(() => document.fonts.ready);
}

/** `$metadata` with `edit` applied, for the mock and the client both. */
async function withMetadata(page: Page, edit: (m: any) => void): Promise<void> {
  const changed = structuredClone(metadata);
  edit(changed);
  await page.addInitScript((m) => Object.assign(globalThis, { asterMetadata: m }), changed);
}

test("an estimated count reads as about so many rows until the end is reached", async ({ page }) => {
  await visit(page, "#time", "&estimate=2");
  const grid = page.getByRole("grid", { name: "Time entries" });
  const total = page.locator(".aster-grid-total");
  await expect(total).toHaveText("About 500 rows");
  // A screen reader hears the same: the row count is unknown, and the grid is described by the estimate.
  await expect(grid).toHaveAttribute("aria-rowcount", "-1");
  await expect(grid).toHaveAccessibleDescription("About 500 rows");
  await expect
    .poll(async () => {
      await grid.evaluate((el) => (el.scrollTop = el.scrollHeight));
      return total.textContent();
    })
    .toBe("250 rows");
  await expect(grid).toHaveAttribute("aria-rowcount", String(250 + 1));
  await expect(grid).not.toHaveAttribute("aria-describedby");
});

test("a value hidden on one record shows as hidden in the form, and a save leaves it alone", async ({ page }) => {
  await withMetadata(page, (m) => {
    m.AsterDemo.Project.budget["@AsterData.ViewableWhen#BudgetUnlessPaused"] = { $Ne: [{ $Path: "state" }, "paused"] };
  });
  const paused = data.Projects.find((p) => p.state === "paused")!;
  const active = data.Projects.find((p) => p.state === "active")!;
  await visit(page, `#project/${paused.id}`);
  const budget = page.getByRole("textbox", { name: "Budget", exact: true });
  await expect(budget).toHaveAttribute("placeholder", "Hidden");
  await expect(budget).toHaveValue("");
  await expect(budget).toHaveAttribute("readonly", "");
  await expect(budget).toHaveAccessibleDescription(/You can't see Budget on this record\./);
  const name = page.getByRole("textbox", { name: "Project", exact: true });
  await name.fill(`${paused.name} (on hold)`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await server(page)).Projects.find((p) => p.id === paused.id)?.name).toBe(`${paused.name} (on hold)`);
  const stored = (await server(page)).Projects.find((p) => p.id === paused.id) as unknown as { budget: string };
  expect(stored.budget).toBe(paused.budget);
  // Where it isn't hidden, the value shows as usual.
  await page.evaluate((h) => (location.hash = h), `#project/${active.id}`);
  await expect(page.getByRole("textbox", { name: "Budget", exact: true })).not.toHaveValue("");
});

test("a value hidden on some rows reads Hidden in those grid cells", async ({ page }) => {
  await withMetadata(page, (m) => {
    m.AsterDemo.TimeEntry.note["@AsterData.ViewableWhen#NoteWhenBillable"] = { $Eq: [{ $Path: "billable" }, true] };
  });
  await visit(page, "#time");
  const grid = page.getByRole("grid", { name: "Time entries" });
  await expect(grid.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  const notBillable = grid.locator(".aster-grid-row[data-key]").filter({ hasNot: page.locator("[aria-colindex='5']", { hasText: "Yes" }) }).first();
  const billable = grid.locator(".aster-grid-row[data-key]").filter({ has: page.locator("[aria-colindex='5']", { hasText: "Yes" }) }).first();
  await expect(notBillable.getByRole("gridcell").nth(6)).toHaveText("Hidden");
  await expect(billable.getByRole("gridcell").nth(6)).not.toHaveText("Hidden");
});
