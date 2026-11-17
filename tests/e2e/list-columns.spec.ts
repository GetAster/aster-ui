// A list editor column's `align` and `format`: numeric columns read from the end by default, and a
// money column shows currency in its cells and, while not focused, its input. The journal's lines
// (debit and credit are Decimals of scale 2) are the host.
import { expect, test, type Page } from "@playwright/test";

async function openJournal(page: Page) {
  await page.goto("/playground/finance.html");
  await expect(page.locator("#screens [role=tab]")).toHaveCount(3);
  await page.getByRole("tab", { name: "Journal" }).click();
  await page.locator('[role="tabpanel"]:not([hidden]) .finance-list .invoice-row', { hasText: "JE-0008" }).click();
  await expect(page.locator(".journal-lines [role=row][data-id]")).not.toHaveCount(0);
}
const lines = (page: Page) => page.locator(".journal-lines");
const align = (cell: ReturnType<Page["locator"]>) => cell.evaluate((el) => getComputedStyle(el).textAlign);
/** Where the text of an element ends: a header's text node, an input's own box less its padding. */
const textEnd = (el: ReturnType<Page["locator"]>) => el.evaluate((node) => {
  if (node instanceof HTMLInputElement) return node.getBoundingClientRect().right - parseFloat(getComputedStyle(node).paddingRight);
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getBoundingClientRect().right;
});

test("numeric columns align to the end by default, in the header and the input; text stays at the start", async ({ page }) => {
  await openJournal(page);
  const header = (name: string) => lines(page).getByRole("columnheader", { name, exact: true });
  expect(await align(header("Debit"))).toBe("end");
  expect(await align(header("Credit"))).toBe("end");
  expect(await align(header("Description"))).toBe("start");
  // The account is a key chosen from a tree, so it reads from the start although its key is a number.
  expect(await align(header("Account"))).toBe("start");
  expect(await align(lines(page).getByRole("combobox", { name: "Account" }).first())).toBe("start");
  const debit = lines(page).getByRole("textbox", { name: "Debit" }).first();
  expect(await align(debit)).toBe("end");
  expect(await align(lines(page).getByRole("textbox", { name: "Description" }).first())).toBe("start");
});

test("an end-aligned header's text ends where its inputs' text ends", async ({ page }) => {
  await openJournal(page);
  for (const name of ["Debit", "Credit"]) {
    const header = await textEnd(lines(page).getByRole("columnheader", { name, exact: true }));
    const input = await textEnd(lines(page).getByRole("textbox", { name }).first());
    expect(Math.abs(header - input), name).toBeLessThanOrEqual(1);
  }
});

test("a currency format reads in the input until it is focused, then shows what is typed", async ({ page }) => {
  await openJournal(page);
  const debit = lines(page).getByRole("textbox", { name: "Debit" }).first();
  await expect(debit).toHaveValue("£120.00");
  await expect(lines(page).getByRole("textbox", { name: "Credit" }).first()).toHaveValue("£0.00");
  await debit.focus();
  await expect(debit).toHaveValue("120.00");
  await debit.fill("1234.5");
  await expect(debit).toHaveValue("1234.5");
  await page.keyboard.press("Tab");
  await expect(debit).toHaveValue("£1,234.50");
  await expect(page.locator("[data-total=debit]")).toContainText("£1,234.50");
});

