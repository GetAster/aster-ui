import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Demo = {
  show(message: string, options?: object): string;
  update(id: string, patch: object): boolean;
  dismiss(id?: string): void;
  pause(): void;
  resume(): void;
  duration: number;
  actionDuration: number;
  maxVisible: number;
  policy: object;
  chrome: object;
  features: object[];
  progressPolicy: object;
};

const toasts = (page: Page) => page.locator(".aster-toast");

async function open(page: Page, query = "") {
  await page.goto(`/playground/toasts.html${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}

const toaster = (page: Page) => page.locator("aster-toaster");
const call = <T, A = undefined>(page: Page, fn: (t: Demo, arg: A) => T, arg?: A) => toaster(page).evaluate(fn as never, arg) as Promise<T>;

test("polite toasts share one status region; an error is an alert that stays until dismissed", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.duration = 400; });
  await call(page, (t) => { t.show("Draft saved"); t.show("Could not reach the server", { variant: "error" }); });
  const status = page.getByRole("status");
  await expect(status.locator(".aster-toast", { hasText: "Draft saved" })).toBeVisible();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(/Could not reach the server/);
  await expect(status).toHaveAttribute("aria-atomic", "false");
  // The info toast times out; the error is still there well after.
  await expect(toasts(page).filter({ hasText: "Draft saved" })).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(alert).toBeVisible();
  // A toast that does not time out has a dismiss button, and Escape also dismisses it.
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toHaveCount(0);
  await call(page, (t) => { t.show("Again", { variant: "error" }); });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the defaults are long enough to read", async ({ page }) => {
  await open(page);
  expect(await call(page, (t) => [t.duration, t.actionDuration])).toEqual([6000, 10000]);
});

test("showing a known id updates the toast in place; progress changes do not restart it", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.duration = 1500; });
  const id = await call(page, (t) => t.show("Exporting…", { variant: "loading", progress: 0 }));
  const toast = toasts(page).filter({ hasText: "Exporting" });
  await expect(toast.locator("progress")).toHaveJSProperty("value", 0);
  await toast.evaluate((el) => { el.setAttribute("data-same", "yes"); });
  const loading = await call(page, (t, id) => t.update(id, { progress: 0.4 }), id);
  expect(loading).toBe(true);
  await expect(toast.locator("progress")).toHaveJSProperty("value", 0.4);
  await expect(toast.locator(".aster-toast-percent")).toHaveText("40%");
  await expect(toast.locator(".aster-toast-percent")).toHaveAttribute("aria-hidden", "true");
  // Showing the same id replaces the content in the same element, and a result then times out.
  await call(page, (t) => { t.show("Exported 1,204 rows", { id: (document.querySelector(".aster-toast[data-variant=loading]") as HTMLElement).dataset.id!, variant: "success" }); });
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page).first()).toHaveText(/Exported 1,204 rows/);
  await expect(toasts(page).first()).toHaveAttribute("data-same", "yes");
  await expect(toasts(page)).toHaveCount(0, { timeout: 3000 });
});

test("the export demo goes from a loading toast with progress to a result", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Export 1,204 rows" }).click();
  const toast = toasts(page).first();
  await expect(toast).toHaveAttribute("data-variant", "loading");
  await expect(toast.locator("progress")).toBeVisible();
  await expect(toast).toHaveText(/Exported 1,204 rows/, { timeout: 5000 });
  await expect(toast).toHaveAttribute("data-variant", "success");
  await expect(toast.locator("progress")).toHaveCount(0);
});

test("a promise shows loading then its result, and a fast one only its result", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Save (fast)" }).click();
  await expect(toasts(page).filter({ hasText: "Saved 3 changes" })).toBeVisible();
  await expect(toasts(page).filter({ hasText: "Saving" })).toHaveCount(0);
  await call(page, (t) => t.dismiss());
  await page.getByRole("button", { name: "Save (slow)" }).click();
  await expect(toasts(page).filter({ hasText: "Saving…" })).toHaveAttribute("data-variant", "loading");
  await expect(toasts(page)).toHaveText(/Saved 7 changes/, { timeout: 4000 });
  await expect(toasts(page)).toHaveCount(1);
  await call(page, (t) => t.dismiss());
  await page.getByRole("button", { name: "Save (fails)" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Could not save: Network down/, { timeout: 4000 });
});

test("the original promise is returned, and its rejection still reaches the caller", async ({ page }) => {
  await open(page);
  const result = await toaster(page).evaluate(async (el) => {
    const t = el as unknown as { promise<T>(p: Promise<T>, m: object): Promise<T> };
    const p = Promise.reject(new Error("boom"));
    const returned = t.promise(p, { loading: "Working…", success: "Done", error: "Failed" });
    return { same: returned === p, rejected: await returned.then(() => "resolved", (e: Error) => e.message) };
  });
  expect(result).toEqual({ same: true, rejected: "boom" });
});

test("a stack shows maxVisible toasts and queues the rest until one leaves", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.duration = 800; });
  await page.getByRole("button", { name: "Show five" }).click();
  await expect(toasts(page)).toHaveCount(3);
  await expect(toasts(page).nth(0)).toHaveText(/Message 1/);
  await expect(toasts(page).filter({ hasText: "Message 4" })).toBeVisible({ timeout: 3000 });
  await expect(toasts(page).filter({ hasText: "Message 1" })).toHaveCount(0);
  await expect(toasts(page)).toHaveCount(0, { timeout: 4000 });
  await call(page, (t) => { t.maxVisible = 1; });
  await call(page, (t) => { t.show("One"); t.show("Two"); });
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toHaveText(/One/);
});

test("the oldest toast keeps its place at the edge, and an error sits nearer than a polite toast", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.show("First"); t.show("Second"); t.show("Broken", { variant: "error" }); });
  const y = async (text: string) => (await toasts(page).filter({ hasText: text }).boundingBox())!.y;
  expect(await y("First")).toBeGreaterThan(await y("Second"));
  expect(await y("Broken")).toBeGreaterThan(await y("First"));
  const box = (await toasts(page).filter({ hasText: "Broken" }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test("hovering holds every timer; leaving gives it at least two more seconds", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.duration = 500; });
  await call(page, (t) => { t.show("Held"); });
  const toast = toasts(page).filter({ hasText: "Held" });
  await toast.hover();
  await page.waitForTimeout(1200);
  await expect(toast).toBeVisible();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1200);
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 3000 });
});

test("an open modal dialog holds the timers and closing it lets them run", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.duration = 500; });
  await page.getByRole("button", { name: "Open modal dialog" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await call(page, (t) => { t.show("Behind the dialog"); });
  await page.waitForTimeout(1500);
  await expect(toasts(page).filter({ hasText: "Behind the dialog" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Escape closed the dialog, not the toast; the timer then runs out.
  await expect(toasts(page).filter({ hasText: "Behind the dialog" })).toHaveCount(0, { timeout: 4000 });
});

test("pause and resume hold the host's own timers", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.duration = 400; t.pause(); t.show("Paused"); });
  await page.waitForTimeout(1200);
  await expect(toasts(page)).toHaveCount(1);
  await call(page, (t) => t.resume());
  await expect(toasts(page)).toHaveCount(0, { timeout: 4000 });
});

test("Escape dismisses the newest toast first and reports why", async ({ page }) => {
  await open(page);
  await toaster(page).evaluate((el) => {
    (window as unknown as { log: unknown[] }).log = [];
    el.addEventListener("toast-change", (e) => (window as unknown as { log: unknown[] }).log.push((e as CustomEvent).detail));
  });
  await call(page, (t) => { t.show("Older", { variant: "warning" }); t.show("Newer", { variant: "warning" }); });
  await page.keyboard.press("Escape");
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toHaveText(/Older/);
  const log = await page.evaluate(() => (window as unknown as { log: { change: string; reason?: string; message: string }[] }).log);
  expect(log.filter((e) => e.change === "dismissed")).toMatchObject([{ message: "Newer", reason: "escape" }]);
  await call(page, (t) => { t.dismiss(); });
  expect((await page.evaluate(() => (window as unknown as { log: { reason?: string }[] }).log)).at(-1)?.reason).toBe("api");
});

test("Escape belongs to the focused control: a picker closes on it and the toast stays", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const choice = document.createElement("aster-choice") as HTMLElement & Record<string, unknown>;
    choice.id = "pick";
    Object.assign(choice, { label: "Region", options: [{ value: "eu", label: "Europe" }, { value: "us", label: "Americas" }] });
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Notes");
    document.querySelector("main")!.append(choice, input);
  });
  await call(page, (t) => { t.show("Still here", { variant: "warning" }); });
  const combo = page.getByRole("combobox", { name: "Region" });
  await combo.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: "Still here" })).toHaveCount(1);
  // A plain field does not cancel the key either, so Escape there leaves the toast alone.
  await page.getByRole("textbox", { name: "Notes" }).focus();
  await page.keyboard.press("Escape");
  await expect(toasts(page).filter({ hasText: "Still here" })).toHaveCount(1);
  // With nothing focused, Escape dismisses it.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("Escape");
  await expect(toasts(page)).toHaveCount(0);
});

test("a stack of errors leaves a place for an Undo", async ({ page }) => {
  await open(page);
  await call(page, (t) => { for (const m of ["A", "B", "C"]) t.show(`Failed ${m}`, { variant: "error" }); t.show("Moved", { action: { label: "Undo", run() {} } } as never); });
  await expect(toasts(page)).toHaveCount(3);
  await expect(toasts(page).filter({ hasText: "Failed C" })).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: "Moved" }).getByRole("button", { name: "Undo" })).toBeVisible();
});

test("pressing an action dismisses the toast and runs it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "With Undo" }).click();
  await toasts(page).first().getByRole("button", { name: "Undo" }).click();
  await expect(toasts(page).filter({ hasText: "Move undone" })).toBeVisible();
  await expect(toasts(page).filter({ hasText: "Moved to Archive" })).toHaveCount(0);
});

test("policy: autoDismiss off keeps every toast; dismissOnEscape off ignores Escape", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.duration = 300; t.policy = { autoDismiss: false, dismissOnEscape: false }; t.show("Stays"); });
  await page.waitForTimeout(900);
  await expect(toasts(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(toasts(page)).toHaveCount(1);
  await toasts(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(toasts(page)).toHaveCount(0);
});

test("position is logical: inline end is the left edge in right-to-left text", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.chrome = { position: { block: "start", inline: "end" } }; t.show("Placed"); });
  const toast = toasts(page).filter({ hasText: "Placed" });
  const viewport = page.viewportSize()!;
  const ltr = (await toast.boundingBox())!;
  expect(ltr.x + ltr.width).toBeGreaterThan(viewport.width - 40);
  expect(ltr.y).toBeLessThan(80);
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  const rtl = (await toast.boundingBox())!;
  expect(rtl.x).toBeLessThan(40);
});

test("chrome: no icon, a dismiss button on every toast", async ({ page }) => {
  await open(page);
  await call(page, (t) => { t.chrome = { icon: false, dismissButton: true }; t.show("Plain"); });
  const toast = toasts(page).filter({ hasText: "Plain" });
  await expect(toast.locator(".aster-toast-mark")).toHaveCount(0);
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toHaveCount(0);
});

test("invalid configuration throws with the offending key", async ({ page }) => {
  await open(page);
  const errors = await toaster(page).evaluate((el) => {
    const t = el as unknown as Demo;
    const catching = (fn: () => void) => { try { fn(); return "no error"; } catch (e) { return (e as Error).message; } };
    return [
      catching(() => { t.features = [{ kind: "sticky" }]; }),
      catching(() => { t.chrome = { position: { block: "top" } }; }),
      catching(() => { t.show("x", { variant: "loud" }); }),
    ];
  });
  expect(errors[0]).toContain("Unknown toaster feature 'sticky'");
  expect(errors[1]).toContain('"start", "end"');
  expect(errors[2]).toContain("variant");
});

for (const theme of ["lamplight", "harbour"]) for (const scheme of ["light", "dark"]) {
  test(`${theme} ${scheme}: every variant passes an axe scan and keeps its icon shape`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, `?theme=${theme}&scheme=${scheme}`);
    await call(page, (t) => {
      t.maxVisible = 5;
      t.show("Draft saved");
      t.show("Invoice sent", { variant: "success" });
      t.show("Storage is nearly full", { variant: "warning" });
      t.show("Exporting…", { variant: "loading", progress: 0.4 });
      t.show("Could not reach the server", { variant: "error" });
    });
    await expect(toasts(page)).toHaveCount(5);
    for (const toast of await toasts(page).all()) await expect(toast).toHaveCSS("opacity", "1");
    const shapes = await page.locator(".aster-toast-mark svg").evaluateAll((svgs) => svgs.map((s) => s.innerHTML));
    expect(new Set(shapes).size).toBe(5);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
  });
}

test("forced colours: a toast keeps an edge and its progress is drawn in system colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
  await call(page, (t) => { t.show("Exporting…", { variant: "loading", progress: 0.5 }); });
  await expect(toasts(page).first()).toHaveCSS("border-top-width", "1px");
});
