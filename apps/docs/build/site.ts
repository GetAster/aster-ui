import { exampleSearchItems, searchItems } from "./search.ts";
import { buildAgentDocs } from "./agent-docs.ts";
import { marked } from "marked";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { build as buildReference } from "../../../scripts/docs/build.ts";
import { exampleSource } from "../../showcase/build/assets.ts";
import { shell } from "../src/templates/shell.ts";
import { buildExamples, examples } from "./examples.ts";
import { buildDocsRuntime } from "./runtime.ts";

/** Assemble reading pages, search, API reference and executable source examples. */
export async function buildDocumentation(ROOT: string, OUT: string, DOCS: readonly string[], production: { conditions: string[]; define: Record<string, string> }): Promise<Record<string, string>> {
  const guideMarkdown = new Map<string, string>();
  const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="../site.css">
</head>
<body class="doc"><nav><a href="../">Aster UI</a></nav><main>${body}</main></body>
</html>`;

  // Docs link to each other as .md, which on the site are pages; other relative
  // links go to the repository.
  const REPO = "https://github.com/GetAster/aster-ui/blob/main/docs/";
  async function render(dir: string): Promise<{ name: string; title: string }[]> {
    mkdirSync(join(OUT, dir), { recursive: true });
    const pages = [];
    for (const file of readdirSync(join(ROOT, "docs", dir)).filter((f) => f.endsWith(".md")).sort()) {
      const md = (await Bun.file(join(ROOT, "docs", dir, file)).text())
        .replace("<!--echarts-entry-source-->", () => "```typescript\n" + readFileSync(join(ROOT, "apps/showcase/src/examples/charts/vendor/echarts.ts"), "utf8") + "\n```")
        .replace("<!--composition-yaml-->", () => "```yaml\n" + readFileSync(exampleSource(ROOT, "composition.ui.yaml"), "utf8") + "\n```")
        .replace("<!--composition-model-->", () => "```javascript\n" + readFileSync(exampleSource(ROOT, "composition-model.js"), "utf8") + "\n```")
        .replace("<!--showcase-composition-source-->", () => "```yaml\n" + readFileSync(join(ROOT, "apps/showcase/src/app/showcase.ui.yaml"), "utf8") + "\n```")
        .replace("<!--showcase-preview-source-->", () => "```typescript\n" + readFileSync(join(ROOT, "apps/showcase/src/app/views/preview.ts"), "utf8") + "\n```")
        .replace("<!--composition-status-->", () => "```javascript\n" + readFileSync(exampleSource(ROOT, "composition-status.js"), "utf8") + "\n```")
        .replace("<!--first-grid-html-->", () => "```html\n" + readFileSync(join(OUT, "playground/first-grid.html"), "utf8") + "\n```")
        .replace("<!--first-grid-js-->", () => "```javascript\n" + readFileSync(exampleSource(ROOT, "first-grid.js"), "utf8") + "\n```");
      const heading = /^# (.+)$/m.exec(md)?.[1] ?? file;
      const body = (await marked.parse(md))
        .replace(/href="(\.\/)?([\w-]+)\.md(#[^"]*)?"/g, 'href="$2.html$3"')
        .replace(/href="\.\.\/([\w-]+)\/([\w-]+)\.md(#[^"]*)?"/g, (m, d, n, h = "") =>
          DOCS.includes(d) ? `href="${dir === "guide" && d !== "guide" ? `${REPO}${d}/${n}.md` : `../${d}/${n}.html`}${h}"` : m)
        .replace(/href="\.\.\/(?![\w-]+\/[\w-]+\.html|(?:reference|playground|lib)\/|#)([^"]+)"/g, `href="${REPO}$1"`);
      const name = basename(file, ".md");
      if (dir === "guide") guideMarkdown.set(name, md);
      pages.push({ name, title: await marked.parseInline(heading) });
      writeFileSync(join(OUT, dir, `${name}.html`), dir === "guide"
        ? shell(heading.replaceAll("`", ""), `<p class="eyebrow">Aster UI / ${name === "connected-views" ? "How-to guides" : "Guides"}</p>${body}<footer class="article-footer">Continue exploring: <a href="../reference/">API reference</a> · <a href="../#showcase">Component showcase</a></footer>`).replace("</head>", `<link rel="alternate" type="text/markdown" href="./${name}.md"></head>`)
      : page(heading.replaceAll("`", ""), body));
    }
    return pages;
}
  const list = (dir: string, pages: { name: string; title: string }[]) =>
    pages.map((p) => `<li><a href="${dir}/${p.name}.html">${p.title}</a></li>`).join("");
  const lists: Record<string, string> = {};
  for (const dir of DOCS) lists[dir] = list(dir, await render(dir));

  // The API reference: reference.json and its viewer.
  const reference = buildReference();
  if (reference.problems.length) throw new Error(`The reference has broken headings or links:\n${reference.problems.join("\n")}`);
  const REF = join(OUT, "reference");
  await buildDocsRuntime(ROOT, OUT, production);
  mkdirSync(REF, { recursive: true });
  writeFileSync(join(REF, "index.html"), shell("Documentation", "", "../docs-assets/viewer.js").replace('<body class="doc ref">', '<body class="doc ref" data-api>').replace("</head>", '<link rel="alternate" type="text/markdown" href="./index.md"></head>'));
  writeFileSync(join(REF, "reference.json"), JSON.stringify(reference.entries));
  const guidePages = readdirSync(join(ROOT, "docs/guide")).filter(f => f.endsWith(".md")).sort((a, b) => {
    const order = ["why-aster.md", "getting-started.md", "data-model.md", "connected-views.md", "library.md", "themes.md"];
    const rank = (file: string) => { const index = order.indexOf(file); return index < 0 ? order.length : index; };
    const advanced = (file: string) => file === "data.md" || file === "elements.md";
    return Number(advanced(a)) - Number(advanced(b)) || rank(a) - rank(b) || a.localeCompare(b);
  }).map(f => {
    const md = readFileSync(join(ROOT, "docs/guide", f), "utf8");
    return { name: /^# (.+)$/m.exec(md)?.[1] ?? f, description: md, href: `../guide/${basename(f, ".md")}.html`, kind: "Guide" };
  });
  writeFileSync(join(OUT, "guide/search.json"), JSON.stringify(searchItems([...guidePages, ...exampleSearchItems(examples)], reference.entries)));
  buildExamples(ROOT, OUT);
  buildAgentDocs(OUT, guideMarkdown, reference.entries);
  writeFileSync(join(OUT, "guide/index.html"), shell("Guides", `<p class="eyebrow">Aster UI / Learn</p><h1>Build with Aster.</h1><p class="lead">Understand the model, run an example, then compose your own application.</p><div class="doc-cards">${guidePages.filter(p => !["../guide/data.html", "../guide/elements.html"].includes(p.href)).map(p => `<a class="doc-card" href="${p.href}"><strong>${p.name}</strong><span>Read the guide →</span></a>`).join("")}</div><h2>Implementation details</h2><p>Advanced guides explain how the data core and elements work internally.</p><div class="doc-cards">${guidePages.filter(p => ["../guide/data.html", "../guide/elements.html"].includes(p.href)).map(p => `<a class="doc-card" href="${p.href}"><strong>${p.name}</strong><span>Read the advanced guide →</span></a>`).join("")}</div>`));

    return lists;
}
