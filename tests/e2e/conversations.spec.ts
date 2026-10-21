import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function ready(page: Page) {
  await page.goto("/playground/conversations.html");
  await expect(page.locator(".ac-main .ac-entry")).toHaveCount(24);
  await page.locator("#auto-history").uncheck();
}
async function selectPassage(page: Page, selector: string, count = 25) {
  return page.locator(selector).evaluate((element, count) => {
    const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE)!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, count);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event("selectionchange"));
    return range.toString();
  }, count);
}

async function anchor(page: Page, id = "chat-150") {
  await page.evaluate(id => {
    const scroller = document.querySelector<HTMLElement>(".ac-main .ac-scroll")!;
    const article = [...scroller.querySelectorAll<HTMLElement>("[data-entry]")].find(el => el.dataset["entry"] === id)!;
    scroller.scrollTop += article.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
    scroller.dispatchEvent(new Event("scroll"));
  }, id);
  await page.waitForTimeout(100);
  return page.evaluate(id => {
    const scroller = document.querySelector<HTMLElement>(".ac-main .ac-scroll")!;
    const article = [...scroller.querySelectorAll<HTMLElement>("[data-entry]")].find(el => el.dataset["entry"] === id)!;
    return article.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }, id);
}
async function displacement(page: Page, id: string, offset: number) {
  return page.evaluate(({ id, offset }) => {
    const scroller = document.querySelector<HTMLElement>(".ac-main .ac-scroll")!;
    const article = [...scroller.querySelectorAll<HTMLElement>("[data-entry]")].find(el => el.dataset["entry"] === id)!;
    return Math.abs(article.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset);
  }, { id, offset });
}

test("history prepends and fresh activity retain the visible message and DOM", async ({ page }) => {
  await ready(page);
  const offset = await anchor(page);
  const retained = await page.locator('[data-entry="chat-150"]').elementHandle();
  await page.locator(".ac-main .ac-edge button").first().evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator(".ac-main .ac-entry")).toHaveCount(44);
  await expect.poll(() => displacement(page, "chat-150", offset)).toBeLessThan(2);
  expect(await retained!.evaluate(node => node === document.querySelector('[data-entry="chat-150"]'))).toBe(true);
  await page.getByRole("button", { name: "＋ Incoming message" }).click();
  await expect(page.locator(".ac-main .ac-feedback")).toContainText("1 new message");
  await expect.poll(() => displacement(page, "chat-150", offset)).toBeLessThan(2);
  await page.locator(".ac-main .ac-feedback button").last().click();
  await expect(page.locator(".ac-main .ac-tools")).toContainText("Following latest");
});

test("history errors keep confirmed content and retry the failed edge", async ({ page }) => {
  await ready(page); await page.getByRole("button", { name: "Fail next history request" }).click();
  await page.locator(".ac-main .ac-edge button").first().evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: "Retry history" })).toBeVisible();
  await expect(page.locator(".ac-main .ac-entry")).toHaveCount(24);
  await page.getByRole("button", { name: "Retry history" }).click();
  await expect(page.locator(".ac-main .ac-entry")).toHaveCount(44);
});

test("discussion return retains main and context drafts, focus and reading position", async ({ page }) => {
  await ready(page); await page.locator(".ac-main textarea").fill("Main draft");
  const offset = await anchor(page, "chat-147");
  await page.locator('[data-entry="chat-147"]').getByRole("button", { name: "Read discussion →" }).click();
  await expect(page.locator(".ac-context-pane:not([hidden]) .ac-entry")).toHaveCount(6);
  await page.locator(".ac-context-pane:not([hidden]) textarea").fill("Discussion draft");
  await page.getByRole("button", { name: "← Return to reading position" }).click();
  await expect(page.locator(".ac-main textarea")).toHaveValue("Main draft");
  await expect.poll(() => displacement(page, "chat-147", offset)).toBeLessThan(2);
  await expect(page.locator('[data-entry="chat-147"]').getByRole("button", { name: "Read discussion →" })).toBeFocused();
  await page.locator('[data-entry="chat-147"]').getByRole("button", { name: "Read discussion →" }).click();
  await expect(page.locator(".ac-context-pane:not([hidden]) textarea")).toHaveValue("Discussion draft");
});

