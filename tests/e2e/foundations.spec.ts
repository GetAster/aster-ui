import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/playground/foundations.html");
  await expect(page.locator("#budget-group")).toBeVisible();
}

for (const theme of ["lamplight", "harbour"]) for (const scheme of ["light", "dark"]) {
  test(`native checkboxes follow ${theme} ${scheme} and remain keyboard operable`, async ({ page }) => {
    await page.goto(`/playground/foundations.html?theme=${theme}&scheme=${scheme}`);
    await expect(page.locator("#budget-group")).toBeVisible();
    const checkboxes = page.getByRole("checkbox");
    await expect(checkboxes).toHaveCount(5);
    for (const checkbox of await checkboxes.all()) {
      const accent = await checkbox.evaluate(el => {
        const probe = document.createElement("span");
        probe.style.color = "var(--aster-accent)";
        el.parentElement!.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await expect(checkbox).toHaveCSS("accent-color", accent);
    }
    const disable = page.getByRole("checkbox", { name: "Disable group" });
    await disable.focus();
    await disable.press("Space");
    await expect(disable).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Budget", exact: true })).toBeDisabled();
    await disable.press("Space");
    await expect(page.getByRole("textbox", { name: "Budget", exact: true })).toBeEnabled();
  });
}

test("exact stepping, incomplete drafts, explicit step validation and bounds", async ({ page }) => {
  await open(page);
  const input = page.getByRole("textbox", { name: "Unit price", exact: true });
  await input.focus();
  await input.press("ArrowUp");
  await expect(input).toHaveValue("9007199254740993.3");
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Increase Unit price" }).click();
  await expect(input).toHaveValue("9007199254740993.35");
  await expect(input).toBeFocused();
  await input.fill("-");
  await expect(input).toHaveValue("-");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("1.03");
  await expect(page.locator("#exact .aster-error")).toContainText("increments");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("1.05");
  const quantity = page.getByRole("textbox", { name: "Quantity", exact: true });
  await quantity.fill("9");
  await expect(page.getByRole("button", { name: "Increase Quantity" })).toBeDisabled();
  await quantity.fill("");
  await page.getByRole("button", { name: "Increase Quantity" }).click();
  await expect(quantity).toHaveValue("0");
  await page.locator("#exact").evaluate((el: any) => { el.value = "1234.50"; el.format = (value: string) => `Display ${value}`; });
  await expect(input).toHaveValue("Display 1234.50");
  await input.focus();
  await expect(input).toHaveValue("1234.50");
  await input.fill("1234.55");
  await input.blur();
  await expect(input).toHaveValue("Display 1234.55");
  expect(await page.locator("#exact").evaluate((el: any) => el.value)).toBe("1234.55");
});

test("group revert touches named fields only, retains exact model values and respects disabling", async ({ page }) => {
  await open(page);
  const budget = page.getByRole("textbox", { name: "Budget", exact: true });
  const name = page.getByRole("textbox", { name: "Project", exact: true });
  const before = await budget.inputValue();
  await name.fill("A retained project name");
  await budget.fill("123.45");
  await expect(budget).toHaveValue("123.45");
  await expect(budget).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Revert Project finances", exact: true }).click();
  await expect(budget).toHaveValue(before);
  await expect(name).toHaveValue("A retained project name");
  await page.getByLabel("Disable group").check();
  await expect(budget).toBeDisabled();
  await expect(name).toBeEnabled();
  await page.getByLabel("Disable group").uncheck();
  await budget.fill("1,2");
  await expect(budget).toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => (window as any).foundationsDemo.model.values.value.budget)).toBe("1,2");
  await budget.fill("-");
  await page.getByRole("button", { name: "Validate project" }).click();
  await expect(budget).toHaveAttribute("aria-invalid", "true");
  await expect(budget).toBeFocused();
});

test("structured composite values retain siblings and enforce read-only commits", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("35");
  await expect.poll(() => page.locator("#structured aster-composite-field").evaluate((el: any) => el.value)).toEqual({ width: "35", height: "10" });
  await page.locator("#structured aster-composite-field").evaluate((el: any) => el.readOnly = true);
  await expect(page.getByRole("textbox", { name: "Width", exact: true })).toHaveAttribute("readonly", "");
});

