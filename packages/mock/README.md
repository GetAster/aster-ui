# @getaster/mock

A local OData service for Aster UI development, examples and integration tests.
The service runs in WebAssembly and exposes the same transport interface used
by `@getaster/data`, so a test can exercise metadata, queries and writes without
starting an HTTP server.

This is a development tool, not a production database or authorization boundary.
Aster is pre-1.0; APIs may change.

## Install

```sh
npm install @getaster/data
npm install --save-dev @getaster/mock
```

The package includes its WebAssembly binary and license notices. No Rust compiler
or install script is required. It provides ES modules and TypeScript declarations;
Node.js use requires Node 22 or later. Browser builds must serve the WASM asset
over HTTP or pass its bytes explicitly.

## Run a local service in Node.js

TypeScript projects using this Node.js example also need `@types/node` as a
development dependency.

```ts
import { readFileSync } from 'node:fs';
import { DataContext } from '@getaster/data';
import { createMockService } from '@getaster/mock';

const metadata = {
  $Version: '4.01',
  $EntityContainer: 'Demo.Container',
  Demo: {
    Project: {
      $Kind: 'EntityType', $Key: ['id'],
      id: { $Type: 'Edm.Int32' },
      name: { $Type: 'Edm.String' },
    },
    Container: {
      $Kind: 'EntityContainer',
      Projects: { $Collection: true, $Type: 'Demo.Project' },
    },
  },
};
const wasm = readFileSync(new URL(
  import.meta.resolve('@getaster/mock/wasm/odata_mock.wasm')
));
const mock = await createMockService({
  metadata, wasm,
  data: { Projects: [{ id: 1, name: 'First project' }] },
});
const ctx = await DataContext.connect(mock.transport);
const projects = ctx.collection({ set: 'Projects' });
try {
  await projects.view(0, 10);
  if (projects.error.value) throw projects.error.value;
  console.log(projects.items.value);
} finally {
  ctx.release(projects);
}
```

## Exercise application behaviour

`mock.faults.latencyMs` and `writeLatencyMs` simulate slow requests;
`mock.faults.failNext(503)` fails the next transport request. Use `mock.external()`
to simulate another user's write and test stale edits. ETags are opaque values:
preserve and return them rather than constructing them in tests.

Counts are exact by default. The optional `countEstimate` setting simulates an
estimate-producing service for client tests; it is not Web Data's normal count
behaviour. Optional storage supports persistence; `dump()`, `flush()` and
`reset()` let tests control state. Worker helpers are available for browser use.

## Documentation and support

- [Installation and distribution](https://ui.getaster.now/docs/guide/library.html)
- [Working browser example](https://ui.getaster.now/docs/guide/getting-started.html)
- [API reference](https://ui.getaster.now/docs/reference/)
- [Report a bug](https://github.com/GetAster/aster-ui/issues)

## License

Aster UI code is Apache-2.0; see `LICENSE` and `NOTICE`. The bundled WebAssembly
binary includes third-party components: their attribution inventory is in
`wasm/NOTICE`, with license texts in `wasm/licenses/`. Preserve these files when
redistributing the binary.
