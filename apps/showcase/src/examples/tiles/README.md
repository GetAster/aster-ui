# Tile grids

Start with [tiles.js](tiles.js) and [tiles.html](tiles.html). The main example switches between folders and devices with configurable tiles and selection. `tiles-paged.js` supplies the larger paged fleet scenario.

Build from the repository root with `bun run site`. The example runs at
`/playground/tiles.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/tiles.spec.ts`.