test("accordion lazy bodies retain drafts, coordinate expansion and reveal closed errors", async ({ page }) => {
  await open(page);
  const settings = page.locator("#settings");
  await expect(settings.getByRole("textbox", { name: "Private note" })).toHaveCount(0);
  await settings.getByRole("button", { name: "Notes", exact: true }).click();
  await settings.getByRole("textbox", { name: "Private note" }).fill("Keep this note");
  await settings.getByRole("button", { name: "General", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Notes", exact: true })).toHaveAttribute("aria-expanded", "false");
  await settings.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(settings.getByRole("textbox", { name: "Private note" })).toHaveValue("Keep this note");
  await expect.poll(() => page.evaluate(() => (window as any).foundationsDemo.lazyCalls)).toBe(1);
  await page.getByRole("button", { name: "Reveal a validation error" }).click();
  await expect(settings.getByRole("button", { name: "Limits", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(settings.getByRole("button", { name: "Notes", exact: true })).toHaveAttribute("aria-expanded", "true");
  await settings.getByRole("button", { name: "Notes", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(settings.getByRole("button", { name: "Limits", exact: true })).toBeFocused();
  await expect(settings.getByRole("button", { name: "Managed by administrator" })).toBeDisabled();
});

test("split axes, collapse and narrow-container adaptation retain DOM and drafts", async ({ page }) => {
  await open(page);
  const split = page.locator("#layout-split");
  const bar = split.locator(":scope > .aster-split-layout > [role=separator]");
  await bar.focus();
  const initial = await bar.getAttribute("aria-valuenow");
  await bar.press("ArrowRight");
  await expect.poll(() => bar.getAttribute("aria-valuenow")).not.toBe(initial);
  const note = page.getByRole("textbox", { name: "Working note" });
  await note.fill("Preserve while resizing");
  const inner = page.getByRole("separator", { name: "Resize project notes" });
  await expect(inner).toHaveAttribute("aria-orientation", "horizontal");
  await inner.focus();
  const before = await inner.getAttribute("aria-valuenow");
  await inner.press("ArrowDown");
  await expect.poll(() => inner.getAttribute("aria-valuenow")).not.toBe(before);
  await bar.focus(); await bar.press("Enter");
  await expect(bar).toHaveAttribute("aria-valuetext", "Collapsed");
  await bar.press("Enter");
  await expect(note).toHaveValue("Preserve while resizing");
  const expanded = await bar.getAttribute("aria-valuenow");
  const rect = await bar.boundingBox();
  if (!rect) throw new Error("Missing separator geometry");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(rect.x + 40, rect.y + 10);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => bar.getAttribute("aria-valuenow")).toBe(expanded);
  await page.getByRole("button", { name: "Use narrow container" }).click();
  await expect(bar).toBeHidden();
  await expect(note).toHaveValue("Preserve while resizing");
  await expect(split).toHaveJSProperty("collapsed", false);
});

test("breadcrumb overflow and hierarchy restore context, draft, focus and scroll", async ({ page }) => {
  await open(page);
  const path = page.locator("#path"), hierarchy = page.locator("#hierarchy");
  await expect(path.locator('[aria-current="page"]')).toHaveText("Aster");
  await path.getByRole("button", { name: "Show ancestors" }).click();
  await page.getByRole("menuitem", { name: "Platform", exact: true }).click();
  await expect(hierarchy.getByRole("heading", { name: "Platform", exact: true })).toBeFocused();
  await expect(path.locator('[aria-current="page"]')).toHaveText("Platform");
  await hierarchy.getByRole("button", { name: "Projects →" }).click();
  await hierarchy.getByRole("button", { name: "Aster →" }).click();
  await hierarchy.getByRole("button", { name: "Design →" }).click();
  await expect(hierarchy.getByRole("heading", { name: "Design", exact: true })).toBeFocused();
  const note = hierarchy.getByRole("textbox", { name: "Design note" });
  await note.fill("Context is retained");
  const opener = hierarchy.getByRole("button", { name: "Open folder details" });
  await opener.focus();
  await opener.click();
  await expect(hierarchy.getByRole("heading", { name: "Folder details", exact: true })).toBeFocused();
  await hierarchy.getByRole("button", { name: "Back to Design" }).click();
  await expect(note).toHaveValue("Context is retained");
  await expect(opener).toBeFocused();
  await expect(path.locator('[aria-current="page"]')).toHaveText("Design");
  await path.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(hierarchy.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible();
  await expect(path.locator('[aria-current="page"]')).toHaveText("Workspace");
  await expect(path.getByRole("button", { name: "Show ancestors" })).toHaveCount(0);
  for (const name of ["Engineering", "Platform", "Projects", "Aster", "Design"]) await hierarchy.getByRole("button", { name: `${name} →`, exact: true }).click();
  await expect(note).toHaveValue("Context is retained");
});

test("carousel stable IDs preserve card DOM on reorder and support RTL", async ({ page }) => {
  await page.setViewportSize({ width: 650, height: 900 });
  await open(page);
  const rail = page.locator("#rail");
  const note = rail.getByRole("textbox", { name: "Note for Spring launch" });
  await note.fill("Keep card identity");
  await note.evaluate(el => (window as any).retainedCardInput = el);
  await page.getByRole("button", { name: "Reverse cards" }).click();
  await expect(note).toHaveValue("Keep card identity");
  expect(await note.evaluate(el => el === (window as any).retainedCardInput)).toBe(true);
  await note.focus();
  await rail.evaluate((el: any) => el.slides = [...el.slides].reverse());
  await expect(note).toBeFocused();
  await page.getByLabel("Right-to-left rail").check();
  await expect.poll(() => rail.evaluate((el: any) => el.index)).toBe(0);
  await rail.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => rail.evaluate((el: any) => el.index)).toBe(1);
});

test("narrow layout, reduced motion, forced colors and accessible names", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(" ")}`)).toEqual([]);
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.getByRole("textbox", { name: "Unit price", exact: true })).toBeVisible();
});

test("new controls mount through the shared composition registry", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const model = lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) });
    const authoring = lib.defineCompositeRegistry({ models: { empty: model }, components: { NumberField: lib.asterComponents.NumberField, Breadcrumbs: lib.asterComponents.Breadcrumbs } });
    const definition = authoring.validate({ version: 1, name: "DeclaredControls", model: { type: "empty" },
      children: { number: { type: "NumberField", props: { label: "Declared quantity", labelled: true, value: "5", numericType: "integer", min: 0, max: 10, stepButtons: true } },
        path: { type: "Breadcrumbs", props: { label: "Declared location", items: [{ id: "root", label: "Root", href: "#root" }, { id: "current", label: "Current" }] } } },
      layout: { type: "stack", items: [{ child: "path" }, { child: "number" }] } });
    const host = document.createElement("section"); host.id = "declared-controls";
    document.querySelector("main")!.append(host);
    (window as any).declaredControls = new lib.Composite(definition, authoring.registry).mount(host);
  });
  const declared = page.locator("#declared-controls");
  await expect(declared.getByRole("textbox", { name: "Declared quantity" })).toHaveValue("5");
  await declared.getByRole("button", { name: "Increase Declared quantity" }).click();
  await expect(declared.getByRole("textbox", { name: "Declared quantity" })).toHaveValue("6");
  await expect(declared.getByRole("link", { name: "Root" })).toHaveAttribute("href", "#root");
  await page.evaluate(() => (window as any).declaredControls.dispose());
  await expect(declared).toBeEmpty();
});

test("touch layouts give numeric actions and resize handles 44px targets", async ({ browser, browserName, baseURL }) => {
  test.skip(browserName === "firefox", "Firefox does not support touch context emulation");
  const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await open(page);
    for (const locator of [page.getByRole("button", { name: "Increase Unit price" }), page.getByRole("separator", { name: "Resize project notes" })]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Increase Unit price" }).tap();
    await expect(page.getByRole("textbox", { name: "Unit price", exact: true })).toHaveValue("9007199254740993.3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
