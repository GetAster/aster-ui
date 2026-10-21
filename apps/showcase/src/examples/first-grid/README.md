# Project grid

Start with [first-grid.js](first-grid.js) and [first-grid.html](first-grid.html). This deliberately small entry connects a mock service and renders one data-bound grid. The getting-started guide reads both its JavaScript and emitted HTML.

Build from the repository root with `bun run site`. The example runs at
`/playground/first-grid.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/docs.spec.ts`.
