import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rebaseHTML, stageProductSite } from "../../scripts/build-product-site.ts";

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
