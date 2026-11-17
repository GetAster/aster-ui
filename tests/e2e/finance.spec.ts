// The finance workspace: three screens over one dataset. Posting writes a journal entry and the
// service recomputes the accounts above its lines, so every screen changes without a screen asking.
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test, pageUrl } from "./cdp.ts";

async function open(page: Page, query = "") {
  await page.goto(pageUrl(`/playground/finance.html${query}`));
  await expect(page.locator("#screens [role=tab]")).toHaveCount(3);
  await expect(page.locator(".invoice-row")).toHaveCount(4);
}
const balance = (page: Page) => page.locator('[role="tabpanel"]:not([hidden]) .finance-balance');
const tab = (page: Page, name: string) => page.getByRole("tab", { name });
const figure = (page: Page, name: string) => page.locator(`[data-figure="${name}"]`);
const account = (page: Page, name: RegExp | string) => page.locator("aster-grid").getByRole("row", { name });
const invoice = (page: Page, number: string) => page.locator(".invoice-row", { hasText: number });
const ENTRY_RULE = "An entry needs two lines and equal debits and credits to be posted.";
const entry = (page: Page, reference: string) => page.locator('[role="tabpanel"]:not([hidden]) .finance-list .invoice-row', { hasText: reference });

test("an invoice reads as a document with its status in words and exact computed totals", async ({ page }) => {
  await open(page);
  await invoice(page, "INV-1042").click();
  const paper = page.locator(".paper");
  await expect(paper.locator("h2")).toHaveText("INV-1042");
  await expect(paper.getByText("Pending", { exact: true })).toBeVisible();
  await expect(paper.getByText("Fernbank Design Studio Ltd")).toBeVisible();
  await expect(paper.getByText("Harbour & Vale Ltd")).toBeVisible();
  await expect(paper.getByText("Quarterly design retainer")).toBeVisible();
  // 3,600.00 + 1,850.50 + 3 × 125.00, taxed at 20%.
  await expect(paper.locator(".paper-totals")).toContainText("£5,825.50");
  await expect(paper.locator(".paper-totals")).toContainText("£1,165.10");
  await expect(paper.locator(".paper-total")).toContainText("£6,990.60");
  // Numbers sit on the right edge of their cells.
  const amounts = paper.locator(".finance-num").first();
  expect(await amounts.evaluate((el) => getComputedStyle(el).textAlign)).toBe("end");

  await invoice(page, "INV-1043").click();
  await expect(paper.getByText("Overdue", { exact: true })).toBeVisible();
  await invoice(page, "INV-1041").click();
  await expect(paper.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Post to ledger" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Posted as")).toContainText("JE-0005");
});

