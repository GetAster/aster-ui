import { expect, test } from "@playwright/test";

for (const theme of ["lamplight", "harbour"]) {
  for (const scheme of ["light", "dark"]) {
    test(`collection editors have one focus ring in ${theme} ${scheme}`, async ({ page }) => {
      await page.goto(`/playground/collection-demo.html?theme=${theme}&scheme=${scheme}`);
      await page.locator(".aster-grid-row").filter({ hasText: "Design MacBook" }).first().click();
      await page.getByRole("button", { name: "Edit first selected", exact: true }).click();
      const editor = page.locator("#editor-out");
      const name = editor.getByRole("textbox", { name: "Name", exact: true });
      await expect(name).toBeFocused();
      const rings = () => name.evaluate(element => {
        const frame = element.closest("[data-ring-owner]")!;
        return [element, frame].map(node => ({
          style: getComputedStyle(node).outlineStyle,
          width: getComputedStyle(node).outlineWidth,
        }));
      });
      expect(await rings()).toEqual([
        { style: "none", width: "0px" }, { style: "solid", width: "2px" },
      ]);
      await name.press("Tab");
      const platform = editor.getByRole("combobox", { name: "Platform", exact: true });
      await expect(platform).toBeFocused();
      expect(await platform.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
      expect(await platform.evaluate(element => getComputedStyle(element.closest("[data-ring-owner]")!).outlineWidth)).toBe("2px");
      const search = page.getByRole("searchbox", { name: "Find by name", exact: true });
      await search.focus();
      expect(await search.evaluate(element => getComputedStyle(element).outlineWidth)).toBe("2px");
    });
  }
}
