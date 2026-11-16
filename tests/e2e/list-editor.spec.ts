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

test("row mode offers icon actions on the row being edited, none on a clean row that reads; a row being removed keeps Undo", async ({ page }) => {
  await open(page);
  await expect(page.locator("#fields .aster-list-edit-action")).toHaveCount(0);
  await row(page, 2).dblclick();
  // Cancel editing and Remove, the two icon slots.
  await expect(page.locator("#fields .aster-list-edit-action")).toHaveCount(2);
  const remove = row(page, 2).getByRole("button", { name: "Remove Date of birth" });
  await expect(remove).toHaveAttribute("title", "Remove");
  await expect(remove.locator("svg")).toHaveCount(1);
  await expect(remove).toHaveText("");
  await remove.click();
  await expect(row(page, 2)).toHaveAttribute("data-removing", "");
  await expect(row(page, 2).getByRole("button", { name: "Undo removing Date of birth" })).toHaveAttribute("title", "Undo remove");
  await row(page, 2).getByRole("button", { name: "Undo removing Date of birth" }).click();
  await expect(page.locator("#fields .aster-list-edit-action")).toHaveCount(0);
});

test("columns keep their widths when a move makes Revert appear, and chrome.actions drops the column", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const editor = document.querySelector("#fields") as any;
    editor.editing = "always";
    editor.row = undefined;
  });
  const boxes = () => page.evaluate(() => [...document.querySelectorAll("#fields .aster-list-edit-row")].map((r) =>
    [...r.children].filter((c) => c.getAttribute("role")?.match(/cell|columnheader/)).map((c) => {
      const b = c.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.width)];
    })));
  const before = await boxes();
  for (const cells of before) expect(cells).toEqual(before[0]);
  await row(page, 1).getByRole("button", { name: "Move Full name", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator("#fields").getByRole("button", { name: /^Revert / }).first()).toBeVisible();
  const after = await boxes();
  for (const cells of after) expect(cells).toEqual(before[0]);

  await page.evaluate(() => ((document.querySelector("#fields") as any).chrome = { actions: false }));
  await expect(page.locator("#fields .aster-list-edit-actions")).toHaveCount(0);
  await expect(page.locator("#fields .aster-list-edit-head [role=columnheader]")).toHaveCount(4);
  await expect(page.locator("#fields").getByRole("textbox", { name: "Name" })).toHaveCount(3);
});

for (const scheme of ["light", "dark"] as const) {
  test(`row mode has no accessibility violations in ${scheme}, reading and editing`, async ({ page }) => {
    // Reduced motion: the body fades between schemes, and axe must not read a colour mid-fade.
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
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
      valid: [diagnostics({ editing: "row", chrome: { add: false, actions: false } }), diagnostics({ editing: "always", chrome: {} }), diagnostics({ chrome: { add: true } })],
      invalid: [diagnostics({ editing: "cell" }), diagnostics({ chrome: { add: "no" } }), diagnostics({ chrome: { actions: 1 } }), diagnostics({ chrome: { delete: false } }), diagnostics({ selection: "first" })],
    };
  });
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});

