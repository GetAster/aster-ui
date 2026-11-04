# Aster UI

[![npm @getaster/data](https://img.shields.io/npm/v/@getaster/data?label=%40getaster%2Fdata)](https://www.npmjs.com/package/@getaster/data)
[![npm @getaster/elements](https://img.shields.io/npm/v/@getaster/elements?label=%40getaster%2Felements)](https://www.npmjs.com/package/@getaster/elements)
[![npm @getaster/mock](https://img.shields.io/npm/v/@getaster/mock?label=%40getaster%2Fmock)](https://www.npmjs.com/package/@getaster/mock)

Aster UI connects grids, forms, trees and other application controls to a shared
data model. Filtering, selection, edits and request state stay consistent across
views. Use TypeScript and custom elements directly, or compose workspaces in
YAML with typed JavaScript handlers.

[Documentation and live examples](https://ui.getaster.now/) ·
[Getting started](docs/guide/getting-started.md)

## Run locally

Install [Bun 1.4.3](https://bun.sh/) (the version used in CI), then:

```sh
bun install --frozen-lockfile
bun run verify:wasm
bun run dev                 # http://localhost:4173/
bun run check               # types, dependency boundaries and tests
bun run site                # static showcase in dist-local/showcase/
```

The supplied OData mock engine is a WebAssembly binary. Rust source and a Rust
compiler are not needed to build or test this checkout. Its checksum and
third-party notices are in [packages/mock/wasm](packages/mock/wasm/NOTICE).

For browser tests, install Playwright browsers with `bunx playwright install`,
then run `bun run test:e2e`. Visual baselines were captured on macOS; on another
platform, `bun run test:e2e --ignore-snapshots` runs behavioural assertions.

## Packages

- `@getaster/data`: data collections, editing, selection and shared state.
- `@getaster/elements`: stable controls and application composition.
- `@getaster/elements-preview`: experimental controls with evolving APIs.
- `@getaster/mock`: the optional OData mock wrapper and engine binary.

Install the current release:

```sh
npm install @getaster/data @getaster/elements
```

Add the mock or preview controls separately when needed. Aster is pre-1.0 and
its APIs may evolve; the preview package has intentionally experimental APIs.
To produce compiled ESM packages, declarations, styles and local tarballs:

```sh
bun run version:build
bun run packages:build
```

Versions follow `<major.minor>.<commit-count - offset>` using `VERSION`.
Public source snapshots include `BUILD_NUMBER` from the originating repository,
so a shallow checkout or downloaded archive derives the same version. Local
source checkouts without `BUILD_NUMBER` need full Git history. CI adds
`-preview.<run-number>` for preview releases; stable releases use the base version.
The release workflow derives one version for all four packages and the website.

Outputs go to `dist-release/`; this command does not publish anything. See the
[package guide](docs/guide/library.md) for browser usage and component setup.

## Releases

The repository's package manifests stay `0.0.0` and private; npm versions are
derived and shared by all four packages:

- `VERSION` holds the `<major.minor>` line and a commit-count offset.
  `bun run version:build` prints `<major.minor>.<commit count - offset>`. The
  npm badges above and `npm view @getaster/elements version` show what is
  published.
- A release run derives one version, builds every package and the matching
  website, then publishes stable versions under `latest` and previews as
  `<version>-preview.<run>` under `next`. Its dry-run input builds and checks
  everything without publishing. It also scans dependencies, verifies the WASM
  artifact and checks a fresh package consumer and the consumer template.
- To start a new minor line, change the major/minor in `VERSION` and set the
  offset to the commit count at that change, then verify with
  `bun run version:build`. Never rewrite a published version.
- User-facing changes are recorded in [CHANGELOG.md](CHANGELOG.md); the release
  notes are curated there rather than generated from the commit log.

The standalone consumer template lives in
[templates/consumer](templates/consumer/README.md) and is published separately
as [GetAster/aster-ui-template](https://github.com/GetAster/aster-ui-template).

## License

Aster UI is licensed under [Apache-2.0](LICENSE). The optional mock engine is
supplied as an Apache-2.0-licensed WebAssembly binary; its implementation source
is not included. Bundled third-party components retain their respective licenses;
see [NOTICE](NOTICE) and the binary's attribution inventory. ECharts is an
optional, separately loaded runtime.

## Build the documentation and showcase

`bun run site:release` builds the public website into `dist-site/`, including
the showcase, guides and API reference. Serve it locally with
`PORT=4190 bun scripts/serve-static.ts dist-site --strict`.

Release builds accept `--version <version> --revision <public-commit-sha>` so
the website identifies the matching npm packages and public source.
`bun run test:site` checks the published routes on desktop and mobile.

## Reference applications

The [showcase](apps/showcase/README.md) is organised by feature. Its shell is
[declared in YAML](apps/showcase/src/app/showcase.ui.yaml), with ordinary
TypeScript for the model, registry and routing. Independent examples keep their
entry, model, definition, mock data and styles in the same feature folder.

The [documentation site](apps/docs/README.md) separates content, templates,
navigation, search, API rendering and live example/source browsing. Read
[Organize an application](docs/guide/application-structure.md) for the conventions
used by both sites. These application sources are separate from the npm packages.
