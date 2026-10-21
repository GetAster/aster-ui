# Application windows

Start with [windows.js](windows.js) and [windows.html](windows.html). The page registers durable window content, close guards and layout persistence with Workspace. The shared component handles window interactions.

Build from the repository root with `bun run site`. The example runs at
`/playground/windows.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/window.spec.ts`.
