// Form and field configuration: the three layers, static defaults yielding to
// page rules, validation display and the date, switch, choice, select and
// button surfaces.
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

const form = (page: Page) => page.locator("#e2e-form");

const FIXTURE = {
  metadata: {
    $Version: "4.01",
    $EntityContainer: "Test.Container",
    $Reference: {
      "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] },
      "https://aster.dev/vocabularies/Aster.Data.V1.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
    },
    Test: {
      FormRecord: {
        $Kind: "EntityType",
        $Key: ["id"],
        "@Core.Description": "Record",
        "@AsterData.PluralTitle": "Records",
        "@AsterData.TitleField": "name",
        id: { $Type: "Edm.Int32", "@Core.Computed": true },
        name: { "@Core.Description": "Name", "@AsterData.MinLength": 1 },
        status: {
          "@Core.Description": "Status",
          "@Validation.AllowedValues": [
            { Value: "active", "@Core.Description": "Active" },
            { Value: "paused", "@Core.Description": "Paused" },
            { Value: "archived", "@Core.Description": "Archived" },
          ],
        },
        due: { $Type: "Edm.Date", $Nullable: true, "@Core.Description": "Due" },
        done: { $Type: "Edm.Boolean", "@Core.Description": "Done" },
        budget: { $Type: "Edm.Decimal", $Precision: 12, $Scale: 2, "@Core.Description": "Budget", "@Validation.Minimum": 0 },
        behindDays: { $Type: "Edm.Int32", $Nullable: true, "@Core.Description": "Days behind", "@Validation.Minimum": 1 },
        clientId: { $Type: "Edm.Int32", $Nullable: true, "@Core.Description": "Client" },
        pin: { $Type: "Edm.Boolean", "@Core.Description": "Pinned" },
        ownerId: { $Type: "Edm.Int32", $Nullable: true, "@Core.Description": "Owner" },
        createdAt: { $Type: "Edm.DateTimeOffset", "@Core.Computed": true, "@Core.Description": "Created" },
      },
      Owner: {
        $Kind: "EntityType",
        $Key: ["id"],
        "@Core.Description": "Owner",
        "@AsterData.TitleField": "name",
        id: { $Type: "Edm.Int32", "@Core.Computed": true },
        name: { "@Core.Description": "Name", "@AsterData.MinLength": 1 },
      },
      Container: {
        $Kind: "EntityContainer",
        FormRecords: { $Collection: true, $Type: "Test.FormRecord" },
        Owners: { $Collection: true, $Type: "Test.Owner" },
      },
    },
  },
  data: {
    FormRecords: [
      { id: 1, name: "Spring launch", status: "active", due: "2026-10-09", done: false, budget: "12000.00", behindDays: null, clientId: 1, pin: true, ownerId: 1, createdAt: "2026-01-05T09:00:00Z" },
      { id: 2, name: "Brand refresh", status: "paused", due: null, done: true, budget: "4000.00", behindDays: 3, clientId: 2, pin: false, ownerId: 2, createdAt: "2026-02-05T09:00:00Z" },
      { id: 3, name: "Billing v2", status: "active", due: "2026-11-10", done: false, budget: "9000.00", behindDays: null, clientId: null, pin: false, ownerId: 1, createdAt: "2026-03-05T09:00:00Z" },
    ],
    Owners: [{ id: 1, name: "Ada" }, { id: 2, name: "Ken" }],
  },
};

/** A page that loads the library once and a small service with every field type. */
async function dataPage(page: Page): Promise<void> {
  await page.goto("/playground/composition.html");
  await page.evaluate(async (fixture) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const mock = await mockLib.createMockService({ ...fixture, wasm: new URL("/lib/odata_mock.wasm", location.href) });
    (globalThis as any).e2eCtx = await lib.DataContext.connect(mock.transport);
  }, FIXTURE);
}

