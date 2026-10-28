# @getaster/docs

Shared static documentation machinery for Aster projects: the page shell, brand
assets and fonts, responsive navigation, light/dark appearance, keyboard search,
article contents, highlighted code and copy buttons. It builds static files with
Bun; the deployed site needs only a static host. It has no dependency on Aster UI
controls, the data core, the showcase or Rust tooling.

## Build a documentation site

Install a pinned package version as a development dependency and run a build
script with Bun. During local development, install the tarball produced by
`bun run docs:package` instead of a registry version:

```sh
bun add --dev /path/to/getaster-docs-0.1.0.tgz
bun scripts/build-docs.ts
```

For a published version, use `bun add --dev --exact @getaster/docs@0.1.0`.
Version 0.1.0 is prepared locally; preparing a tarball does not publish it.

```ts
// scripts/build-docs.ts
import { buildDocsSite } from "@getaster/docs";
import { resolve } from "node:path";

await buildDocsSite({
  root: resolve(import.meta.dir, ".."),
  outdir: "dist/docs",
  siteName: "Aster Project",
  description: "Documentation for Aster Project.",
  wordmark: "Aster Project",
  section: "Docs",
  home: "index.html",
  navigation: [{ label: "Start", links: [
    { href: "index.html", label: "Overview" },
    { href: "guides/install.html", label: "Install" },
  ] }],
  pages: [
    { source: "README.md", output: "index.html" },
    { source: "docs/install.md", output: "guides/install.html" },
  ],
  assets: [{ source: "LICENSE", output: "LICENSE" }],
});
```

`pages` and `assets` are explicit publication lists. Links in Markdown resolve
against source files and are rewritten to their configured output paths. Missing
published destinations and Markdown heading fragments fail the build. Output
paths and source files must stay within the project. `outdir` is a dedicated
generated directory: a successful build replaces it, removing stale files; a
failed render or asset build preserves the previous site.

Navigation links use paths relative to the documentation root. Articles, search,
fonts and runtime assets use relative URLs, so the output can be hosted under a
prefix such as `/products/project/docs/`. Heading IDs are generated at build time,
including distinct IDs for repeated headings. Ordinary Markdown builds escape raw
HTML and omit HTML comments. The content is project-controlled; this package is
not an HTML sanitizer for untrusted input.

## Integrate an existing site

The primitives can be adopted without replacing a project's content pipeline:

- `renderShell(title, bodyHtml, config, page?)` renders the common shell.
- `renderNavigation(groups, overview?, afterHtml?)` renders navigation groups.
- `renderMarkdown(markdown, { resolveLink?, allowHtml? })` returns HTML, the page
  title and heading metadata. Enable raw HTML only for trusted project content.
- `buildDocsAssets(outdir, { entrypoints?, stylesheets?, conditions?, define? })`
  bundles the default runtime or project entry points and copies licensed fonts,
  the Aster logo and the default theme.
- `searchText(markdown)` produces searchable prose.

`@getaster/docs/browser` exports `initDocs`, `enhanceArticle`, `enhanceCode` and
`restoreNavigationScroll`. A custom article entry point can initialise the shell,
enhance its article and then initialise project features. `initDocs` accepts an
optional `onAppearanceChange(scheme)` callback for project integrations such as
embedded examples. Routed pages set `data-docs-routed` on the body to preserve
their route hash when navigating article sections.

`@getaster/docs/search` exports `createSearchIndex`, `searchExcerpt` and the
`SearchItem` type for custom search feeds. Search item URLs resolve relative to
the search index URL. `@getaster/docs/browser-paths` exposes `documentationRoot`;
`@getaster/docs/html` exposes the HTML escaping and DOM query helpers used by
custom browser features.

The shell records document-root and search-feed URLs in `aster-docs-root` and
`aster-docs-search` meta elements. A deployment that relocates pages must update
these along with page links. The default styles are available under
`@getaster/docs/styles/*`; custom sites can supply their own theme before
`docs.css`. The default theme uses the same Aster colour tokens as Aster UI but
is distributed independently. Font files retain their SIL Open Font Licences.

