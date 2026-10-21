// Builds the static site in dist-local/ for any static server (served locally
// through Apache at /aster-ui/): the demo, the docs, and an index page.
// dist-local/reviews/ holds checkpoint reviews and is left untouched.
// Usage: bun run site
import { marked } from "marked";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { build as buildReference } from "./docs/build.ts";
import { stageSite } from "./stage-site.ts";
import { shell } from "./docs/shell.ts";
import { buildExamples, examples } from "./docs/examples.ts";
import { checkPublicLinks } from "./docs/check-links.ts";
import { compileCompositeYaml } from "./composite-yaml.ts";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist-local");
const WASM = join(ROOT, "packages/mock/wasm/odata_mock.wasm");
for (const name of ["data", "elements", "elements-preview", "mock"]) {
  const entry = Bun.resolveSync(`@getaster/${name}`, join(ROOT, "scripts/lib"));
  if (entry !== join(ROOT, "packages", name, "src/index.ts")) throw new Error(`@getaster/${name} resolves outside this checkout; reinstall its workspaces`);
}

if (!existsSync(WASM)) throw new Error("The supplied packages/mock/wasm/odata_mock.wasm artifact is missing");
const DOCS = ["guide", "design", "requirements", "milestones"].filter(dir => existsSync(join(ROOT, "docs", dir)));
for (const dir of ["aster", "lib", "playground", "reference", "docs-assets", "examples", ...DOCS]) rmSync(join(OUT, dir), { recursive: true, force: true });
// Lit's production build, without its dev-mode checks and warnings.
const production = { conditions: ["production"], define: { "process.env.NODE_ENV": '"production"' } };
mkdirSync(join(OUT, "reviews"), { recursive: true });

const built = await Bun.build({
  entrypoints: [join(ROOT, "apps/aster/index.html")],
  outdir: join(OUT, "aster"),
  minify: true,
  splitting: true,
  ...production,
});
if (!built.success) throw new AggregateError(built.logs, "The demo didn't build");
const worker = await Bun.build({
  entrypoints: [join(ROOT, "apps/aster/src/mock-worker.ts")],
  outdir: join(OUT, "aster"),
  naming: "mock-worker.js",
  minify: true,
  target: "browser",
  ...production,
});
if (!worker.success) throw new AggregateError(worker.logs, "The mock worker didn't build");
copyFileSync(WASM, join(OUT, "aster/odata_mock.wasm"));

