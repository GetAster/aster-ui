import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 393, height: 851 }, hasTouch: true });

test("mail folders remain on one horizontal row on narrow phones", async ({ page }, info) => {
  await page.goto("/playground/mail.html");
  const folders = page.getByRole("navigation", { name: "Mail folders", exact: true });
  const items = folders.locator(".aster-sidebar-item");
  await expect(items).toHaveCount(3);
  for (const width of [393, 360, 320]) {
    await page.setViewportSize({ width, height: 851 });
    const tops = await items.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    // Allow fractional CSS-pixel intersection rounding.
    for (const item of await items.all()) await expect(item).toBeInViewport({ ratio: 0.999 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await folders.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("mail-folder-strip.png") });
  await items.nth(2).tap();
  await expect(items.nth(2)).toHaveAttribute("aria-current", "page");
});

test("touch scroll reaches the gallery footer and mobile examples have a return route", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "Uses CDP touch gestures");
  await page.goto("/?memory#showcase");
  await expect(page.locator(".showcase-open")).toHaveCount(10);
  const main = page.locator('main[data-page="showcase"]');
  await expect(main).toBeVisible();
  // Commit the first painted frame before sending a compositor touch gesture.
  await page.screenshot({ path: info.outputPath("gallery-top.png") });
  const bounds = (await main.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, yDistance: -700, speed: 900, gestureSourceType: "touch", preventFling: true });
  await expect.poll(() => page.locator('main[data-page="showcase"]').evaluate(element => element.scrollTop)).toBeGreaterThan(200);
  await page.locator('main[data-page="showcase"]').press("Control+End");
  const backHome = page.getByRole("link", { name: "Back to Home", exact: true });
  await backHome.scrollIntoViewIfNeeded();
  await expect(backHome).toBeInViewport();
  await page.screenshot({ path: info.outputPath("gallery-bottom.png") });
  await page.reload();
  const categories = page.getByRole("navigation", { name: "Showcase categories" });
  await categories.getByRole("link", { name: "Authentication recovery", exact: true }).tap();
  await expect(page).toHaveURL(/playground\/mail.html/);
  await expect(page.getByRole("tab", { name: "Reading pane", exact: true })).toBeAttached();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const back = page.getByRole("link", { name: "← Component showcase", exact: true });
  await expect(back).toBeInViewport();
  await page.screenshot({ path: info.outputPath("mail-mobile.png") });
  await page.goBack();
  await expect(categories).toBeVisible();
  await categories.getByRole("link", { name: "Fields & layouts", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Fields and layouts", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "← Component showcase", exact: true }).tap();
  await expect(categories).toBeVisible();
  await page.goto("/?memory#showcase/windows");
  await expect(page).toHaveURL(/playground\/windows.html/);
  await expect(page.getByRole("button", { name: "Open device", exact: true })).toBeVisible();
});

test("mobile windows expose content, close and retained notes without leaving the viewport", async ({ page }, info) => {
  await page.goto("/playground/windows.html");
  await page.getByRole("button", { name: "Open notes", exact: true }).tap();
  const notes = page.getByRole("dialog", { name: "Notes", exact: true });
  await expect(notes.getByRole("button", { name: "Close Notes", exact: true })).toBeInViewport();
  await expect(notes.getByRole("button", { name: "Save notes", exact: true })).toBeInViewport();
  await notes.getByRole("textbox", { name: "Workspace notes", exact: true }).fill("Retained mobile draft");
  await notes.getByRole("button", { name: "Minimize Notes", exact: true }).tap();
  await page.getByRole("button", { name: "Open device", exact: true }).tap();
  const device = page.getByRole("dialog", { name: "Device details", exact: true });
  await expect(device.getByText("Engineering workstation", { exact: true })).toBeInViewport();
  await device.getByRole("button", { name: "Close Device details", exact: true }).tap();
  await page.getByRole("button", { name: "Notes — minimized", exact: true }).tap();
  await expect(notes.getByRole("textbox", { name: "Workspace notes", exact: true })).toHaveValue("Retained mobile draft");
  await page.screenshot({ path: info.outputPath("notes-mobile.png") });
  const bounds = await notes.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.setViewportSize({ width: 851, height: 393 });
  await expect(notes.getByRole("button", { name: "Close Notes", exact: true })).toBeInViewport();
  await expect(notes.getByRole("button", { name: "Save notes", exact: true })).toBeInViewport();
});

test("example canvases remain continuous at the top and bottom in both schemes", async ({ page }) => {
  for (const scheme of ["light", "dark"]) {
    for (const file of ["tiles", "foundations", "mail", "windows"]) {
      await page.goto(`/playground/${file}.html?scheme=${scheme}`);
      await expect(page.locator(".showcase-nav")).toBeVisible();
      await expect.poll(() => page.locator("html").getAttribute("data-scheme")).toBe(scheme);
      const canvas = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, width: document.documentElement.scrollWidth }));
      expect(canvas.html).toBe(canvas.body);
      expect(canvas.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  }
});