test.describe("a layout in lines", () => {
  const laid = (page: Page) => page.locator("#laid-out");
  const line = (page: Page, id: number) => laid(page).locator(`.aster-list-edit-row[data-id="[${id}]"]`);
  const cellBox = async (page: Page, id: number, label: string) => line(page, id).getByRole("gridcell").filter({ hasText: label }).first().boundingBox();

  test("rows keep their lines while editing, with rules deciding what each row may change or show", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await open(page);
    // Reading: the name's renderer, the description on a line of its own, and where an inherited field comes from.
    await expect(line(page, 1).locator("strong")).toHaveText("Full name");
    const name = (await cellBox(page, 1, "Full name"))!;
    const description = (await cellBox(page, 1, "What the client"))!;
    expect(description.y).toBeGreaterThan(name.y + name.height - 1);
    await expect(line(page, 3)).toContainText("Inherited from Household");
    await expect(line(page, 1)).not.toContainText("Inherited");

    // Editing a saved row: the name and description are controls on their lines, the type stays text with its reason.
    await line(page, 1).dblclick();
    const nameBox = line(page, 1).getByRole("textbox", { name: "Name" });
    await expect(nameBox).toBeFocused();
    const descriptionBox = line(page, 1).getByRole("textbox", { name: "Description" });
    expect((await descriptionBox.boundingBox())!.y).toBeGreaterThan((await nameBox.boundingBox())!.y);
    await expect(line(page, 1).locator('[title="Change a field\'s type in the model."]')).toHaveText("Text");
    await page.keyboard.press("Escape");

    // An inherited row: name and description stay text, and the source line is reading-only.
    await line(page, 3).dblclick();
    await expect(line(page, 3)).toHaveAttribute("data-editing", "");
    await expect(line(page, 3).getByRole("textbox")).toHaveCount(0);
    await expect(line(page, 3).locator('[title="Rename an inherited field where it\'s declared."]')).toContainText("Household size");
    await expect(line(page, 3)).not.toContainText("Inherited from");
    await page.keyboard.press("Escape");
  });

  test("a type the Add menu supplies reads as text at once on the new row, and unrestricted text edits in a textarea", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await open(page);
    await page.locator("#add-laid button").click();
    await page.getByRole("menuitem", { name: "Date" }).click();
    const added = laid(page).locator(".aster-list-edit-row[data-new]");
    await expect(added).toHaveAttribute("data-editing", "");
    await expect(added.getByRole("textbox", { name: "Name" })).toBeFocused();
    // Read-only by an explicit rule, so text with its reason even while the row is new.
    await expect(added.locator('[title="Change a field\'s type in the model."]')).toHaveText("Date");
    await expect(added.getByRole("combobox")).toHaveCount(0);
    // No maximum length, yet a textarea that wraps, because the column asks for "multiline".
    await expect(added.getByRole("textbox", { name: "Description" })).toHaveJSProperty("tagName", "TEXTAREA");
  });

  test("an editor 520 px wide or narrower stacks each cell on a line of its own between the handle and the actions", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    await open(page);
    await line(page, 1).dblclick();
    const name = (await line(page, 1).getByRole("gridcell").filter({ has: page.getByRole("textbox", { name: "Name" }) }).boundingBox())!;
    const kind = (await cellBox(page, 1, "Text"))!;
    expect(kind.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    expect(Math.abs(kind.x - name.x)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("responsive sets the width a layout stacks at, by the editor's own width", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    await open(page);
    const grid = laid(page).locator(".aster-list-edit");
    await expect(grid).toHaveAttribute("data-stacked", "");
    const firstLine = async () => {
      const name = (await cellBox(page, 1, "Full name"))!;
      const kind = (await cellBox(page, 1, "Text"))!;
      return Math.abs(kind.y - name.y) < 2 && kind.x > name.x;
    };
    expect(await firstLine()).toBe(false);
    // A compact first line that fits keeps its columns when told the width it fits in.
    await laid(page).evaluate((el) => ((el as unknown as { responsive: unknown }).responsive = { below: 300 }));
    await expect(grid).not.toHaveAttribute("data-stacked", "");
    expect(await firstLine()).toBe(true);
    await laid(page).evaluate((el) => ((el as unknown as { responsive: unknown }).responsive = true));
    await expect(grid).toHaveAttribute("data-stacked", "");
    await laid(page).evaluate((el) => ((el as unknown as { responsive: unknown }).responsive = false));
    await expect(grid).not.toHaveAttribute("data-stacked", "");
    const thrown = await laid(page).evaluate((el) => { try { (el as unknown as { responsive: unknown }).responsive = { below: -1 }; return false; } catch { return true; } });
    expect(thrown).toBe(true);
  });

  test("the composition validator checks a layout's cells", async ({ page }) => {
    await page.goto("/playground/composition.html");
    const result = await page.evaluate(async () => {
      const lib = await import("/lib/aster-ui.js" as string);
      const authoring = lib.defineCompositeRegistry({
        models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) },
        components: lib.asterComponents,
      });
      const diagnostics = (props: object) => authoring.diagnostics({
        version: 1, name: "list-layout-test", model: { type: "empty" }, children: { control: { type: "ListEditor", props } }, layout: { child: "control" },
      });
      return {
        valid: [diagnostics({ layout: [[{ field: "name" }, { field: "kind", width: "8rem" }], [{ field: "description", span: "all", show: "editing", control: "multiline" }]] }), diagnostics({ responsive: { below: 360 } }), diagnostics({ responsive: false })],
        invalid: [diagnostics({ layout: [] }), diagnostics({ layout: [[]] }), diagnostics({ layout: [[{ field: "name", span: 0 }]] }), diagnostics({ layout: [[{ field: "name", show: "sometimes" }]] }), diagnostics({ layout: [[{ field: "name", control: "rich" }]] }), diagnostics({ responsive: { below: -1 } }), diagnostics({ responsive: "narrow" })],
      };
    });
    for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
    for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
  });
});

