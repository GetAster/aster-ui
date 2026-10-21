// Drag on touch screens: a held row lifts, a quick swipe scrolls, and a
// cancelled or misplaced drop moves nothing. Chromium drives real touches
// over CDP, so scrolling and pointercancel come from the browser. Firefox
// and WebKit offer Playwright only a tap, so there pointer events with
// pointerType "touch" stand in for the finger; they can't scroll the page,
// so the swipe there is the pointercancel a browser sends when it takes a
// gesture for a scroll.
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

test.use({ hasTouch: true });

const HOLD = 400;

interface Finger {
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number, steps?: number): Promise<void>;
  up(): Promise<void>;
  cancel(): Promise<void>;
}

async function finger(page: Page, browserName: string): Promise<Finger> {
  let at = { x: 0, y: 0 };
  const path = async (x: number, y: number, steps: number, step: (x: number, y: number) => Promise<unknown>) => {
    const from = at;
    for (let i = 1; i <= steps; i++) await step(from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps);
    at = { x, y };
  };
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", points: { x: number; y: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    return {
      down: async (x, y) => {
        at = { x, y };
        await send("touchStart", [{ x, y }]);
      },
      move: (x, y, steps = 1) => path(x, y, steps, (px, py) => send("touchMove", [{ x: px, y: py }])),
      up: async () => void (await send("touchEnd", [])),
      cancel: async () => void (await send("touchCancel", [])),
    };
  }
  // A touch's events go to the element it went down on, as a real touch's do.
  const fire = (type: string, x: number, y: number) =>
    page.evaluate(([type, x, y]) => {
      const w = window as unknown as { touchTarget?: Element | null };
      if (type === "pointerdown" || !w.touchTarget?.isConnected) w.touchTarget = document.elementFromPoint(x, y);
      w.touchTarget?.dispatchEvent(new PointerEvent(type, {
        pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
      }));
    }, [type, x, y] as const);
  return {
    down: async (x, y) => {
      at = { x, y };
      await fire("pointerdown", x, y);
    },
    move: (x, y, steps = 1) => path(x, y, steps, (px, py) => fire("pointermove", px, py)),
    up: () => fire("pointerup", at.x, at.y),
    cancel: () => fire("pointercancel", at.x, at.y),
  };
}