test("form policy is a static default, and page rules override it", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).e2eCtx;
    const records = ctx.collection({ set: "FormRecords", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await records.ensure(0, 5);
    const edit = new lib.EditModel(ctx, "FormRecords", records.keys.value[0]);
    const scope = new lib.PageScope();
    const on = lib.signal(true);
    scope.publish("page", lib.valuesPublication({ on }));
    edit.applyRules(scope, "form", {
      name: { readOnly: { when: { op: "eq", field: "page.on", value: false }, reason: "A page rule unlocked this." } },
      budget: { enabled: { when: { op: "eq", field: "page.on", value: true } } },
    });
    const element = document.createElement("aster-form") as HTMLElement & Record<string, any>;
    element.id = "e2e-form";
    element.model = edit;
    element.policy = { readOnly: true, disabled: true };
    element.sections = [{ title: "Basics", items: ["name", "budget", { field: "behindDays", required: true }] }];
    document.body.append(element);
    (globalThis as unknown as { e2e: unknown }).e2e = { edit, on };
  });

  const name = form(page).locator('[data-field="name"] input');
  const budget = form(page).locator('[data-field="budget"] input');
  const behind = form(page).locator('[data-field="behindDays"] input');
  // The page rule names read-only for name and enabled for budget.
  await expect(name).not.toHaveAttribute("readonly", "");
  await expect(budget).not.toBeDisabled();
  await expect(budget).toHaveAttribute("readonly", "");
  await expect(behind).toHaveAttribute("aria-required", "true");
  await expect(form(page).locator('[data-field="behindDays"] .aster-optional')).toHaveCount(0);

  await page.evaluate(() => ((globalThis as unknown as { e2e: { on: { value: boolean } } }).e2e.on.value = false));
  await expect(name).toHaveAttribute("readonly", "");
  await expect(budget).toBeDisabled();
  await expect(form(page).locator('[data-field="name"] .aster-hint')).toContainText("A page rule unlocked this.");
});

test("a field takes a label, hint, placeholder and typed or custom editor override", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).e2eCtx;
    const records = ctx.collection({ set: "FormRecords", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    const people = ctx.collection({ set: "Owners", orderBy: [{ field: "name" }] }, { pageSize: 20 });
    await Promise.all([records.ensure(0, 5), people.ensure(0, 20)]);
    const edit = new lib.EditModel(ctx, "FormRecords", records.keys.value[0]);
    const element = document.createElement("aster-form") as HTMLElement & Record<string, any>;
    element.id = "e2e-form";
    element.model = edit;
    element.sections = [{
      title: "Basics",
      items: [
        { field: "name", title: "Project label", hint: "Shown on reports", placeholder: "Brand refresh" },
        { field: "status", control: "text" },
        { field: "ownerId", control: "text", options: people },
        {
          field: "pin",
          control: (c: { value: unknown; write: (value: unknown) => void }) => lib.html`<button type="button" class="e2e-custom"
            @click=${() => c.write(!c.value)}>${c.value ? "Pinned" : "Unpinned"}</button>`,
        },
      ],
    }];
    document.body.append(element);
    (globalThis as unknown as { e2e: unknown }).e2e = { edit };
  });

  const name = form(page).locator('[data-field="name"]');
  await expect(name.locator(".aster-field-label")).toHaveText("Project label");
  await expect(name.locator(".aster-hint")).toHaveText("Shown on reports");
  await expect(name.locator("input")).toHaveAttribute("placeholder", "Brand refresh");
  await expect(name.locator("input")).toHaveAttribute("aria-describedby", /-hint/);

  await expect(form(page).locator('[data-field="status"]')).toHaveJSProperty("tagName", "ASTER-FIELD");
  await expect(form(page).locator('[data-field="status"] input')).toHaveValue("Active");
  await expect(form(page).locator('[data-field="ownerId"]')).toHaveJSProperty("tagName", "ASTER-FIELD");
  await expect(form(page).locator('[data-field="ownerId"] aster-picker')).toHaveCount(0);

  const custom = form(page).locator('[data-field="pin"] .e2e-custom');
  await expect(custom).toHaveText("Pinned");
  await custom.click();
  await expect(custom).toHaveText("Unpinned");
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { edit: { values: { value: { pin: boolean } } } } }).e2e.edit.values.value.pin)).toBe(false);
});

