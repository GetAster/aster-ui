import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { shell } from "./docs/shell.ts";
import { checkPublicLinks } from "./docs/check-links.ts";

export const siteOrigin = "https://ui.getaster.now";

export function publishedPath(path: string): string {
  if (path === "/" || path === "/index.html") return "/showcase/";
  return path.replace(/^\/(guide|reference)(?=\/)/, "/docs/$1");
}

/** Resolve links against their original page before moving documentation. */
export function rebaseHTML(html: string, originalPath: string): string {
  return html.replace(/\b(href|src)=(['"])(.*?)\2/g, (match, attribute: string, quote: string, href: string) => {
    if (!href || href.startsWith("#") || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) return match;
    const url = new URL(href.replaceAll("&amp;", "&"), siteOrigin + originalPath);
    url.pathname = publishedPath(url.pathname);
    return `${attribute}=${quote}${(url.pathname + url.search + url.hash).replaceAll("&", "&amp;")}${quote}`;
  });
}

function* files(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
    else throw new Error(`Unsupported site entry: ${path}`);
  }
}

function productLinks(): string {
  return `<details class="product-switcher"><summary>Aster products</summary><ul><li><a href="https://getaster.now/">Aster product site</a></li><li><a href="/" aria-current="true">Aster UI</a></li><li><a href="https://sdk.getaster.now/docs/">Aster SDK</a></li><li>Aster WebData <small>Coming soon</small></li><li>Aster Exec <small>Coming soon</small></li><li>AgentXchange <small>Coming soon</small></li></ul></details>`;
}

const introduction = `<p class="eyebrow">Aster UI</p><h1>Keep your data and interface in sync</h1><p class="lead">A form saves a record. The grid, detail panel and chart should reflect that change. Aster UI provides a shared data model and browser-native controls to coordinate those interactions as your application grows.</p><div class="doc-actions"><a class="doc-action primary" href="../#showcase">Explore the showcase →</a><a class="doc-action" href="../guide/getting-started.html">Get started</a></div>`;
const capabilities = `<div class="doc-cards"><a class="doc-card" href="../examples/grid.html"><span class="card-index">COLLECTIONS</span><strong>Query and edit connected data</strong><span>Filter, sort, group, page and select records. Switch between tables and tiles using the same collection.</span></a><a class="doc-card" href="../examples/composition.html"><span class="card-index">COMPOSITION</span><strong>Declare how a workspace fits together</strong><span>Compose layouts with JavaScript or YAML. Connect controls through shared state and typed handlers.</span></a><a class="doc-card" href="../examples/mail.html"><span class="card-index">WORKFLOWS</span><strong>Preserve work through interruptions</strong><span>Retain drafts, selection and views. Try a mock mail application with authentication recovery.</span></a><a class="doc-card" href="../guide/themes.html"><span class="card-index">PRESENTATION</span><strong>Adapt controls to your application</strong><span>Use themes, keyboard interaction and reduced motion support across forms, navigation and data views.</span></a></div>`;
const docsHome = `<p class="eyebrow">Aster UI documentation</p><h1>Build connected interfaces</h1><p class="lead">Start with the data model, explore working examples, then compose the workflows your application needs.</p><div class="doc-cards"><a class="doc-card" href="../guide/why-aster.html"><strong>Why use Aster UI?</strong><span>Understand the coordination work that grows around a grid, form and detail view.</span></a><a class="doc-card" href="../guide/getting-started.html"><strong>Get started</strong><span>Run a complete example, then connect your own data.</span></a><a class="doc-card" href="../examples/"><strong>Learn from live examples</strong><span>Try the controls and inspect the code behind each behaviour.</span></a><a class="doc-card" href="../reference/"><strong>Browse the API reference</strong><span>Find typed properties, methods, events and source links.</span></a></div><h2>Develop a workspace</h2><p>Connect a <a href="../guide/connected-views.html">grid and form</a>, <a href="../guide/declarative-workspace.html">declare a layout</a>, or integrate <a href="../examples/charts.html">a chart with shared data</a>.</p>`;

