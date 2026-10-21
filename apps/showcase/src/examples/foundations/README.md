# Fields and layouts

Start with [foundations.js](foundations.js) and [foundations.html](foundations.html). The page owns the project editor, retained settings and contextual navigation. `folder-picker.js` owns the folder-selection workflow and lazy mock loading. Its styles stay in `folder-picker.css`.

Build from the repository root with `bun run site`. The example runs at
`/playground/foundations.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/foundations.spec.ts`.
