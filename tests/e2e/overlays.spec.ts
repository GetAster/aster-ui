// M4 acceptance 1: overlays sit in the top layer, attached to their anchor,
// whole inside the viewport, flipping at its edges.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

async function placement(page: Page, anchor: Locator, list: Locator) {
  await expect(list).toBeVisible();
  const [a, l] = [(await anchor.boundingBox())!, (await list.boundingBox())!];
  const viewport = page.viewportSize()!;
  return {
    inside: l.x >= 0 && l.y >= 0 && l.x + l.width <= viewport.width + 0.5 && l.y + l.height <= viewport.height + 0.5,
    below: l.y >= a.y + a.height - 1,
    above: l.y + l.height <= a.y + 1,
    alignedLeft: Math.abs(l.x - a.x) <= 1,
    atLeastAnchorWidth: l.width >= a.width - 1,
    topLayer: await list.evaluate((el) => el.matches(":popover-open")),
  };
}

test("a picker in a grid row near the bottom flips above, whole and attached, outside the grid's scroll box", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 640 });
  await page.goto(`/?memory&debug&clients=2000&time=3000&now=${NOW}#time`);
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
  const scroll = page.locator(".aster-grid-scroll");
  const box = (await scroll.boundingBox())!;
  const rows = page.locator(".aster-grid-row[data-key]");
  let low: Locator | undefined;
  for (let i = 0; i < (await rows.count()); i++) {
    const r = (await rows.nth(i).boundingBox())!;
    if (r.y + r.height < box.y + box.height && r.y > box.y + box.height - 160 && !(await rows.nth(i).textContent())!.includes("Approved")) low = rows.nth(i);
  }
  expect(low).toBeDefined();
  await low!.locator("[aria-colindex='2']").dblclick();
  const person = low!.getByRole("combobox", { name: "Person" });
  await person.click();
  const list = page.getByRole("listbox", { name: "Person" });
  await expect.poll(() => placement(page, low!.locator("[aria-colindex='2'] .aster-field"), list))
    .toMatchObject({ inside: true, above: true, alignedLeft: true, atLeastAnchorWidth: true, topLayer: true });
});

test("a select near the top opens below; near the bottom of a short window, above", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#project/1`);
  const status = page.getByRole("combobox", { name: "Status" });
  await status.click();
  const list = page.getByRole("listbox", { name: "Status" });
  expect(await placement(page, page.locator(".aster-field", { has: status }), list)).toMatchObject({ inside: true, below: true, topLayer: true });
  await page.keyboard.press("Escape");
  const top = (await status.boundingBox())!.y;
  await page.setViewportSize({ width: 900, height: Math.round(top + 60) });
  await status.click();
  expect(await placement(page, page.locator(".aster-field", { has: status }), list)).toMatchObject({ inside: true, above: true, topLayer: true });
});

test("a picker at the right edge stays inside the window", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#project/1`);
  await page.addStyleTag({ content: "aster-form .aster-form-grid { direction: rtl; }" });
  const lead = page.getByRole("combobox", { name: "Lead" });
  await lead.click();
  const p = await placement(page, page.locator(".aster-field", { has: lead }), page.getByRole("listbox", { name: "Lead" }));
  expect(p.inside).toBe(true);
});

test("a picker in a section collapsed and opened again stays whole and attached", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#project/1`);
  const basics = page.getByRole("button", { name: /Basics/ });
  await basics.click();
  await expect(basics).toHaveAttribute("aria-expanded", "false");
  await basics.click();
  const lead = page.getByRole("combobox", { name: "Lead" });
  await lead.click();
  const p = await placement(page, page.locator(".aster-field", { has: lead }), page.getByRole("listbox", { name: "Lead" }));
  expect(p).toMatchObject({ inside: true, alignedLeft: true, topLayer: true });
});

