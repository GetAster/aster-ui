# Device tabs

Start with [tabs.js](tabs.js) and [tabs.html](tabs.html). The page owns tab descriptors, selection and close decisions. Lazy panel factories retain their drafts while the owning descriptors remain present.

Build from the repository root with `bun run site`. The example runs at
`/playground/tabs.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/tabs.spec.ts`.
