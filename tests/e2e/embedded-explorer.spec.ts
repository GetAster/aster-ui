import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function reveal(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (box) await page.evaluate(y => scrollBy(0, y - 180), box.y);
}

test("embedded Tabs preserves drafts and guards closing", async ({ page }) => {
  await page.goto("/examples/tabs.html");
  const frame = page.frameLocator("iframe");
  await frame.getByRole("tab", { name: "Studio workstation 1", exact: true }).click();
  const notes = frame.getByRole("textbox", { name: "Workspace notes", exact: true });
  await notes.fill("A retained explorer draft");
  await frame.getByRole("tab", { name: "Overview", exact: true }).click();
  await frame.getByRole("tab", { name: /Studio workstation 1/ }).click();
  await expect(notes).toHaveValue("A retained explorer draft");
  await frame.getByRole("tab", { name: /Studio workstation 1/ }).press("Delete");
  await frame.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(notes).toHaveValue("A retained explorer draft");
});

test("embedded Windows retains notes across placement changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/examples/windows.html");
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "Open notes", exact: true }).waitFor();
  await page.locator("iframe").scrollIntoViewIfNeeded();
  await frame.getByRole("button", { name: "Open notes", exact: true }).click();
  const notes = frame.getByRole("dialog", { name: "Notes", exact: true });
  const input = notes.getByRole("textbox", { name: "Workspace notes", exact: true });
  await input.fill("Keep the workspace draft");
  await notes.getByRole("button", { name: "Minimize Notes", exact: true }).click();
  await frame.getByRole("button", { name: "Notes — minimized", exact: true }).click();
  await expect(input).toHaveValue("Keep the workspace draft");
  await notes.getByRole("button", { name: "Maximize Notes", exact: true }).click();
  await expect(notes).toHaveAttribute("data-state", "maximized");
  await notes.getByRole("button", { name: "Restore Notes", exact: true }).click();
  await notes.getByRole("button", { name: "Close Notes", exact: true }).click();
  await frame.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(input).toHaveValue("Keep the workspace draft");
});

test("embedded dashboard shares filters, writes and retained content", async ({ page }) => {
  await page.goto("/examples/dashboard.html");
  const frame = page.frameLocator("iframe");
  const summary = frame.locator('[data-widget="summary-1"] output');
  await expect(summary).toHaveText("240");
  await frame.locator('[data-widget="platforms-1"]').getByRole("button", { name: "Linux", exact: true }).click();
  await expect(summary).toHaveText("80");
  await frame.getByRole("button", { name: "Add Linux device", exact: true }).click();
  await expect(summary).toHaveText("81");
  const input = frame.getByRole("textbox", { name: "Notes text", exact: true });
  await reveal(page, input);
  await input.fill("Keep dashboard notes");
  const move = frame.getByRole("button", { name: "Move Notes", exact: true });
  await move.focus(); await move.press("ArrowUp");
  await expect(input).toHaveValue("Keep dashboard notes");
});

test("embedded charts update and survive hide, show and remount", async ({ page }) => {
  await page.goto("/examples/charts.html");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#platforms svg")).toBeVisible();
  await frame.locator("#platforms").getByRole("button", { name: "Linux", exact: true }).click();
  await expect(frame.locator("#devices .aster-grid-total")).toContainText("80");
  await frame.getByRole("button", { name: "Add Linux device", exact: true }).click();
  await expect(frame.locator("#platforms").getByRole("row", { name: "Linux 81", exact: true })).toBeVisible();
  await frame.getByRole("button", { name: "Hide charts", exact: true }).click();
  await frame.getByRole("button", { name: "Show charts", exact: true }).click();
  await frame.getByRole("button", { name: "Remount charts", exact: true }).click();
  await expect(frame.locator("#platforms svg")).toBeVisible();
});

