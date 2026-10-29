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
    });
  }
}