test("editing the lines updates the totals as you type, and saving keeps them", async ({ page }) => {
  await open(page);
  await invoice(page, "INV-1044").click();
  await expect(page.locator(".paper-total")).toContainText("£1,140.00");
  await page.getByRole("button", { name: "Post to ledger" }).hover();
  await page.getByRole("row", { name: /Onboarding session/ }).dblclick();
  await page.getByRole("textbox", { name: "Qty" }).fill("4");
  await page.keyboard.press("Enter");
  // 25 × 18.00 + 4 × 250.00 = 1,450.00; tax 290.00.
  await expect(page.locator(".paper-total")).toContainText("£1,740.00");
  await expect(page.getByRole("button", { name: "Post to ledger" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".paper-total")).toContainText("£1,740.00");
  // The service computed the same amount.
  const stored = await page.evaluate(async () => {
    const response = await (globalThis as any).finance.mock.transport({ method: "GET", url: "InvoiceLines?$filter=description eq 'Onboarding session'", headers: { accept: "application/json;IEEE754Compatible=true" } });
    return JSON.parse(response.body).value[0].amount;
  });
  expect(stored).toBe("1000.00");
});

test("posting an invoice books its entry and every balance up the chart follows, then Undo takes it back", async ({ page }) => {
  await open(page);
  await invoice(page, "INV-1042").click();
  await page.getByRole("button", { name: "Post to ledger" }).click();
  await expect(page.locator(".aster-toast")).toContainText("Posted INV-1042 as JE-0009");
  await expect(page.getByRole("button", { name: "Post to ledger" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Posted as")).toContainText("JE-0009");

  // The journal has the entry, posted, with the three lines a taxed sale needs.
  await tab(page, "Journal").click();
  await expect(entry(page, "JE-0009")).toContainText("Posted");
  await entry(page, "JE-0009").click();
  await expect(page.locator("[data-total=debit]")).toContainText("£6,990.60");
  await expect(page.locator("[data-total=credit]")).toContainText("£6,990.60");
  await expect(balance(page)).toContainText("Balanced");
  await expect(page.locator(".journal-lines [role=row][data-id]")).toHaveCount(3);

  // The chart: the receivable and both parents above it moved, with no screen asking for it.
  await tab(page, "Chart of accounts").click();
  await expect(figure(page, "assets")).toHaveText("£53,141.60");
  await expect(figure(page, "liabilities")).toHaveText("£2,365.10");
  await expect(figure(page, "revenue")).toHaveText("£11,825.50");
  await expect(balance(page)).toContainText("The books balance");
  await expect(account(page, /Accounts receivable/)).toContainText("£6,990.60");
  await expect(account(page, /Current assets/)).toContainText("£48,341.60");
  await expect(account(page, /^.*1000.*Assets/)).toContainText("£53,141.60");
  await expect(account(page, /Sales tax payable/)).toContainText("£2,365.10");

  // Undo from the toast, which is still on screen on the next tab.
  await tab(page, "Invoices").click();
  await page.locator(".aster-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".aster-toast")).toContainText("INV-1042 is back out of the ledger");
  await expect(page.getByRole("button", { name: "Post to ledger" })).not.toHaveAttribute("aria-disabled", "true");
  await tab(page, "Chart of accounts").click();
  await expect(figure(page, "assets")).toHaveText("£46,151.00");
  await expect(account(page, /Accounts receivable/)).toContainText("£0.00");
  await tab(page, "Journal").click();
  await expect(page.locator('[role="tabpanel"]:not([hidden]) .finance-list .invoice-row')).toHaveCount(8);
});

test("a journal entry whose debits and credits differ can't be posted; balancing it lets it post", async ({ page }) => {
  await open(page);
  await tab(page, "Journal").click();
  await expect(entry(page, "JE-0008")).toContainText("Draft");
  const post = page.getByRole("button", { name: "Post entry" });
  await expect(page.locator("[data-total=debit]")).toContainText("£120.00");
  await expect(page.locator("[data-total=credit]")).toContainText("£100.00");
  await expect(balance(page)).toContainText("Out of balance by £20.00");
  await expect(post).toHaveAttribute("aria-disabled", "true");
  await expect(post).toHaveAttribute("title", ENTRY_RULE);
  // A click on the disabled button does nothing: the entry is still a draft and the books are as they were.
  await post.click({ force: true });
  expect(await page.evaluate(async () => (await (globalThis as any).finance.mock.dump()).data.JournalEntries.find((e: any) => e.id === 8).status)).toBe("draft");

  // Balance it by raising the credit to 120.00.
  const credit = page.locator(".journal-lines").getByRole("textbox", { name: "Credit" }).nth(1);
  await credit.fill("120.00");
  await expect(balance(page)).toContainText("Balanced: debits equal credits.");
  await expect(post).not.toHaveAttribute("aria-disabled", "true");
  // Saving a draft doesn't post it, and doesn't change the accounts.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(entry(page, "JE-0008")).toContainText("Draft");
  await tab(page, "Chart of accounts").click();
  await expect(figure(page, "expenses")).toHaveText("£11,049.00");

  await tab(page, "Journal").click();
  await post.click();
  await expect(page.locator(".aster-toast")).toContainText("Posted JE-0008");
  await expect(entry(page, "JE-0008")).toContainText("Posted");
  await expect(page.locator(".journal-lines")).toContainText("Posted entries can't be changed.");
  await tab(page, "Chart of accounts").click();
  await expect(figure(page, "expenses")).toHaveText("£11,169.00");
  await expect(figure(page, "liabilities")).toHaveText("£1,320.00");
  await expect(account(page, /Accounts payable/)).toContainText("£120.00");
  await expect(account(page, /Operating expenses/)).toContainText("£11,169.00");
});

test("a line can't carry both a debit and a credit", async ({ page }) => {
  await open(page);
  await tab(page, "Journal").click();
  const lines = page.locator(".journal-lines");
  await lines.getByRole("textbox", { name: "Credit" }).first().fill("5.00");
  await expect(page.getByRole("button", { name: "Post entry" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Post entry" })).toHaveAttribute("title", "Fix the lines marked first.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(lines).toContainText("A line is a debit or a credit, not both.");
});

test("a new entry is a draft with no lines, and lines are chosen by account", async ({ page }) => {
  await open(page);
  await tab(page, "Journal").click();
  await page.getByRole("button", { name: "New entry" }).click();
  await expect(page.locator(".journal-head h2")).toHaveText("JE-0009");
  await expect(balance(page)).toContainText("No lines yet.");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByRole("combobox", { name: "Account" }).first().click();
  // The chart shows as a tree: open the groups to reach the account.
  await page.getByRole("treeitem", { name: /^1000 Assets/ }).click();
  await page.getByRole("treeitem", { name: /^1100 Current assets/ }).click();
  await page.getByRole("treeitem", { name: /Bank account/ }).click();
  await expect(page.getByRole("combobox", { name: "Account" }).first()).toHaveValue("1110 Bank account");
  // The group above an account is shown but can't be chosen.
  await page.getByRole("combobox", { name: "Account" }).first().click();
  await page.getByRole("treeitem", { name: /^1100 Current assets/ }).click();
  await expect(page.getByRole("combobox", { name: "Account" }).first()).toHaveValue("1110 Bank account");
  await expect(page.getByRole("treeitem", { name: /^1100 Current assets/ })).toHaveAttribute("aria-expanded", "false");
});

test("the invoice prints as a document", async ({ page }) => {
  await open(page);
  await invoice(page, "INV-1042").click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".paper")).toBeVisible();
  await expect(page.locator(".finance-list")).toBeHidden();
  await expect(page.locator("aster-form")).toBeHidden();
  await expect(page.getByRole("button", { name: "Post to ledger" })).toBeHidden();
  await expect(page.locator("aster-tabs [role=tablist]")).toBeHidden();
  await expect(page.locator(".paper .aster-list-edit-add")).toBeHidden();
  await expect(page.locator(".paper-total")).toBeVisible();
  const paper = await page.locator(".paper").evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, border: getComputedStyle(el).borderTopWidth }));
  expect(paper).toEqual({ shadow: "none", border: "0px" });
});

for (const [theme, scheme] of [["lamplight", "light"], ["lamplight", "dark"], ["harbour", "light"], ["harbour", "dark"]] as const) {
  test(`every screen passes an accessibility scan in ${theme} ${scheme}`, async ({ page }) => {
    await open(page, `?theme=${theme}&scheme=${scheme}`);
    for (const name of ["Invoices", "Chart of accounts", "Journal"]) {
      await tab(page, name).click();
      await expect(page.locator('[role="tabpanel"]:not([hidden])')).toBeVisible();
      await page.waitForTimeout(300);
      const { violations } = await new AxeBuilder({ page }).include(".finance-screen").analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
  });
}

test("forced colours keep the balance and status text readable", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
  await expect(page.locator(".invoice-row", { hasText: "INV-1043" }).getByText("Overdue")).toBeVisible();
  await tab(page, "Journal").click();
  await expect(balance(page)).toBeVisible();
  await expect(balance(page)).toContainText("Out of balance by £20.00");
});

test("on a phone each screen fits the width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  for (const name of ["Invoices", "Chart of accounts", "Journal"]) {
    await tab(page, name).click();
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, name).toBeLessThanOrEqual(0);
  }
});