test("all embedded examples expose source, guide and valid API links", async ({ page, request }) => {
  for (const [id, file] of [["composition", "composition"], ["tabs", "tabs"], ["windows", "windows"], ["dashboard", "dashboard"], ["charts", "components"]]) {
    await page.goto(`/examples/${id}.html`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.locator(".example-source summary").click();
    await expect(page.locator(`[data-source-file="${file}.js"]`)).toBeVisible();
    await page.getByLabel("Source file", { exact: true }).selectOption(`${file}.html`);
    await expect(page.locator(`[data-source-file="${file}.html"]`)).toBeVisible();
    const guide = page.getByRole("link", { name: "How it works", exact: false });
    expect((await request.get((await guide.getAttribute("href"))!)).status()).toBe(200);
    const links = await page.locator(".example-links a").evaluateAll(nodes => nodes.map(n => (n as HTMLAnchorElement).href));
    for (const link of links.filter(link => link.includes("/reference/"))) {
      await page.goto(link);
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Not found");
    }
  }
});

for (const [id, ready] of [["composition", "#workspace .aster-grid-row[data-index]"], ["tabs", "#devices [role=tab]"], ["windows", "#open-notes"], ["dashboard", '[data-widget="summary-1"] output'], ["charts", "#platforms svg"]] as const) {
  test(`embedded ${id} themes, mobile geometry and accessibility remain coherent`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/examples/${id}.html`);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator(ready).first()).toBeVisible();
    await expect(frame.locator(".showcase-nav")).toHaveCount(0);
    for (const scheme of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "Colour scheme", exact: true }).selectOption(scheme);
      await expect(frame.locator("html")).toHaveAttribute("data-scheme", scheme);
      await expect.poll(() => frame.locator("#scheme").evaluate(el => (el as HTMLElement & { value: string }).value)).toBe(scheme);
      const violations = (await new AxeBuilder({ page }).analyze()).violations;
      expect(violations.map(v => `${id} ${scheme}: ${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await frame.locator("html").evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}


test("every explorer leads with capability code, including the vendor lifecycle", async ({ page, request }) => {
  const cases = [
    ["composition", ["collection: { ref: model.collection }", "use: model.commands.save", "async function saveDevice", "lifetime.defer", 'import("./composition-details.js")']],
    ["grid", ["ctx.collection", "table.collection", "new Selection"]],
    ["tile-grid", ["tiles.presentTile", "tiles.renderTile", "--tile-min-width"]],
    ["tabs", ["tabs.items", "tabs.renderPanel", "function requestClose"]],
    ["windows", ["workspace.register", "notes.beforeClose", "workspace.restore"]],
    ["dashboard", ["dashboard.registerType", "dashboard.restore", "beforeRemove"]],
    ["charts", ["runtime.init", ".setOption", ".resize", ".dispose", 'from "echarts"']],
  ] as const;
  for (const [id, patterns] of cases) {
    await page.goto(`/examples/${id}.html`);
    const feature = page.locator(".example-feature-code");
    await expect(feature.getByRole("heading", { name: /^Code for this example/ })).toBeVisible();
    const code = (await feature.locator("pre code").allTextContents()).join("\n");
    for (const pattern of patterns) expect(code, id).toContain(pattern);
    expect(await feature.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector("details.example-source")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  }
  await page.locator("details.example-source summary").click();
  await page.getByLabel("Source file", { exact: true }).selectOption("echarts-adapter.ts");
  await expect(page.locator('[data-source-file="echarts-adapter.ts"] code')).toContainText("runtime.init");
  expect((await request.get("/examples/source/echarts-adapter.ts")).status()).toBe(200);
  expect((await request.get("/examples/source/echarts-entry.ts")).status()).toBe(200);
});

test("composition explorer connects YAML source to a retained editable workspace", async ({ page, request }) => {
  await page.goto("/examples/");
  await page.locator(".doc-cards").getByRole("link", { name: /Composition: a JS and YAML workspace/ }).click();
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#workspace .aster-grid-total")).toHaveText("72 rows");
  await frame.locator('.aster-grid-row[data-index="0"] [role="gridcell"]').first().click();
  await frame.getByRole("button", { name: "Edit selected", exact: true }).click();
  const input = frame.getByRole("region", { name: "Device editor", exact: true }).locator("input").first();
  await input.fill("Design explorer workstation");
  await frame.getByRole("button", { name: "Tiles", exact: true }).click();
  await expect(input).toHaveValue("Design explorer workstation");
  await frame.getByRole("button", { name: "Save device", exact: true }).click();
  await expect(frame.locator("#workspace aster-tile-grid").getByText("Design explorer workstation", { exact: true })).toBeVisible();
  await page.locator(".example-source summary").click();
  await page.getByLabel("Source file", { exact: true }).selectOption("composition.ui.yaml");
  await expect(page.locator('[data-source-file="composition.ui.yaml"] code')).toContainText("use: model.commands.save");
  await page.getByLabel("Source file", { exact: true }).selectOption("composition-model.js");
  await expect(page.locator('[data-source-file="composition-model.js"] code')).toContainText("async function saveDevice");
  expect((await request.get("/playground/composition.ui.json")).ok()).toBe(true);
});

test("embedded source and guide links preserve the live workspace and return focus", async ({ page }) => {
  await page.goto("/examples/composition.html");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#workspace .aster-grid-total")).toHaveText("72 rows");
  await frame.locator('.aster-grid-row[data-index="0"] [role="gridcell"]').first().click();
  await frame.getByRole("button", { name: "Edit selected", exact: true }).click();
  const input = frame.getByRole("region", { name: "Device editor", exact: true }).locator("input").first();
  await input.fill("Retain this source-reading draft");
  for (const [label, file, language] of [["YAML definition", "composition.ui.yaml", "yaml"], ["Model & function bodies", "composition-model.js", "javascript"], ["Lazy details component", "composition-details.js", "javascript"]] as const) {
    const link = frame.getByRole("link", { name: label, exact: true });
    await link.click();
    await expect(page.getByLabel("Source file", { exact: true })).toHaveValue(file!);
    await expect(page.locator(`[data-source-file="${file}"] code.language-${language} .hljs-keyword, [data-source-file="${file}"] code.language-${language} .hljs-attr`).first()).toBeVisible();
    await expect(input).toHaveValue("Retain this source-reading draft");
    await page.getByRole("button", { name: "Back to live preview", exact: true }).click();
    await expect(link).toBeFocused();
    await expect(page).toHaveURL(/\/examples\/composition\.html/);
  }
  const popup = page.waitForEvent("popup");
  await frame.getByRole("link", { name: /How it works.*opens in a new tab/ }).click();
  const guide = await popup;
  await expect(guide).toHaveURL(/\/guide\/declarative-workspace\.html/);
  await guide.close();
  await expect(input).toHaveValue("Retain this source-reading draft");
});

test("standalone source links open the highlighted explorer without replacing the demo", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: /YAML definition.*opens in a new tab/ }).click();
  const source = await popup;
  await expect(source).toHaveURL(/\/examples\/composition\.html\?.*source=composition.ui.yaml/);
  await expect(source.getByLabel("Source file", { exact: true })).toHaveValue("composition.ui.yaml");
  await expect(source.locator('[data-source-file="composition.ui.yaml"] .hljs-attr').first()).toBeVisible();
  await source.getByRole("button", { name: "Back to live preview", exact: true }).click();
  await expect(source.locator("#preview-heading")).toBeFocused();
  expect(new URL(source.url()).searchParams.has("source")).toBe(false);
  await expect(page).toHaveURL(/\/playground\/composition\.html/);
  await source.close();
});


test("mail source links use the shared highlighted viewer", async ({ page }) => {
  await page.goto("/examples/mail.html");
  const frame = page.frameLocator("iframe");
  const link = frame.getByRole("link", { name: "Workspace YAML", exact: true });
  await link.click();
  await expect(page.getByLabel("Source file", { exact: true })).toHaveValue("mail.ui.yaml");
  await expect(page.locator('[data-source-file="mail.ui.yaml"] .hljs-attr').first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Download mail.ui.yaml", exact: true })).toHaveAttribute("download", "");
  await page.getByRole("button", { name: "Back to live preview", exact: true }).click();
  await expect(link).toBeFocused();
});
