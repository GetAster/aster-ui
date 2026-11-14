# List editor, row by row

Start with [list-editor.js](list-editor.js) and [list-editor.html](list-editor.html). A field list reads in the page's own layout and edits one row at a time (`editing = "row"` with a `row` template), keeps a single selection, and takes new rows only from the page's own Add menu (`chrome.add = false`, a button with `popup` and `expanded` bound to the menu's `opened`).

Build from the repository root with `bun run site`. The example runs at
`/playground/list-editor.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`.

The checks are in `tests/e2e/list-editor.spec.ts`.
