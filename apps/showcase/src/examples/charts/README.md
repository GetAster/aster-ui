# Connected charts

Start with [components.js](components.js) and [components.html](components.html). The page supplies ECharts options and actions around shared queries and selection. `vendor/echarts.ts` is the optional vendor entry. The adapter belongs to the elements package; this feature owns its use and mock fixtures.

Build from the repository root with `bun run site`. The example runs at
`/playground/components.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/components.spec.ts`.
