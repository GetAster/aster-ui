# Directory cards

Start with [dataview.js](dataview.js) and [dataview.html](dataview.html). The page supplies card templates and accessible descriptions, with collection filtering, sorting, selection and edits.

Build from the repository root with `bun run site`. The example runs at
`/playground/dataview.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/dataview.spec.ts`.