test("on a phone every invoice line shows its amount without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await invoice(page, "INV-1042").click();
  const lines = page.locator(".paper-lines");
  const within = async (cell: Locator) => {
    await expect(cell).toBeVisible();
    await cell.scrollIntoViewIfNeeded();
    const box = (await cell.boundingBox())!;
    expect(box.x, "left edge").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "right edge").toBeLessThanOrEqual(390);
  };
  // In each row the amount is the last figure.
  for (const amount of ["£3,600.00", "£1,850.50", "£375.00"]) await within(lines.getByRole("gridcell").filter({ hasText: amount }).last());
  // The rate is there too, and the lines don't scroll.
  await within(lines.getByRole("gridcell").filter({ hasText: "£125.00" }).first());
  expect(await lines.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test("journal figures line up: inputs, headers and totals share the right edge", async ({ page }) => {
  await open(page);
  await tab(page, "Journal").click();
  const edges = await page.evaluate(() => {
    const field = (name: string) => [...document.querySelectorAll<HTMLInputElement>(".journal-lines input")].filter((i) => i.getAttribute("aria-label") === name || i.closest("[data-cell]")?.querySelector("label")?.textContent === name);
    return field("Debit").concat(field("Credit")).map((i) => getComputedStyle(i).textAlign);
  });
  expect(edges.length).toBeGreaterThan(0);
  expect(new Set(edges)).toEqual(new Set(["end"]));
});

test("the account picker is the chart of accounts, naming accounts by code and name", async ({ page }) => {
  await open(page);
  await tab(page, "Journal").click();
  await expect(page.getByRole("combobox", { name: "Account" }).first()).toHaveValue("5120 Software");
  await page.getByRole("combobox", { name: "Account" }).first().fill("5130");
  await expect(page.getByRole("treeitem", { name: /5130 Salaries/ })).toBeVisible();
  // The group that holds it stays, to show where it sits.
  await expect(page.getByRole("treeitem", { name: /^5100 Operating expenses/ })).toBeVisible();
});

/** What a refused post leaves: the Post handler run on JE-0008 while its lines are out of balance. The button is disabled then, so the handler is called directly. */
async function refusePost(page: Page) {
  await open(page);
  await tab(page, "Journal").click();
  await expect(entry(page, "JE-0008")).toContainText("Draft");
  await page.evaluate(() => (globalThis as any).finance.journal.post());
}
const summary = (page: Page) => page.locator(".journal-entry .aster-form-summary");
const lineFailure = (page: Page) => page.locator(".journal-lines .aster-list-edit-errors");

test("a refused post shows the entry's rule in the summary and under the lines, and focus goes to the summary", async ({ page }) => {
  await open(page);
  await tab(page, "Journal").click();
  // The editor's polite region exists before anything fails, so the words are announced when they arrive.
  const region = lineFailure(page);
  const said = page.locator(".journal-lines [aria-live=polite]");
  await expect(said).toHaveText("");
  await expect(region).toHaveText("");
  const handle = await said.elementHandle();
  await page.evaluate(() => (globalThis as any).finance.journal.post());
  await expect(summary(page)).toHaveAttribute("role", "alert");
  await expect(summary(page)).toContainText("There is 1 problem");
  await expect(summary(page)).toBeFocused();
  await expect(region).toHaveText(ENTRY_RULE);
  await expect(said).toHaveText(ENTRY_RULE);
  expect(await handle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator(".journal-lines .aster-list-edit")).toHaveAttribute("aria-describedby", (await region.getAttribute("id"))!);
  // Nothing was sent: the entry is still a draft in the service.
  expect(await page.evaluate(async () => (await (globalThis as any).finance.mock.dump()).data.JournalEntries.find((e: any) => e.id === 8).status)).toBe("draft");
  // The entry stays in the page as the person left it: Save draft is still available.
  await expect(page.getByRole("button", { name: "Save draft" })).not.toHaveAttribute("aria-disabled", "true");
});

test("with autoFocus off, a refused post is announced by the summary and focus is not moved", async ({ page }) => {
  await open(page);
  await tab(page, "Journal").click();
  // The page binds autoFocus on and rebinds it on a render, so the host's choice is made for good here.
  await page.evaluate(() => {
    const form = document.querySelector(".journal-entry aster-form") as any;
    form.chrome = {};
    Object.defineProperty(form, "chrome", { get: () => ({}), set: () => {} });
  });
  await page.getByRole("button", { name: "New entry" }).focus();
  await page.evaluate(() => (globalThis as any).finance.journal.post());
  await expect(summary(page)).toHaveAttribute("role", "alert");
  await expect(summary(page)).toContainText(ENTRY_RULE);
  await page.waitForTimeout(300);
  // Nothing moved focus to the summary or into the form (the button that held it is busy during the post).
  await expect(summary(page)).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.closest(".journal-entry") !== null && document.activeElement !== document.body)).toBe(false);
});

