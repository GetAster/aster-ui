import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rebaseHTML, stageProductSite } from "../../scripts/build-product-site.ts";

test("Cloudflare resolves declared directory indexes while retaining explicit HTML and missing-page routes", () => {
  const root = mkdtempSync(join(tmpdir(), "aster-cloudflare-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(new URL("../../scripts/prepare-cloudflare.mjs", import.meta.url), join(root, "scripts/prepare-cloudflare.mjs"));
    copyFileSync(new URL("../../cloudflare.config.ts", import.meta.url), join(root, "cloudflare.config.ts"));
    const assets = { "index.html": "Home", "docs/index.html": "Docs", "docs/guide/grid.html": "Grid", "404.html": "Missing" };
    const files = Object.fromEntries(Object.entries(assets).map(([path, text]) => {
      const file = join(root, "dist-site", path);
      mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, text);
      return [path, createHash("sha256").update(text).digest("hex")];
    }));
    const receipt = JSON.stringify({ site: "https://ui.getaster.now", version: "1.0.0", revision: "a".repeat(40), files });
    writeFileSync(join(root, "dist-site/deployment.json"), receipt);
    const result = Bun.spawnSync(["node", join(root, "scripts/prepare-cloudflare.mjs")], { cwd: root });
    expect(result.exitCode).toBe(0);
    const output = join(root, ".cloudflare/output/v0/workers/default/assets");
    expect(readFileSync(join(output, "_redirects"), "utf8")).toBe("/docs /docs/ 308\n/docs/ /docs/index.html 200\n/ /index.html 200\n");
    for (const [path, text] of Object.entries(assets)) expect(readFileSync(join(output, path), "utf8")).toBe(text);
    expect(readFileSync(join(output, "deployment.json"), "utf8")).toBe(receipt);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("moving docs preserves local links, query strings, hashes and external URLs", () => {
  expect(rebaseHTML('<a href="../reference/#class:Grid">API</a><img src="../docs-assets/logo.svg"><a href="https://example.com/guide/">Other</a><a href="#local">Local</a>', "/guide/data.html"))
    .toBe('<a href="/docs/reference/#class:Grid">API</a><img src="/docs-assets/logo.svg"><a href="https://example.com/guide/">Other</a><a href="#local">Local</a>');
  expect(rebaseHTML('<a href="../playground/grid.html?x=1&amp;y=2">Demo</a>', "/reference/index.html"))
    .toContain('/playground/grid.html?x=1&amp;y=2');
});

test("release staging only copies public areas and records the supplied public revision", () => {
  const root = mkdtempSync(join(tmpdir(), "aster-product-test-"));
  try {
    const source = join(root, "input"), output = join(root, "output");
    for (const name of ["aster", "guide", "reference", "lib", "playground", "docs-assets", "examples", "design"]) {
      mkdirSync(join(source, name), { recursive: true });
      writeFileSync(join(source, name, "index.html"), '<html><head></head><body><a href="../guide/">Guide</a></body></html>');
    }
    writeFileSync(join(source, "site.css"), "body{}");
    const revision = "a".repeat(40);
    stageProductSite(source, output, "1.0.0-preview.1", revision);
    expect(existsSync(join(output, "design"))).toBe(false);
    expect(existsSync(join(output, "docs/guide/index.html"))).toBe(true);
    const receipt = JSON.parse(readFileSync(join(output, "deployment.json"), "utf8"));
    expect(receipt.revision).toBe(revision);
    expect(receipt.files["docs/guide/index.html"]).toMatch(/^[a-f0-9]{64}$/);
    expect(() => stageProductSite(source, output, "1.0.0", revision)).toThrow("empty");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
