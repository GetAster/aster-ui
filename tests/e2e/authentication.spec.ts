import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function ready(page: Page) {
  await page.goto("/playground/mail.html");
  await page.waitForFunction(() => !!(globalThis as any).mailDemo);
  await expect(page.getByRole("grid")).toHaveAttribute("aria-busy", "false");
  await page.locator(".mail-lab summary").click();
}
async function draft(page: Page) {
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await page.getByLabel("To", { exact: true }).fill("priya@example.test");
  await page.getByLabel("Subject", { exact: true }).fill("A retained draft");
  await page.getByLabel("Message", { exact: true }).fill("Keep my message while I sign in.");
}
async function signIn(page: Page, method = "Continue with email") {
  await page.getByRole("dialog").getByRole("button", { name: method, exact: true }).click();
  await page.getByRole("button", { name: "Simulate successful sign-in" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("concurrent refreshes share one login and retain loaded rows", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  const first = page.locator('.aster-grid-row[data-key]').first();
  const key = await first.getAttribute("data-key");
  await page.locator("#expire").click();
  await expect(page.getByRole("dialog", { name: "Sign in to continue" })).toBeVisible();
  await expect(first).toHaveAttribute("data-key", key!);
  expect(await page.evaluate(() => (globalThis as any).mailDemo.loginCount)).toBe(1);
  await signIn(page);
  await expect(page.locator("#notice")).toContainText("Mail refreshed");
  await expect(page.getByRole("grid")).toHaveAttribute("aria-busy", "false");
  expect(errors).toEqual([]);
});

test("sending after expiry resumes once, with the original draft payload", async ({ page }) => {
  await ready(page); await draft(page);
  await page.locator("#expire-only").click();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("A retained draft");
  await signIn(page, "Sign in with a passkey");
  await expect(page.locator("#notice")).toContainText("Message sent");
  const result = await page.evaluate(async () => {
    const demo = (globalThis as any).mailDemo;
    const sent = await demo.ctx.source.query({ set: "Messages", filter: { op: "eq", field: "subject", value: "A retained draft" } });
    return { posts: demo.calls.filter((call: any) => call.method === "POST"), records: sent.records };
  });
  expect(result.posts).toHaveLength(2);
  expect(result.posts.map((call: any) => call.expired)).toEqual([true, false]);
  expect(result.records).toHaveLength(1);
  expect(result.records[0].entity.body).toBe("Keep my message while I sign in.");
});

test("cancellation and failure settle sending, keep drafts and allow explicit retry", async ({ page }) => {
  await ready(page); await draft(page); await page.locator("#expire-only").click();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  await expect(page.locator(".mail-draft-error")).toContainText("Sign-in cancelled");
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep my message while I sign in.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Simulate failure", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await signIn(page, "Sign in with SSO");
  await expect(page.locator("#notice")).toContainText("Message sent");
  expect(await page.evaluate(() => (globalThis as any).mailDemo.loginCount)).toBe(3);
});

test("folder and tab changes retain keyed drafts, guarded close protects edits", async ({ page }) => {
  await ready(page); await draft(page);
  await page.getByRole("button", { name: /Archive/ }).click();
  await page.getByRole("tab", { name: "Reading pane", exact: true }).click();
  await page.getByRole("tab", { name: /A retained draft/ }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep my message while I sign in.");
  await page.getByRole("button", { name: /Close A retained draft/ }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("A retained draft");
  await page.getByRole("button", { name: /Close A retained draft/ }).click();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(page.getByRole("tab", { name: /A retained draft/ })).toHaveCount(0);
});

test("message opening reuses identity and new arrivals update folder counts", async ({ page }) => {
  await ready(page);
  await page.locator('.aster-grid-row[data-key]').first().click();
  await page.getByRole("button", { name: "Open selected", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "Open selected", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.locator("#arrival").click();
  await expect(page.locator("#notice")).toContainText("sample message arrived");
  await expect(page.getByRole("grid")).toContainText("New arrival 1");
  await expect(page.getByRole("button", { name: /Inbox/ })).toContainText("17");
});

test("login is labelled, keyboard cancellable and accessible under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await ready(page);
  await page.locator("#expire").click();
  const dialog = page.getByRole("dialog", { name: "Sign in to continue" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#feedback")).toContainText("Sign-in cancelled");
  await expect(page.locator("#expire")).toBeFocused();
});

test("phone layout and dark login contain horizontal geometry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/playground/mail.html?scheme=dark");
  await page.waitForFunction(() => !!(globalThis as any).mailDemo);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".mail-lab summary").click();
  await page.locator("#expire").click(); await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await signIn(page);
});

test("click previews, double-click and Enter open the exact message without duplicate tabs", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  const row = page.locator('.aster-grid-row[data-key]').nth(2);
  const subject = await row.locator('.mail-subject > span').innerText();
  await row.click();
  await expect(page.locator('.mail-reader h2')).toHaveText(subject);
  await expect(page.getByRole('tab')).toHaveCount(1);
  await row.dblclick();
  await expect(page.getByRole('tab', { name: subject, exact: true })).toHaveAttribute('aria-selected', 'true');
  await row.dblclick();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await row.click(); await page.getByRole('grid').press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: subject, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('body')).not.toContainText("isn't loaded");
  expect(errors).toEqual([]);
});

test("mark read uses the loaded record key and updates unread counts", async ({ page }) => {
  await ready(page);
  const row = page.locator('.aster-grid-row[data-key]').filter({ has: page.locator('.mail-unread-dot') }).first();
  const key = await row.getAttribute('data-key');
  await row.dblclick();
  await page.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('marked as read');
  await expect(page.locator(`.aster-grid-row[data-key='${key}'] .mail-unread-dot`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Inbox/ })).toContainText('15');
  await expect(page.locator('#feedback')).toBeHidden();
});

test("failed recovery has one contextual notification with retry and dismiss", async ({ page }) => {
  await ready(page); await page.locator('#expire').click();
  await page.getByRole('button', { name: 'Simulate failure', exact: true }).click();
  await expect(page.locator('#feedback')).toBeVisible();
  await expect(page.locator('#feedback-title')).toHaveText('Mail couldn’t refresh');
  await expect(page.locator('#feedback-detail')).toContainText('Sign-in could not be completed');
  await expect(page.locator('aster-command-bar .aster-command-error')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Authentication recovery:');
  await page.locator('#retry').click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
  await expect(page.locator('#feedback')).toContainText('Sign-in cancelled');
  await page.locator('#dismiss').click(); await expect(page.locator('#feedback')).toBeHidden();
  await expect(page.getByRole('grid')).toBeFocused();
  await expect(page.locator('#login dialog')).toBeHidden();
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
});

test("draft errors stay with their draft and reply fills the recipient and subject", async ({ page }) => {
  await ready(page);
  await page.locator('.aster-grid-row[data-key]').first().click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('aster.team@example.test');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(/^Re:/);
  await page.locator('#expire-only').click();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate failure', exact: true }).click();
  await expect(page.locator('.mail-draft-error')).toContainText('Message wasn’t sent');
  await expect.poll(async () => {
    const error = await page.locator('.mail-draft-error').boundingBox();
    const pane = await page.locator('.mail-reader').boundingBox();
    return !!error && !!pane && error.y >= pane.y && error.y + error.height <= pane.y + pane.height;
  }).toBe(true);
  await expect(page.locator('#feedback')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('Authentication recovery:');
  await page.getByRole('button', { name: 'Try sending again', exact: true }).click();
  await signIn(page);
  await expect(page.locator('#notice')).toContainText('Message sent');
  await expect(page.locator('.mail-draft-error')).toHaveCount(0);
});

test("CommandBar supports formatted errors or application-owned feedback", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const bundle = '/lib/aster-ui.js';
    const { command } = await import(bundle);
    const bar = document.createElement('aster-command-bar') as any;
    bar.id = 'command-error-probe'; bar.label = 'Probe actions'; bar.formatError = () => 'Please sign in and try again.';
    bar.commands = [command({ label: 'Load messages', run: () => { throw new Error('Private implementation detail'); } })];
    document.querySelector('main')!.append(bar);
  });
  const group = page.getByRole('group', { name: 'Probe actions' });
  await group.getByRole('button', { name: 'Load messages', exact: true }).click();
  const error = page.locator('aster-command-bar').last().locator('.aster-command-error');
  await expect(error).toContainText('Please sign in and try again.');
  await expect(error).not.toContainText('Private implementation detail');
  await page.evaluate(() => { (document.querySelector('#command-error-probe') as any).showErrors = false; });
  await expect(error).toHaveCount(0);
});

