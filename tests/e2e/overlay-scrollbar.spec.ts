// A scrolled element shows an overlay scrollbar for a moment (WebKit), and that
// scrollbar takes pointer events over the strip it covers. A control inside a
// scroller's inline-end strip then loses presses that begin on it. Controls
// floating at a scroller's end keep the strip clear (--aster-scrollbar-clearance).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

async function tasks(page: Page) {
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#tasks`);
  await expect(page.locator(".aster-grid-row[data-key]").first()).toBeVisible();
}

const settled = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// Scrolls the grid on, as a wheel or scroll-into-view would, and lets the overlay scrollbar appear.
async function scrolled(page: Page) {
  await page.locator(".aster-grid-scroll").evaluate((el) => { el.scrollTop = Math.max(1, el.scrollHeight / 3); });
  await settled(page);
}

// What is under the point `fraction` of the way across the control, as the pointer sees it.
async function under(page: Page, control: Locator, fraction = 0.5) {
  const box = (await control.boundingBox())!;
  const x = box.x + box.width * fraction, y = box.y + box.height / 2;
  const owns = await control.evaluate((el, p) => { const t = document.elementFromPoint(p.x, p.y); return !!t && (el === t || el.contains(t)); }, { x, y });
  return { owns, x, y };
}

test("the last column's options button stays clickable just after the grid scrolls, while its scrollbar is showing", async ({ page }) => {
  await tasks(page);
  const button = page.locator(".aster-grid-head .aster-grid-header").last().locator(".aster-grid-header-menu");
  await scrolled(page);
  const hit = await under(page, button);
  expect(hit.owns).toBe(true);
  await page.mouse.click(hit.x, hit.y);
  await expect(page.getByRole("menu")).toBeVisible();
});

test("the last column's resize handle stays grabbable just after the grid scrolls, while its scrollbar is showing", async ({ page }) => {
  await tasks(page);
  const handle = page.locator(".aster-grid-head .aster-grid-header").last().locator(".aster-grid-resize");
  const width = () => page.locator(".aster-grid-head .aster-grid-header").last().evaluate((el) => el.getBoundingClientRect().width);
  await scrolled(page);
  const hit = await under(page, handle);
  expect(hit.owns).toBe(true);
  const before = await width();
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  await page.mouse.move(hit.x - 30, hit.y, { steps: 4 });
  await page.mouse.up();
  expect(await width()).toBeLessThan(before);
});

test("a row's floating controls are all clickable just after the grid scrolls, while its scrollbar is showing", async ({ page }) => {
  await tasks(page);
  await scrolled(page);
  const rows = page.locator(".aster-grid-row[data-key]");
  const inView = await rows.evaluateAll((els) => {
    const view = document.querySelector(".aster-grid-scroll")!.getBoundingClientRect();
    return els.findIndex((el) => { const b = el.getBoundingClientRect(); return b.top > view.top + 120 && b.bottom < view.bottom - 40; });
  });
  expect(inView).toBeGreaterThanOrEqual(0);
  const r = rows.nth(inView);
  await r.hover();
  const controls = r.locator(".aster-grid-controls button");
  await expect(controls.last()).toBeVisible();
  // The control nearest the edge, at its far side: the part a scrollbar strip covers first.
  const hit = await under(page, controls.last(), 0.9);
  expect(hit.owns).toBe(true);
});

