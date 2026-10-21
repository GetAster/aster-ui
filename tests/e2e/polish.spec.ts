// M1 acceptance 2: the automatable items of Lamplight's review checklist.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { open, row, settle, size } from "./fixtures.ts";

const style = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))) return;
  }
  throw new Error("couldn't reach the element with Tab");
}

test.beforeEach(async ({ page }) => open(page));

test("Lamplight's faces load and set the figures", async ({ page }) => {
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
  expect(loaded).toEqual(expect.arrayContaining(["Bricolage Grotesque Variable", "Fraunces Variable"]));
  expect(await page.evaluate(() => document.fonts.check('380 32px "Fraunces Variable"'))).toBe(true);
});

test("one flush ring on keyboard focus, none on click", async ({ page, browserName }) => {
  const newButton = page.locator("aster-button.new button");
  await tabTo(page, newButton);
  expect(await style(newButton, "outline-style")).toBe("solid");
  expect(await style(newButton, "outline-width")).toBe("2px");
  expect(await style(newButton, "outline-offset")).toBe("0px");
  expect(await style(page.locator("aster-button.new"), "outline-style")).toBe("none");

  await page.getByRole("tab", { name: "Paused" }).click();
  const paused = page.getByRole("tab", { name: "Paused" });
  // WebKit doesn't focus buttons on click at all, which also shows no ring.
  if (browserName !== "webkit") await expect(paused).toBeFocused();
  expect(await style(paused, "outline-style")).toBe("none");
});

test("a field's frame owns its ring; the input never shows one", async ({ page }) => {
  await page.getByRole("button", { name: "Share" }).click();
  const input = page.getByRole("textbox", { name: "Invite by name or email" });
  await expect(input).toBeFocused();
  expect(await style(input, "outline-style")).toBe("none");
  expect(await style(page.locator("aster-dialog .aster-field").first(), "outline-style")).toBe("solid");
});

test("the dialog takes focus, keeps it, and gives it back", async ({ page }) => {
  const share = page.getByRole("button", { name: "Share" });
  await share.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Invite by name or email" })).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog") || document.activeElement === document.body)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(share).toBeFocused();
  await expect(page.locator("aster-dialog dialog")).not.toBeVisible();
  await expect(page.locator("aster-dialog input").first()).not.toBeVisible();
});

test("a click on the backdrop closes the dialog", async ({ page }) => {
  await page.getByRole("button", { name: "Share" }).click();
  await page.mouse.click(30, 400);
  await expect(page.locator("aster-dialog dialog")).not.toBeVisible();
});

test("the cursor follows the role", async ({ page }) => {
  const pointer = [
    page.locator("aster-button.new button"),
    page.getByRole("tab", { name: "Paused" }),
    page.locator("#projects-list [role=option]").first(),
    page.locator(".aster-nav-item").first(),
    page.locator(".lamp-switch"),
  ];
  for (const l of pointer) expect(await style(l, "cursor")).toBe("pointer");
  for (const l of [page.locator(".due").first(), page.locator(".note")]) expect(await style(l, "cursor")).toBe("auto");
  await page.getByRole("button", { name: "Share" }).click();
  expect(await style(page.locator("aster-dialog .aster-field").first(), "cursor")).toBe("text");
  expect(await style(page.locator(".person").first(), "cursor")).toBe("auto");
  await page.getByRole("button", { name: "Link settings" }).click();
  expect(await style(page.getByRole("switch").first(), "cursor")).toBe("pointer");
  expect(await style(page.locator(".aster-switch-row").first(), "cursor")).toBe("pointer");
});

test("confirmations happen in place with no layout shift", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Link settings" }).click();
  const copy = page.locator("aster-button", { hasText: "Copy link" }).locator("button");
  await settle(page);
  const before = await size(copy);
  await copy.click();
  await expect(copy.locator("[data-off]")).toHaveText("Copy link");
  expect(await size(copy)).toEqual(before);
});

test("busy swaps the label in place, holds the width and ignores repeat clicks", async ({ page }) => {
  await page.evaluate(() => ((globalThis as unknown as { aster: { mock: { faults: { writeLatencyMs: number } } } }).aster.mock.faults.writeLatencyMs = 600));
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("textbox", { name: "Invite by name or email" }).fill("Donald Knuth");
  const invite = page.locator("aster-dialog aster-button", { hasText: "Invite" }).locator("button");
  await settle(page);
  const before = await size(invite);
  await invite.click();
  await expect(invite).toHaveAttribute("aria-busy", "true");
  await expect(invite.locator(".aster-label-swap > span:not([data-off])")).toHaveText("Inviting…");
  expect(await size(invite)).toEqual(before);
  expect(await style(invite, "cursor")).toBe("progress");
  await invite.click({ force: true });
  await expect(invite).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".person", { hasText: "Donald Knuth" })).toHaveCount(1);
});