// The library: aster-ui.js (data and elements, lit-html and signals inside),
// aster-ui-mock.js, the styles and themes, declarations, and the demo's data
// for the playground.
const LIB = join(OUT, "lib");
const lib = await Bun.build({
  entrypoints: [join(ROOT, "scripts/lib/aster-ui.ts"), join(ROOT, "scripts/lib/aster-ui-mock.ts")],
  outdir: LIB,
  minify: true,
  target: "browser",
  ...production,
});
if (!lib.success) throw new AggregateError(lib.logs, "The library didn't build");
// Preview uses the stable module's runtime and is fetched only by explicit import.
const preview = await Bun.build({
  entrypoints: [join(ROOT, "scripts/lib/aster-ui-preview.ts")], outdir: LIB,
  minify: true, target: "browser", ...production,
  external: ["./aster-ui.js"],
  plugins: [{ name: "stable-runtime", setup(build) {
    build.onResolve({ filter: /^\.\/aster-ui\.js$/ }, (args) => ({ path: args.path, external: true }));
    build.onLoad({ filter: /\/packages\/elements-preview\/src\/.*\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace(/from "(@getaster\/(?:data|elements)|@preact\/signals-core|lit-html)"/g, 'from "./aster-ui.js"'), loader: "ts",
    }));
  } }],
});
if (!preview.success) throw new AggregateError(preview.logs, "The preview library didn't build");
writeFileSync(join(LIB, "aster-ui-preview.css"), ["conversation", "hierarchy"].map(name => readFileSync(join(ROOT, `packages/elements-preview/src/styles/${name}.css`), "utf8")).join("\n"));
copyFileSync(WASM, join(LIB, "odata_mock.wasm"));
const STYLES = join(ROOT, "packages/elements/src/styles");
writeFileSync(join(LIB, "aster-ui.css"), ["base.css", "elements.css"].map((f) => readFileSync(join(STYLES, f), "utf8")).join("\n"));
mkdirSync(join(LIB, "themes"), { recursive: true });
for (const theme of ["lamplight.css", "harbour.css"]) copyFileSync(join(STYLES, theme), join(LIB, "themes", theme));
mkdirSync(join(LIB, "demo"), { recursive: true });
for (const f of ["metadata.json", "data.json"]) copyFileSync(join(ROOT, "fixtures/aster", f), join(LIB, "demo", f));
const tsc = Bun.spawnSync(["bunx", "tsc", "-p", join(ROOT, "scripts/lib")], { stdout: "inherit", stderr: "inherit" });
if (tsc.exitCode !== 0) throw new Error("The library's declarations didn't build");
// Declarations import the packages by name; on the site they're files beside each other.
const TYPES = join(LIB, "types");
const PACKAGES: Record<string, string> = {
  "@getaster/data": "packages/data/src/index.js",
  "@getaster/elements": "packages/elements/src/index.js",
  "@getaster/elements-preview": "packages/elements-preview/src/index.js",
  "@getaster/mock": "packages/mock/src/index.js",
};
for (const file of new Bun.Glob("**/*.d.ts").scanSync(TYPES)) {
  const path = join(TYPES, file);
  const text = readFileSync(path, "utf8").replace(/(from "\.{1,2}\/[^"]+)\.ts"/g, '$1.js"').replace(/from "(@getaster\/[\w-]+)"/g, (m, name: string) => {
    const target = PACKAGES[name];
    if (!target) return m;
    const rel = relative(dirname(path), join(TYPES, target));
    return `from "${rel.startsWith(".") ? rel : `./${rel}`}"`;
  });
  writeFileSync(path, text);
}
writeFileSync(join(LIB, "aster-ui.d.ts"), 'export * from "./types/scripts/lib/aster-ui.js";\n');
writeFileSync(join(LIB, "aster-ui-mock.d.ts"), 'export * from "./types/scripts/lib/aster-ui-mock.js";\n');
writeFileSync(join(LIB, "aster-ui-preview.d.ts"), 'export * from "./types/scripts/lib/aster-ui-preview.js";\n');
mkdirSync(join(OUT, "playground"), { recursive: true });
for (const f of readdirSync(join(import.meta.dir, "site/playground"))) copyFileSync(join(import.meta.dir, "site/playground", f), join(OUT, "playground", f));
for (const f of readdirSync(join(import.meta.dir, "site/playground")).filter(f => f.endsWith(".yaml"))) {
  writeFileSync(join(OUT, "playground", f.replace(/\.yaml$/, ".json")), JSON.stringify(compileCompositeYaml(readFileSync(join(import.meta.dir, "site/playground", f), "utf8"), f)));
}
// A separate, optional vendor chunk; ordinary library pages never fetch ECharts.
const charts = await Bun.build({ entrypoints: [join(import.meta.dir, "site/vendors/echarts.ts")], outdir: join(OUT, "playground/vendor"), minify: true, target: "browser", ...production });
if (!charts.success) throw new AggregateError(charts.logs, "The optional chart demo didn't build");

// Lit's development build warns in the console and runs extra checks; none ships.
for (const dir of ["aster", "lib"]) {
  for (const file of new Bun.Glob("*.js").scanSync(join(OUT, dir))) {
    if (readFileSync(join(OUT, dir, file), "utf8").includes("Lit is in dev mode")) throw new Error(`${dir}/${file} has Lit's development build`);
  }
}

