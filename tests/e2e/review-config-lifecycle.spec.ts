import { expect, test, type Page } from "@playwright/test";

async function mount(page: Page): Promise<void> {
  await page.goto("/playground/composition.html");
  await page.evaluate(async () => {
    await import("/lib/aster-ui.js" as string);
    document.body.replaceChildren();
  });
}

async function mountWindow(page: Page, modal = false): Promise<void> {
  await mount(page);
  await page.evaluate(async (modal) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const opener = document.createElement("button");
    opener.id = "review-opener";
    opener.textContent = "Open editor";
    const win = document.createElement("aster-window") as HTMLElement & Record<string, any>;
    win.id = "review-window";
    win.heading = "Editor";
    win.modal = modal;
    win.preserveContent = true;
    win.content = lib.html`<input aria-label="Draft">`;
    document.body.append(opener, win);
    opener.focus();
    win.show(opener);
  }, modal);
  await expect(page.locator("#review-window .aster-window")).toBeVisible();
}

async function mountForm(page: Page, custom = false, initiallyCollapsed = false): Promise<void> {
  await mount(page);
  await page.evaluate(async ({ custom, initiallyCollapsed }) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const mock = await mockLib.createMockService({
      metadata: {
        $Version: "4.01", $EntityContainer: "Test.Container",
        Test: {
          Record: {
            $Kind: "EntityType", $Key: ["id"],
            id: { $Type: "Edm.Int32", "@Core.Computed": true },
            name: { $Type: "Edm.String", "@Core.Description": "Name", "@AsterData.MinLength": 1 },
          },
          Container: { $Kind: "EntityContainer", Records: { $Collection: true, $Type: "Test.Record" } },
        },
      },
      data: { Records: [{ id: 1, name: "Saved" }] },
      wasm: new URL("/lib/odata_mock.wasm", location.href),
    });
    const ctx = await lib.DataContext.connect(mock.transport);
    const rows = ctx.collection({ set: "Records" }, { pageSize: 5 });
    await rows.ensure(0, 5);
    const edit = new lib.EditModel(ctx, "Records", rows.keys.value[0]);
    const form = document.createElement("aster-form") as HTMLElement & Record<string, any>;
    form.id = "review-form";
    form.model = edit;
    form.errorSummary = true;
    form.sections = [
      ...(initiallyCollapsed ? [{ title: "Other section", items: [] }] : []),
      { title: "Details", open: !initiallyCollapsed, items: [custom ? {
        field: "name",
        control: (c: any) => lib.html`<input id=${c.id} aria-invalid=${c.invalid ? "true" : "false"}
          .value=${c.value} @input=${(event: InputEvent) => c.write((event.target as HTMLInputElement).value)}>`,
      } : "name"] },
    ];
    document.body.append(form);
    (window as any).reviewEdit = edit;
  }, { custom, initiallyCollapsed });
  await expect(page.locator("#review-form input")).toHaveValue("Saved");
  await page.evaluate(() => {
    (window as any).reviewEdit.set("name", "");
    (window as any).reviewEdit.validate();
  });
  await expect(page.locator("#review-form .aster-form-summary button")).toHaveCount(1);
}

