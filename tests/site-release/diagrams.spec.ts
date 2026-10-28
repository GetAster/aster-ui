import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("diagrams keep readable labels, accessible descriptions and theme colours across layouts", async ({ page }) => {
  await page.goto("/docs/guide/data-model.html");
  const figures = page.locator(".docs-diagram");
  await expect(figures).toHaveCount(2);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scheme of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "Colour scheme" }).selectOption(scheme);
      const visible = figures.first().locator(width === 375 ? '.diagram-narrow svg' : '.diagram-wide svg');
      await expect(visible).toBeVisible();
      await expect(figures.first().locator(width === 375 ? '.diagram-wide' : '.diagram-narrow')).toBeHidden();
      expect(await visible.locator('text').first().evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).include('.docs-diagram').analyze()).violations).toEqual([]);
    }
  }
  await expect(page.getByRole('img', { name: 'A Grid and TileGrid share one collection and selection over the same DataContext record store.' })).toHaveCount(1);
});

test("docs home and start navigation expose the showcase", async ({ page }) => {
  await page.goto('/docs/');
  await expect(page.locator('main').getByRole('link', { name: 'Explore the showcase →' })).toHaveAttribute('href', '/showcase/#showcase');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  const showcase = page.locator('#nav').getByRole('link', { name: 'Explore the showcase ↗' });
  await expect(showcase).toHaveAttribute('href', '/showcase/#showcase');
});

for (const guide of ['integrate-sql-and-apis', 'authentication', 'keyed-sessions']) {
  test(`${guide} diagram fits both layouts and has a text alternative`, async ({ page }) => {
    await page.goto(`/docs/guide/${guide}.html`);
    const figure = page.locator('.docs-diagram');
    await expect(figure).toHaveCount(1);
    await expect(figure.getByRole('img')).toHaveAttribute('aria-label', /.+/);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const scheme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: 'Colour scheme' }).selectOption(scheme);
        await page.evaluate(() => document.fonts.ready);
        const svg = figure.locator(width === 375 ? '.diagram-narrow svg' : '.diagram-wide svg');
        await expect(svg).toBeVisible();
        expect(await svg.evaluate(element => {
          const bounds = (element as SVGSVGElement).viewBox.baseVal;
          return [...element.querySelectorAll('text')].every(text => {
            const box = text.getBBox();
            return box.x >= 0 && box.y >= 0 && box.x + box.width <= bounds.width && box.y + box.height <= bounds.height
              && parseFloat(getComputedStyle(text).fontSize) >= 14;
          });
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).include('.docs-diagram').analyze()).violations).toEqual([]);
      }
    }
  });
}
