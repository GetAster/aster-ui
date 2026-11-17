// A tree picker as the editor of a list-editor column and of a form field, over the finance chart of
// accounts: the hierarchy shows, only leaf accounts can be chosen, the chosen account reads "code name".
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "") {
  await page.goto(`/playground/finance.html${query}`);
  await expect(page.locator("#screens [role=tab]")).toHaveCount(3);
  await page.getByRole("tab", { name: "Journal" }).click();
  await expect(page.locator(".journal-lines [role=row][data-id]")).toHaveCount(2);
}
const lines = (page: Page) => page.locator(".journal-lines");
const account = (page: Page, line = 0) => lines(page).getByRole("combobox", { name: "Account" }).nth(line);
const node = (page: Page, name: RegExp | string) => page.getByRole("treeitem", { name });

test("the account column opens the chart as a tree and chooses only postable accounts", async ({ page }) => {
  await open(page);
  await expect(account(page)).toHaveValue("5120 Software");
  await account(page).click();
  await expect(page.getByRole("tree", { name: "Account" })).toBeVisible();
  // The chosen account is revealed under its parents, at its level.
  await expect(node(page, /^5000 /)).toHaveAttribute("aria-expanded", "true");
  await expect(node(page, /5120 Software/)).toHaveAttribute("aria-selected", "true");
  const level = async (name: RegExp) => Number(await node(page, name).getAttribute("aria-level"));
  expect(await level(/^5000 /)).toBe(1);
  expect(await level(/5120 Software/)).toBeGreaterThan(await level(/^5000 /));

  // A group opens and never chooses.
  await node(page, /^1000 Assets/).click();
  await expect(node(page, /^1100 Current assets/)).toBeVisible();
  await node(page, /^1100 Current assets/).click();
  await expect(account(page)).toHaveValue("5120 Software");
  await expect(node(page, /1110 Bank account/)).toBeVisible();

  // A leaf chooses, and the popup closes on the label.
  await node(page, /1110 Bank account/).click();
  await expect(page.getByRole("tree", { name: "Account" })).toBeHidden();
  await expect(account(page)).toHaveValue("1110 Bank account");
  // The row stays one line high: the path is described, not drawn, under the cell.
  await expect(account(page)).toHaveAccessibleDescription(/Assets.*Current assets/);
  await expect(lines(page).locator(".aster-tree-picker-trail").first()).toBeHidden();
  const heights = await lines(page).locator("[role=row][data-id]").first().evaluate((row) => [...row.querySelectorAll("aster-tree-picker, aster-field")].map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
});

test("typing searches by code or name, keeping the groups that lead to each match", async ({ page }) => {
  await open(page);
  await account(page).fill("5130");
  await expect(node(page, /5130 Salaries/)).toBeVisible();
  await expect(node(page, /5120 Software/)).toHaveCount(0);
  await expect(node(page, /^5000 /)).toBeVisible();
  await account(page).fill("payable");
  await expect(node(page, /2110 Accounts payable/)).toBeVisible();
  await expect(node(page, /2120 Sales tax payable/)).toBeVisible();
  await node(page, /2110 Accounts payable/).click();
  await expect(account(page)).toHaveValue("2110 Accounts payable");
  await account(page).fill("zzzz");
  await expect(page.getByRole("tree", { name: "Account" }).getByText("Nothing matches")).toBeVisible();
});

test("the keyboard opens the tree, walks it, chooses a leaf and keeps Escape for the open tree first", async ({ page }) => {
  await open(page);
  await account(page).focus();
  await page.keyboard.press("Escape");
  await account(page).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tree", { name: "Account" })).toBeHidden();
  await expect(account(page)).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(account(page)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Home");
  // Walk 1000 Assets > 1100 Current assets > 1110 Bank account by arrows.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await expect(account(page)).toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(node(page, /1110 Bank account/)).toHaveAttribute("data-active", "");
  // Enter on a group only opens it; on a leaf it chooses.
  await page.keyboard.press("Enter");
  await expect(account(page)).toHaveValue("1110 Bank account");
  await expect(page.getByRole("tree", { name: "Account" })).toBeHidden();
  await expect(account(page)).toBeFocused();
  await expect(page.getByRole("button", { name: "Save draft" })).not.toHaveAttribute("aria-disabled", "true");
});

test("a changed cell is marked pending, an empty one is invalid, a disabled one is inert and a posted entry reads as text", async ({ page }) => {
  await open(page);
  const cell = lines(page).locator("aster-tree-picker").first();
  await expect(cell).not.toHaveAttribute("data-pending", "");
  await account(page).click();
  await node(page, /5130 Salaries/).click();
  await expect(cell).toHaveAttribute("data-pending", "");
  await expect(account(page)).toHaveAccessibleDescription(/Changed, not saved yet/);
  // The ink edge that marks a pending field is drawn on the tree picker's frame as on the others.
  const frame = (n: number) => lines(page).locator("aster-tree-picker .aster-field").nth(n).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(await frame(0)).not.toBe(await frame(1));

  await page.getByRole("button", { name: "Revert", exact: true }).click();
  await expect(account(page)).toHaveValue("5120 Software");

  // A new line has no account yet; saving says so.
  await page.getByRole("button", { name: "Add line" }).click();
  const added = account(page, 2);
  await expect(added).toHaveValue("");
  await added.fill("0");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(added).toHaveAttribute("aria-invalid", "true");
  await expect(lines(page).locator("aster-tree-picker").nth(2)).toContainText(/\S/);

  // Disabled: the input can't take focus or open the tree.
  await page.evaluate(() => {
    const editor = document.querySelector<any>(".journal-lines aster-list-editor");
    editor.list.rows.value[0].edit.applyPolicy({ fields: { accountId: { disabled: true } } });
  });
  await expect(account(page)).toBeDisabled();
  await account(page).click({ force: true });
  await expect(page.getByRole("tree", { name: "Account" })).toBeHidden();

  // A posted entry reads: the label is text, with no control.
  await page.locator(".finance-list .invoice-row", { hasText: "JE-0004" }).click();
  await expect(lines(page).getByRole("combobox")).toHaveCount(0);
  await expect(lines(page)).toContainText("5120 Software");
  await expect(lines(page)).toContainText("1110 Bank account");
});

test("a field the row can't change reads as the account's label", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const editor = document.querySelector<any>(".journal-lines aster-list-editor");
    editor.list.rows.value[0].edit.applyPolicy({ fields: { accountId: { readOnly: true } } });
  });
  await expect(lines(page).getByRole("combobox", { name: "Account" })).toHaveCount(1);
  await expect(lines(page).locator(".aster-list-edit-static").first()).toContainText("5120 Software");
});

