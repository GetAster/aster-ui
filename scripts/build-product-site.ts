import { productLinks, introduction, capabilities, docsHome } from "../apps/docs/src/templates/product.ts";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { shell } from "../apps/docs/src/templates/shell.ts";
import { checkPublicLinks } from "./docs/check-links.ts";
import { agentIndex, mapMarkdownLinks } from "../apps/docs/build/agent-docs.ts";

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

export function stageProductSite(source: string, destination: string, version: string, revision: string): void {
  if (!/^(?:development|\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.test(version)) throw new Error("Invalid site release version");
  if (revision !== "working-tree" && !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Use the public source commit SHA or working-tree");
  if (existsSync(destination) && readdirSync(destination).length) throw new Error("Product site destination must be empty");
  mkdirSync(destination, { recursive: true });
  const areas = [["aster", "showcase"], ["guide", "docs/guide"], ["reference", "docs/reference"], ...["lib", "playground", "docs-assets", "examples"].map(name => [name, name])] as const;
  for (const [from, to] of areas) cpSync(join(source, from!), join(destination, to!), { recursive: true });
  cpSync(join(source, "site.css"), join(destination, "site.css"));
  const metadata = `<meta name="aster-site-layout" content="product"><meta name="aster-reference-root" content="docs/reference/"><meta name="aster-release-version" content="${version}"><meta name="aster-release-revision" content="${revision}">`;
  const decorate = (html: string, path: string) => html.replace(/(<meta name="aster-docs-root" content=")[^"]*/, '$1/docs/').replace(/(<meta name="aster-docs-search" content=")[^"]*/, '$1/docs/guide/search.json').replace("</head>", `${metadata}<link rel="canonical" href="${siteOrigin}${path}"></head>`);
  for (const path of files(destination)) {
    if (path.endsWith(".md") && /\/docs\/(guide|reference)\//.test(path)) {
      const original = "/" + relative(destination, path).replace(/^docs\//, "");
      writeFileSync(path, mapMarkdownLinks(readFileSync(path, "utf8"), href => {
        if (!href || href.startsWith("#") || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) return href;
        const url = new URL(href, siteOrigin + original);
        return publishedPath(url.pathname) + url.search + url.hash;
      }));
      continue;
    }
    if (path === join(destination, "docs/guide/search.json")) {
      const index = JSON.parse(readFileSync(path, "utf8")) as { href: string }[];
      writeFileSync(path, JSON.stringify(index.map(item => {
        const url = new URL(item.href, `${siteOrigin}/guide/search.json`);
        return { ...item, href: publishedPath(url.pathname) + url.search + url.hash };
      })));
      continue;
    }
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
  writeFileSync(join(destination, "llms.txt"), agentIndex("docs/"));
  writeFileSync(join(destination, "docs/llms.txt"), agentIndex("", "../"));
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