// The options button must not move an end-aligned label away from its figures.
for (const [name, path, field] of [
  ["an end-aligned column that is not last", "/playground/filtering.html", "cost"],
  ["an end-aligned last column", "/playground/components.html", "cost"],
] as const) {
  test(`${name} ends its header label where its figures end, with the options button at rest and shown`, async ({ page }) => {
    await page.goto(path);
    const header = page.locator(`.aster-grid-head .aster-grid-header[data-field="${field}"]`);
    await expect(header).toBeVisible();
    const colindex = await header.getAttribute("aria-colindex");
    const gap = () => page.evaluate(({ field, colindex }) => {
      const end = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); return Math.max(...[...r.getClientRects()].map((x) => x.right)); };
      const h = document.querySelector(`.aster-grid-head .aster-grid-header[data-field="${field}"]`)!;
      const cell = document.querySelector(`.aster-grid-row[data-key] > [aria-colindex="${colindex}"]`)!;
      return Math.abs(end(h.querySelector(".aster-grid-sort span")!) - end(cell));
    }, { field, colindex });
    // The options button sits beside its label, not out at the column's edge.
    const menuGap = async () => (await extents(page, field, colindex)).menuGap;
    expect(await gap()).toBeLessThanOrEqual(1);
    expect(await menuGap()).toBeLessThanOrEqual(8);
    await header.hover({ force: true });
    expect(await gap()).toBeLessThanOrEqual(1);
    expect(await menuGap()).toBeLessThanOrEqual(8);
  });
}

// The header label's text box and the cells' text box, from the column's header and its first row.
const extents = (page: Page, field: string, colindex: string | null) => page.evaluate(({ field, colindex }) => {
  const box = (el: Element) => {
    const r = document.createRange(); r.selectNodeContents(el);
    const rects = [...r.getClientRects()];
    return { start: Math.min(...rects.map((x) => x.left)), end: Math.max(...rects.map((x) => x.right)) };
  };
  const h = document.querySelector(`.aster-grid-head .aster-grid-header[data-field="${field}"]`)!;
  const cell = document.querySelector(`.aster-grid-row[data-key] > [aria-colindex="${colindex}"]`)!;
  const label = box(h.querySelector(".aster-grid-sort span")!), figures = box(cell);
  const mark = h.querySelector(".aster-grid-sort-mark")?.getBoundingClientRect();
  return {
    labelCentre: (label.start + label.end) / 2, figuresCentre: (figures.start + figures.end) / 2,
    labelEnd: label.end, figuresEnd: figures.end,
    labelStart: label.start, figuresStart: figures.start,
    menuGap: (() => {
      const menu = h.querySelector(".aster-grid-header-menu")!.getBoundingClientRect();
      const items = [{ left: label.start, right: label.end }, ...(mark ? [mark] : [])];
      return Math.min(...items.map((i) => Math.max(menu.left - i.right, i.left - menu.right)));
    })(),
    markGap: mark ? Math.min(Math.abs(mark.left - label.end), Math.abs(label.start - mark.right)) : undefined,
  };
}, { field, colindex });

for (const dir of ["ltr", "rtl"] as const) {
  for (const [name, path] of [
    ["not last", "/playground/filtering.html"],
    ["last", "/playground/components.html"],
  ] as const) {
    test(`a centre-aligned ${name} column's header label is centred on its cells' text, at rest and shown (${dir})`, async ({ page }) => {
      await page.goto(path);
      const grid = page.locator("aster-grid").first();
      await expect(page.locator(".aster-grid-head .aster-grid-header[data-field='cost']")).toBeVisible();
      await grid.evaluate((g: any, dir) => {
        document.documentElement.dir = dir;
        g.presentation = { ...g.presentation, columns: { ...g.presentation?.columns, cost: { ...g.presentation?.columns?.cost, align: "center" } } };
      }, dir);
      const header = page.locator(".aster-grid-head .aster-grid-header[data-field='cost']");
      await expect(header).toHaveAttribute("data-align", "center");
      const colindex = await header.getAttribute("aria-colindex");
      const gap = async () => { const e = await extents(page, "cost", colindex); return Math.abs(e.labelCentre - e.figuresCentre); };
      const menuGap = async () => (await extents(page, "cost", colindex)).menuGap;
      expect(await gap()).toBeLessThanOrEqual(1);
      expect(await menuGap()).toBeLessThanOrEqual(8);
      await header.hover({ force: true });
      expect(await gap()).toBeLessThanOrEqual(1);
      expect(await menuGap()).toBeLessThanOrEqual(8);
    });
  }

  test(`a sorted end-aligned column's header label still ends where its figures end, with its arrow attached (${dir})`, async ({ page }) => {
    await page.goto("/playground/filtering.html");
    const header = page.locator(".aster-grid-head .aster-grid-header[data-field='cost']");
    await expect(header).toBeVisible();
    await page.evaluate((dir) => { document.documentElement.dir = dir; }, dir);
    const colindex = await header.getAttribute("aria-colindex");
    await header.locator(".aster-grid-sort").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(header.locator(".aster-grid-sort-mark")).toBeVisible();
    const check = async () => {
      await expect(page.locator(`.aster-grid-row[data-key] > [aria-colindex="${colindex}"]`).first()).toBeVisible();
      const e = await extents(page, "cost", colindex);
      // The inline end is the right in ltr and the left in rtl.
      expect(Math.abs(dir === "ltr" ? e.labelEnd - e.figuresEnd : e.labelStart - e.figuresStart)).toBeLessThanOrEqual(1);
      expect(e.markGap).toBeLessThanOrEqual(8);
      expect(e.menuGap).toBeLessThanOrEqual(8);
    };
    await check();
    await header.hover({ force: true });
    await check();
  });
}

