# Shared collections

Start with [collection-demo.js](collection-demo.js) and [collection-demo.html](collection-demo.html). The page binds one collection and selection to a table and tile grid. It owns mock setup, query controls and a retained editor. `collection-demo.css` owns the two-view presentation.

Build from the repository root with `bun run site`. The example runs at
`/playground/collection-demo.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/shared-views.spec.ts`.
