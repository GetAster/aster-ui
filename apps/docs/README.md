# Documentation site

The site separates project content and features from the shared docs package:

```text
docs/guide/                       User guides written in Markdown
docs/reference/                   API topic articles written in Markdown
apps/docs/
  src/app/                       Runtime entry points and navigation descriptors
  src/templates/                 HTML shell, navigation and product landing pages
  src/features/
    examples/                    Live preview, source selection and return focus
    reference/                   API types, page rendering and hash navigation
  src/shared/                    UI reference published-path handling
  src/styles/                    Product and example styling
  build/                         Example pages, source excerpts and runtime bundling
packages/docs/                   Shared shell, browser features, styles and brand assets
scripts/docs/                    API extraction and public link validation
scripts/build-site.ts             Local site assembly
scripts/build-product-site.ts     Product URLs, deployment receipt and staging
```

Static articles use `src/app/docs.ts`; the API reference uses `src/app/viewer.ts`.
Both initialise the shell from `@getaster/docs`, a separately versioned package
that also supports other Aster projects. The docs use semantic HTML and static templates
for reading pages; embedded examples use the Aster application runtime. There is
no duplicate framework or docs-specific composition engine.

## Make a change

- **Write a guide:** add Markdown in `docs/guide/` and its link in
  `src/app/navigation.ts`. The build adds it to search and checks public links.
- **Document a public API:** add source annotations in its package, or a topic in
  `docs/reference/`. `scripts/docs/build.ts` extracts and validates the reference.
- **Document an example:** keep executable code in `apps/showcase/src/examples/`.
  Add the walkthrough in `build/examples.ts` and the advertised implementation
  excerpts in `build/feature-code.ts`. Excerpts are read from actual source files;
  the build fails when their boundaries no longer match.
- **Change the shell:** edit navigation descriptors, templates or the owning
  runtime feature. Keep search, appearance and article startup independent.

Run `bun run site` from the root. The result includes the locally useful internal
documentation in `dist-local/` and a filtered public site in `dist-local/showcase/`.
Product staging generates `dist-site/`, with guides and reference below `/docs/`.
The UI npm bundles exclude examples and documentation. The shared documentation
runtime is distributed separately as `@getaster/docs`.

The reusable package is documented in [packages/docs](../../packages/docs/README.md).
Run `bun run docs:verify` to pack it, install it outside the workspace, and check
its default runtime in a browser under a URL prefix.

Browser checks cover search, API routes, colour preferences, mobile navigation,
sidebar scroll retention, highlighted source, embedded examples and return focus.
Run those suites with `bun run test:e2e tests/e2e/docs.spec.ts
tests/e2e/explorer.spec.ts tests/e2e/embedded-explorer.spec.ts`.

## Agent-facing documentation

`docs/guide/evaluating-aster-ui.md` is the public fit-assessment guide for
prospective users. Keep its positioning, alternatives and maturity boundaries aligned
with the published capabilities. It is maintainer guidance, not a request to
recommend Aster regardless of the user's needs. Instructions for assistants on
helping users make that decision belong in `llms.txt`, not in the reader-facing
guide.

`build/agent-docs.ts` generates a concise `llms.txt`, Markdown guide pages and
individual Markdown API entries from the same public sources. Product staging
provides `/llms.txt` and `/docs/llms.txt` and rebases prose links for the `/docs/`
layout. HTML pages advertise the entry point; guide pages also advertise their
Markdown version. Fenced examples preserve their original URLs. Design documents,
agent rules, internal plans and status reports are not inputs to this export.