test("the caret, page title, window title and URL agree", async ({ page }) => {
  const caretAt = async (group: Locator, item: Locator, axis: "x" | "y") => {
    const caret = await group.locator(":scope > .aster-caret").boundingBox();
    const box = await item.boundingBox();
    if (!caret || !box) throw new Error("not rendered");
    return axis === "x" ? Math.abs(caret.x - box.x) < 1 && Math.abs(caret.width - box.width) < 1 : caret.y > box.y && caret.y + caret.height < box.y + box.height;
  };
  await page.getByRole("tab", { name: "Paused" }).click();
  await expect(page).toHaveURL(/#projects\/paused$/);
  await expect(page).toHaveTitle("Paused projects – Aster");
  await expect(page.locator("h1")).toHaveText("Projects");
  await expect.poll(() => caretAt(page.locator(".aster-tabs"), page.getByRole("tab", { name: "Paused" }), "x")).toBe(true);
  await expect.poll(() => caretAt(page.locator(".aster-nav"), page.locator('.aster-nav-item[aria-current="page"]'), "y")).toBe(true);

  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/#reports$/);
  await expect(page).toHaveTitle("Reports – Aster");
  await expect(page.locator("h1")).toHaveText("Reports");
  await expect(page.locator('.aster-nav-item[aria-current="page"]')).toHaveText("Reports");
  await expect.poll(() => caretAt(page.locator(".aster-nav"), page.getByRole("link", { name: "Reports" }), "y")).toBe(true);
});

test("Back goes to the previous page, not the previous filter, and reload keeps your place", async ({ page }) => {
  await page.getByRole("tab", { name: "Paused" }).click();
  await page.getByRole("tab", { name: "Archived" }).click();
  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveTitle("People – Aster");
  await page.goBack();
  await expect(page).toHaveURL(/#projects\/archived$/);
  await expect(page).toHaveTitle("Archived projects – Aster");
  await expect(page.getByRole("tab", { name: "Archived" })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page).toHaveTitle("Archived projects – Aster");
  await expect(page.getByRole("tab", { name: "Archived" })).toHaveAttribute("aria-selected", "true");
});

test("errors sit under their field, quote the input, clear on fix and keep what was typed", async ({ page }) => {
  await page.getByRole("button", { name: "Share" }).click();
  const input = page.getByRole("textbox", { name: "Invite by name or email" });
  const error = page.locator("aster-dialog .aster-error");
  const cases: [string, string][] = [
    ["", "Type a name or an email address, then press Invite."],
    ["@aster.example", "“@aster.example” is missing the name before the @. For example: grace@aster.example"],
    ["grace@", "“grace@” is missing the part after the @, such as aster.example."],
    ["Grace Hopper", "Grace Hopper already has access (can edit)."],
    ["Linus", "No one called “Linus” is in Aster yet. Use their email address to invite them."],
  ];
  for (const [typed, message] of cases) {
    await input.fill(typed);
    await input.press("Enter");
    await expect(error).toHaveText(message);
    await expect(input).toHaveValue(typed);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect(await input.getAttribute("aria-describedby")).toBe(await error.getAttribute("id"));
  }
  await input.fill("linus@kernel.org");
  await expect(error).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});

test("pinned shortcuts reveal the row on its tab rather than inventing a page", async ({ page }) => {
  await page.getByRole("tab", { name: "Archived" }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Billing v2" }).click();
  await expect(page).toHaveURL(/#projects\/active$/);
  await expect(row(page, "Billing v2")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Billing v2")).toHaveClass(/aster-flash/);
});

test("the list follows the listbox pattern from the keyboard", async ({ page }) => {
  const list = page.getByRole("listbox", { name: "Active projects" });
  await row(page, "Spring launch").click();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "Brand refresh")).toHaveAttribute("aria-selected", "true");
  expect(await list.getAttribute("aria-activedescendant")).toBe(await row(page, "Brand refresh").getAttribute("id"));
  await page.keyboard.press("End");
  await expect(page.locator("#projects-list [role=option]").last()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#projects-list [role=option]").last()).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(row(page, "Spring launch")).toHaveAttribute("aria-selected", "true");
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("motion collapses to nothing", async ({ page }) => {
    const caret = page.locator(".aster-tabs > .aster-caret");
    // No transition, not a short one: a section or caret then lands in the next frame.
    const durations = (l: Locator) => style(l, "transition-duration").then((d) => d.split(",").map((s) => parseFloat(s)));
    expect((await durations(caret)).slice(0, 2)).toEqual([0, 0]);
    expect((await durations(page.locator(".aster-button").first()))[0]).toBe(0);
    await page.evaluate(() => (location.hash = "#project/1"));
    await expect(page.getByRole("button", { name: "Budget", exact: true })).toBeVisible();
    expect(await durations(page.locator(".aster-section-body").first())).toEqual([0]);
  });
});

test("form controls: the frame owns the ring, cursors follow role, Save keeps its width", async ({ page }) => {
  await page.evaluate(() => (location.hash = "#project/1"));
  const name = page.getByRole("textbox", { name: "Project", exact: true });
  await expect(name).toBeVisible();
  await name.click();
  for (const target of [page.getByRole("combobox", { name: "Lead" }), page.getByRole("combobox", { name: "State" })]) {
    await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    const frame = page.locator(".aster-field", { has: target });
    expect(await style(target, "outline-style")).toBe("none");
    expect(await style(frame, "outline-style")).toBe("solid");
  }
  expect(await style(page.locator(".aster-field", { has: page.getByRole("combobox", { name: "Lead" }) }), "cursor")).toBe("text");
  expect(await style(page.locator(".aster-field", { has: page.getByRole("combobox", { name: "State" }) }), "cursor")).toBe("pointer");
  expect(await style(page.getByRole("button", { name: "Budget", exact: true }), "cursor")).toBe("pointer");

  await name.fill("Spring launch, again");
  const saveButton = page.locator("aster-button.save button");
  const before = await size(saveButton);
  await saveButton.click();
  await expect(page.locator("aster-button.save .aster-label-swap > :not([data-off])")).toHaveText("Saved");
  expect(await size(saveButton)).toEqual(before);

  await page.getByRole("tab", { name: /Tasks/ }).click();
  expect(await style(page.getByRole("checkbox").first(), "cursor")).toBe("pointer");
  await page.evaluate(() => (location.hash = "#people"));
  expect(await style(page.getByRole("separator"), "cursor")).toBe("col-resize");
});