test("a refused post leaves the failure showing, and Save draft saves it as a draft", async ({ page }) => {
  await refusePost(page);
  await expect(summary(page)).toBeVisible();
  await expect(page.locator(".journal-head")).toContainText("Draft");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(summary(page)).toHaveCount(0);
  await expect(entry(page, "JE-0008")).toContainText("Draft");
  expect(await page.evaluate(async () => (await (globalThis as any).finance.mock.dump()).data.JournalEntries.find((e: any) => e.id === 8).status)).toBe("draft");
});

test("the summary's button for a list failure moves focus to the first line control", async ({ page }) => {
  await refusePost(page);
  await summary(page).getByRole("button", { name: ENTRY_RULE }).click();
  await expect(page.getByRole("combobox", { name: "Account" }).first()).toBeFocused();
});

test("the failure follows the lines as they are edited, politely, and focus stays in the cell", async ({ page }) => {
  await refusePost(page);
  const credit = page.locator(".journal-lines").getByRole("textbox", { name: "Credit" }).nth(1);
  await credit.fill("120.00");
  await expect(lineFailure(page)).toHaveText("");
  await expect(summary(page)).toHaveCount(0);
  // Out again: the message comes back where it was, and nothing takes the focus from the cell being typed in.
  await credit.fill("110.00");
  await expect(lineFailure(page)).toHaveText(ENTRY_RULE);
  await expect(summary(page)).toBeVisible();
  await expect(credit).toBeFocused();
  // Balanced, Post is available again, and the entry posts.
  await credit.fill("120.00");
  await page.getByRole("button", { name: "Post entry" }).click();
  await expect(page.locator(".aster-toast")).toContainText("Posted JE-0008");
  await expect(entry(page, "JE-0008")).toContainText("Posted");
});

