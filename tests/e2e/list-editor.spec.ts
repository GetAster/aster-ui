// The list editor's row mode: read rows in the page's own layout, one row edited at a time,
// a single selection, and the page's own Add menu as the only way to add.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/playground/list-editor.html");
  await expect(page.locator("#fields .aster-list-edit-row[data-id]")).toHaveCount(3);
}
const row = (page: Page, id: number) => page.locator(`#fields .aster-list-edit-row[data-id="[${id}]"]`);
const status = (page: Page) => page.locator("#status");

test("rows read in the page's layout, and one row at a time edits on double-click and Enter", async ({ page }) => {
  await open(page);
  const grid = page.locator("#fields .aster-list-edit");
  await expect(grid).toHaveAttribute("role", "grid");
  await expect(page.locator("#fields input, #fields textarea, #fields select")).toHaveCount(0);
  await expect(row(page, 1).locator(".field-row strong")).toHaveText("Full name");

  await row(page, 1).dblclick();
  await expect(row(page, 1).getByRole("textbox", { name: "Name" })).toBeFocused();
  await expect(row(page, 1)).toHaveAttribute("data-editing", "");
  // Activating another row keeps the first one's change as draft and moves on.
  await row(page, 1).getByRole("textbox", { name: "Name" }).fill("Legal name");
  await row(page, 2).focus();
  await page.keyboard.press("Enter");
  await expect(row(page, 2).getByRole("textbox", { name: "Name" })).toBeFocused();
  await expect(row(page, 1)).not.toHaveAttribute("data-editing", "");
  await expect(row(page, 1).locator(".field-row strong")).toHaveText("Legal name");
  await expect(page.locator("#fields [data-editing]")).toHaveCount(1);
  await expect(status(page)).toHaveText("Unsaved changes");
});

test("Enter keeps the row as a pending draft, Shift+Enter in a textarea is a newline, Escape puts it back", async ({ page }) => {
  await open(page);
  await row(page, 3).focus();
  await page.keyboard.press("Enter");
  const name = row(page, 3).getByRole("textbox", { name: "Name" });
  await name.fill("Household");
  await row(page, 3).getByRole("textbox", { name: "Description" }).focus();
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line");
  await expect(row(page, 3).getByRole("textbox", { name: "Description" })).toHaveValue(/\nSecond line$/);
  await page.keyboard.press("Enter");
  await expect(row(page, 3)).not.toHaveAttribute("data-editing", "");
  await expect(row(page, 3)).toBeFocused();
  await expect(row(page, 3).locator(".field-row strong")).toHaveText("Household");
  await expect(status(page)).toHaveText("Unsaved changes");
  expect(await page.evaluate(() => (document.querySelector("#fields") as any).list.dirty.value)).toBe(true);

  // Another row's Escape leaves row 3's pending draft alone and puts back only its own edits.
  await row(page, 1).dblclick();
  await row(page, 1).getByRole("textbox", { name: "Name" }).fill("Throwaway");
  await page.keyboard.press("Escape");
  await expect(row(page, 1)).toBeFocused();
  await expect(row(page, 1).locator(".field-row strong")).toHaveText("Full name");
  await expect(row(page, 3).locator(".field-row strong")).toHaveText("Household");
  await expect(status(page)).toHaveText("Unsaved changes");

  // Escape after a kept edit goes back to the kept draft, not the saved value.
  await row(page, 3).dblclick();
  await row(page, 3).getByRole("textbox", { name: "Name" }).fill("Again");
  await page.keyboard.press("Escape");
  await expect(row(page, 3).locator(".field-row strong")).toHaveText("Household");
});

test("the Add menu starts a new row; Escape discards it until an Enter has kept it", async ({ page }) => {
  await open(page);
  const add = page.locator("#add button");
  await expect(add).toHaveAttribute("aria-haspopup", "menu");
  await expect(add).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#fields .aster-list-edit-add")).toHaveCount(0);
  await add.click();
  await expect(add).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("menuitem", { name: "Number" }).click();
  await expect(add).toHaveAttribute("aria-expanded", "false");
  const fresh = page.locator("#fields .aster-list-edit-row[data-new]");
  await expect(fresh).toHaveCount(1);
  await expect(fresh.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(fresh).toHaveCount(0);

  await add.click();
  await page.getByRole("menuitem", { name: "Text" }).click();
  await fresh.getByRole("textbox", { name: "Name" }).fill("Postcode");
  await page.keyboard.press("Enter");
  await expect(fresh).toHaveCount(1);
  await expect(fresh.locator(".field-row strong")).toHaveText("Postcode");
  // Kept once, a later Escape only undoes that later edit.
  await fresh.dblclick();
  await fresh.getByRole("textbox", { name: "Name" }).fill("Zip");
  await page.keyboard.press("Escape");
  await expect(fresh.locator(".field-row strong")).toHaveText("Postcode");
});

test("edit(id) after an outside add starts that row and focuses its first control", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const editor = document.querySelector("#fields") as any;
    const added = editor.list.add({ name: "", kind: "Text" });
    editor.edit(added.id);
  });
  await expect(page.locator("#fields .aster-list-edit-row[data-new]")).toHaveAttribute("data-editing", "");
  await expect(page.locator("#fields .aster-list-edit-row[data-new]").getByRole("textbox", { name: "Name" })).toBeFocused();
  // Editing another row first keeps this one's draft.
  await page.evaluate(() => (document.querySelector("#fields") as any).edit("[2]"));
  await expect(row(page, 2).getByRole("textbox", { name: "Name" })).toBeFocused();
  await expect(page.locator("#fields [data-editing]")).toHaveCount(1);
});

