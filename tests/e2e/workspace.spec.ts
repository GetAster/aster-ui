import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/playground/windows.html");
  await page.getByRole("button", { name: "Open notes", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "Notes", exact: true });
  await expect(notes).toBeFocused();
  return notes;
}

test("minimize, restore, maximize and close keep the same content node", async ({ page }) => {
  const notes = await open(page);
  const input = notes.getByRole("textbox", { name: "Workspace notes" });
  await input.fill("A note worth keeping");
  await input.evaluate(el => { el.dataset.original = "yes"; });
  await notes.getByRole("button", { name: "Minimize Notes", exact: true }).click();
  await expect(notes).not.toBeVisible();
  const task = page.getByRole("button", { name: "Notes — minimized", exact: true });
  await expect(task).toBeVisible(); await task.click();
  await expect(input).toHaveValue("A note worth keeping");
  await expect(input).toHaveAttribute("data-original", "yes");
  await notes.getByRole("button", { name: "Maximize Notes", exact: true }).click();
  await expect(notes).toHaveAttribute("data-state", "maximized");
  await expect.poll(async () => Math.round((await notes.boundingBox())!.width)).toBe(page.viewportSize()!.width - 16);
  await notes.getByRole("button", { name: "Restore Notes", exact: true }).click();
  await expect(notes).toHaveAttribute("data-state", "normal");
  await expect.poll(async () => Math.round((await notes.boundingBox())!.width)).toBe(390);
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  await notes.getByRole("button", { name: "Close Notes", exact: true }).click();
  await expect(notes).not.toBeVisible();
  await page.getByRole("button", { name: "Open notes", exact: true }).click();
  await expect(input).toHaveValue("A note worth keeping");
  await expect(input).toHaveAttribute("data-original", "yes");
});

test("close guards support cancel, modal Escape and discard without leaking Escape to the window", async ({ page }) => {
  const notes = await open(page);
  const input = notes.getByRole("textbox", { name: "Workspace notes" });
  await input.fill("Unsaved draft"); await input.press("Escape");
  const confirm = page.getByRole("dialog", { name: "Close unsaved notes?", exact: true });
  await expect(confirm).toBeVisible();
  await expect(notes).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(confirm).not.toBeVisible(); await expect(input).toHaveValue("Unsaved draft");
  await expect(input).toBeFocused();
  await input.press("Escape"); await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape"); await expect(confirm).not.toBeVisible();
  await expect(notes).toBeVisible(); await expect(notes).toHaveAttribute("aria-busy", "false");
  await input.press("Escape"); await expect(confirm).toBeVisible();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(notes).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Open notes", exact: true })).toBeFocused();
});

test("activation raises windows, F6 cycles, minimizing activates another and nested pickers keep focus", async ({ page }) => {
  const first = await open(page);
  await first.getByRole("textbox", { name: "Workspace notes" }).fill("Return to this field");
  await page.getByRole("button", { name: "Open device", exact: true }).click();
  const device = page.getByRole("dialog", { name: "Device details", exact: true });
  const notes = page.getByRole("dialog", { name: "Notes", exact: true });
  await expect(device).toHaveAttribute("data-active", "true");
  await page.keyboard.press("F6"); await expect(notes).toHaveAttribute("data-active", "true");
  await expect(device).toHaveAttribute("data-active", "false");
  await expect(notes.getByRole("textbox", { name: "Workspace notes" })).toBeFocused();
  await page.keyboard.press("Shift+F6"); await expect(device).toHaveAttribute("data-active", "true");
  const choice = device.getByRole("combobox", { name: "Device action", exact: true });
  await choice.click();
  await expect(page.getByRole("listbox", { name: "Device action", exact: true })).toBeVisible();
  await choice.press("Escape");
  await expect(device).toBeVisible(); await expect(choice).toBeFocused();
  await device.getByRole("button", { name: "Minimize Device details", exact: true }).click();
  await expect(notes).toHaveAttribute("data-active", "true");
});

test("keyboard resizing and moving stay recoverable after a viewport shrink", async ({ page }) => {
  const notes = await open(page);
  const initial = (await notes.boundingBox())!;
  const resize = notes.getByRole("button", { name: "Resize Notes", exact: true });
  await resize.focus(); await resize.press("ArrowRight"); await resize.press("Shift+ArrowDown");
  await expect.poll(async () => {
    const b = (await notes.boundingBox())!; return [Math.round(b.width - initial.width), Math.round(b.height - initial.height)];
  }).toEqual([16, 64]);
  const move = notes.getByRole("button", { name: "Move Notes", exact: true });
  await move.focus(); for (let i = 0; i < 12; i++) await move.press("Shift+ArrowRight");
  await page.setViewportSize({ width: 320, height: 500 });
  await expect.poll(async () => {
    const b = (await notes.boundingBox())!;
    return b.x >= 7.5 && b.y >= 7.5 && b.x + b.width <= 312.5 && b.y + b.height <= 492.5;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(notes.getByRole("button", { name: "Close Notes", exact: true })).toBeInViewport();
});

test("saved placement survives refresh, restores maximized/minimized states and ignores unknown types", async ({ page }) => {
  const notes = await open(page);
  await notes.getByRole("button", { name: "Maximize Notes", exact: true }).click();
  await notes.getByRole("button", { name: "Minimize Notes", exact: true }).click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Restore layout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Notes — minimized", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notes — minimized", exact: true }).click();
  await expect(notes).toHaveAttribute("data-state", "maximized");
  await notes.getByRole("button", { name: "Restore Notes", exact: true }).click();
  await expect.poll(async () => {
    const b = (await notes.boundingBox())!;
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width)];
  }).toEqual([490, 460, 390]);
  await page.evaluate(() => localStorage.setItem("aster-showcase-workspace-v1", JSON.stringify({ version: 1, windows: [{ id: "not-registered", open: true, placement: { state: "normal" } }], active: "not-registered" })));
  await page.getByRole("button", { name: "Restore layout", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved layout restored" })).toBeVisible();
  await expect(page.locator("aster-window")).toHaveCount(2);
});