test("resizing content above the reading anchor preserves its position", async ({ page }) => {
  await ready(page); await page.locator("#configuration").selectOption("email");
  await expect(page.locator(".ac-main .ac-entry")).toHaveCount(24);
  const offset = await anchor(page, "email-150");
  await page.locator('[data-entry="email-149"] details').evaluate((details: HTMLDetailsElement) => { details.open = true; });
  await expect.poll(() => displacement(page, "email-150", offset)).toBeLessThan(2);
  await page.locator('[data-entry="email-149"] .demo-resize').evaluate((element: HTMLElement) => { element.style.height = "320px"; });
  await expect.poll(() => displacement(page, "email-150", offset)).toBeLessThan(2);
});

test("bounded windows protect focused messages and preserve both loading directions", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const session = (window as any).conversationDemo.sessions.get("chat");
    for (let i = 0; i < 5; i++) await session.loadOlder();
    const before = session.entries.value.length;
    const gap = session.hasNewer.value;
    await session.loadNewer();
    return { before, after: session.entries.value.length, gap, dom: document.querySelectorAll(".ac-main .ac-entry").length };
  });
  expect(result.before).toBe(80); expect(result.after).toBe(80); expect(result.gap).toBe(true);
  await expect(page.locator(".ac-main .ac-entry")).toHaveCount(80);
});

test("selected passage creates attributed context without changing the source", async ({ page }) => {
  await ready(page); const source = page.locator('[data-entry="chat-159"] [data-passage-body]');
  const original = await source.textContent();
  await source.evaluate(element => {
    const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE)!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 25);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event("selectionchange"));
  });
  await page.getByRole("button", { name: "Selection actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Discuss passage…" }).click();
  await expect(page.locator("#passage-quote")).toHaveValue(original!.slice(0, 25));
  await page.locator("#passage-title").fill("Keep context visible");
  await page.getByRole("button", { name: "Create discussion ↗" }).click();
  await expect(page.locator(".ac-context-pane:not([hidden]) .ac-body")).toHaveText(original!.slice(0, 25));
  await page.getByRole("button", { name: "← Return to reading position" }).click();
  await expect(source).toHaveText(original!);
  await expect(page.locator('[data-entry="chat-159"]').getByRole("button", { name: "Keep context visible →" })).toBeVisible();
  await page.locator("#passages").uncheck();
  await expect(page.getByRole("button", { name: "Selection actions" })).toHaveCount(0);
});

