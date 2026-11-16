# Aster UI consumer template

A minimal, standalone Aster UI application. It connects a
[`DataContext`](https://ui.getaster.now/docs/reference/#class:DataContext) to the
WebAssembly OData mock, compiles a YAML screen with
[`compileCompositeYaml`](https://ui.getaster.now/docs/reference/#staticMethod:compileCompositeYaml),
and mounts it through the same registry and `Composite` runtime the library
uses. It is application code over the published packages: no Aster source
checkout, no build script from the Aster repository, no Rust.

## Run it

You need [Bun](https://bun.sh/) 1.2 or later.

```sh
bun install
bun run dev
```

Open **http://localhost:4200/**. The dev server bundles the page, serves the
mock engine at `/odata_mock.wasm`, and reloads on changes.

```sh
bun run build      # static bundle in dist/
bun run typecheck  # TypeScript, strict
bun run lint       # aster-lint: Aster elements and theme tokens, not hand-made controls
```

## Working with a coding agent

`bun install` also runs `aster-skill`, which places the Aster UI skill in
`.claude/skills/aster-ui` for Claude Code and `.agents/skills/aster-ui` for Codex
and other agents that read that folder. The skill matches the installed package
version: it tells the agent to build every screen through the data layer (the
mock until a real service exists), to look up the API in the installed
`custom-elements.json` and type declarations, and to run the checks below before
handing work back. `AGENTS.md` carries the same rules in brief. Run
`bunx aster-skill check` to confirm the copies are current.

After `bun run build`, serve `dist/` with `/odata_mock.wasm` beside
`index.html`; `build.ts` copies the engine there from the installed package.
Delete the mock and the WASM file when the application talks to a real service.

## What is in the template

| File | What it does |
| --- | --- |
| `index.html` | The page and its element. |
| `src/main.ts` | Creates the mock, connects a `DataContext`, validates the compiled YAML and mounts the workspace. |
| `src/screen.ui.yaml` | The screen: model bindings, a `Grid` child and its layout. Change this first. |
| `src/model.ts` | The model's collection and selection, and the component registry the YAML may use. |
| `src/mock.ts` | The CSDL JSON metadata and seed records for the local service. |
| `src/yaml-plugin.ts` | A Bun loader that compiles `.ui.yaml` imports with the shipped compiler at build time. |
| `src/styles.css` | One composed theme import, then application layout. |
| `serve.ts`, `build.ts` | Development server and static build. |
| `AGENTS.md`, `CLAUDE.md` | Rules for coding agents working in the project. |

The YAML may name only registered models, components and renderers.
`authoring.validate` reports an unknown name or property with the YAML file,
line and column before the model runs.

## Learn each part

- [Get started](https://ui.getaster.now/docs/guide/getting-started.html): the
  data context, a grid and the mock.
- [Declarative workspace](https://ui.getaster.now/docs/guide/declarative-workspace.html):
  YAML definitions, models, commands, layout and the compiler.
- [The shared data model](https://ui.getaster.now/docs/guide/data-model.html):
  collections, selection and edit state.
- [Installation and distribution](https://ui.getaster.now/docs/guide/library.html):
  package entry points and stylesheet layout.
- [Theming](https://ui.getaster.now/docs/guide/themes.html): the token contract
  behind `theme-lamplight.css` and `theme-harbour.css`.
- [Check an application](https://ui.getaster.now/docs/guide/aster-lint.html):
  what `bun run lint` checks and how to record an exception.
- [The mock service](https://ui.getaster.now/docs/reference/mock.html): faults,
  storage and the WASM location and route contract.

## Talk to a real service

Replace the mock setup in `src/main.ts`:

```ts
import { DataContext, fetchTransport } from "@getaster/data";

const ctx = await DataContext.connect(
  fetchTransport("https://your-service.example/odata/"),
);
```

Keep the rest: change the entity set and fields in `src/screen.ui.yaml` and
`src/model.ts` to match your metadata. The application configures authentication
and CORS, and the service must support the operations you enable.

## Eject from the template

There is nothing to unwrap. Copy this directory into your application, remove
`node_modules/`, `dist/` and any repository remote you do not want, rename the
`package.json`, and keep the files you use. The template pins the 0.4 release
line from 0.4.59 (`^0.4.59`, the first release with `aster-skill`); `bun update
@getaster/data @getaster/elements @getaster/mock` moves within it, and reinstalls
the matching skill. Read the release notes before moving to a new minor line.

All four packages, `@getaster/data`, `@getaster/elements`,
`@getaster/elements-preview` and `@getaster/mock`, are released together at one
version and pin each other exactly; keep them at the same version. The template
leaves out the experimental `@getaster/elements-preview`; add it at the same
version when you need it.

A dependency cooldown (in your package manager or a guard such as PMG) delays
new versions for several days, so installs resolve the previous release for a
while. That is the policy doing its job: use the release it allows, or ask
whoever owns the policy whether an exception is warranted.

## Problems and questions

Report problems and ask questions in the [Aster UI repository](https://github.com/GetAster/aster-ui): [Report a problem](https://ui.getaster.now/docs/guide/support.html) covers issues, discussions and private security reports.

## License

The template is application code you may copy and modify. Aster UI packages are
Apache-2.0; the bundled fonts are under the SIL Open Font License, with their
licenses inside the `@getaster/elements` package.