test("the service refuses an unbalanced post by the rule's id and message", async ({ page }) => {
  await open(page);
  const answer = await page.evaluate(async () => {
    const response = await (globalThis as any).finance.mock.transport({
      method: "PATCH", url: "JournalEntries(8)", headers: { "content-type": "application/json", "if-match": "*", accept: "application/json;IEEE754Compatible=true" }, body: JSON.stringify({ status: "posted" }),
    });
    return { status: response.status, error: JSON.parse(response.body).error };
  });
  expect(answer.status).toBe(400);
  expect(JSON.stringify(answer.error)).toContain("EntryBalances");
  expect(JSON.stringify(answer.error)).toContain(ENTRY_RULE);
});

for (const [theme, scheme] of [["lamplight", "light"], ["lamplight", "dark"], ["harbour", "light"], ["harbour", "dark"]] as const) {
  test(`the journal with a refused post passes an accessibility scan in ${theme} ${scheme}`, async ({ page }) => {
    await page.goto(pageUrl(`/playground/finance.html?theme=${theme}&scheme=${scheme}`));
    await expect(page.locator("#screens [role=tab]")).toHaveCount(3);
    await tab(page, "Journal").click();
    await page.evaluate(() => (globalThis as any).finance.journal.post());
    await expect(summary(page)).toBeVisible();
    await expect(lineFailure(page)).toHaveText(ENTRY_RULE);
    await page.waitForTimeout(300);
    const { violations } = await new AxeBuilder({ page }).include(".finance-screen").analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("in forced colours the failure is text and the summary takes focus", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await refusePost(page);
  await expect(summary(page)).toBeFocused();
  await expect(summary(page)).toContainText(ENTRY_RULE);
  await expect(lineFailure(page)).toContainText(ENTRY_RULE);
});

test("on a phone the message under the lines wraps inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await refusePost(page);
  const box = (await lineFailure(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
