// In-flow panels: the section's chrome, collapsible and footer surfaces.
// Each option is exercised in a bare page built from the browser library, so
// the assertions describe the element's own contract rather than a demo.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixtures.ts";

interface ProbeSection extends HTMLElement {
  heading: string;
  open: boolean;
  body: Node;
  summary: string | Node;
  footer: Node;
  collapsible: boolean;
  chrome: { titleBar?: boolean; fold?: boolean; close?: boolean; footer?: boolean; status?: "collapsed" | "always" };
}

/** A blank page with the browser library and theme, so elements start from their own defaults. */
async function mount(page: Page): Promise<void> {
  await page.goto("/reference/reference.json");
  await page.setContent(`<!doctype html><html lang="en"><head><title>Section probe</title>
    <link rel="stylesheet" href="/lib/aster-ui.css">
    <link rel="stylesheet" href="/lib/themes/lamplight.css">
  </head><body><h1>Section probe</h1></body></html>`);
  await page.evaluate(async () => { const url = "/lib/aster-ui.js"; await import(url); });
}

type Setup = Partial<Pick<ProbeSection, "heading" | "open" | "collapsible" | "chrome">> & {
  body?: boolean;
  footer?: boolean;
  summary?: string;
};

/** Creates #probe with optional body content, a footer button, and properties. */
async function probe(page: Page, setup: Setup = {}): Promise<void> {
  await page.evaluate((s) => {
    const section = document.createElement("aster-section") as ProbeSection;
    section.id = "probe";
    section.heading = s.heading ?? "Probe";
    if (s.open !== undefined) section.open = s.open;
    if (s.collapsible !== undefined) section.collapsible = s.collapsible;
    if (s.chrome !== undefined) section.chrome = s.chrome;
    if (s.summary !== undefined) section.summary = s.summary;
    if (s.body) {
      const body = document.createElement("div");
      body.className = "probe-body";
      body.textContent = "Body content";
      section.body = body;
    }
    if (s.footer) {
      const footer = document.createElement("button");
      footer.type = "button";
      footer.className = "probe-footer";
      footer.textContent = "Footer action";
      section.footer = footer;
    }
    document.body.append(section);
  }, setup);
}

const section = (page: Page) => page.locator("#probe");
const body = (page: Page) => section(page).locator(".aster-section-body");
const summary = (page: Page) => section(page).locator(".aster-section-summary");

test("defaults keep the button heading, aria wiring and collapsed summary", async ({ page }) => {
  await mount(page);
  await probe(page, { open: true, summary: "2 changes" });
  await expect(section(page)).toHaveAttribute("data-open", "");
  const head = section(page).locator(".aster-section-head");
  await expect(head).toHaveAttribute("role", "heading");
  await expect(head).toHaveAttribute("aria-level", "2");
  await expect(head.locator(":scope > button")).toHaveAttribute("aria-expanded", "true");
  await expect(head.locator(":scope > button")).toHaveAttribute("aria-controls", /aster-section-/);
  await expect(section(page).locator(".aster-window-bar")).toHaveCount(0);
  await expect(summary(page)).toHaveCount(0);

  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).open = false; });
  await expect(head.locator(":scope > button")).toHaveAttribute("aria-expanded", "false");
  await expect(summary(page)).toHaveText("2 changes");
  await expect(body(page)).toHaveAttribute("inert", "");
});

test("chrome.titleBar uses the shared window bar with the fold control by default", async ({ page }) => {
  await mount(page);
  await probe(page, { chrome: { titleBar: true } });
  const bar = section(page).locator(".aster-window-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("heading", { level: 2, name: /Probe/ })).toBeVisible();
  await expect(section(page).locator(".aster-section-head")).toHaveCount(0);
  const fold = bar.getByRole("button", { name: "Collapse Probe" });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(fold).toHaveAttribute("aria-controls", /aster-section-/);
  await fold.click();
  await expect(section(page)).not.toHaveAttribute("data-open", "");
  await expect(bar.getByRole("button", { name: "Expand Probe" })).toHaveAttribute("aria-expanded", "false");
});

test("chrome.fold: false hides the separate chevron", async ({ page }) => {
  await mount(page);
  await probe(page, { chrome: { titleBar: true, fold: false } });
  await expect(section(page).locator(".aster-window-bar")).toBeVisible();
  await expect(section(page).locator(".aster-section-fold")).toHaveCount(0);
  await expect(section(page).getByRole("button", { name: /Collapse|Expand/ })).toHaveCount(0);
});

test("chrome.close emits a cancelable bubbling close and leaves the panel in place", async ({ page }) => {
  await mount(page);
  await probe(page, { chrome: { close: true } });
  const events = await page.evaluate(() => {
    const log: { phase: string; bubbles: boolean; cancelable: boolean; prevented: boolean }[] = [];
    const probe = document.getElementById("probe")!;
    probe.addEventListener("close", (event) => {
      const e = event as CustomEvent;
      e.preventDefault();
      log.push({ phase: "probe", bubbles: e.bubbles, cancelable: e.cancelable, prevented: e.defaultPrevented });
    });
    document.addEventListener("close", (event) => {
      const e = event as CustomEvent;
      log.push({ phase: "document", bubbles: e.bubbles, cancelable: e.cancelable, prevented: e.defaultPrevented });
    }, { once: true });
    (probe.querySelector(".aster-section-close") as HTMLButtonElement).click();
    return log;
  });
  expect(events).toEqual([
    { phase: "probe", bubbles: true, cancelable: true, prevented: true },
    { phase: "document", bubbles: true, cancelable: true, prevented: true },
  ]);
  await expect(section(page)).toBeVisible();
  await expect(section(page)).toHaveAttribute("data-open", "");
  await expect(section(page).getByRole("button", { name: "Close Probe" })).toBeVisible();
});

test("collapsible: false renders a plain heading and an open, non-inert body", async ({ page }) => {
  await mount(page);
  await probe(page, { body: true, open: false, collapsible: false });
  const head = section(page).locator(".aster-section-head");
  await expect(head).toHaveAttribute("role", "heading");
  await expect(head).toHaveAttribute("aria-level", "2");
  await expect(section(page).getByRole("heading", { level: 2, name: "Probe" })).toBeVisible();
  await expect(head.locator("button, [aria-expanded], svg")).toHaveCount(0);
  await expect(section(page).locator("[aria-expanded]")).toHaveCount(0);
  await expect(section(page)).toHaveAttribute("data-open", "");
  await expect(body(page)).not.toHaveAttribute("inert", "");
  await expect(body(page).getByText("Body content")).toBeVisible();
});

test("chrome.status: always shows the summary while open; the default hides it", async ({ page }) => {
  await mount(page);
  await probe(page, { open: true, summary: "3 fields" });
  await expect(summary(page)).toHaveCount(0);
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).chrome = { status: "always" }; });
  await expect(summary(page)).toHaveText("3 fields");
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).open = false; });
  await expect(summary(page)).toHaveText("3 fields");
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).chrome = { status: "collapsed" }; });
  await expect(summary(page)).toHaveText("3 fields");
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).open = true; });
  await expect(summary(page)).toHaveCount(0);
});

