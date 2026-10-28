import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocsSite, renderMarkdown, renderShell, type DocsSiteConfig } from "../src/build/index.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(): DocsSiteConfig {
  const root = mkdtempSync(join(tmpdir(), "aster-docs-test-"));
  roots.push(root);
  mkdirSync(join(root, "guides"));
  writeFileSync(join(root, "README.md"), "# Other Aster project\n\n[Install](guides/install.md#first-step)\n");
  writeFileSync(join(root, "guides/install.md"), "# Install\n\n## First step\n\nRun the command.\n\n[Home](../README.md)\n");
  writeFileSync(join(root, "private.md"), "# Private plans\n");
  return {
    root, outdir: "dist/docs", siteName: "Other Aster project", home: "index.html",
    pages: [{ source: "README.md", output: "index.html" }, { source: "guides/install.md", output: "guides/install.html" }],
    navigation: [{ label: "Start", links: [{ href: "guides/install.html", label: "Install" }] }],
  };
}

test("a second project gets portable routes, assets and searchable content from its publication list", async () => {
  const config = fixture();
  await buildDocsSite(config);
  const out = join(config.root, config.outdir);
  const install = readFileSync(join(out, "guides/install.html"), "utf8");
  expect(install).toContain('href="../index.html"');
  expect(install).toContain('src="../docs-assets/docs.js"');
  expect(install).toContain('name="aster-docs-search" content="../search.json"');
  expect(install).toContain('id="first-step"');
  expect(readFileSync(join(out, "index.html"), "utf8")).toContain('href="guides/install.html#first-step"');
  expect(JSON.parse(readFileSync(join(out, "search.json"), "utf8"))).toHaveLength(2);
  expect(existsSync(join(out, "private.html"))).toBe(false);
  for (const name of ["docs.js", "docs.css", "theme.css", "aster-logo.svg", "geist-OFL.txt", "ibm-plex-mono-OFL.txt", "brand/geist/Geist-VariableFont_wght.ttf"]) expect(existsSync(join(out, "docs-assets", name)), name).toBe(true);
});

test("broken destinations and headings fail without replacing a previously built site", async () => {
  const config = fixture();
  await buildDocsSite(config);
  const before = readFileSync(join(config.root, config.outdir, "index.html"), "utf8");
  for (const href of ["private.md", "guides/install.md#missing"]) {
    writeFileSync(join(config.root, "README.md"), `# Home\n\n[Broken](${href})\n`);
    await expect(buildDocsSite(config)).rejects.toThrow(/no published/);
    expect(readFileSync(join(config.root, config.outdir, "index.html"), "utf8")).toBe(before);
  }
});

test("publication collisions and output directories containing sources are rejected", async () => {
  const config = fixture();
  await expect(buildDocsSite({ ...config, pages: [...config.pages, { source: "private.md", output: "index.html" }] })).rejects.toThrow(/Duplicate/);
  await expect(buildDocsSite({ ...config, outdir: "guides" })).rejects.toThrow(/inside the output/);
  await expect(buildDocsSite({ ...config, outdir: ".." })).rejects.toThrow(/within the project/);
});

test("Markdown anchors are stable, duplicate headings are distinct, and raw HTML requires an explicit opt in", async () => {
  const page = await renderMarkdown("# Install\n\n## First step\n\n## First step\n\n<img src=x onerror=alert(1)>\n");
  expect(page.headings.map(heading => heading.id)).toEqual(["install", "first-step", "first-step-2"]);
  expect(page.html).toContain("&lt;img");
  expect((await renderMarkdown("<div>Example</div>", { allowHtml: true })).html).toContain("<div>Example</div>");
  await expect(renderMarkdown("[Bad](javascript:alert)" )).rejects.toThrow(/Unsupported/);
});

test("shell configuration is escaped while trusted article markup is preserved", () => {
  const html = renderShell('<Install & run>', "<h1>Install</h1>", {
    siteName: 'Project "A"', wordmark: "Aster", section: "Docs", homeHref: "../", assetsHref: "../assets/", rootHref: "../", searchHref: "../search.json", navigationHtml: "",
  });
  expect(html).toContain("&lt;Install &amp; run&gt;");
  expect(html).toContain("Project &quot;A&quot;");
  expect(html).toContain("<h1>Install</h1>");
  expect(html).not.toContain("Aster UI");
});
