# Editable playground

Start with [examples.js](examples.js) and [index.html](index.html). The HTML entry loads runnable examples from `examples.js` into an isolated iframe. Generated snippets use the standalone browser distribution.

Build from the repository root with `bun run site`. The example runs at
`/playground/index.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/playground.spec.ts`.
