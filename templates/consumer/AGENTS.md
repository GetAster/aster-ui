# AGENTS.md

This application is built with Aster UI. Read the `aster-ui` skill before
changing a screen; `bun install` places it in `.claude/skills/aster-ui` and
`.agents/skills/aster-ui`.

- Every screen reads its records through the `DataContext`, including mockups
  and prototypes. Add data to the mock's metadata and seed in `src/mock.ts`;
  never put records into an element or write a static table.
- Leave paging, sorting, filtering, selection, drafts, validation and refresh
  after save to the data layer: collections, `Selection`, `PageScope` and
  `EditModel`.
- Configure elements through properties (`props:` in YAML, `.prop=${}` in
  lit-html), never attributes. Use Aster elements, not native or hand-made
  controls, and style with theme tokens.
- Look up the API in `node_modules/@getaster/elements/custom-elements.json` and
  the packages' `.d.ts` files rather than guessing.
- Before handing work back, run `bun run typecheck`, `bun run lint` and
  `bun run build`, and try the screen in the browser.