// The project and People pages are their own chunks, loaded on first visit.
const entry = /src="\.\/([^"]+\.js)"/.exec(await Bun.file(join(OUT, "aster/index.html")).text())?.[1];
const main = entry ? await Bun.file(join(OUT, "aster", entry)).text() : "";
for (const page of ["aster-project-page", "aster-people-page", "aster-showcase-page"]) {
  if (main.includes(`define("${page}"`) || main.includes(`"${page}",`)) throw new Error(`${page} is in the entry chunk`);
}

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
      .replace("<!--echarts-entry-source-->", () => "```typescript\n" + readFileSync(join(import.meta.dir, "site/vendors/echarts.ts"), "utf8") + "\n```")
      .replace("<!--composition-yaml-->", () => "```yaml\n" + readFileSync(join(import.meta.dir, "site/playground/composition.ui.yaml"), "utf8") + "\n```")
      .replace("<!--composition-model-->", () => "```javascript\n" + readFileSync(join(import.meta.dir, "site/playground/composition-model.js"), "utf8") + "\n```")
      .replace("<!--showcase-composition-source-->", () => "```typescript\n" + readFileSync(join(ROOT, "apps/aster/src/pages/showcase.ts"), "utf8") + "\n```")
      .replace("<!--showcase-preview-source-->", () => "```typescript\n" + readFileSync(join(ROOT, "apps/aster/src/pages/showcase-preview.ts"), "utf8") + "\n```")
      .replace("<!--composition-status-->", () => "```javascript\n" + readFileSync(join(import.meta.dir, "site/playground/composition-status.js"), "utf8") + "\n```")
      .replace("<!--first-grid-html-->", () => "```html\n" + readFileSync(join(import.meta.dir, "site/playground/first-grid.html"), "utf8") + "\n```")
      .replace("<!--first-grid-js-->", () => "```javascript\n" + readFileSync(join(import.meta.dir, "site/playground/first-grid.js"), "utf8") + "\n```");
    const heading = /^# (.+)$/m.exec(md)?.[1] ?? file;
    const body = (await marked.parse(md))
      .replace(/href="(\.\/)?([\w-]+)\.md(#[^"]*)?"/g, 'href="$2.html$3"')
      .replace(/href="\.\.\/([\w-]+)\/([\w-]+)\.md(#[^"]*)?"/g, (m, d, n, h = "") =>
        DOCS.includes(d) ? `href="${dir === "guide" && d !== "guide" ? `${REPO}${d}/${n}.md` : `../${d}/${n}.html`}${h}"` : m)
      .replace(/href="\.\.\/(?![\w-]+\/[\w-]+\.html|(?:reference|playground|lib)\/|#)([^"]+)"/g, `href="${REPO}$1"`);
    const name = basename(file, ".md");
    pages.push({ name, title: await marked.parseInline(heading) });
    writeFileSync(join(OUT, dir, `${name}.html`), dir === "guide"
      ? shell(heading.replaceAll("`", ""), `<p class="eyebrow">Aster UI / ${name === "connected-views" ? "How-to guides" : "Guides"}</p>${body}<footer class="article-footer">Continue exploring: <a href="../reference/">API reference</a> · <a href="../#showcase">Component showcase</a></footer>`)
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
const viewer = await Bun.build({ entrypoints: ["docs.ts", "viewer.ts", "docs.css"].map(f => join(import.meta.dir, "site/reference", f)), outdir: join(OUT, "docs-assets"), splitting: true, minify: true, ...production });
if (!viewer.success) throw new AggregateError(viewer.logs, "The reference viewer didn't build");
copyFileSync(join(import.meta.dir, "site/reference/brand/aster-logo.svg"), join(OUT, "docs-assets/aster-logo.svg"));
for (const family of ["geist", "ibm-plex-mono"]) copyFileSync(join(import.meta.dir, "site/reference/brand", family, "OFL.txt"), join(OUT, "docs-assets", `${family}-OFL.txt`));
mkdirSync(REF, { recursive: true });
writeFileSync(join(REF, "index.html"), shell("Documentation", "", "../docs-assets/viewer.js").replace('<body class="doc ref">', '<body class="doc ref" data-api>'));
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
writeFileSync(join(OUT, "guide/search.json"), JSON.stringify([...guidePages, ...examples.map(e => ({ name: e.name, description: e.description, href: `../examples/${e.id}.html`, kind: "Example" }))]));
buildExamples(ROOT, OUT);
writeFileSync(join(OUT, "guide/index.html"), shell("Guides", `<p class="eyebrow">Aster UI / Learn</p><h1>Build with Aster.</h1><p class="lead">Understand the model, run an example, then compose your own application.</p><div class="doc-cards">${guidePages.filter(p => !["../guide/data.html", "../guide/elements.html"].includes(p.href)).map(p => `<a class="doc-card" href="${p.href}"><strong>${p.name}</strong><span>Read the guide →</span></a>`).join("")}</div><h2>Implementation details</h2><p>Advanced guides explain how the data core and elements work internally.</p><div class="doc-cards">${guidePages.filter(p => ["../guide/data.html", "../guide/elements.html"].includes(p.href)).map(p => `<a class="doc-card" href="${p.href}"><strong>${p.name}</strong><span>Read the advanced guide →</span></a>`).join("")}</div>`));

copyFileSync(join(import.meta.dir, "site/site.css"), join(OUT, "site.css"));
const reviews = readdirSync(join(OUT, "reviews"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(OUT, "reviews", d.name, "index.html")))
  .map((d) => d.name)
  .sort();
const index = (await Bun.file(join(import.meta.dir, "site/index.html")).text())
  .replace(/<!--(\w+)-->/g, (m, dir: string) => lists[dir] ?? (["design", "requirements", "milestones"].includes(dir) ? "" : m))
  .replace("<!--reviews-->", reviews.map((r) => `<li><a href="reviews/${r}/">${r.toUpperCase()} review</a></li>`).join("") || "<li>None yet</li>");
writeFileSync(join(OUT, "index.html"), index);
const SHOWCASE = join(OUT, "showcase");
rmSync(SHOWCASE, { recursive: true, force: true });
stageSite(OUT, SHOWCASE);
const publicLinkProblems = checkPublicLinks(SHOWCASE);
if (publicLinkProblems.length) throw new Error(`Published documentation has broken links:\n${publicLinkProblems.join("\n")}`);
console.log(`wrote ${OUT}`);