The body, navigation HTML and optional head additions passed to `renderShell`
must already be trusted HTML. Text configuration values are escaped. Projects
own their content, navigation, product pages, API generation, live examples,
agent-facing documentation and deployment configuration.

## Package and check

From the Aster UI workspace:

```sh
bun test packages/docs
bun run docs:package
```

The second command compiles JavaScript and TypeScript declarations, includes
styles, fonts and licence notices, and writes
`dist-docs/getaster-docs-0.1.0.tgz`. It does not run UI, WASM or Rust builds and
does not publish to a registry. The docs package version is independent of the
Aster UI package release version.

## Diagrams

Use a `diagram` fence with a project-relative SVG path and a required one-sentence
text description. `buildDocsSite` inlines the SVG at build time; no diagram runtime
is downloaded. The description becomes the accessible name, visible caption and
searchable text. Explain complex relationships in the surrounding prose as well.

````md
```diagram
{
  "source": "docs/diagrams/read.svg",
  "narrow": "docs/diagrams/read-narrow.svg",
  "description": "The caller's rules are applied before queries reach each database."
}
```
````

`narrow` is optional. CSS selects it when the figure's available width is 600 px
or less. Give both variants the same meaning. They share one accessible name;
only one visual variant is displayed. SVGs retain their viewBox width in CSS
pixels so labels do not shrink. Wide diagrams scroll inside a keyboard-focusable
box. Design narrow variants around a 280 px width and use at least 14-unit text.

An SVG supplies geometry; the package supplies scoped `panel`, `step`, `arrow`,
`arrowhead`, `label` and `note` classes. For example:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 120">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto">
      <path class="arrowhead" d="M0 0L10 5L0 10Z"/>
    </marker>
  </defs>
  <rect class="step" x="10" y="10" width="260" height="40" rx="6"/>
  <text class="label" x="140" y="36" text-anchor="middle">Apply rules</text>
  <path class="arrow" d="M140 50V82" marker-end="url(#arrow)"/>
  <text x="140" y="108" text-anchor="middle">Query the database</text>
</svg>
```

Diagram colours inherit the light/dark theme through `--diagram-text`,
`--diagram-note`, `--diagram-line`, `--diagram-accent` and `--diagram-fill`.
Override these in the site's stylesheet, scoped to `.docs-diagram`, when needed.
Avoid hard-coded colours. Use shared styles instead of embedded `<style>` tags;
SVG root attributes other than `viewBox` are replaced by the renderer. Root
`title`/`desc` content is replaced by the block's description. IDs and local
`url(#id)` / `href="#id"` references are namespaced per instance and variant.
Use ordinary quoted attributes and simple IDs; interactive SVGs are unsupported.

SVG inputs are trusted, project-owned source files, not uploads. Sources must
remain inside the project, including symlink targets. Missing files, descriptions,
viewBoxes or local ID references fail the build. This is not an SVG sanitizer.
Ordinary Markdown still escapes raw HTML.

For a custom pipeline, create one renderer **per page**:

```ts
import { createDiagramRenderer, renderMarkdown } from "@getaster/docs";
const page = await renderMarkdown(markdown, {
  renderDiagram: createDiagramRenderer(projectRoot),
});
```

Use `searchText(markdown)` from the package to retain diagram descriptions in a
custom search feed. Check both themes, repeated diagrams and a 375 px viewport
before publishing.

### Web Data migration

1. Install the rebuilt docs package. Replace the pipeline's `chart` fence with
   the `diagram` JSON block above, using `docs/diagrams/request-pipeline.svg`.
2. Remove the SVG's embedded styles. Keep its coordinates and shared classes;
   change heading/strong text to `label`, and move any project-specific styling
   into the site's stylesheet under `.docs-diagram`. Remove hard-coded colours.
3. Add a 280 px-wide vertical SVG with the same steps and database branches;
   reference it as `narrow`. Keep labels at least 14 units.
4. In the custom Markdown pipeline, route diagram blocks through the shared
   `renderMarkdown` renderer and use the shared `searchText`. Retain the existing
   capture and chart handling for other content. Load the package's `docs.css`.
5. Keep the explanation of rules-before-splitting next to the figure. Check both
   themes, narrow screens and repeated embeds before deploying.
