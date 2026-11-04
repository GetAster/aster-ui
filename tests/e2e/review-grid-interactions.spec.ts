import { expect, test, type Page } from "@playwright/test";

const grid = (page: Page) => page.locator("#review-grid");
const row = (page: Page, id: number) => grid(page).locator(`.aster-grid-row[data-key="[${id}]"]`);
const selected = (page: Page): Promise<string[]> => grid(page).evaluate((element) => (element as any).selection.keys.peek());

async function openGrid(page: Page, options: { tree?: boolean; cascadeSelection?: boolean; orderedLimit?: number; editable?: boolean; paged?: boolean } = {}): Promise<void> {
  await page.goto("/playground/composition.html");
  await page.waitForFunction(() => (globalThis as any).compositionDemo !== undefined);
  await page.evaluate(async (options) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const { createMockService } = await import("/lib/aster-ui-mock.js" as string);
    const metadata = {
      $Version: "4.01", $EntityContainer: "Review.Container",
      Review: {
        Task: {
          $Kind: "EntityType", $Key: ["id"],
          id: { $Type: "Edm.Int32" },
          title: { $Type: "Edm.String" },
          parentId: { $Type: "Edm.Int32", $Nullable: true },
        },
        Container: { $Kind: "EntityContainer", Tasks: { $Collection: true, $Type: "Review.Task" } },
      },
    };
    const mock = await createMockService({ metadata, data: { Tasks: [
      { id: 1, title: "Root A", parentId: null },
      { id: 2, title: "Child A1", parentId: 1 },
      { id: 3, title: "Grandchild A1a", parentId: 2 },
      { id: 4, title: "Root B", parentId: null },
      { id: 5, title: "Child B1", parentId: 4 },
      { id: 6, title: "Root C", parentId: null },
      { id: 7, title: "Child A2", parentId: 1 },
    ] }, wasm: new URL("../lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    const membership = ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] });
    await membership.loadAll();
    const selection = new lib.Selection(ctx.store, membership, {
      multiple: true,
      ...(options.orderedLimit ? { ordered: true, maxOrdered: options.orderedLimit } : {}),
    });
    const element = document.createElement("aster-grid") as any;
    element.id = "review-grid";
    element.ctx = ctx;
    element.set = "Tasks";
    element.view = { ...lib.defaultView(ctx.schema.set("Tasks").type), sort: [{ field: "id" }] };
    if (options.tree) element.tree = { parentField: "parentId", autoOpen: 2, cascadeSelection: options.cascadeSelection ?? true };
    element.selection = selection;
    element.selectionColumn = true;
    element.editable = options.editable ?? false;
    if (options.paged) {
      element.features = [...element.features, { kind: "page" }];
      element.pageSize = 3;
    }
    element.style.height = "460px";
    document.querySelector("main")!.replaceChildren(element);
    (globalThis as any).reviewGrid = { ctx, mock, selection };
  }, options);
  await expect(row(page, 3)).toBeVisible();
}

test("rejecting an ordered tree cascade leaves the entire shared selection unchanged", async ({ page }) => {
  await openGrid(page, { tree: true, orderedLimit: 3 });
  await row(page, 6).locator(".aster-grid-select input").check();
  expect(await selected(page)).toEqual(["[6]"]);

  await row(page, 1).locator(".aster-grid-select input").click();
  await expect(grid(page).locator(".aster-grid-note")).toContainText("Select at most 3");
  expect(await selected(page)).toEqual(["[6]"]);
});

test("tree Shift selection follows visible tree order rather than membership collection order", async ({ page }) => {
  await openGrid(page, { tree: true });
  await expect(grid(page).locator(".aster-grid-row[data-key]")).toHaveCount(7);
  expect(await grid(page).locator(".aster-grid-row[data-key]").evaluateAll(rows => rows.map(row => row.getAttribute("data-key"))))
    .toEqual(["[1]", "[2]", "[3]", "[7]", "[4]", "[5]", "[6]"]);
  await row(page, 2).locator('[data-col="1"]').click();
  await row(page, 7).locator('[data-col="1"]').click({ modifiers: ["Shift"] });
  expect(await selected(page)).toEqual(["[2]", "[3]", "[7]"]);

  // The keyboard path uses the same visible order: reopen without cascade so a
  // plain click resets to one row, then two Shift+ArrowDowns reach row 7.
  await openGrid(page, { tree: true, cascadeSelection: false });
  await row(page, 2).locator('[data-col="1"]').click();
  expect(await selected(page)).toEqual(["[2]"]);
  await grid(page).locator(".aster-grid-scroll").focus();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await selected(page)).toEqual(["[2]", "[3]", "[7]"]);
});

test("runtime editing policy removes the editor while preserving a change made before the restriction", async ({ page }) => {
  await openGrid(page, { editable: true });
  await row(page, 1).locator('[data-col="1"]').dblclick();
  await row(page, 1).getByRole("textbox", { name: "title", exact: true }).fill("Changed before policy restriction");
  await grid(page).evaluate((element) => { (element as any).policy = { editable: ["parentId"] }; });
  await expect(row(page, 1).getByRole("textbox", { name: "title", exact: true })).toHaveCount(0);
  await grid(page).evaluate(async (element) => { await (element as any).finishEditing(); });
  const title = await page.evaluate(async () => (await (globalThis as any).reviewGrid.mock.dump()).data.Tasks.find((task: any) => task.id === 1).title);
  expect(title).toBe("Changed before policy restriction");
});

test("withdrawing selection permission preserves shared picks while blocking pointer and Space selection", async ({ page }) => {
  await openGrid(page, { tree: true });
  await row(page, 2).locator(".aster-grid-select input").check();
  const before = await selected(page);
  await grid(page).evaluate((element) => { (element as any).policy = { selectable: false }; });
  await expect(grid(page).locator(".aster-grid-select")).toHaveCount(0);
  await row(page, 6).locator('[data-col="1"]').click();
  await grid(page).press(" ");
  expect(await selected(page)).toEqual(before);
  await grid(page).evaluate((element) => { (element as any).policy = {}; });
  await expect(row(page, 2).locator(".aster-grid-select input")).toBeChecked();
});

test("tree select-all includes the loaded descendant rows as well as roots", async ({ page }) => {
  for (const cascadeSelection of [false, true]) {
    await openGrid(page, { tree: true, cascadeSelection });
    await expect(grid(page).locator(".aster-grid-row[data-key]")).toHaveCount(7);
    await grid(page).getByRole("checkbox", { name: "Select all loaded rows", exact: true }).check();
    expect((await selected(page)).sort()).toEqual(["[1]", "[2]", "[3]", "[4]", "[5]", "[6]", "[7]"]);
  }
});

test("paged row indices stay within the announced row count", async ({ page }) => {
  await openGrid(page, { paged: true });
  await grid(page).getByRole("button", { name: "Next page", exact: true }).click();
  await expect(row(page, 4)).toBeVisible();
  await expect(row(page, 6)).toBeVisible();
  const count = Number(await grid(page).getByRole("grid").getAttribute("aria-rowcount"));
  const indices = await grid(page).locator('[role="row"][aria-rowindex]').evaluateAll(rows => rows.map(row => Number(row.getAttribute("aria-rowindex"))));
  expect(count).toBeGreaterThanOrEqual(indices.length);
  expect(Math.max(...indices)).toBeLessThanOrEqual(count);
});