test("mobile discussion navigation, short dialogs and internal audiences", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await ready(page);
  await page.locator("#configuration").selectOption("ticket");
  await expect(page.locator('[data-entry="ticket-144"]')).toHaveCount(1);
  await page.locator('[data-entry="ticket-144"]').scrollIntoViewIfNeeded();
  await selectPassage(page, '[data-entry="ticket-144"] [data-passage-body]');
  await page.getByRole("button", { name: "Selection actions" }).click();
  await page.getByRole("menuitem", { name: "Discuss passage…" }).click();
  await expect(page.locator("#passage-audience")).toContainText("support team only");
  await page.locator("#passage-title").fill("Internal investigation");
  await page.setViewportSize({ width: 390, height: 480 });
  await page.getByRole("button", { name: "Create discussion ↗" }).click();
  await expect(page.locator(".ac-main")).not.toBeVisible();
  await expect(page.locator(".ac-context-pane:not([hidden])")).toContainText("Internal · Internal investigation");
  await page.getByRole("button", { name: "← Return to reading position" }).click();
  await expect(page.locator(".ac-main")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("disconnect releases owned context sessions while the root remains usable", async ({ page }) => {
  await ready(page);
  await page.locator('[data-entry="chat-154"]').getByRole("button", { name: "Read discussion →" }).click();
  await expect(page.locator(".ac-context-pane:not([hidden]) .ac-entry")).toHaveCount(6);
  const result = await page.evaluate(() => {
    const reader = (window as any).conversationDemo.reader;
    const root = reader.session, child = reader.querySelector(".ac-context-pane").session;
    reader.remove();
    return { rootDisposed: root.lifetime.disposed, childDisposed: child.lifetime.disposed, rootCount: root.entries.value.length };
  });
  expect(result).toEqual({ rootDisposed: false, childDisposed: true, rootCount: 24 });
});

test("deleted reading anchors fall back locally with an explanation", async ({ page }) => {
  await ready(page); await anchor(page, "chat-150");
  await page.locator('[data-entry="chat-150"]').focus();
  await page.evaluate(() => (window as any).conversationDemo.sessions.get("chat").remove("chat-150"));
  await expect(page.locator('[data-entry="chat-150"]')).toHaveCount(0);
  await expect(page.locator(".ac-main .ac-sr")).toContainText("previous message is unavailable");
  await expect(page.locator('[data-entry="chat-151"]')).toBeFocused();
});

test("preview is opt-in and exposes the existing composition contract", async ({ page }) => {
  const requests: string[] = []; page.on("request", request => requests.push(request.url()));
  await page.goto("/playground/first-grid.html");
  await expect(page.locator("aster-grid")).toBeVisible();
  expect(requests.some(url => url.includes("aster-ui-preview"))).toBe(false);
  const result = await page.evaluate(async () => {
    const stable = await import("/lib/aster-ui.js" as string), preview = await import("/lib/aster-ui-preview.js" as string);
    const component = stable.compositeElement(preview.ConversationReader);
    return { props: Object.keys(component.props).sort(), stableContainsPreview: "ConversationReader" in stable };
  });
  expect(result).toEqual({ props: ["autoLoadHistory", "contextProvider", "entryRenderer", "focusModeEnabled", "passageProvider", "readerActions", "session"], stableContainsPreview: false });
});

test("keyboard passage review and reduced-motion reader have accessible names and focus containment", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const action = page.locator('[data-entry="chat-159"]');
  await action.focus();
  await selectPassage(page, '[data-entry="chat-159"] [data-passage-body]');
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Discuss passage…" }).click();
  await expect(page.getByRole("dialog", { name: "Discuss this passage" })).toBeVisible();
  await expect(page.locator("#passage-title")).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape"); await expect(page.locator("#passage-dialog")).not.toBeVisible();
  await expect(action).toBeFocused();
});

test("selected text context menu offers Copy and Discuss while unselected text keeps native context behaviour", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  const text = await selectPassage(page, '[data-entry="chat-159"] [data-passage-body]');
  const box = await page.evaluate(() => { const rect = getSelection()!.getRangeAt(0).getBoundingClientRect(); return { x: rect.left + 10, y: rect.top + 6 }; });
  await page.mouse.click(box.x, box.y, { button: "right" });
  await expect(page.getByRole("menu", { name: "Selected text" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Discuss passage…" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
  if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  const preserved = await page.evaluate(() => {
    getSelection()!.removeAllRanges();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.querySelector('.ac-main [data-entry="chat-159"]')!.dispatchEvent(event);
    return !event.defaultPrevented;
  });
  expect(preserved).toBe(true);
  await expect(page.getByRole("button", { name: "Choose passage from message…" })).toHaveCount(0);
});

test("focused reader shares a thread, provides custom commands, and restores inline state on Escape", async ({ page }) => {
  await ready(page); const offset = await anchor(page, "chat-150");
  await page.locator(".ac-main textarea").fill("Inline draft survives focused reading");
  const retained = await page.locator('[data-entry="chat-150"]').elementHandle();
  const launch = page.locator(".ac-main").getByRole("button", { name: "Read # product-design in focused reader" });
  await launch.click();
  const dialog = page.getByRole("dialog", { name: "# product-design", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ac-entry")).toHaveCount(24);
  await expect(dialog.locator("textarea")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Copy loaded messages" })).toBeVisible();
  await selectPassage(page, '.ac-reader-pane [data-entry="chat-159"] [data-passage-body]');
  const selectedOffset = await dialog.locator('[data-entry="chat-159"]').evaluate(element => element.getBoundingClientRect().top);
  await page.evaluate(() => {
    const demo = (window as any).conversationDemo;
    const entry = { id: "focused-arrival", cursor: "9999", order: "009999", author: "Maya", time: "Now", text: "New activity while copying" };
    demo.database.get("chat").push(entry); demo.reader.receive("chat", entry);
  });
  await expect(dialog.locator(".ac-tools")).toContainText("Reading history");
  await expect.poll(async () => Math.abs(await dialog.locator('[data-entry="chat-159"]').evaluate(element => element.getBoundingClientRect().top) - selectedOffset)).toBeLessThan(2);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download loaded messages" }).click();
  expect((await download).suggestedFilename()).toBe("conversation.txt");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(launch).toBeFocused();
  await expect(page.locator(".ac-main textarea")).toHaveValue("Inline draft survives focused reading");
  await expect.poll(() => displacement(page, "chat-150", offset)).toBeLessThan(2);
  expect(await retained!.evaluate(node => node === document.querySelector('[data-entry="chat-150"]'))).toBe(true);
});

test("focused reader restores an evicted inline location and remembers its own location", async ({ page }) => {
  await ready(page); const offset = await anchor(page, "chat-150");
  await page.locator(".ac-main .ac-focus-launch").click();
  await expect(page.locator(".ac-focus-dialog")).toBeVisible();
  await page.evaluate(async () => {
    const session = (window as any).conversationDemo.reader.session;
    for (let i = 0; i < 6; i++) await session.loadOlder();
  });
  const readerAnchor = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(".ac-reader-pane .ac-scroll")!;
    const article = scroller.querySelectorAll<HTMLElement>("[data-entry]")[12]!;
    scroller.scrollTop += article.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
    scroller.dispatchEvent(new Event("scroll")); return article.dataset["entry"]!;
  });
  await page.getByRole("button", { name: "Close focused reader" }).click();
  await expect(page.locator('.ac-main [data-entry="chat-150"]')).toHaveCount(1);
  await expect.poll(() => displacement(page, "chat-150", offset)).toBeLessThan(2);
  await page.locator(".ac-main .ac-focus-launch").click();
  await expect(page.locator(`.ac-reader-pane [data-entry="${readerAnchor}"]`)).toHaveCount(1);
  await expect(page.locator(".ac-reader-pane .ac-tools")).toContainText("Reading history");
});

test("focused reader fills a phone viewport and can be disabled without losing a draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await ready(page);
  await page.locator(".ac-main textarea").fill("Phone draft");
  await page.locator(".ac-main .ac-focus-launch").click();
  const dialog = page.locator(".ac-focus-dialog"); await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox(); expect(bounds!.width).toBe(390); expect(bounds!.height).toBe(740);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole("button", { name: "Close focused reader" }).click();
  await expect(page.locator(".ac-main textarea")).toHaveValue("Phone draft");
  await page.evaluate(() => { (window as any).conversationDemo.reader.focusModeEnabled = false; });
  await expect(page.locator(".ac-focus-launch")).toHaveCount(0);
  const cancelled = await page.evaluate(async () => {
    const reader = (window as any).conversationDemo.reader;
    reader.focusModeEnabled = true; reader.showReader(); reader.closeReader();
    await Promise.resolve(); await Promise.resolve();
    return reader.querySelector(".ac-focus-dialog").open;
  });
  expect(cancelled).toBe(false);
});


test("message hover controls preserve geometry and work with keyboard and clipboard", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const entry = page.locator('.ac-main [data-entry="chat-159"]');
  const controls = entry.locator(".ac-message-controls");
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS("opacity", "0");
  const before = await entry.boundingBox();
  await entry.hover();
  await expect(controls).toHaveCSS("opacity", "1");
  expect(await entry.boundingBox()).toEqual(before);
  await page.mouse.move(0, 0);
  await entry.getByRole("button", { name: "Copy message", exact: true }).focus();
  await expect(controls).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await entry.locator(".ac-body").innerText());
  await page.locator(".ac-main textarea").fill("Keep this draft");
  await entry.hover();
  await entry.getByRole("button", { name: "Reply to conversation", exact: true }).click();
  await expect(page.locator(".ac-main textarea")).toBeFocused();
  await expect(page.locator(".ac-main textarea")).toHaveValue("Keep this draft");
  await page.locator(".ac-main .ac-focus-launch").click();
  await expect(page.locator(".ac-focus-dialog[open]")).toBeVisible();
  await expect(page.locator(".ac-reader-pane .ac-message-controls").getByRole("button", { name: "Reply to conversation" })).toHaveCount(0);
});

test("touch message actions are visible and have generous targets", async ({ browser, browserName, baseURL }) => {
  test.skip(browserName === "firefox", "Firefox does not emulate touch contexts.");
  const context = await browser.newContext({ ...(baseURL ? { baseURL } : {}), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await ready(page);
    const entry = page.locator('.ac-main [data-entry="chat-159"]');
    await expect(entry.locator(".ac-message-controls")).toHaveCSS("opacity", "1");
    const reply = entry.getByRole("button", { name: "Reply to conversation", exact: true });
    const box = await reply.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    await reply.tap();
    await expect(page.locator(".ac-main textarea")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally { await context.close(); }
});