test("the footer is a region at the bottom of the body and collapses with it", async ({ page }) => {
  await mount(page);
  await probe(page, { body: true, footer: true });
  const content = section(page).locator(".probe-body");
  const footer = section(page).locator(".aster-section-footer");
  await expect(footer).toBeVisible();
  await expect(footer.locator(".probe-footer")).toHaveText("Footer action");
  const [contentBox, footerBox] = [(await content.boundingBox())!, (await footer.boundingBox())!];
  expect(footerBox.y).toBeGreaterThan(contentBox.y);

  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js";
    const { nothing } = await import(url) as { nothing: unknown };
    const s = document.getElementById("probe") as ProbeSection;
    s.open = false;
    s.footer = nothing as Node;
  });
  await expect(body(page)).toHaveAttribute("inert", "");
  await expect(section(page).locator(".aster-section-footer")).toHaveCount(0);
});

test("collapsing a section with focus inside restores focus to its head button", async ({ page }) => {
  await mount(page);
  await probe(page, { body: true });
  await page.evaluate(() => {
    const s = document.getElementById("probe") as ProbeSection;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Inside";
    s.body = button;
  });
  await section(page).getByRole("button", { name: "Inside" }).focus();
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).open = false; });
  await expect(section(page).locator(".aster-section-head > button")).toBeFocused();
  await expect(body(page)).toHaveAttribute("inert", "");
});

test("collapsing a title-bar panel with focus inside restores focus to the fold button", async ({ page }) => {
  await mount(page);
  await probe(page, { chrome: { titleBar: true }, body: true });
  await page.evaluate(() => {
    const s = document.getElementById("probe") as ProbeSection;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Inside";
    s.body = button;
  });
  await section(page).getByRole("button", { name: "Inside" }).focus();
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).open = false; });
  await expect(section(page).getByRole("button", { name: "Expand Probe" })).toBeFocused();
});

test("a newly invalid field still opens a collapsed section once", async ({ page }) => {
  await mount(page);
  await probe(page, { open: true, body: true });
  await page.evaluate(() => {
    const s = document.getElementById("probe") as ProbeSection;
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Probe input");
    s.body = input;
  });
  const toggle = section(page).locator(".aster-section-head > button");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => { document.getElementById("probe")!.querySelector("input")!.setAttribute("aria-invalid", "true"); });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => { document.getElementById("probe")!.querySelector("input")!.removeAttribute("aria-invalid"); });
  await page.waitForTimeout(20);
  await page.evaluate(() => { document.getElementById("probe")!.querySelector("input")!.setAttribute("aria-invalid", "true"); });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("the panel configurations are axe-clean", async ({ page }) => {
  await mount(page);
  await probe(page, { chrome: { titleBar: true, close: true, footer: true }, body: true, footer: true });
  const violations = async () => (await new AxeBuilder({ page }).include("#probe").analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(await violations()).toEqual([]);
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).collapsible = false; });
  expect(await violations()).toEqual([]);
  await page.evaluate(() => { (document.getElementById("probe") as ProbeSection).open = false; });
  expect(await violations()).toEqual([]);
});

test("the helpdesk family tree draws its cards as section panels", async ({ page }) => {
  await page.goto(`/?memory&debug&clients=0&time=0&now=${NOW}#helpdesk`);
  const first = page.locator("aster-section.hdm-win").first();
  await expect(first).toBeVisible();
  await expect(page.locator(".hdm-win-bar, .hdm-win-name, .hdm-win-fold, .hdm-win-count")).toHaveCount(0);
  await expect(first.locator(".aster-window-bar").getByRole("heading", { level: 2 })).toBeVisible();
  await expect(first.locator(".aster-section-summary")).toBeVisible();
  await expect(first.locator(".aster-section-summary")).toHaveText(/^\d+$/);
  const fold = first.locator(".aster-section-fold");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(first).not.toHaveAttribute("data-open", "");
  await expect(first.locator(".aster-section-summary")).toBeVisible();
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("data-open", "");
  await expect(first.locator(".aster-section-summary")).toBeVisible();
  await expect(first.locator(".aster-section-body")).not.toHaveAttribute("inert", "");
});
