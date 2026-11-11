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
line from 0.4.23 (`^0.4.23`, the first release with `aster-lint`); `bun update
@getaster/data @getaster/elements @getaster/mock` moves within it. Aster is pre-1.0, so read
the release notes before a minor upgrade.

All four packages, `@getaster/data`, `@getaster/elements`,
`@getaster/elements-preview` and `@getaster/mock`, are released together at one
version and pin each other exactly; keep them at the same version. The template
leaves out the experimental `@getaster/elements-preview`; add it at the same
version when you need it.

A dependency cooldown (in your package manager or a guard such as PMG) can hide
a new release for several days: installs resolve the previous version and
`npm view` does not list the new one. Exempt the `@getaster` packages from the
cooldown while keeping malware checks, or install each package's tarball URL,
`https://registry.npmjs.org/@getaster/<name>/-/<name>-<version>.tgz`, e.g.
`bun add https://registry.npmjs.org/@getaster/elements-preview/-/elements-preview-0.4.0.tgz`.

## License

The template is application code you may copy and modify. Aster UI packages are
Apache-2.0; the bundled fonts are under the SIL Open Font License, with their
licenses inside the `@getaster/elements` package.
