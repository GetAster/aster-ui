# Device workspace

Start with [composition.js](composition.js) and [composition.html](composition.html). The host connects the context and mounts variants. Read `composition.ui.yaml` for structure, `composition-model.js` for queries, selection, commands and disposal, `composition-registry.js` for registrations and lazy loaders, and `composition-details.js` for the editor. `composition-mock.js` contains fixtures; `composition-status.js` declares a custom element.

Build from the repository root with `bun run site`. The example runs at
`/playground/composition.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/composition.spec.ts`.
