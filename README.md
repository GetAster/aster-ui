# Aster UI

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

The initial npm release is `0.1.0-preview.0`, available under the `next` tag:

```sh
npm install @getaster/data@next @getaster/elements@next
```

Add the mock or preview controls separately when needed. These releases are
prereleases; the preview package also has intentionally experimental APIs.
To produce compiled ESM packages, declarations, styles and local tarballs:

```sh
bun run packages:build --version 0.1.0-preview.0
```

Outputs go to `dist-release/`; this command does not publish anything. See the
[package guide](docs/guide/library.md) for browser usage and component setup.

## License

Source code and the supplied mock WebAssembly binary are licensed under
[Apache-2.0](LICENSE). The engine's Rust source is not included. Third-party
components retain their own licenses; see [NOTICE](NOTICE) and the binary's
attribution inventory. ECharts is an optional, separately loaded runtime.

## Build the documentation and showcase

`bun run site:release` builds the public website into `dist-site/`, including
the showcase, guides and API reference. Serve it locally with
`PORT=4190 bun scripts/serve-static.ts dist-site --strict`.

Release builds accept `--version <version> --revision <public-commit-sha>` so
the website identifies the matching npm packages and public source.
`bun run test:site` checks the published routes on desktop and mobile.
