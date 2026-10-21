# Conversation reader preview

Start with [conversations.js](conversations.js) and [conversations.html](conversations.html). The page supplies local conversation adapters, passage actions and focused-reader commands. `conversations.css` owns example presentation. The conversation component itself is in the optional preview package.

Build from the repository root with `bun run site`. The example runs at
`/playground/conversations.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/conversations.spec.ts`.
