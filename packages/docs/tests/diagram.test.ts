import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocsSite, createDiagramRenderer, renderMarkdown, searchText } from "../src/build/index.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "docs-diagram-")); roots.push(root);
  writeFileSync(join(root, "flow.svg"), `<svg viewBox="0 0 840 200"><defs><marker id="arrow"><path d="M0 0L5 5"/></marker></defs><path class="arrow" marker-end="url(#arrow)"/><text>Example</text></svg>`);
  writeFileSync(join(root, "narrow.svg"), '<svg viewBox="0 0 280 500"><rect class="step" width="200" height="40"/></svg>');
  return root;
}
const spec = { source: "flow.svg", narrow: "narrow.svg", description: 'Rules precede queries & results.' };
const markdown = `# Flow\n\n\`\`\`diagram\n${JSON.stringify(spec)}\n\`\`\`\n`;

test("repeated diagrams keep marker references distinct and both layouts retain readable dimensions", async () => {
  const root = fixture();
  const page = await renderMarkdown(markdown + markdown, { renderDiagram: createDiagramRenderer(root) });
  expect(page.html).toContain('url(#aster-diagram-1-wide-arrow)');
  expect(page.html).toContain('id="aster-diagram-2-wide-arrow"');
  expect(page.html).toContain('--diagram-width:840px');
  expect(page.html).toContain('--diagram-width:280px');
  expect(page.html.match(/role="img"/g)).toHaveLength(2);
  expect(page.html).toContain('aria-label="Rules precede queries &amp; results."');
  expect(searchText(markdown)).toContain(spec.description);
  expect(searchText(markdown)).not.toContain('flow.svg');
});

test("diagram errors fail the build and ordinary HTML remains escaped", async () => {
  const root = fixture();
  const renderDiagram = createDiagramRenderer(root);
  await expect(renderMarkdown(markdown)).rejects.toThrow(/renderer/);
  await expect(renderMarkdown('```diagram\n{"source":"flow.svg"}\n```', { renderDiagram })).rejects.toThrow(/description/);
  writeFileSync(join(root, 'bad.svg'), '<svg></svg>');
  expect(() => renderDiagram({ ...spec, source: 'bad.svg' })).toThrow(/viewBox/);
  const outside = fixture();
  symlinkSync(join(outside, 'flow.svg'), join(root, 'escape.svg'));
  expect(() => renderDiagram({ ...spec, source: 'escape.svg' })).toThrow(/within the project/);
  const page = await renderMarkdown(markdown + '\n<script>alert(1)</script>', { renderDiagram });
  expect(page.html).toContain('&lt;script&gt;');
});

test("a full site publishes the diagram and indexes its description", async () => {
  const root = fixture(); writeFileSync(join(root, 'README.md'), markdown);
  await buildDocsSite({ root, outdir: 'dist', siteName: 'Example', home: 'index.html', navigation: [], pages: [{ source: 'README.md', output: 'index.html' }] });
  expect(await Bun.file(join(root, 'dist/index.html')).text()).toContain('class="docs-diagram has-narrow"');
  expect(await Bun.file(join(root, 'dist/search.json')).text()).toContain(spec.description);
});
