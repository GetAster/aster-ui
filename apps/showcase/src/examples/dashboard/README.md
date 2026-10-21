# Dashboard workspace

Start with [dashboard.js](dashboard.js) and [dashboard.html](dashboard.html). The page owns widget factories, shared data, filters and saved layout choices. Factories return their own disposers; moving a widget retains its session.

Build from the repository root with `bun run site`. The example runs at
`/playground/dashboard.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/dashboard.spec.ts`.
