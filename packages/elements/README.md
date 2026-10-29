# @getaster/elements

Browser-native controls for metadata-driven enterprise applications: grids,
forms, pickers, filters, dashboards and workspaces. Controls share records and
edit state through `@getaster/data` and use CSS for layout and theming.

Aster is pre-1.0; production API stability is not yet promised. Experimental
controls are published separately in `@getaster/elements-preview`.

## Install

```sh
npm install @getaster/data @getaster/elements
```

Use a modern browser with custom elements and ES modules, plus a bundler that
resolves npm modules and CSS imports. The package ships TypeScript declarations.
Its main entry registers browser elements and requires a DOM; use
`@getaster/data` for headless work. Package tooling requires Node 22 or later.

## Connect a grid

With an OData service exposing a `Projects` entity set and JSON CSDL metadata:

```ts
import { DataContext, fetchTransport } from '@getaster/data';
import { Grid } from '@getaster/elements';
import '@getaster/elements/styles/aster-ui.css';

const ctx = await DataContext.connect(
  fetchTransport('https://your-service.example/odata/')
);
const grid = new Grid();
grid.ctx = ctx;
grid.set = 'Projects';
grid.label = 'Projects';
grid.style.height = '24rem';
document.body.append(grid);
```

Replace the endpoint and entity set with your own. Give a virtualized grid a
bounded height, and supply your application's theme tokens as described in the
[theming guide](https://ui.getaster.now/docs/guide/themes.html). When the view
closes, remove the element; separately owned data models remain the host's
responsibility.

## Compose an application

Use a shared data context to connect a grid, form and selection. JavaScript and
YAML composition support reusable workspace definitions. Controls provide
keyboard interaction and semantic markup; application labels, focus flow and
accessibility still need testing in the completed application.

The package depends on Aster's data core, Lit HTML and Preact signals. Keep one
compatible copy of each shared runtime in your build. The optional ECharts
adapter accepts an application-supplied runtime; ECharts, showcase data, fonts
and the mock service are not bundled into this package. There are no install
scripts.

## Documentation and support

- [Get started](https://ui.getaster.now/docs/guide/getting-started.html)
- [Connected views](https://ui.getaster.now/docs/guide/connected-views.html)
- [Workspace composition](https://ui.getaster.now/docs/guide/declarative-workspace.html)
- [API reference](https://ui.getaster.now/docs/reference/)
- [Interactive showcase](https://ui.getaster.now/showcase/)
- [Report a bug](https://github.com/GetAster/aster-ui/issues)

## License

Apache-2.0. See the included `LICENSE` and package-specific `NOTICE`.
Separately installed dependencies retain their own licenses.
