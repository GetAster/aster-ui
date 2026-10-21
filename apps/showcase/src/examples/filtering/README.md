# Advanced filters

Start with [filtering.js](filtering.js) and [filtering.html](filtering.html). The page connects typed expression editing to the collection query, including declared field choices and relative values.

Build from the repository root with `bun run site`. The example runs at
`/playground/filtering.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/filtering.spec.ts`.
