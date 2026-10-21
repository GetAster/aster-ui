# Showcase application

This is a working Aster application and a collection of independent examples.
The source is organised by feature; the emitted URLs remain `/showcase/` and
`/playground/*.html`.

Start with [the shell definition](src/app/showcase.ui.yaml), then read its
[model](src/app/model.ts), [registry](src/app/registry.ts) and
[mounting code](src/app/main.ts). The shell uses the public composition APIs.

```text
src/
  app/                 Catalogue, YAML shell, routing, registry and shell views
  examples/            Independent, runnable component examples
    composition/       Device workspace: definition, model, registry, lazy views
    mail/              Mail workspace: definition, model, fixtures and styles
    foundations/       Fields, layouts, folder picker and contextual navigation
    collections/       Table and tiles over the same collection
    charts/            Third-party integration and optional vendor entry
  shared/navigation/   Appearance controls and navigation for standalone examples
  workspace/           Project workspace hosting the showcase alongside its features
    features/          Projects, people, tasks, model editor, time and reports
build/                 Bundling and the public filename compatibility manifest
```

`app/bootstrap.ts` starts the project workspace. Its route loader imports the
showcase shell on demand. The shell's catalogue supplies navigation and gallery
metadata; its YAML declares one reusable preview. Only the active example owns
an iframe. Appearance changes update that frame without restarting its data.
On small or touch displays, categories open full-page examples with a return link.

## Add or change an example

1. Put its HTML entry, JavaScript, YAML, mock data and styles in one feature folder.
   Small examples need only an entry and its presentation. Split models,
   registrations and views when those responsibilities become substantial.
2. Import the public packages. The static build supplies a browser import map;
   examples share the same library runtime rather than bundling their own copies.
3. Add the public filenames in `build/assets.ts`. Those aliases keep bookmarked
   URLs independent of the source tree. Shared navigation paths are rebased when
   staged; YAML definitions are compiled to `.ui.json` beside the entry.
4. Add discoverable category metadata in `src/app/catalogue.ts`. The gallery,
   navigation and preview model consume that list without another YAML edit.
5. Add a workflow test under `tests/e2e/`. For a documented example, add its
   editorial description and feature excerpts under `apps/docs/build/`.

Each example owns its data context, commands and cleanup. Share navigation and
appearance, rather than a global demo state object. Example code stays outside
the published npm packages.

Run `bun run site` from the repository root to build every example and the docs.
`bun run dev` runs the project workspace with hot reload. The Bun YAML plugin
validates and compiles the shell at build time; the browser does not load a YAML
parser. See [Bun's HTML plugin configuration](https://bun.sh/docs/bundler/fullstack).

For a local product-site preview, run `bun scripts/build-product-site.ts --stage-only`
after `bun run site`, then serve `dist-site/`.
