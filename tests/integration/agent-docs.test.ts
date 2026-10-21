import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentIndex, apiMarkdownFile, buildAgentDocs, mapMarkdownLinks } from "../../apps/docs/build/agent-docs.ts";
import type { Entry } from "../../scripts/docs/extract.ts";

test("agent links rebase prose while example code keeps its own URLs", () => {
  const markdown = '[Guide](../guide/data.md)\n```html\n<a href="../lib/example.html">Example</a>\n```\n<a href="../guide/data.html">Guide</a>';
  expect(mapMarkdownLinks(markdown, href => `/docs/${href.slice(3)}`)).toBe('[Guide](/docs/guide/data.md)\n```html\n<a href="../lib/example.html">Example</a>\n```\n<a href="/docs/guide/data.html">Guide</a>');
  expect(mapMarkdownLinks('~~~~js\nconst x = "[keep](./source)";\n~~~~\n[Move](./target)', href => `/new/${href}`)).toContain('const x = "[keep](./source)";');
});

test("public Markdown preserves API types and links to related entries without a JS viewer", () => {
  const out = mkdtempSync(join(tmpdir(), "aster-agent-docs-"));
  try {
    mkdirSync(join(out, "guide"));
    const base: Entry = { ref: "class:Grid", name: "Grid", kind: "class", package: "elements", description: "Share a [[class:Selection]] with a form.", seeAlso: ["class:Selection"], groups: [], examples: [], source: "packages/elements/src/grid/grid.ts:1" };
    const selection: Entry = { ...base, ref: "class:Selection", name: "Selection", package: "data", description: "Selected keys.", seeAlso: [] };
    const member: Entry = { ...base, ref: "method:Grid.refresh", name: "refresh", definingClass: "class:Grid", kind: "method", description: "Refresh confirmed content.", params: [{ name: "force", type: "boolean", optional: true, description: "Force refresh." }], returns: { type: "Promise<void>", description: "Resolves after refresh." }, seeAlso: [] };
    buildAgentDocs(out, new Map([["example", "# Example\n\n[Grid](../reference/#class:Grid)\n"]]), [base, selection, member]);
    expect(readFileSync(join(out, "guide/example.md"), "utf8")).toContain("../reference/api/class-Grid.md");
    const grid = readFileSync(join(out, "reference/api/class-Grid.md"), "utf8");
    expect(grid).toContain("[Selection](class-Selection.md)");
    expect(grid).toContain("method-Grid.refresh.md");
    expect(readFileSync(join(out, "reference/api/method-Grid.refresh.md"), "utf8")).toContain("refresh(force?: boolean): Promise<void>");
    expect(() => apiMarkdownFile("class:../../internal")).toThrow();
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("root and docs entry points link to the appropriate public paths", () => {
  expect(agentIndex("docs/")).toContain("(docs/guide/evaluating-aster-ui.md)");
  expect(agentIndex("", "../")).toContain("(../examples/mail.html)");
  expect(agentIndex()).toContain("(reference/index.md)");
});