test("the grid's panels are popovers under their buttons, inside a short window", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#time`);
  for (const name of ["Columns", "Views"]) {
    const tool = page.getByRole("button", { name, exact: true });
    await tool.click();
    const panel = page.getByRole("group", { name });
    const [t, b] = [(await tool.boundingBox())!, (await panel.boundingBox())!];
    expect(await panel.evaluate((el) => el.matches(":popover-open"))).toBe(true);
    expect(b.y + b.height).toBeLessThanOrEqual(420.5);
    expect(b.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
    expect(Math.abs(b.x + b.width - (t.x + t.width))).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
});

test("menus by pointer and type-ahead: hovering a submenu item opens it beside, a letter jumps", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#time`);
  await page.locator('.aster-grid-header[data-field="note"]').hover();
  await page.locator('.aster-grid-header[data-field="note"] .aster-grid-header-menu').click();
  const menu = page.getByRole("menu", { name: "Note column" });
  await page.keyboard.press("w");
  await expect(menu.getByRole("menuitem", { name: /Width/ })).toBeFocused();
  await menu.getByRole("menuitem", { name: /Move/ }).hover();
  const sub = page.getByRole("menu", { name: "Move" });
  await expect(sub).toBeVisible();
  const [item, box] = [(await menu.getByRole("menuitem", { name: /Move/ }).boundingBox())!, (await sub.boundingBox())!];
  expect(box.x >= item.x + item.width - 2 || box.x + box.width <= item.x + 2).toBe(true);
  await expect(sub.getByRole("menuitem", { name: "Right" })).toHaveAttribute("aria-disabled", "true");
  await menu.getByRole("menuitem", { name: /Width/ }).hover();
  await expect(sub).toHaveCount(0);
});

test("axe in Harbour dim with each new overlay open: menu and submenu, calendar, window, picker with columns", async ({ page }) => {
  const check = async (what: string) => {
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect([what, violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)]).toEqual([what, []]);
  };
  await page.addInitScript(() => localStorage.setItem("aster-demo-scheme", "dark"));
  await page.goto(`/?memory&debug&identity=harbour&clients=2000&time=200&now=${NOW}#time`);
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
  await page.locator('.aster-grid-header[data-field="note"]').hover();
  await page.locator('.aster-grid-header[data-field="note"] .aster-grid-header-menu').click();
  await page.getByRole("menuitem", { name: /Move/ }).hover();
  await expect(page.getByRole("menu", { name: "Move" })).toBeVisible();
  await check("menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Choose a date to filter Date" }).click();
  await expect(page.getByRole("dialog", { name: /Choose a date/ })).toBeVisible();
  await check("calendar");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await check("window");
  await page.keyboard.press("Escape");
  await page.evaluate(() => (location.hash = "#project/2"));
  const client = page.getByRole("combobox", { name: "Client" });
  await client.click();
  await client.pressSequentially("lumen", { delay: 20 });
  await expect(page.locator("aster-picker [role=status]").filter({ hasText: "match" })).toBeVisible();
  await check("picker");
});

test("a menu's radio and check marks follow choices while it stays open", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#time`);
  await page.locator('.aster-grid-header[data-field="note"]').hover();
  await page.locator('.aster-grid-header[data-field="note"] .aster-grid-header-menu').click();
  const menu = page.getByRole("menu", { name: "Note column" });
  await expect(menu.getByRole("menuitemradio", { name: /Not sorted/ })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: /Descending/ }).click();
  await expect(menu.getByRole("menuitemradio", { name: /Descending/ })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: /Not sorted/ })).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('.aster-grid-header[data-field="note"]')).toHaveAttribute("aria-sort", "descending");
  await page.keyboard.press("Escape");
  await page.locator('.aster-grid-header[data-field="status"]').hover();
  await page.locator('.aster-grid-header[data-field="status"] .aster-grid-header-menu').click();
  const status = page.getByRole("menu", { name: "Status column" });
  const freeze = status.getByRole("menuitemcheckbox", { name: /Freeze up to Status/ });
  await expect(freeze).toHaveAttribute("aria-checked", "false");
  await freeze.click();
  await expect(freeze).toHaveAttribute("aria-checked", "true");
});

test("a toast's duration is configurable, and keyboard focus holds it", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#projects/active`);
  const toast = page.locator(".aster-toast");
  const toaster = page.locator("aster-toaster");
  await expect(page.locator('[data-figure="Budget left"]')).not.toHaveText("–");
  await toaster.evaluate((t) => {
    const el = t as unknown as { duration: number; actionDuration: number; show(m: string, a?: { label: string; run(): void }): void };
    el.duration = 300;
    el.actionDuration = 500;
    el.show("Plain");
  });
  await expect(toast).toHaveAttribute("data-show", "");
  await expect(toast).not.toHaveAttribute("data-show", "", { timeout: 1500 });
  await toaster.evaluate((t) => (t as unknown as { show(m: string, a: { label: string; run(): void }): void }).show("Moved", { label: "Undo", run() {} }));
  const undo = toast.getByRole("button", { name: "Undo" });
  await undo.focus();
  await page.waitForTimeout(1200);
  await expect(toast).toHaveAttribute("data-show", "");
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(toast).not.toHaveAttribute("data-show", "", { timeout: 4000 });
});