test("validation timing, inline errors, the summary and first-invalid focus", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).e2eCtx;
    const records = ctx.collection({ set: "FormRecords", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await records.ensure(0, 5);
    const edit = new lib.EditModel(ctx, "FormRecords", records.keys.value[0]);
    const element = document.createElement("aster-form") as HTMLElement & Record<string, any>;
    element.id = "e2e-form";
    element.model = edit;
    element.chrome = { errorSummary: true, autoFocus: true };
    element.validateOn = "exit";
    element.sections = [{ title: "Task", items: ["name", "due"] }];
    document.body.append(element);
    (globalThis as unknown as { e2e: { form: unknown; edit: unknown } }).e2e = { form: element, edit };
  });

  const nameField = form(page).locator('[data-field="name"] input');
  const summary = form(page).locator(".aster-form-summary");
  await nameField.fill("");
  await nameField.press("Tab");
  await expect(form(page).locator('[data-field="name"] .aster-error')).toContainText("Name can't be blank.");
  await expect(summary).toContainText("There is 1 problem");
  await expect(summary).toContainText("can't be blank");
  // exit validation asked for the first invalid field; it takes focus back.
  await expect(nameField).toBeFocused();

  // Inline errors off leaves the summary as the only visible error surface.
  await nameField.fill("Release notes");
  await nameField.press("Tab");
  await expect(summary).toHaveCount(0);
  await page.evaluate(() => ((globalThis as unknown as { e2e: { form: { showInlineErrors: boolean } } }).e2e.form.showInlineErrors = false));
  await nameField.fill("");
  await nameField.press("Tab");
  await expect(summary).toContainText("There is 1 problem");
  await expect(form(page).locator(".aster-error")).toHaveCount(0);
  await summary.getByRole("button").click();
  await expect(nameField).toBeFocused();

  // Change validation shows and clears the error while the field stays focused.
  await page.evaluate(() => {
    const { form } = (globalThis as unknown as { e2e: { form: { showInlineErrors: boolean; validateOn: string } } }).e2e;
    form.showInlineErrors = true;
    form.validateOn = "change";
  });
  await nameField.fill("");
  await expect(form(page).locator('[data-field="name"] .aster-error')).toContainText("Name can't be blank.");
  await nameField.fill("Release notes");
  await expect(form(page).locator('[data-field="name"] .aster-error')).toHaveCount(0);

  // Submit validation waits for the host's validate().
  await page.evaluate(() => {
    const { form } = (globalThis as unknown as { e2e: { form: { validateOn: string; edit: { validate(): boolean } } } }).e2e;
    form.validateOn = "submit";
  });
  await nameField.fill("");
  await nameField.press("Tab");
  await expect(form(page).locator('[data-field="name"] .aster-error')).toHaveCount(0);
  await page.evaluate(() => (globalThis as unknown as { e2e: { edit: { validate(): boolean } } }).e2e.edit.validate());
  await expect(form(page).locator('[data-field="name"] .aster-error')).toContainText("Name can't be blank.");
});

test("date bounds, formats, placeholder, dismissal and out-of-range validation", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).e2eCtx;
    const records = ctx.collection({ set: "FormRecords", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await records.ensure(0, 5);
    const edit = new lib.EditModel(ctx, "FormRecords", records.keys.value[0]);
    const element = document.createElement("aster-form") as HTMLElement & Record<string, any>;
    element.id = "e2e-form";
    element.model = edit;
    element.sections = [{ title: "Due", items: ["due"] }];
    document.body.append(element);
    (globalThis as unknown as { e2e: { edit: unknown } }).e2e = { edit };
  });
  const date = form(page).locator("aster-date");
  const input = date.locator("input");
  await page.evaluate(() => {
    const element = document.querySelector("#e2e-form aster-date") as unknown as Record<string, unknown>;
    element.min = "2026-10-05";
    element.max = "2026-10-20";
    element.format = "iso";
    element.placeholder = "Pick a date";
  });
  await expect(input).toHaveValue("2026-10-09");
  await expect(input).toHaveAttribute("placeholder", "Pick a date");
  await page.evaluate(() => ((document.querySelector("#e2e-form aster-date") as unknown as Record<string, unknown>).format = "short"));
  await expect(input).toHaveValue("9 Oct 26");
  await page.evaluate(() => ((document.querySelector("#e2e-form aster-date") as unknown as Record<string, unknown>).format = "medium"));
  await expect(input).toHaveValue("9 Oct 2026");

  await date.locator(".aster-date-button").click();
  const calendar = date.locator("[role=dialog]");
  await expect(calendar).toBeVisible();
  const tooLate = calendar.locator('[id$="-2026-10-21"]');
  await expect(tooLate).toHaveAttribute("aria-disabled", "true");
  await tooLate.click({ force: true });
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { edit: { values: { value: { due: string } } } } }).e2e.edit.values.value.due)).toBe("2026-10-09");
  await calendar.locator('[id$="-2026-10-12"]').click();
  await expect(calendar).toHaveCount(0);
  await expect(input).toHaveValue("12 Oct 2026");

  await page.evaluate(() => ((document.querySelector("#e2e-form aster-date") as unknown as Record<string, unknown>).dismissOnSelect = false));
  await date.locator(".aster-date-button").click();
  await calendar.locator('[id$="-2026-10-13"]').click();
  await expect(calendar).toBeVisible();
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { edit: { values: { value: { due: string } } } } }).e2e.edit.values.value.due)).toBe("2026-10-13");
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);

  await input.fill("2026-10-25");
  await input.press("Tab");
  await expect(form(page).locator(".aster-error")).toContainText("Choose 20 Oct 2026 or earlier.");
  await input.fill("2026-10-01");
  await input.press("Tab");
  await expect(form(page).locator(".aster-error")).toContainText("Choose 5 Oct 2026 or later.");
});