export function stageProductSite(source: string, destination: string, version: string, revision: string): void {
  if (!/^(?:development|\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.test(version)) throw new Error("Invalid site release version");
  if (revision !== "working-tree" && !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Use the public source commit SHA or working-tree");
  if (existsSync(destination) && readdirSync(destination).length) throw new Error("Product site destination must be empty");
  mkdirSync(destination, { recursive: true });
  const areas = [["aster", "showcase"], ["guide", "docs/guide"], ["reference", "docs/reference"], ...["lib", "playground", "docs-assets", "examples"].map(name => [name, name])] as const;
  for (const [from, to] of areas) cpSync(join(source, from!), join(destination, to!), { recursive: true });
  cpSync(join(source, "site.css"), join(destination, "site.css"));
  const metadata = `<meta name="aster-site-layout" content="product"><meta name="aster-reference-root" content="docs/reference/"><meta name="aster-release-version" content="${version}"><meta name="aster-release-revision" content="${revision}">`;
  const decorate = (html: string, path: string) => html.replace("</head>", `${metadata}<link rel="canonical" href="${siteOrigin}${path}"></head>`);
  for (const path of files(destination)) {
    if (!path.endsWith(".html")) continue;
    const name = "/" + relative(destination, path).replaceAll("\\", "/");
    if (name.startsWith("/showcase/")) {
      writeFileSync(path, decorate(readFileSync(path, "utf8"), name.replace(/index\.html$/, "")));
      continue;
    }
    const original = name.replace(/^\/docs\/(guide|reference)\//, "/$1/");
    let html = rebaseHTML(readFileSync(path, "utf8"), original);
    html = html.replace(/(class="(?:ref-home|nav-overview)" href=")\/docs\/reference\/(?:index\.html)?"/g, '$1/docs/"');
    html = html.replace('<a class="header-showcase"', `${productLinks()}<a class="header-showcase"`);
    writeFileSync(path, decorate(html, name.replace(/index\.html$/, "")));
  }
  const receipt = `<p class="release-note">${version === "development" ? "Development build" : `Version ${version}${version.includes("-") ? " · Prerelease" : ""}`} · <a href="/deployment.json">Build details</a> · <a href="https://github.com/GetAster/aster-ui">Apache-2.0 source</a></p>`;
  for (const [path, title, body] of [["index.html", "Connected interfaces", introduction + capabilities], ["docs/index.html", "Documentation", docsHome]]) {
    let html = rebaseHTML(shell(title!, body! + receipt), "/reference/index.html");
    html = html.replace('class="ref-home" href="/docs/reference/"', 'class="ref-home" href="/docs/"').replace('class="nav-overview" href="/docs/reference/"', 'class="nav-overview" href="/docs/"');
    html = html.replace('<a class="header-showcase"', `${productLinks()}<a class="header-showcase"`);
    if (path === "index.html") html = html.replace('class="doc ref"', 'class="doc ref product-home"');
    const target = join(destination, path!); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, decorate(html, "/" + path!.replace(/index\.html$/, "")));
  }
  writeFileSync(join(destination, "404.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page not found · Aster UI</title><h1>Page not found</h1><p><a href="/docs/">Open Aster UI documentation</a> or <a href="/showcase/">explore the showcase</a>.</p></html>');
  writeFileSync(join(destination, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteOrigin}/sitemap.xml\n`);
  const pages = [...files(destination)].filter(path => path.endsWith(".html") && !path.endsWith("404.html")).map(path => siteOrigin + "/" + relative(destination, path).replace(/index\.html$/, ""));
  writeFileSync(join(destination, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(url => `<url><loc>${url}</loc></url>`).join("")}</urlset>`);
  const hashes = Object.fromEntries([...files(destination)].map(path => [relative(destination, path), createHash("sha256").update(readFileSync(path)).digest("hex")]));
  writeFileSync(join(destination, "deployment.json"), JSON.stringify({ site: siteOrigin, version, revision, files: hashes }, null, 2) + "\n");
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const option = (name: string, fallback: string) => process.argv[process.argv.indexOf(name) + 1] ?? fallback;
  const version = process.argv.includes("--version") ? option("--version", "") : "development";
  const revision = process.argv.includes("--revision") ? option("--revision", "") : "working-tree";
  if (!process.argv.includes("--stage-only")) {
    const build = Bun.spawnSync(["bun", "scripts/build-site.ts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (build.exitCode) process.exit(build.exitCode);
  }
  const destination = join(root, "dist-site");
  rmSync(destination, { recursive: true, force: true });
  stageProductSite(join(root, "dist-local"), destination, version, revision);
  const problems = checkPublicLinks(destination, [""]);
  if (problems.length) throw new Error(`Published site links failed:\n${problems.join("\n")}`);
  console.log(`Product site staged at ${destination}`);
}
