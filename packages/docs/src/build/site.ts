import { createDiagramRenderer } from "./diagram.ts";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDocsAssets } from "./assets.ts";
import { renderMarkdown, searchText } from "./markdown.ts";
import { renderNavigation, renderShell, type NavigationGroup } from "./shell.ts";
import type { SearchItem } from "../features/search/index.ts";

export interface DocsPage {
  readonly source: string;
  readonly output: string;
}

export interface DocsSiteConfig {
  readonly root: string;
  /** A dedicated generated directory, replaced only after a successful build. */
  readonly outdir: string;
  readonly siteName: string;
  readonly description?: string;
  readonly wordmark?: string;
  readonly section?: string;
  readonly home: string;
  readonly navigation: readonly NavigationGroup[];
  /** Explicit publication list; unlisted Markdown is never discovered or exported. */
  readonly pages: readonly DocsPage[];
  readonly assets?: readonly { readonly source: string; readonly output: string }[];
}

const outside = (path: string) => isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`);

function outputPath(path: string): string {
  if (!path || path.includes("\\") || path.split("/").some(part => part === ".." || part === "." || !part) || isAbsolute(path)) throw new Error(`Invalid published path: ${path}`);
  if (/^(?:docs-assets(?:\/|$)|search\.json$)/.test(path)) throw new Error(`Reserved published path: ${path}`);
  return path;
}

function relativeHref(target: string, current: string): string {
  return relative(dirname(current), target).split(sep).map(encodeURIComponent).join("/") || "./";
}

/** Render an explicit source graph into a static site that can be hosted under any prefix. */
export async function buildDocsSite(config: DocsSiteConfig): Promise<void> {
  const root = realpathSync(resolve(config.root));
  const requestedOut = resolve(root, config.outdir);
  let ancestor = dirname(requestedOut);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const out = resolve(realpathSync(ancestor), relative(ancestor, requestedOut));
  if (out === root || outside(relative(root, out))) throw new Error("The docs output must be a dedicated directory within the project");
  const published = new Map<string, string>();
  const outputs = new Set<string>();
  const sourcePath = (path: string) => {
    const source = realpathSync(resolve(root, path));
    if (outside(relative(root, source))) throw new Error(`Documentation source is outside the project: ${path}`);
    if (!outside(relative(out, source))) throw new Error(`Documentation source is inside the output directory: ${path}`);
    return source;
  };
  const register = (source: string, output: string) => {
    outputPath(output);
    if (outputs.has(output) || published.has(source)) throw new Error(`Duplicate documentation source or output: ${output}`);
    for (const existing of outputs) if (existing.startsWith(output + "/") || output.startsWith(existing + "/")) throw new Error(`Conflicting published paths: ${output} and ${existing}`);
    outputs.add(output); published.set(source, output);
  };
  for (const page of config.pages) {
    if (!page.output.endsWith(".html")) throw new Error(`Documentation pages must end in .html: ${page.output}`);
    register(sourcePath(page.source), page.output);
  }
  for (const asset of config.assets ?? []) register(sourcePath(asset.source), asset.output);
  if (!outputs.has(config.home)) throw new Error(`The documentation home is not published: ${config.home}`);
  const fragmentLinks: { source: string; target: string; fragment: string }[] = [];
  const ids = new Map<string, Set<string>>();
  const pages: { output: string; html: string }[] = [];
  const index: SearchItem[] = [];
  for (const page of config.pages) {
    const source = sourcePath(page.source);
    const markdown = readFileSync(source, "utf8");
    const rendered = await renderMarkdown(markdown, {
      renderDiagram: createDiagramRenderer(root),
      resolveLink(href) {
        if (/^[a-z][\w+.-]*:|^\/\//i.test(href)) return href;
        const url = new URL(href, pathToFileURL(source));
        const target = fileURLToPath(url);
        const output = published.get(target);
        if (!output) throw new Error(`${page.source}: no published target for ${href}`);
        if (url.hash) fragmentLinks.push({ source: page.source, target, fragment: decodeURIComponent(url.hash.slice(1)) });
        return (target === source && !url.search ? "" : relativeHref(output, page.output)) + url.search + url.hash;
      },
    });
    ids.set(source, new Set(rendered.headings.map(heading => heading.id)));
    const navigation = config.navigation.map(group => ({ ...group, links: group.links.map(link => {
      const url = new URL(link.href, "https://docs.invalid/");
      if (url.origin !== "https://docs.invalid") return link;
      const output = decodeURIComponent(url.pathname.slice(1));
      if (!outputs.has(output)) throw new Error(`Navigation target is not published: ${link.href}`);
      return { ...link, href: relativeHref(output, page.output) + url.search + url.hash };
    }) }));
    pages.push({ output: page.output, html: renderShell(rendered.title, rendered.html, {
      siteName: config.siteName,
      ...(config.description ? { description: config.description } : {}),
      wordmark: config.wordmark ?? config.siteName,
      section: config.section ?? "Docs",
      homeHref: relativeHref(config.home, page.output),
      rootHref: relativeHref("index.html", page.output).replace(/index\.html$/, "") || "./",
      assetsHref: relativeHref("docs-assets/index.html", page.output).replace(/index\.html$/, ""),
      searchHref: relativeHref("search.json", page.output),
      navigationHtml: renderNavigation(navigation),
    }) });
    index.push({ name: rendered.title, description: searchText(markdown), href: page.output, kind: "Guide" });
  }
  for (const link of fragmentLinks) {
    if (!ids.get(link.target)?.has(link.fragment)) throw new Error(`${link.source}: no published heading #${link.fragment} in ${relative(root, link.target)}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  const staging = mkdtempSync(resolve(dirname(out), ".aster-docs-"));
  try {
    await buildDocsAssets(resolve(staging, "docs-assets"));
    for (const page of pages) {
      const destination = resolve(staging, page.output);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, page.html);
    }
    for (const asset of config.assets ?? []) {
      const destination = resolve(staging, asset.output);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(sourcePath(asset.source), destination);
    }
    writeFileSync(resolve(staging, "search.json"), JSON.stringify(index));
    rmSync(out, { recursive: true, force: true });
    renameSync(staging, out);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
