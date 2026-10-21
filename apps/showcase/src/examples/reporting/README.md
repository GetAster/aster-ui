# Grouped reports

Start with [reporting.js](reporting.js) and [reporting.html](reporting.html). The page owns grouping controls and export actions over a shared query. Server aggregates and paging stay in the data layer.

Build from the repository root with `bun run site`. The example runs at
`/playground/reporting.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/reporting.spec.ts`.
