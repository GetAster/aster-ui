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

test("folds to its title bar and unfolds to the same size, with its content kept", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/playground/foundations.html");
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const win = Object.assign(document.createElement("aster-window"), {
      id: "e2e-fold", heading: "Minimap", chrome: { fold: true },
      initialPlacement: { state: "normal", bounds: { x: 40, y: 40, width: 320, height: 300 } },
      content: lib.html`<label>Note <input id="e2e-fold-note"></label>`,
    });
    const events: unknown[] = [];
    win.addEventListener("placementchange", (e) => events.push((e as CustomEvent).detail));
    Object.assign(globalThis, { e2eFoldEvents: events });
    document.body.append(win);
    (win as unknown as { show(o: null): void }).show(null);
  });
  const win = page.getByRole("dialog", { name: "Minimap" });
  await expect(win).toBeVisible();
  const note = page.locator("#e2e-fold-note");
  await note.fill("kept");
  const collapse = win.getByRole("button", { name: "Collapse Minimap" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  const before = (await win.boundingBox())!;

  await note.focus();
  await collapse.click();
  const expand = win.getByRole("button", { name: "Expand Minimap" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(expand).toBeFocused();
  await expect(note).toBeHidden();
  const bar = (await win.locator(".aster-window-bar").boundingBox())!;
  const folded = (await win.boundingBox())!;
  expect(folded.height).toBeLessThan(bar.height + 4);
  expect([folded.x, folded.y, folded.width]).toEqual([before.x, before.y, before.width]);
  await expect(win.getByRole("button", { name: "Resize Minimap" })).toBeDisabled();
  const placement = await page.evaluate(() => (document.querySelector("#e2e-fold") as unknown as { placement(): { folded: boolean; bounds: { height: number } } }).placement());
  expect(placement.folded).toBe(true);
  expect(placement.bounds.height).toBe(before.height);

  // Moving while folded keeps the unfolded height.
  await win.getByRole("button", { name: "Move Minimap" }).press("ArrowRight");
  await expect.poll(async () => (await win.boundingBox())!.x).toBe(before.x + 16);
  await win.getByRole("button", { name: "Expand Minimap" }).press("Enter");
  await expect(note).toBeVisible();
  await expect(note).toHaveValue("kept");
  await expect.poll(async () => (await win.boundingBox())!.height).toBe(before.height);
  const events = await page.evaluate(() => (globalThis as unknown as { e2eFoldEvents: { folded: boolean }[] }).e2eFoldEvents.map(e => e.folded));
  expect(events).toContain(true);
  expect(events.at(-1)).toBe(false);

  // A saved placement restores the fold.
  await page.evaluate(() => {
    const el = document.querySelector("#e2e-fold") as unknown as { setPlacement(p: unknown): void; folded: boolean };
    el.setPlacement({ state: "normal", bounds: { x: 40, y: 40, width: 320, height: 300 }, folded: true });
  });
  await expect(note).toBeHidden();
  await expect(win.getByRole("button", { name: "Expand Minimap" })).toBeVisible();
});

test("snaps to its parent's edges while dragged, and follows them as the parent resizes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/playground/foundations.html");
  await page.evaluate(() => {
    const pane = Object.assign(document.createElement("div"), { id: "e2e-snap-pane" });
    pane.style.cssText = "position: fixed; left: 40px; top: 40px; width: 600px; height: 500px;";
    const win = Object.assign(document.createElement("aster-window"), {
      id: "e2e-snap", heading: "Minimap", keepInParentRect: true, snapDistance: 24,
      initialPlacement: { state: "normal", bounds: { x: 200, y: 200, width: 240, height: 160 } },
    });
    const events: unknown[] = [];
    win.addEventListener("placementchange", (e) => events.push((e as CustomEvent).detail));
    Object.assign(globalThis, { e2eSnapEvents: events });
    pane.append(win);
    document.body.append(pane);
    (win as unknown as { show(o: null): void }).show(null);
  });
  const win = page.getByRole("dialog", { name: "Minimap" });
  await expect.poll(async () => Math.round((await win.boundingBox())?.x ?? 0)).toBe(200);
  const events = () => page.evaluate(() => (globalThis as unknown as { e2eSnapEvents: { anchor?: unknown }[] }).e2eSnapEvents.splice(0));
  await events();

  // Dragged to within reach of the top-right corner, it lands flush there before the drop.
  const b = (await win.locator(".aster-window-bar").boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 40 + 185, b.y + b.height / 2 - 145, { steps: 5 });
  const live = (await win.boundingBox())!;
  expect([Math.round(live.x + live.width), Math.round(live.y)]).toEqual([640, 40]);
  expect(await events()).toEqual([]);
  await page.mouse.up();
  const dropped = await events();
  expect(dropped.at(-1)?.anchor).toEqual({ x: "end", y: "start" });

  // Widening the parent keeps it in the corner and reports the move.
  await page.evaluate(() => { document.querySelector<HTMLElement>("#e2e-snap-pane")!.style.width = "800px"; });
  await expect.poll(async () => Math.round(((b) => b.x + b.width)((await win.boundingBox())!))).toBe(840);
  expect((await events()).at(-1)?.anchor).toEqual({ x: "end", y: "start" });

  // Dropped away from the edges it is free, and a shrinking parent only pushes it back inside.
  const c = (await win.locator(".aster-window-bar").boundingBox())!;
  await page.mouse.move(c.x + 40, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 40 - 300, c.y + c.height / 2 + 150, { steps: 5 });
  await page.mouse.up();
  expect((await events()).at(-1)).not.toHaveProperty("anchor");
  const free = (await win.boundingBox())!;
  await page.evaluate(() => { document.querySelector<HTMLElement>("#e2e-snap-pane")!.style.width = "300px"; });
  await expect.poll(async () => Math.round(((b) => b.x + b.width)((await win.boundingBox())!))).toBe(340);
  expect(Math.round((await win.boundingBox())!.y)).toBe(Math.round(free.y));

  // In right-to-left text, the start edge is the right one.
  await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>("#e2e-snap-pane")!;
    pane.style.width = "600px";
    pane.dir = "rtl";
    (pane.firstElementChild as unknown as { setPlacement(p: unknown): void })
      .setPlacement({ state: "normal", bounds: { x: 200, y: 200, width: 240, height: 160 }, anchor: { x: "start" } });
  });
  await expect.poll(async () => Math.round(((b) => b.x + b.width)((await win.boundingBox())!))).toBe(640);
});