test("switch labels reword the state, and read-only and disabled stop the toggle", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).e2eCtx;
    const records = ctx.collection({ set: "FormRecords", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await records.ensure(0, 5);
    const element = document.createElement("aster-switch") as HTMLElement & Record<string, any>;
    element.id = "e2e-switch";
    element.binding = { ctx, set: "FormRecords", key: records.keys.value[0], field: "pin" };
    element.onLabel = "Visible";
    element.offLabel = "Hidden";
    document.body.append(element);
    (globalThis as unknown as { e2e: { element: unknown } }).e2e = { element };
  });
  const element = page.locator("#e2e-switch");
  const toggle = element.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(element.locator(".aster-switch-state")).toHaveText("Visible");
  await expect(toggle).toHaveAccessibleDescription("Visible");

  await page.evaluate(() => ((globalThis as unknown as { e2e: { element: Record<string, unknown> } }).e2e.element.readOnly = true));
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await toggle.dispatchEvent("click");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveAttribute("aria-readonly", "true");

  await page.evaluate(() => {
    const { element } = (globalThis as unknown as { e2e: { element: Record<string, unknown> } }).e2e;
    element.readOnly = false;
    element.disabled = true;
  });
  await expect(toggle).toBeDisabled();
  await toggle.dispatchEvent("click");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("choice filters, clears and explains an empty result; a bound select clears a nullable field", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const choice = document.createElement("aster-choice") as HTMLElement & Record<string, any>;
    choice.id = "e2e-choice";
    choice.label = "Period";
    choice.options = [
      { value: "week", label: "This week" },
      { value: "month", label: "This month" },
      { value: "quarter", label: "This quarter" },
    ];
    choice.value = "week";
    choice.filter = true;
    choice.clearable = true;
    choice.noResults = "Nothing here";
    choice.addEventListener("change", (event) => ((globalThis as unknown as { e2eChange: unknown }).e2eChange = (event as CustomEvent).detail));
    document.body.append(choice);
  });
  const choice = page.locator("#e2e-choice");
  const combo = choice.getByRole("combobox", { name: "Period" });
  const clear = choice.locator(".aster-select-clear");
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(combo).toHaveText("Choose…");
  expect(await page.evaluate(() => (globalThis as unknown as { e2eChange: unknown }).e2eChange)).toBeNull();

  await page.evaluate(() => {
    const element = document.querySelector("#e2e-choice") as unknown as { value: unknown };
    element.value = "week";
  });
  await combo.click();
  await page.keyboard.type("zzz");
  await expect(choice.locator(".aster-choice-empty")).toHaveText("Nothing here");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await combo.click();
  await page.keyboard.type("mon");
  await expect(choice.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(combo).toHaveText("This month");
  expect(await page.evaluate(() => (globalThis as unknown as { e2eChange: unknown }).e2eChange)).toBe("month");

  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).e2eCtx;
    const records = ctx.collection({ set: "FormRecords", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await records.ensure(0, 5);
    const edit = new lib.EditModel(ctx, "FormRecords", records.keys.value[0]);
    edit.set("clientId", 1);
    const select = document.createElement("aster-select") as HTMLElement & Record<string, any>;
    select.id = "e2e-select";
    select.model = edit;
    select.field = "clientId";
    select.labelled = true;
    select.choices = [{ value: 1, label: "Acme" }, { value: 2, label: "Beta" }];
    select.placeholder = "Pick a client";
    select.clearable = true;
    select.filter = true;
    select.noResults = "No client matches";
    document.body.append(select);
    (globalThis as unknown as { e2e: { edit: unknown } }).e2e = { edit };
  });
  const select = page.locator("#e2e-select");
  const selected = select.getByRole("combobox");
  await expect(selected).toHaveText("Acme");
  await select.locator(".aster-select-clear").click();
  await expect(selected).toHaveText("Pick a client");
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { edit: { values: { value: { clientId: unknown } } } } }).e2e.edit.values.value.clientId)).toBeNull();
  await selected.click();
  await page.keyboard.type("zzz");
  await expect(select.locator(".aster-choice-empty")).toHaveText("No client matches");
});