test.describe("cancel editing", () => {
  const cancel = (page: Page, id: number, name: string) => row(page, id).getByRole("button", { name: `Cancel editing ${name}` });

  test("a clean row offers Cancel editing in Revert's place; it ends editing and focuses the row, as Escape does", async ({ page }) => {
    await open(page);
    await row(page, 2).dblclick();
    const button = cancel(page, 2, "Date of birth");
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("title", "Cancel editing (Esc)");
    await expect(row(page, 2).getByRole("button", { name: "Revert Date of birth" })).toHaveCount(0);
    await button.click();
    await expect(row(page, 2)).not.toHaveAttribute("data-editing", "");
    await expect(row(page, 2)).toBeFocused();
    await expect(status(page)).toHaveText("Saved");
  });

  test("on a changed row it puts back this session's changes and keeps those made before it", async ({ page }) => {
    await open(page);
    await row(page, 1).dblclick();
    await row(page, 1).getByRole("textbox", { name: "Name" }).fill("Legal name");
    await page.keyboard.press("Enter");
    await expect(row(page, 1).locator(".field-row strong")).toHaveText("Legal name");
    // A second session changes the description, then cancels.
    await page.keyboard.press("Enter");
    await row(page, 1).getByRole("textbox", { name: "Description" }).fill("Something else");
    await cancel(page, 1, "Legal name").click();
    await expect(row(page, 1)).not.toHaveAttribute("data-editing", "");
    await expect(row(page, 1).locator(".field-row strong")).toHaveText("Legal name");
    await expect(row(page, 1).locator(".field-row .description")).toHaveText("What the client is called on paper.");
    await expect(status(page)).toHaveText("Unsaved changes");
    await expect(row(page, 1)).toBeFocused();
  });

  test("on a new row no Enter has kept it discards the row and moves focus on, as Escape does", async ({ page }) => {
    await open(page);
    await page.locator("#add button").click();
    await page.getByRole("menuitem", { name: "Number" }).click();
    const added = page.locator("#fields .aster-list-edit-row[data-new]");
    await expect(added).toHaveAttribute("data-editing", "");
    await added.getByRole("button", { name: "Cancel editing new row" }).click();
    await expect(page.locator("#fields .aster-list-edit-row[data-new]")).toHaveCount(0);
    await expect(page.locator("#fields .aster-list-edit-row[data-id]")).toHaveCount(3);
    await expect(page.locator("#fields .aster-list-edit-row[data-id]").last()).toBeFocused();
  });

  test("a changed row that reads offers Revert, which puts back its saved values and returns focus to the row", async ({ page }) => {
    await open(page);
    await row(page, 1).dblclick();
    await row(page, 1).getByRole("textbox", { name: "Name" }).fill("Legal name");
    await page.keyboard.press("Enter");
    // The changed row reads now: Revert only, and no actions on clean rows.
    const revert = row(page, 1).getByRole("button", { name: "Revert Legal name" });
    await expect(revert).toHaveAttribute("title", "Revert changes");
    await expect(row(page, 1).getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await expect(row(page, 2).locator(".aster-list-edit-action")).toHaveCount(0);
    await revert.click();
    await expect(row(page, 1).locator(".field-row strong")).toHaveText("Full name");
    await expect(row(page, 1)).toBeFocused();
    await expect(row(page, 1).locator(".aster-list-edit-action")).toHaveCount(0);
    await expect(status(page)).toHaveText("Saved");
  });
});