test("rejected close guards recover and concurrent requests run only one guard", async ({ page }) => {
  const notes = await open(page);
  const result = await page.locator("#notes").evaluate(async el => {
    const win = el as unknown as { beforeClose: () => Promise<boolean>; close(): Promise<boolean>; open: boolean };
    let calls = 0;
    win.beforeClose = async () => { calls++; throw new Error("Save failed"); };
    const results = await Promise.all([win.close(), win.close()]);
    return { results, calls, open: win.open };
  });
  expect(result).toEqual({ results: [false, false], calls: 1, open: true });
  await expect(notes).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#workspace-status")).toContainText("Could not close");
});

test("a late close decision after reconnect cannot close the new lifecycle", async ({ page }) => {
  await open(page);
  const result = await page.locator("#notes").evaluate(async el => {
    const win = el as unknown as HTMLElement & { beforeClose: () => Promise<boolean>; close(): Promise<boolean>; show(): void; open: boolean };
    let settle!: (value: boolean) => void;
    win.beforeClose = () => new Promise(resolve => { settle = resolve; });
    const closing = win.close();
    await Promise.resolve();
    const parent = win.parentNode!;
    win.remove(); parent.appendChild(win); win.show();
    settle(true);
    return { closed: await closing, open: win.open };
  });
  expect(result).toEqual({ closed: false, open: true });
});

test("saved layout validation is atomic and does not close an existing dirty window", async ({ page }) => {
  const notes = await open(page);
  await notes.getByRole("textbox", { name: "Workspace notes" }).fill("Keep this draft");
  await page.evaluate(() => localStorage.setItem("aster-showcase-workspace-v1", JSON.stringify({ version: 1, windows: [
    { id: "notes", open: true, placement: { state: "maximized" } },
    { id: "device", open: true, placement: { state: "normal", bounds: { x: 0, y: 0, width: -2, height: 100 } } },
  ], active: "notes" })));
  await page.getByRole("button", { name: "Restore layout", exact: true }).click();
  await expect(page.locator("#workspace-status")).toHaveText("The saved layout could not be restored.");
  await expect(notes).toHaveAttribute("data-state", "normal");
  await page.evaluate(() => localStorage.setItem("aster-showcase-workspace-v1", JSON.stringify({ version: 1, windows: [
    { id: "notes", open: false, placement: { state: "normal" } },
  ], active: null })));
  await page.getByRole("button", { name: "Restore layout", exact: true }).click();
  await expect(notes).toBeVisible();
  await expect(notes.getByRole("textbox", { name: "Workspace notes" })).toHaveValue("Keep this draft");
});

for (const theme of ["lamplight", "harbour"]) {
  for (const scheme of ["light", "dark"]) {
    test(`accessible window chrome and confirmation: ${theme} ${scheme}, reduced motion`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/playground/windows.html?theme=${theme}&scheme=${scheme}`);
      await page.getByRole("button", { name: "Open notes", exact: true }).click();
      await page.getByRole("textbox", { name: "Workspace notes" }).fill("Accessible draft");
      const check = async () => {
        const result = await new AxeBuilder({ page }).analyze();
        expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
      };
      await check();
      await page.getByRole("textbox", { name: "Workspace notes" }).press("Escape");
      await expect(page.getByRole("dialog", { name: "Close unsaved notes?", exact: true })).toBeVisible();
      await check();
    });
  }
}

test.describe("touch windows", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("title actions have touch targets and restored windows fit narrow viewports", async ({ page }) => {
    await page.goto("/playground/windows.html");
    await page.getByRole("button", { name: "Open notes", exact: true }).tap();
    const notes = page.getByRole("dialog", { name: "Notes", exact: true });
    const close = notes.getByRole("button", { name: "Close Notes", exact: true });
    expect((await close.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await notes.getByRole("button", { name: "Maximize Notes", exact: true }).tap();
    await expect(notes).toHaveAttribute("data-state", "maximized");
    await notes.getByRole("button", { name: "Minimize Notes", exact: true }).tap();
    await page.getByRole("button", { name: "Notes — minimized", exact: true }).tap();
    await expect(close).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