test("sender and timestamp sorting reaches the service and remains available in card layouts", async ({ page }) => {
  await ready(page);
  async function sort(field: string, direction: string) {
    await page.getByRole('button', { name: 'Sort', exact: true }).click();
    await page.getByRole('menu', { name: 'Sort rows', exact: true }).getByRole('group', { name: field, exact: true }).getByRole('menuitemradio', { name: direction, exact: true }).click();
    await expect(page.getByRole('grid')).toHaveAttribute('aria-busy', 'false');
  }
  await sort('From', 'Ascending');
  await expect.poll(() => page.evaluate(() => (globalThis as any).mailDemo.instance.model.collection.query.orderBy)).toEqual([{ field: 'sender' }]);
  await expect(page.locator('.mail-sender').first()).toHaveText('Aster team');
  await sort('From', 'Descending');
  await expect(page.locator('.mail-sender').first()).toHaveText('Sofia Patel');
  await sort('Received', 'Ascending');
  await expect.poll(() => page.evaluate(() => (globalThis as any).mailDemo.instance.model.collection.query.orderBy)).toEqual([{ field: 'date' }]);
  const result = await page.evaluate(async () => {
    const demo = (globalThis as any).mailDemo;
    const first = await demo.ctx.source.query(demo.instance.model.collection.query, { top: 24 });
    const next = await demo.ctx.source.query(demo.instance.model.collection.query, { skip: 24, top: 24 });
    return { dates: [...first.records, ...next.records].map((record: any) => record.entity.date), urls: demo.calls.slice(-2).map((call: any) => call.url) };
  });
  expect(result.dates).toHaveLength(48);
  expect(result.dates).toEqual([...result.dates].sort());
  expect(result.urls.every((url: string) => new URL(url, 'https://example.test/').searchParams.get('$orderby') === 'date,id')).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await sort('From', 'Ascending');
  await expect(page.locator('.mail-sender').first()).toHaveText('Aster team');
});