test("button tone, size and native disabled", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const danger = document.createElement("aster-button") as HTMLElement & Record<string, any>;
    danger.id = "e2e-danger";
    danger.label = "Delete";
    danger.tone = "danger";
    danger.size = "sm";
    const off = document.createElement("aster-button") as HTMLElement & Record<string, any>;
    off.id = "e2e-off";
    off.label = "Save";
    off.disabled = true;
    off.reason = "Nothing to save";
    document.body.append(danger, off);
    (globalThis as unknown as { e2e: { clicks: number } }).e2e = { clicks: 0 };
    off.addEventListener("click", () => ((globalThis as unknown as { e2e: { clicks: number } }).e2e.clicks++));
  });
  const danger = page.locator("#e2e-danger button");
  await expect(danger).toHaveAttribute("data-tone", "danger");
  await expect(danger).toHaveAttribute("data-size", "sm");
  const style = await page.evaluate(() => {
    const button = document.querySelector("#e2e-danger button")!;
    const probe = document.createElement("span");
    probe.style.color = "var(--aster-negative)";
    document.body.append(probe);
    const negative = getComputedStyle(probe).color;
    probe.remove();
    const tight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--aster-ctl-tight"));
    return { colour: getComputedStyle(button).color, negative, height: parseFloat(getComputedStyle(button).height), tight };
  });
  expect(style.colour).toBe(style.negative);
  expect(style.height).toBe(style.tight);

  const off = page.locator("#e2e-off button");
  await expect(off).toBeDisabled();
  await off.click({ force: true });
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { clicks: number } }).e2e.clicks)).toBe(0);
});

test("an icon-only button is square, centres its icon and is named by its label", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const zoom = Object.assign(document.createElement("aster-button"), { id: "e2e-zoom", label: "Zoom in", labelled: false, busyLabel: "Zooming",
      icon: lib.html`<svg id="e2e-zoom-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>` });
    const plain = Object.assign(document.createElement("aster-button"), { id: "e2e-plain", label: "Plain", labelled: false });
    document.body.append(zoom, plain);
  });
  const zoom = page.getByRole("button", { name: "Zoom in" });
  await expect(zoom).toHaveAttribute("title", "Zoom in");
  await expect(page.locator("#e2e-zoom .aster-label-swap")).toHaveCount(0);
  const geometry = await page.evaluate(() => {
    const button = document.querySelector("#e2e-zoom button")!.getBoundingClientRect();
    const icon = document.querySelector("#e2e-zoom-icon")!.getBoundingClientRect();
    return { width: button.width, height: button.height, left: icon.left - button.left, right: button.right - icon.right };
  });
  expect(geometry.width).toBe(geometry.height);
  expect(geometry.left).toBeCloseTo(geometry.right, 1);

  await page.evaluate(() => { (document.querySelector("#e2e-zoom") as HTMLElement & { busy: boolean }).busy = true; });
  await expect(page.getByRole("button", { name: "Zooming" })).toHaveAttribute("title", "Zooming");
  await page.evaluate(() => { Object.assign(document.querySelector("#e2e-zoom")!, { busy: false, reason: "Already at full zoom" }); });
  await expect(zoom).toHaveAttribute("title", "Already at full zoom");

  // Without an icon there is nothing else to show, so the label stays.
  await expect(page.locator("#e2e-plain .aster-label-swap")).toHaveText("Plain");
  await expect(page.locator("#e2e-plain button")).not.toHaveAttribute("aria-label", /./);
});