test("selection follows Up and Down and survives a move and an edit; the fill and focus ring are drawn", async ({ page }) => {
  await open(page);
  await row(page, 1).click();
  await expect(row(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, 2)).toHaveAttribute("aria-selected", "false");
  await expect(row(page, 1)).toHaveCSS("background-color", /^(?!rgba\(0, 0, 0, 0\))/);
  await page.keyboard.press("ArrowDown");
  await expect(row(page, 2)).toBeFocused();
  await expect(row(page, 2)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, 1)).toHaveAttribute("aria-selected", "false");
  await expect(row(page, 2)).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("End");
  await expect(row(page, 3)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(row(page, 1)).toHaveAttribute("aria-selected", "true");

  // A move by keyboard keeps the same row selected, at its new place.
  await row(page, 1).getByRole("button", { name: /^Move/ }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  expect(await page.locator("#fields .aster-list-edit-row[data-id]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.id))).toEqual(["[2]", "[1]", "[3]"]);
  await expect(row(page, 1)).toHaveAttribute("aria-selected", "true");

  // An edit keeps it too, and the row stays the same element.
  await row(page, 1).evaluate((el) => ((window as any).kept = el));
  await row(page, 1).dblclick();
  await row(page, 1).getByRole("textbox", { name: "Name" }).fill("Renamed");
  await page.keyboard.press("Enter");
  await expect(row(page, 1)).toHaveAttribute("aria-selected", "true");
  expect(await row(page, 1).evaluate((el) => el === (window as any).kept)).toBe(true);
});

test("always mode and the Add button are unchanged by default, and chrome.add hides the button", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const editor = document.querySelector("#fields") as any;
    editor.editing = "always";
    editor.row = undefined;
    editor.selection = undefined;
    editor.chrome = {};
  });
  const grid = page.locator("#fields .aster-list-edit");
  await expect(grid).toHaveAttribute("role", "table");
  await expect(grid).not.toHaveAttribute("data-rows", "");
  await expect(page.locator("#fields .aster-list-edit-row[data-id]").first()).not.toHaveAttribute("tabindex", /.*/);
  await expect(page.locator("#fields .aster-list-edit-row[data-id]").first()).not.toHaveAttribute("aria-selected", /.*/);
  await expect(page.locator("#fields .aster-list-edit-head")).toBeVisible();
  await expect(page.locator("#fields").getByRole("textbox", { name: "Name" })).toHaveCount(3);
  await expect(page.locator("#fields .aster-list-edit-add")).toBeVisible();
  await page.locator("#fields .aster-list-edit-add").click();
  await expect(page.locator("#fields .aster-list-edit-row[data-new]").getByRole("textbox", { name: "Name" })).toBeFocused();
  // Enter and double-click do nothing special here.
  await page.keyboard.press("Enter");
  await expect(page.locator("#fields [data-editing]")).toHaveCount(0);
  await page.evaluate(() => ((document.querySelector("#fields") as any).chrome = { add: false }));
  await expect(page.locator("#fields .aster-list-edit-add")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`row mode has no accessibility violations in ${scheme}, reading and editing`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.evaluate((s) => (document.documentElement.dataset.scheme = s), scheme);
    await row(page, 1).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await row(page, 1).dblclick();
    await expect(row(page, 1).getByRole("textbox", { name: "Name" })).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("the composition validator accepts the list editor's row-mode data and rejects bad values", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const authoring = lib.defineCompositeRegistry({
      models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) },
      components: lib.asterComponents,
    });
    const diagnostics = (props: object) => authoring.diagnostics({
      version: 1, name: "list-editor-test", model: { type: "empty" }, children: { control: { type: "ListEditor", props } }, layout: { child: "control" },
    });
    return {
      valid: [diagnostics({ editing: "row", chrome: { add: false } }), diagnostics({ editing: "always", chrome: {} }), diagnostics({ chrome: { add: true } })],
      invalid: [diagnostics({ editing: "cell" }), diagnostics({ chrome: { add: "no" } }), diagnostics({ chrome: { delete: false } }), diagnostics({ selection: "first" })],
    };
  });
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});
