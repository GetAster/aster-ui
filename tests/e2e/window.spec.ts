// M4: a non-modal window beside the page, moved by pointer and keyboard.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#project/1`);
  const opener = page.getByRole("button", { name: "Simulate", exact: true });
  await opener.click();
  const win = page.getByRole("dialog", { name: "Simulate" });
  await expect(win).toBeFocused();
  return { opener, win };
}

test("opens above its opener, focused; the page stays usable; Escape closes and returns focus", async ({ page }) => {
  const { opener, win } = await open(page);
  await expect(win).toHaveAttribute("aria-modal", "false");
  const [box, o] = [(await win.boundingBox())!, (await opener.boundingBox())!];
  expect([Math.round(box.x - o.x), Math.round(o.y - (box.y + box.height))]).toEqual([0, 8]);
  // Not modal: the page behind takes clicks and typing.
  const name = page.getByRole("textbox", { name: "Project", exact: true });
  await name.click();
  await name.press("End");
  await name.type("!");
  await expect(name).toHaveValue(/!$/);
  await expect(win).toBeVisible();
  await win.getByRole("button", { name: "Rename it" }).focus();
  await page.keyboard.press("Escape");
  await expect(win).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("moves by dragging its title bar and by keyboard, and stays inside the viewport", async ({ page }) => {
  const { win } = await open(page);
  const bar = win.locator(".aster-window-bar");
  const start = (await win.boundingBox())!;
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 340, b.y + b.height / 2 - 200, { steps: 6 });
  await page.mouse.up();
  const dragged = (await win.boundingBox())!;
  expect([Math.round(dragged.x - start.x), Math.round(dragged.y - start.y)]).toEqual([300, -200]);

  const move = win.getByRole("button", { name: "Move Simulate" });
  await move.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  const keyed = (await win.boundingBox())!;
  expect([Math.round(keyed.x - dragged.x), Math.round(keyed.y - dragged.y)]).toEqual([16, -64]);

  for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowRight");
  const edge = (await win.boundingBox())!;
  expect(Math.round(edge.x + edge.width)).toBe(1280 - 8);

  // Closed and opened again, it comes back where it was left.
  await win.getByRole("button", { name: "Close Simulate" }).click();
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect.poll(async () => Math.round((await win.boundingBox())?.x ?? 0)).toBe(Math.round(edge.x));
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: the window open, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    const results = await new AxeBuilder({ page }).include(".aster-window").analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}