test("columns, label orientation and Enter-to-save with a cancelable form-submit", async ({ page }) => {
  await dataPage(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const ctx = (globalThis as any).e2eCtx;
    const records = ctx.collection({ set: "FormRecords", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await records.ensure(0, 5);
    const edit = new lib.EditModel(ctx, "FormRecords", records.keys.value[0]);
    const element = document.createElement("aster-form") as HTMLElement & Record<string, any>;
    element.id = "e2e-form";
    element.model = edit;
    element.columns = 3;
    element.titleOrientation = "start";
    element.saveOnEnter = true;
    element.sections = [
      { title: "First", items: ["name", "status"] },
      { title: "Second", columns: 1, items: ["budget"] },
    ];
    document.body.append(element);
    (globalThis as unknown as { e2e: { edit: unknown; allow: boolean; events: number } }).e2e = { edit, allow: false, events: 0 };
    element.addEventListener("form-submit", (event) => {
      const state = (globalThis as unknown as { e2e: { allow: boolean; events: number } }).e2e;
      state.events++;
      if (!state.allow) event.preventDefault();
    });
  });

  const grids = form(page).locator(".aster-form-grid");
  expect(await grids.nth(0).evaluate((element) => (element as HTMLElement).style.getPropertyValue("--columns"))).toBe("3");
  expect(await grids.nth(1).evaluate((element) => (element as HTMLElement).style.getPropertyValue("--columns"))).toBe("1");
  await expect(form(page)).toHaveAttribute("data-title-orientation", "start");
  await page.evaluate(() => document.querySelector("#e2e-form")!.setAttribute("style", "--aster-form-label-width: 12rem"));
  const field = form(page).locator('[data-field="name"]');
  expect(await field.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ")[0])).toBe("192px");
  const label = await field.locator(".aster-field-label").boundingBox();
  const input = await field.locator("input").boundingBox();
  expect(label!.x + label!.width).toBeLessThan(input!.x + 1);
  expect(Math.abs(label!.y - input!.y)).toBeLessThan(20);

  const name = field.locator("input");
  await name.fill("Renamed by Enter");
  await name.press("Enter");
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { events: number } }).e2e.events)).toBe(1);
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { edit: { dirty: { value: boolean } } } }).e2e.edit.dirty.value)).toBe(true);
  await page.evaluate(() => ((globalThis as unknown as { e2e: { allow: boolean } }).e2e.allow = true));
  await name.press("Enter");
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { e2e: { edit: { dirty: { value: boolean } } } }).e2e.edit.dirty.value)).toBe(false);
  expect(await page.evaluate(() => (globalThis as unknown as { e2e: { events: number } }).e2e.events)).toBe(2);
  expect(await page.evaluate(() => {
    const w = globalThis as any;
    return w.e2eCtx.store.record("FormRecords", w.e2e.edit.key.value)?.value?.entity.name;
  })).toBe("Renamed by Enter");
});

test("the composition validator accepts the data forms and rejects functions and bad values", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const authoring = lib.defineCompositeRegistry({
      models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) },
      components: lib.asterComponents,
    });
    const diagnostics = (type: string, props: object) => authoring.diagnostics({
      version: 1, name: "form-test", model: { type: "empty" }, children: { control: { type, props } }, layout: { child: "control" },
    });
    return {
      valid: [
        diagnostics("Form", {
          policy: { readOnly: true, disabled: false },
          chrome: { columns: 3, titleOrientation: "start", showInlineErrors: false, errorSummary: true, autoFocus: true },
          features: [{ kind: "validation", on: "exit" }, { kind: "save" }],
          columns: 3, titleOrientation: "start", showInlineErrors: false, errorSummary: true, autoFocus: true,
          readOnly: true, disabled: false, validateOn: "change", saveOnEnter: true,
          sections: [{ title: "Basics", items: [{ field: "name", title: "Name", hint: "Help", placeholder: "A name", readOnly: true, disabled: false, required: true, control: "select" }] }],
        }),
        diagnostics("DateField", { min: "2026-01-01", max: "2026-12-31", format: "iso", placeholder: "Pick a date", dismissOnSelect: false }),
        diagnostics("Switch", { disabled: true, readOnly: false, onLabel: "On", offLabel: "Off" }),
        diagnostics("Choice", { filter: true, clearable: true, noResults: "No matches", disabled: false }),
        diagnostics("Select", { filter: true, clearable: true, noResults: "No matches", placeholder: "Pick one" }),
        diagnostics("Button", { tone: "danger", size: "sm", disabled: true }),
      ],
      invalid: [
        diagnostics("Form", { sections: [{ title: "Bad", items: [{ field: "name", control: () => null }] }] }),
        diagnostics("Form", { sections: [{ title: "Bad", items: [{ field: "name", control: "canvas" }] }] }),
        diagnostics("Form", { validateOn: "blur" }),
        diagnostics("Form", { chrome: { columns: 0 } }),
        diagnostics("Form", { features: [{ kind: "save" }, { kind: "save" }] }),
        diagnostics("DateField", { format: "long" }),
        diagnostics("DateField", { min: "soon" }),
        diagnostics("Switch", { disabled: "yes" }),
        diagnostics("Choice", { filter: "yes" }),
        diagnostics("Button", { tone: "ghost" }),
      ],
    };
  });
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});
