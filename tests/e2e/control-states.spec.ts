import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["lamplight", "harbour"]) for (const scheme of ["light", "dark"]) {
  for (const width of [1000, 375]) {
    test(`${theme} ${scheme} controls at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/playground/control-states.html?theme=${theme}&scheme=${scheme}`);
      const controls = page.locator("#controls");
      await expect(controls).toHaveAttribute("data-ready", "true");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("#checks").getByRole("checkbox", { name: "Checked", exact: true })).toBeChecked();
      await expect(page.locator("#checks").getByRole("checkbox", { name: "Mixed", exact: true })).toHaveJSProperty("indeterminate", true);
      await expect(page.getByRole("textbox", { name: "Invalid quantity", exact: true })).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("textbox", { name: "Read-only project", exact: true })).toHaveAttribute("readonly", "");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const region = page.getByRole("combobox", { name: "Region", exact: true });
      await expect(region).toHaveCSS("min-height", "30px");
      await region.selectOption({ label: "Americas" });
      await expect(region).toHaveValue("Americas");
      await expect(page.getByRole("combobox", { name: "Unavailable region", exact: true })).toBeDisabled();
      await page.locator("#focus-check").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator("#focus-check")).toBeFocused();
      await expect(page.locator("#focus-check")).toHaveCSS("outline-style", "solid");
      await expect(controls).toHaveScreenshot(`${theme}-${scheme}-${width}.png`, { animations: "disabled", caret: "hide", maxDiffPixels: 20, maxDiffPixelRatio: 0 });
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
      await page.emulateMedia({ forcedColors: "active" });
      await page.keyboard.press("Space");
      await expect(page.locator("#focus-check")).toBeChecked();
      await expect(page.locator("#focus-check")).toHaveCSS("outline-style", "solid");
      // Shadows are dropped in forced colours; the shared button keeps a real edge.
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCSS("border-top-width", "1px");
    });
  }
}

test("a check's label can sit beside the box, on one line", async ({ page }) => {
  await page.goto("/playground/control-states.html");
  await expect(page.locator("#controls")).toHaveAttribute("data-ready", "true");
  const checks = page.locator("#checks");
  const after = checks.locator("aster-check").nth(3), before = checks.locator("aster-check").nth(4);
  const afterBox = after.getByRole("checkbox", { name: "Label after", exact: true });
  const beforeBox = before.getByRole("checkbox", { name: "Label before", exact: true });
  await expect(after.locator(".aster-field-head")).toHaveCount(0);
  // Text and box share a line, in the order asked for.
  const line = async (check: typeof after) => check.evaluate(el => {
    const box = el.querySelector("input")!.getBoundingClientRect(), text = el.querySelector(".aster-check-label")!.getBoundingClientRect();
    return { textFirst: text.right <= box.left, sameLine: Math.abs((text.top + text.bottom) / 2 - (box.top + box.bottom) / 2) < 3 };
  });
  expect(await line(after)).toEqual({ textFirst: false, sameLine: true });
  expect(await line(before)).toEqual({ textFirst: true, sameLine: true });
  // Clicking the text toggles the box.
  await expect(afterBox).toBeChecked();
  await after.getByText("Label after", { exact: true }).click();
  await expect(afterBox).not.toBeChecked();
  // On a stored record the change is pending, with Revert on the same line.
  await after.evaluate(async (el: any) => {
    const url = "/lib/aster-ui.js", mockUrl = "/lib/aster-ui-mock.js";
    const { DataContext, EditModel, keyText } = await import(url); const { createMockService } = await import(mockUrl);
    const json = async (name: string) => (await fetch(`/lib/demo/${name}.json`)).json();
    const mock = await createMockService({ metadata: await json("metadata"), data: await json("data"), wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await DataContext.connect(mock.transport);
    const task = (await json("data")).Tasks.find((t: any) => t.done === true);
    await ctx.reload("Tasks", keyText([task.id]));
    el.model = new EditModel(ctx, "Tasks", keyText([task.id]));
  });
  await expect(afterBox).toBeChecked();
  await after.getByText("Label after", { exact: true }).click();
  await expect(after).toHaveAttribute("data-pending", "");
  const revert = after.getByRole("button", { name: /^Revert Label after/ });
  await expect(revert).toBeVisible();
  expect(Math.abs((await revert.boundingBox())!.y + (await revert.boundingBox())!.height / 2 - ((await afterBox.boundingBox())!.y + (await afterBox.boundingBox())!.height / 2))).toBeLessThan(4);
  await revert.click();
  await expect(afterBox).toBeChecked();
  await beforeBox.focus(); await page.keyboard.press("Space");
  await expect(beforeBox).toBeChecked();
  // Right to left: "end" follows the text direction.
  await after.evaluate(el => el.setAttribute("dir", "rtl"));
  expect(await line(after)).toEqual({ textFirst: true, sameLine: true });
  await after.evaluate(el => el.removeAttribute("dir"));
  // Unlabelled, the position doesn't show a label; above restores the head.
  await after.evaluate((el: any) => { el.labelled = false; });
  await expect(after.locator(".aster-check-label")).toHaveCount(0);
  await expect(afterBox).toHaveAccessibleName("Label after");
  await after.evaluate((el: any) => { el.labelled = true; el.labelPosition = "above"; });
  await expect(after.locator(".aster-field-head")).toHaveCount(1);
  await expect(after.locator(".aster-check-label")).toHaveCount(0);
  const error = await after.evaluate((el: any) => { try { el.labelPosition = "below"; return "accepted"; } catch (e) { return (e as Error).name; } });
  expect(error).toBe("TypeError");
});