test("a form field that is a foreign key into a tree gets a tree picker, unless it is told otherwise", async ({ page }) => {
  await open(page);
  const used = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const finance = (globalThis as any).finance;
    const host = document.createElement("div");
    document.body.append(host);
    const make = (items: unknown[]) => {
      const form = document.createElement("aster-form") as any;
      form.model = new lib.EditModel(finance.ctx, "JournalLines");
      form.sections = [{ title: "Line", items }];
      host.append(form);
      return form;
    };
    const auto = make(["accountId", "debit"]);
    const text = make([{ field: "accountId", control: "text" }]);
    const own = make([{ field: "accountId", options: new lib.TreeChoices(finance.ctx, { set: "Accounts", parentField: "parentId", display: "label", choosable: (a: any) => a.postable === true }) }]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const tags = (form: HTMLElement) => [...form.querySelectorAll("aster-tree-picker, aster-picker, aster-field, aster-number-field")].map((e) => e.tagName.toLowerCase());
    return { auto: tags(auto), text: tags(text), own: tags(own) };
  });
  expect(used.auto).toEqual(["aster-tree-picker", "aster-number-field"]);
  expect(used.text).toEqual(["aster-field"]);
  expect(used.own).toEqual(["aster-tree-picker"]);
});

test("a tree's own parent field is not given a tree picker", async ({ page }) => {
  await open(page);
  const tags = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const finance = (globalThis as any).finance;
    const form = document.createElement("aster-form") as any;
    form.model = new lib.EditModel(finance.ctx, "Accounts");
    form.sections = [{ title: "Account", items: ["name", "parentId"] }];
    document.body.append(form);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return [...form.querySelectorAll("aster-tree-picker")].length;
  });
  expect(tags).toBe(0);
});

test("the composition contracts accept tree choices as options and reject look-alikes", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const finance = (globalThis as any).finance;
    const tree = new lib.TreeChoices(finance.ctx, { set: "Accounts", parentField: "parentId" });
    const column = (options: unknown) => lib.asterComponents.ListEditor.props.columns.validate([{ field: "accountId", options }]);
    const field = (options: unknown) => lib.asterComponents.Form.props.sections.validate([{ title: "Line", items: [{ field: "accountId", options }] }]);
    return { valid: [column(tree), column(undefined), field(tree)], invalid: [column({ set: "Accounts" }), column("Accounts"), field({ set: "Accounts" })] };
  });
  expect(result.valid).toEqual([true, true, true]);
  expect(result.invalid).toEqual([false, false, false]);
});

for (const [theme, scheme] of [["lamplight", "light"], ["lamplight", "dark"], ["harbour", "light"], ["harbour", "dark"]] as const) {
  test(`the open account tree passes an accessibility scan in ${theme} ${scheme}`, async ({ page }) => {
    await open(page, `?theme=${theme}&scheme=${scheme}`);
    await account(page).click();
    await expect(node(page, /5120 Software/)).toBeVisible();
    await page.waitForTimeout(300);
    const { violations } = await new AxeBuilder({ page }).include(".finance-screen").analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("on a phone the open tree stays inside the screen, and in forced colours the chosen node is still marked", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
  await account(page).click();
  const tree = page.getByRole("tree", { name: "Account" });
  await expect(tree).toBeVisible();
  const box = (await tree.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(node(page, /5120 Software/)).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