test("changing modality waits for the next opening and retains the current draft", async ({ page }) => {
  await mountWindow(page);
  const draft = page.getByRole("textbox", { name: "Draft" });
  await draft.fill("Do not lose this edit");
  await draft.evaluate(element => { element.dataset.original = "true"; });
  const current = await page.evaluate(async () => {
    const win = document.getElementById("review-window") as any;
    win.modal = true;
    await new Promise(requestAnimationFrame);
    const input = win.querySelector("input") as HTMLInputElement;
    return { modal: win.querySelector(".aster-window").getAttribute("aria-modal"), value: input.value, original: input.dataset.original };
  });
  expect.soft(current).toEqual({ modal: "false", value: "Do not lose this edit", original: "true" });
  await page.evaluate(async () => {
    const win = document.getElementById("review-window") as any;
    await win.close();
    win.show();
  });
  // Pin the direction: the dialog itself is modal and hosts the live panel.
  await expect.poll(() => page.evaluate(() => {
    const win = document.getElementById("review-window") as any;
    const dialog = win.querySelector("dialog");
    return { hostModal: dialog.matches(":modal"), panelInside: !!dialog.querySelector(".aster-window") };
  })).toEqual({ hostModal: true, panelInside: true });
  const kept = await page.evaluate(() => {
    const input = document.querySelector("#review-window input") as HTMLInputElement;
    return { value: input.value, original: input.dataset.original };
  });
  expect.soft(kept).toEqual({ value: "Do not lose this edit", original: "true" });

  // The reverse transition also waits for the next open and keeps the open draft.
  await mountWindow(page, true);
  const reverseDraft = page.getByRole("textbox", { name: "Draft" });
  await reverseDraft.fill("Keep this draft too");
  const reverse = await page.evaluate(async () => {
    const win = document.getElementById("review-window") as any;
    win.modal = false;
    await new Promise(requestAnimationFrame);
    const input = win.querySelector("input") as HTMLInputElement;
    return { modal: win.querySelector(".aster-window").getAttribute("aria-modal"), value: input.value };
  });
  expect.soft(reverse).toEqual({ modal: "true", value: "Keep this draft too" });
  await page.evaluate(async () => {
    const win = document.getElementById("review-window") as any;
    await win.close();
    win.show();
  });
  // Pin the direction: the dialog stays closed and the panel lives outside it.
  await expect.poll(() => page.evaluate(() => {
    const win = document.getElementById("review-window") as any;
    const dialog = win.querySelector("dialog");
    return { hostModal: dialog.matches(":modal"), panelInside: !!dialog.querySelector(".aster-window") };
  })).toEqual({ hostModal: false, panelInside: false });
  await expect(page.locator("#review-window .aster-window")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep this draft too");
});

test("native modal closure emits one close notification and restores the opener without throwing", async ({ page }) => {
  await mountWindow(page, true);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.evaluate(() => {
    const win = document.getElementById("review-window")!;
    (window as any).reviewCloseCount = 0;
    win.addEventListener("close", event => {
      if (event.target === win) (window as any).reviewCloseCount++;
    });
    win.querySelector("dialog")!.close();
  });
  await expect.poll(() => page.evaluate(() => (document.getElementById("review-window") as any).open)).toBe(false);
  expect.soft(errors).toEqual([]);
  expect.soft(await page.evaluate(() => (window as any).reviewCloseCount)).toBe(1);
  await expect(page.locator("#review-opener")).toBeFocused();
});

test("a parent smaller than the desktop minimum contains its window", async ({ page }) => {
  for (const explicitPlacement of [false, true]) {
    await mount(page);
    await page.evaluate((explicitPlacement) => {
      const parent = document.createElement("div");
      parent.id = "review-parent";
      parent.style.cssText = "position:fixed;left:100px;top:100px;width:180px;height:120px";
      const win = document.createElement("aster-window") as HTMLElement & Record<string, any>;
      win.id = "review-window";
      win.heading = "Small parent";
      win.keepInParentRect = true;
      if (explicitPlacement) win.initialPlacement = { state: "normal", bounds: { x: 0, y: 0, width: 240, height: 160 } };
      parent.append(win);
      document.body.append(parent);
      win.show(null);
    }, explicitPlacement);
    await expect(page.locator("#review-window .aster-window")).toBeVisible();
    await expect.poll(async () => {
      const parent = (await page.locator("#review-parent").boundingBox())!;
      const panel = (await page.locator("#review-window .aster-window").boundingBox())!;
      return panel.x >= parent.x - 1 && panel.y >= parent.y - 1
        && panel.x + panel.width <= parent.x + parent.width + 1
        && panel.y + panel.height <= parent.y + parent.height + 1;
    }).toBe(true);
  }
});

test("an error summary opens a section collapsed after validation and focuses its field", async ({ page }) => {
  await mountForm(page, false, true);
  const section = page.locator("#review-form aster-section").nth(1);
  await expect(section).toHaveJSProperty("open", true);
  await section.getByRole("button", { name: "Details" }).click();
  await expect(section.locator(".aster-section-body")).toHaveAttribute("inert", "");
  await page.locator("#review-form .aster-form-summary button").click();
  await expect(page.locator("#review-form input")).toBeFocused();
  await expect(section).toHaveJSProperty("open", true);
});

test("an error summary focuses the custom editor of an expanded section", async ({ page }) => {
  await mountForm(page, true);
  await page.locator("#review-form .aster-form-summary button").click();
  await expect(page.locator("#review-form input")).toBeFocused();
});

test("a rejected modal close guard preserves focus and can subsequently close", async ({ page }) => {
  await mountWindow(page, true);
  const draft = page.getByRole("textbox", { name: "Draft" });
  await draft.fill("Keep editing");
  await page.evaluate(() => {
    const win = document.getElementById("review-window") as any;
    win.beforeClose = () => Promise.reject(new Error("Try again"));
    (window as any).reviewCloseErrors = [];
    win.addEventListener("closeerror", (event: CustomEvent) => (window as any).reviewCloseErrors.push(event.detail.message));
  });
  await draft.press("Escape");
  await expect(page.locator("#review-window .aster-window")).toHaveAttribute("aria-busy", "false");
  await expect(draft).toHaveValue("Keep editing");
  await expect(draft).toBeFocused();
  expect(await page.evaluate(() => (window as any).reviewCloseErrors)).toEqual(["Try again"]);
  await page.evaluate(() => { (document.getElementById("review-window") as any).beforeClose = () => true; });
  await draft.press("Escape");
  await expect(page.locator("#review-window .aster-window")).not.toBeVisible();
  await expect(page.locator("#review-opener")).toBeFocused();
});
