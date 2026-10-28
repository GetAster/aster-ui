import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const version = (await Bun.file(join(root, "packages/docs/package.json")).json()).version as string;
const tarball = join(root, `dist-docs/getaster-docs-${version}.tgz`);
if (!await Bun.file(tarball).exists()) throw new Error("Run bun run docs:package first");
const project = mkdtempSync(join(tmpdir(), "aster-docs-consumer-"));
try {
  writeFileSync(join(project, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "@getaster/docs": `file:${tarball}` } }));
  const install = Bun.spawnSync(["bun", "install", "--ignore-scripts"], { cwd: project, stdout: "pipe", stderr: "pipe" });
  if (install.exitCode) throw new Error(`Isolated package installation failed: ${install.stderr}`);
  mkdirSync(join(project, "guides"));
  writeFileSync(join(project, "flow.svg"), '<svg viewBox="0 0 840 100"><text class="label" x="10" y="30">Rules apply before queries run.</text></svg>');
  writeFileSync(join(project, "narrow.svg"), '<svg viewBox="0 0 280 100"><text class="label" x="10" y="30">Rules before queries</text></svg>');
  writeFileSync(join(project, "README.md"), "# Another Aster project\n\n[Install](guides/install.md#first-step)\n\n```diagram\n" + JSON.stringify({ source: "flow.svg", narrow: "narrow.svg", description: "Rules apply before queries run." }) + "\n```\n");
  writeFileSync(join(project, "guides/install.md"), "# Install\n\n## First step\n\nInstall the command.\n\n```bash\naster --help\n```\n\n[Home](../README.md)\n");
  writeFileSync(join(project, "build.ts"), `import { buildDocsSite } from "@getaster/docs";
await buildDocsSite({ root: import.meta.dir, outdir: "dist/docs", siteName: "Another Aster project", wordmark: "AgentXchange", home: "index.html",
  pages: [{ source: "README.md", output: "index.html" }, { source: "guides/install.md", output: "guides/install.html" }],
  navigation: [{ label: "Start", links: [{ href: "index.html", label: "Overview" }, { href: "guides/install.html", label: "Install" }] }],
});`);
  const build = Bun.spawnSync(["bun", "build.ts"], { cwd: project, stdout: "pipe", stderr: "pipe" });
  if (build.exitCode) throw new Error(`Isolated documentation build failed: ${build.stderr}`);
  const prefix = "/products/other/docs/";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(prefix) || path.includes("..")) return new Response("Not found", { status: 404 });
    const name = decodeURIComponent(path.slice(prefix.length));
    const file = Bun.file(join(project, "dist/docs", name.endsWith("/") || !name ? name + "index.html" : name));
    return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
  } });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(new URL(prefix, server.url).href);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Another Aster project");
    await expect(page.getByRole("img", { name: "Rules apply before queries run." })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 844 });
    await expect(page.locator('.diagram-narrow svg')).toBeVisible();
    await expect(page.locator('.diagram-wide')).toBeHidden();
    expect(await page.locator('.diagram-narrow text').evaluate(el => getComputedStyle(el).fontSize)).toBe('14px');
    expect((await new AxeBuilder({ page }).include('.docs-diagram').analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press("Control+k");
    const search = page.getByRole("searchbox", { name: "Search documentation" });
    await expect(search).toBeFocused();
    await search.fill("Install");
    await expect(page.locator("#results a").first()).toContainText("Install");
    await search.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${prefix}guides/install.html$`));
    await expect(page.locator("#outline a")).toHaveAttribute("href", "#first-step");
    await expect(page.locator(".hljs-built_in")).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { document.body.dataset.copied = text; } } });
    });
    await page.getByRole("button", { name: "Copy bash code" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-copied", "aster --help\n");
    for (const scheme of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "Colour scheme" }).selectOption(scheme);
      await expect(page.locator("html")).toHaveAttribute("data-scheme", scheme);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.locator("#nav").getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Another Aster project");
    await page.locator("main").getByRole("link", { name: "Install" }).click();
    await expect(page).toHaveURL(/install\.html#first-step$/);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        searchOutsideHeader: document.querySelector("#search")!.getBoundingClientRect().bottom > document.querySelector("header")!.getBoundingClientRect().bottom,
      }))).toEqual({ overflow: false, searchOutsideHeader: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(errors).toEqual([]);
    await page.screenshot({ path: join(root, "dist-docs/consumer-mobile.png"), fullPage: true });
    console.log(`Packed @getaster/docs@${version} passed isolated installation, prefixed hosting, search, navigation, appearance, highlighting, copying and accessibility checks.`);
  } finally {
    await browser.close();
    await server.stop(true);
  }
} finally {
  rmSync(project, { recursive: true, force: true });
}