test("formatters change text while server sort aliases and filters retain raw semantics", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const grid = document.querySelector('aster-grid') as any;
    grid.formatters = { ...grid.formatters, sender: (value: string) => `Display: ${value}` };
    grid.renderers = { subject: grid.renderers.subject };
    grid.view = { ...grid.view, columns: grid.view.columns.map((column: any) => column.field === 'sender' ? { ...column, sortField: 'senderAddress' } : column),
      sort: [{ field: 'sender' }], filters: { sender: { op: 'eq', field: 'sender', value: 'Oliver Brown' } } };
  });
  await expect(page.getByRole('grid')).toContainText('Display: Oliver Brown');
  const query = await page.evaluate(() => (globalThis as any).mailDemo.instance.model.collection.query);
  expect(query.orderBy).toEqual([{ field: 'senderAddress' }]);
  expect(JSON.stringify(query.filter)).toContain('Oliver Brown');
  expect(JSON.stringify(query.filter)).not.toContain('Display:');
});


test("keyed registered panels retain nodes on reorder and release only the closed session", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await ready(page); await draft(page);
  await page.evaluate(() => {
    const model = (globalThis as any).mailDemo.instance.model;
    const first = model.panels.get("draft-1");
    (globalThis as any).retainedPanel = first.value.peek().element;
  });
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await page.locator('[role="tabpanel"]:not([hidden])').getByLabel("Subject", { exact: true }).fill("Second draft");
  await page.evaluate(() => {
    const panels = (globalThis as any).mailDemo.instance.model.panels;
    panels.reconcile([...panels.sessions.peek()].reverse().map((handle: any) => handle.descriptor));
  });
  await page.getByRole("tab", { name: /A retained draft/ }).click();
  await expect(page.locator('[role="tabpanel"]:not([hidden])').getByLabel("Message", { exact: true })).toHaveValue("Keep my message while I sign in.");
  expect(await page.evaluate(() => (globalThis as any).mailDemo.instance.model.panels.get("draft-1").value.peek().element === (globalThis as any).retainedPanel)).toBe(true);
  await page.getByRole("button", { name: /Close A retained draft/ }).click();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const panels = (globalThis as any).mailDemo.instance.model.panels;
    return !panels.get("draft-1") && !!panels.get("draft-2") && !(globalThis as any).retainedPanel.isConnected;
  })).toBe(true);
  await page.getByRole("tab", { name: /Second draft/ }).click();
  await expect(page.locator('[role="tabpanel"]:not([hidden])').getByLabel("Subject", { exact: true })).toHaveValue("Second draft");
  await page.locator("#arrival").click();
  await expect(page.locator("#notice")).toContainText("sample message arrived");
  expect(errors).toEqual([]);
});

test("workspace activity pauses refresh and refreshes stale mail on return without remounting drafts", async ({ page }) => {
  await ready(page); await draft(page);
  await page.locator("#background").check();
  await expect.poll(() => page.evaluate(() => (globalThis as any).mailDemo.background.stale.peek())).toBe(false);
  await page.evaluate(() => {
    const demo = (globalThis as any).mailDemo;
    demo.instance.activity.setActive(false);
    demo.background.invalidate();
    (globalThis as any).pausedCalls = demo.calls.length;
  });
  // Paused invalidation cannot dispatch work; resumed invalidation must do so.
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (globalThis as any).mailDemo.calls.length)).toBe(await page.evaluate(() => (globalThis as any).pausedCalls));
  expect(await page.evaluate(() => (globalThis as any).mailDemo.instance.model.panels.get("draft-1").activity.running.peek())).toBe(false);
  await page.evaluate(() => (globalThis as any).mailDemo.instance.activity.setActive(true));
  await expect.poll(() => page.evaluate(() => (globalThis as any).mailDemo.calls.length > (globalThis as any).pausedCalls)).toBe(true);
  await expect.poll(() => page.evaluate(() => (globalThis as any).mailDemo.background.stale.peek())).toBe(false);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep my message while I sign in.");
  await page.evaluate(() => {
    const demo = (globalThis as any).mailDemo;
    (globalThis as any).closedSession = demo.instance.model.panels.get("draft-1");
    demo.instance.dispose();
  });
  expect(await page.evaluate(() => (globalThis as any).closedSession.status.peek())).toBe("disposed");
  // The context was borrowed, so owner disposal does not tear down its transport.
  expect(await page.evaluate(async () => (await (globalThis as any).mailDemo.ctx.source.query({ set: "Messages" }, { top: 1 })).records.length)).toBe(1);
});