const said = (page: Page) => page.locator("body > p.aster-sr-only[aria-live]");
const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.describe("the Tasks tree", () => {
  interface Task { id: number; projectId: number; parentId: number | null; title: string }
  const all = async (page: Page): Promise<Task[]> =>
    page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: { Tasks: Task[] } }> } } }).aster.mock.dump()).data.Tasks);
  const cell = (id: number) => `.aster-grid-row[data-key="[${id}]"] [aria-colindex='2']`;
  const scroll = (page: Page) => page.locator(".aster-grid-scroll");

  async function tasks(page: Page) {
    await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#tasks`);
    await expect(page.locator(".aster-grid-row[data-key]:not([data-placeholder])").first()).toBeVisible();
    const data = await all(page);
    const top = data.filter((t) => t.parentId === null && t.projectId === 1);
    const parent = top.find((t) => data.some((c) => c.parentId === t.id))!;
    const moving = top.find((t) => t.id !== parent.id && !data.some((c) => c.parentId === t.id))!;
    await page.locator(cell(moving.id)).scrollIntoViewIfNeeded();
    return { parent, moving };
  }

  test("a held row lifts and follows the finger; letting go on another row moves it under that one", async ({ page, browserName }) => {
    const { parent, moving } = await tasks(page);
    const f = await finger(page, browserName);
    const from = await centre(page, cell(moving.id));
    await f.down(from.x, from.y);
    // Held still: lifted, drawn so, and said.
    await expect(page.locator(`.aster-grid-row[data-key="[${moving.id}]"]`)).toHaveAttribute("data-lifted", "");
    await expect(page.locator(".aster-grid-drag[data-touch]")).toHaveText(moving.title);
    await expect(said(page)).toHaveText(`Picked up ${moving.title}. Drop it on another row to move it under that row, or on Top level to move it to the top level.`);
    // Over its own row it is only held, not refused.
    await expect(page.locator("[data-drop]")).toHaveCount(0);
    const to = await centre(page, cell(parent.id));
    await f.move(to.x, to.y, 8);
    await expect(page.locator(`.aster-grid-row[data-key="[${parent.id}]"]`)).toHaveAttribute("data-drop", "ok");
    await f.up();
    await expect.poll(async () => (await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(parent.id);
    await expect(page.locator(".aster-toast")).toContainText(`Moved ${moving.title} under ${parent.title}`);
    await expect(page.locator("[data-lifted], .aster-grid-drag, [data-drop]")).toHaveCount(0);
    await expect(page.locator("aster-grid")).not.toHaveAttribute("data-dragging", "");
  });

  test("a quick swipe scrolls and lifts nothing", async ({ page, browserName }) => {
    const { moving } = await tasks(page);
    await scroll(page).evaluate((el) => (el.scrollTop = 0));
    const box = (await scroll(page).boundingBox())!;
    const f = await finger(page, browserName);
    const start = { x: box.x + box.width / 2, y: box.y + box.height * 0.7 };
    await f.down(start.x, start.y);
    await f.move(start.x, start.y - 30);
    await f.move(start.x, start.y - 240, 6);
    // Where the browser can't scroll for a synthetic touch, it takes the gesture with a pointercancel.
    if (browserName === "chromium") await f.up();
    else await f.cancel();
    if (browserName === "chromium") await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await page.waitForTimeout(HOLD * 2);
    await expect(page.locator("[data-lifted], .aster-grid-drag, [data-drop]")).toHaveCount(0);
    expect((await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(null);
  });

  test("an interrupted touch, or letting go away from any row, moves nothing and says so", async ({ page, browserName }) => {
    const { parent, moving } = await tasks(page);
    const f = await finger(page, browserName);
    const from = await centre(page, cell(moving.id));
    const to = await centre(page, cell(parent.id));
    await f.down(from.x, from.y);
    await expect(page.locator(".aster-grid-drag[data-touch]")).toBeVisible();
    await f.move(to.x, to.y, 6);
    await expect(page.locator(`.aster-grid-row[data-key="[${parent.id}]"]`)).toHaveAttribute("data-drop", "ok");
    await f.cancel();
    await expect(said(page)).toHaveText(`${moving.title} not moved.`);
    await expect(page.locator("[data-lifted], .aster-grid-drag, [data-drop]")).toHaveCount(0);
    // Let go over the toolbar, which isn't a drop target.
    await f.down(from.x, from.y);
    await expect(page.locator(".aster-grid-drag[data-touch]")).toBeVisible();
    const away = await centre(page, ".aster-grid-total");
    await f.move(away.x, away.y, 6);
    await f.up();
    await expect(said(page)).toHaveText(`${moving.title} not moved.`);
    await page.waitForTimeout(300);
    expect((await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(null);
  });

  test("held near the bottom edge, a lifted row scrolls the grid under it", async ({ page, browserName }) => {
    const { moving } = await tasks(page);
    await scroll(page).evaluate((el) => (el.scrollTop = 0));
    await page.locator(cell(moving.id)).scrollIntoViewIfNeeded();
    const before = await scroll(page).evaluate((el) => el.scrollTop);
    const box = (await scroll(page).boundingBox())!;
    const f = await finger(page, browserName);
    const from = await centre(page, cell(moving.id));
    await f.down(from.x, from.y);
    await expect(page.locator(".aster-grid-drag[data-touch]")).toBeVisible();
    await f.move(from.x, box.y + box.height - 6, 6);
    await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 150);
    // The drop target follows the content moving under the finger.
    await expect(page.locator(".aster-grid-row[data-drop]")).toHaveCount(1);
    await f.cancel();
    await expect(page.locator("[data-drop]")).toHaveCount(0);
  });

  test("a mouse drag auto-scrolls at the edge and cancels without moving", async ({ page }) => {
    const { moving } = await tasks(page);
    await page.locator(cell(moving.id)).scrollIntoViewIfNeeded();
    const from = await centre(page, cell(moving.id));
    const before = await scroll(page).evaluate((el) => el.scrollTop);
    const box = (await scroll(page).boundingBox())!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y);
    await expect(page.locator(".aster-grid-drag")).toBeVisible();
    await page.mouse.move(from.x, box.y + box.height - 6, { steps: 6 });
    await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 150);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".aster-grid-drag, [data-drop]")).toHaveCount(0);
    expect((await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(null);
  });

  test("a held card can move to the top level using its visible drop target", async ({ page, browserName }) => {
    const { parent, moving } = await tasks(page);
    const f = await finger(page, browserName);
    let from = await centre(page, cell(moving.id));
    await f.down(from.x, from.y);
    await expect(page.locator(".aster-grid-drag[data-touch]")).toBeVisible();
    const to = await centre(page, cell(parent.id));
    await f.move(to.x, to.y, 6);
    await f.up();
    await expect.poll(async () => (await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(parent.id);
    // Card layout depends on the grid's width, independently of the page's phone navigator.
    await page.locator("aster-grid").evaluate((el) => { (el as HTMLElement).style.width = "500px"; });
    await page.locator(cell(moving.id)).scrollIntoViewIfNeeded();
    from = await centre(page, cell(moving.id));
    await f.down(from.x, from.y);
    const root = page.locator(".aster-grid-root-drop");
    await expect(root).toBeVisible();
    const drop = await centre(page, ".aster-grid-root-drop");
    await f.move(drop.x, drop.y, 6);
    await expect(root).toHaveAttribute("data-drop", "ok");
    await f.up();
    await expect.poll(async () => (await all(page)).find((t) => t.id === moving.id)!.parentId).toBe(null);
    await expect(root).toBeHidden();
  });

  test("a tapped row shows its controls, and only that row", async ({ page }) => {
    const { parent, moving } = await tasks(page);
    const controls = (id: number) => page.locator(`.aster-grid-row[data-key="[${id}]"] > .aster-grid-controls`);
    await expect(controls(moving.id)).toHaveCSS("opacity", "0");
    await page.locator(cell(moving.id)).tap();
    await expect(page.locator(`.aster-grid-row[data-key="[${moving.id}]"]`)).toHaveAttribute("aria-selected", "true");
    await expect(controls(moving.id)).toHaveCSS("opacity", "1");
    await page.locator(cell(parent.id)).tap();
    await expect(controls(parent.id)).toHaveCSS("opacity", "1");
    await expect(controls(moving.id)).toHaveCSS("opacity", "0");
    await controls(parent.id).getByRole("button", { name: "Move to…" }).tap();
    await expect(page.getByRole("dialog")).toContainText(`Move ${parent.title}`);
  });
});

test.describe("the answers list", () => {
  const CLIENT_TYPE = 4;
  const list = (page: Page) => page.locator(`.model-grid .aster-grid-row[data-key="[${CLIENT_TYPE}]"] aster-list-editor`);
  const keys = (page: Page) => list(page).locator(".aster-list-edit-row[data-id] .aster-list-edit-static").allTextContents();
  const handle = (page: Page, name: string) => list(page).getByRole("button", { name: `Move ${name}`, exact: true });
  const ORDER = ["individual", "company", "trust", "partnership", "charity"];

  async function answers(page: Page) {
    await page.addInitScript(() => indexedDB.deleteDatabase("aster-drafts"));
    await page.goto(`/?memory&debug&clients=0&time=0&now=${NOW}#model/${CLIENT_TYPE}/answers`);
    await expect.poll(() => keys(page)).toEqual(ORDER);
    await centred(page);
  }
  // In the middle of the viewport, clear of the debug button at its bottom corner.
  const centred = (page: Page) => handle(page, "trust").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const middle = async (page: Page, name: string) => {
    const box = (await handle(page, name).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, bottom: box.y + box.height };
  };

  test("a held handle lifts its row; moving it and letting go reorders, said in words", async ({ page, browserName }) => {
    await answers(page);
    const f = await finger(page, browserName);
    const from = await middle(page, "individual");
    await f.down(from.x, from.y);
    await expect(list(page).locator(".aster-list-edit-row[data-lifted]")).toContainText("individual");
    await expect(list(page).locator("[aria-live]")).toHaveText("Picked up individual, 1 of 5");
    await expect(list(page).locator(".aster-list-edit-drop")).toBeVisible();
    const to = await middle(page, "trust");
    await f.move(to.x, to.bottom + 4, 8);
    await f.up();
    await expect.poll(() => keys(page)).toEqual(["company", "trust", "individual", "partnership", "charity"]);
    await expect(list(page).locator("[aria-live]")).toHaveText("individual, moved to 3 of 5");
    await expect(list(page).locator("[data-lifted], [data-dragging], .aster-list-edit-drop")).toHaveCount(0);
  });

  test("a swipe from a handle scrolls; a cancelled or outside drop leaves the order", async ({ page, browserName }) => {
    await answers(page);
    const scroller = page.locator(".model-grid .aster-grid-scroll");
    const f = await finger(page, browserName);
    const from = await middle(page, "partnership");
    const top = await scroller.evaluate((el) => el.scrollTop);
    await f.down(from.x, from.y);
    await f.move(from.x, from.y - 30);
    await f.move(from.x, from.y - 200, 6);
    if (browserName === "chromium") await f.up();
    else await f.cancel();
    if (browserName === "chromium") await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(top + 50);
    await page.waitForTimeout(HOLD * 2);
    await expect(list(page).locator("[data-lifted], [data-dragging]")).toHaveCount(0);
    // The swipe's fling ends before the next touch, which would otherwise only stop it.
    await expect.poll(async () => {
      const at = await scroller.evaluate((el) => el.scrollTop);
      await page.waitForTimeout(150);
      return (await scroller.evaluate((el) => el.scrollTop)) === at;
    }).toBe(true);
    await centred(page);
    // Interrupted while over another place.
    const a = await middle(page, "individual");
    const b = await middle(page, "trust");
    await f.down(a.x, a.y);
    await expect(list(page).locator(".aster-list-edit-row[data-lifted]")).toHaveCount(1);
    await f.move(b.x, b.bottom + 4, 6);
    await f.cancel();
    await expect(list(page).locator("[aria-live]")).toHaveText("individual not moved");
    // Let go beside the list, not in it.
    await f.down(a.x, a.y);
    await expect(list(page).locator(".aster-list-edit-row[data-lifted]")).toHaveCount(1);
    const box = (await list(page).locator(".aster-list-edit").boundingBox())!;
    await f.move(box.x + box.width + 40, b.bottom + 4, 6);
    await expect(list(page).locator(".aster-list-edit-drop")).toHaveCount(0);
    await f.up();
    await expect(list(page).locator("[aria-live]")).toHaveText("individual not moved");
    expect(await keys(page)).toEqual(ORDER);
  });
});