// The whole header is the sort target and the column-drag handle, not only its label.
const headerOf = (page: Page, field = "cost") => page.locator(`.aster-grid-head .aster-grid-header[data-field="${field}"]`);
async function atHeaderStart(page: Page, field = "cost") {
  const box = (await headerOf(page, field).boundingBox())!;
  return { x: box.x + 8, y: box.y + box.height / 2, box };
}

test("clicking the empty start of an end-aligned header sorts it", async ({ page }) => {
  await page.goto("/playground/filtering.html");
  await expect(headerOf(page)).toBeVisible();
  const at = await atHeaderStart(page);
  await page.mouse.click(at.x, at.y);
  await expect(headerOf(page)).toHaveAttribute("aria-sort", "ascending");
  await page.mouse.click(at.x, at.y);
  await expect(headerOf(page)).toHaveAttribute("aria-sort", "descending");
});

test("clicking the empty area around a centred label sorts the column", async ({ page }) => {
  await page.goto("/playground/filtering.html");
  await page.locator("aster-grid").first().evaluate((g: any) => {
    g.presentation = { ...g.presentation, columns: { ...g.presentation?.columns, cost: { ...g.presentation?.columns?.cost, align: "center" } } };
  });
  await expect(headerOf(page)).toHaveAttribute("data-align", "center");
  const at = await atHeaderStart(page);
  await page.mouse.click(at.x, at.y);
  await expect(headerOf(page)).toHaveAttribute("aria-sort", "ascending");
});

test("dragging from the empty start of a header moves the column", async ({ page }) => {
  await page.goto("/playground/filtering.html");
  await expect(headerOf(page)).toBeVisible();
  const order = () => page.locator(".aster-grid-head .aster-grid-header").evaluateAll((hs) => hs.map((h) => (h as HTMLElement).dataset.field));
  const before = await order();
  const first = (await page.locator(".aster-grid-head .aster-grid-header").first().boundingBox())!;
  const at = await atHeaderStart(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 40, at.y, { steps: 4 });
  await page.mouse.move(first.x + 20, at.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(order).not.toEqual(before);
  expect((await order())[0]).toBe("cost");
  await expect(headerOf(page)).not.toHaveAttribute("aria-sort", /.+/);
});

test("the options button opens its menu and does not sort", async ({ page }) => {
  await page.goto("/playground/filtering.html");
  await expect(headerOf(page)).toBeVisible();
  await headerOf(page).hover();
  await headerOf(page).locator(".aster-grid-header-menu").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(headerOf(page)).not.toHaveAttribute("aria-sort", /.+/);
});