test("a read-only list shows its cells formatted, and align and format override the defaults", async ({ page }) => {
  await openJournal(page);
  await page.evaluate(() => {
    const list = document.querySelector(".journal-lines aster-list-editor") as any;
    list.readOnlyReason = "Posted entries can't be changed.";
  });
  const cell = (n: number) => lines(page).locator("[role=row][data-id]").first().getByRole("cell").nth(n);
  await expect(cell(2)).toHaveText("£120.00");
  expect(await align(cell(2))).toBe("end");

  await page.evaluate(() => {
    const list = document.querySelector(".journal-lines aster-list-editor") as any;
    list.columns = list.columns.map((c: any) => c.field === "debit"
      ? { ...c, display: undefined, align: "start", format: { style: "currency", currency: "EUR", locale: "de-DE" } }
      : c.field === "description" ? { ...c, align: "center" } : c);
  });
  await expect(cell(2)).toHaveText("120,00 €");
  expect(await align(cell(2))).toBe("start");
  expect(await align(cell(1))).toBe("center");
  expect(await align(lines(page).getByRole("columnheader", { name: "Debit", exact: true }))).toBe("start");
  expect(await align(lines(page).getByRole("columnheader", { name: "Description", exact: true }))).toBe("center");
  // Credit keeps its own format and the numeric default.
  expect(await align(cell(3))).toBe("end");
  // A zero side is blank where a journal reads as text: the example's own `display`.
  await expect(cell(3)).toHaveText("");
});

test("a composition catalog checks a column's align and format", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const authoring = lib.defineCompositeRegistry({ models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) }, components: lib.asterComponents });
    const diagnostics = (columns: unknown) => authoring.diagnostics({ version: 1, name: "Columns", model: { type: "empty" }, children: { list: { type: "ListEditor", props: { columns } } }, layout: { child: "list" } });
    return {
      valid: [
        diagnostics([{ field: "rate", align: "end", format: { style: "currency", currency: "GBP" } }]),
        diagnostics([{ field: "share", format: { style: "percent", maximumFractionDigits: 1 } }]),
      ],
      invalid: [
        diagnostics([{ field: "rate", align: "right" }]),
        diagnostics([{ field: "rate", format: { style: "money" } }]),
        diagnostics([{ field: "rate", format: { kind: "number" } }]),
        diagnostics([{ field: "rate", format: "currency" }]),
      ],
    };
  });
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});

test("the columns hold at a phone width, in the dark and in forced colours", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openJournal(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.evaluate(() => { document.documentElement.dataset.scheme = "dark"; document.documentElement.style.colorScheme = "dark"; });
  expect(await align(lines(page).getByRole("columnheader", { name: "Debit", exact: true }))).toBe("end");
  await expect(lines(page).getByRole("textbox", { name: "Debit" }).first()).toHaveValue("£120.00");
  await page.emulateMedia({ forcedColors: "active" });
  expect(await align(lines(page).getByRole("textbox", { name: "Debit" }).first())).toBe("end");
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("stacked at a phone width, each cell names its column, and a control keeps its own label", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/playground/finance.html");
  await page.locator(".invoice-row", { hasText: "INV-1042" }).click();
  const rows = page.locator(".paper-lines [role=row][data-id]");
  await expect(rows).toHaveCount(3);
  const first = rows.first();
  // Text cells: the caption is part of the cell, so a reader hears "Rate £3,600.00".
  for (const [title, value] of [["Qty", "1"], ["Rate", "£3,600.00"], ["Amount", "£3,600.00"]] as [string, string][]) {
    const cell = first.getByRole("gridcell").filter({ has: page.locator(".aster-list-edit-caption", { hasText: title }) });
    await expect(cell).toBeVisible();
    await expect(cell).toHaveText(new RegExp(`^\\s*${title}\\s*${value}$`));
    await expect(cell.locator(".aster-list-edit-caption")).toBeVisible();
    await expect(cell.locator(".aster-list-edit-caption")).not.toHaveAttribute("aria-hidden", "true");
  }
  // A control already has its column as its label, so its caption is for the eye only.
  await first.dblclick();
  await expect(first.getByRole("textbox", { name: "Qty" })).toBeVisible();
  await expect(first.locator(".aster-list-edit-caption[aria-hidden=true]")).toHaveCount(3);
  // Wide, there are no captions: the header row names the columns.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator(".paper-lines .aster-list-edit-caption:visible")).toHaveCount(0);
});
