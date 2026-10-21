# Organize an application

Group an application's code by the work it does. Keep a screen's definition,
model, registered components and views together, so you can understand or change
that screen without searching a collection of unrelated files.

The [showcase source](https://github.com/GetAster/aster-ui/tree/main/apps/showcase)
uses this convention:

```text
src/
  app/
    showcase.ui.yaml
    main.ts
    model.ts
    registry.ts
    routing.ts
    catalogue.ts
    views/
  examples/
    composition/
      composition.html
      composition.js
      composition.ui.yaml
      composition-model.js
      composition-registry.js
      composition-details.js
      composition-mock.js
    mail/
    foundations/
  shared/
    navigation/
```

These are application conventions, not required filenames. Use JavaScript or
TypeScript; begin with fewer files and separate responsibilities as they grow.
A small field example does not need a registry, model factory and view directory.

## Keep structure and behaviour close

A **definition** declares named children, properties, bindings, layout and rules.
The showcase shell's YAML declares a sidebar, gallery and lazy preview. It does
not contain a second copy of the catalogue or executable functions.

A **model** owns queries, selection, edit state, commands and cleanup. Derived
signals express what the screen should show. In the showcase, the selected route
determines the preview title, filename and active deck surface.

A **registry** connects names in the definition to trusted functions, components
and module loaders. Keep custom rendering functions and lazy factories beside
their screen. YAML can refer to those registrations; it cannot evaluate code.

The **entry point** supplies inputs, mounts the composition and connects browser
events to application actions. Keep route and history handling explicit. Release
the composition when its host disconnects, and release subscriptions or services
owned by the application separately.

See [Compose a workspace](declarative-workspace.md) for the APIs and
[Customize workspaces](workspace-patterns.md) for variants and ownership.

## Share deliberate boundaries

Keep feature-specific fixtures, styles and renderers in their feature folder.
Move a module to `shared/` when several features need the same behaviour. Shared
navigation and appearance are useful; one global object holding every screen's
query, draft and selection makes ownership harder to follow.

The showcase's standalone examples import the public packages. Its static build
provides a browser import map and compiles YAML to JSON. A build manifest maps
feature files to stable example URLs, so reorganizing source does not invalidate
bookmarks. Your application can instead use its normal bundler and router.

## Keep documentation connected to working code

The documentation site lives in `apps/docs/`. Reading pages use static HTML;
interactive examples run the same code as the showcase. Search, navigation,
appearance, article enhancement and API rendering have separate modules.

Guides live in `docs/guide/`. Example walkthroughs read their feature excerpts
from executable source, and API pages are extracted from the public packages.
The build checks source boundaries and public links. This keeps the explanation,
the running example and the reference tied to the same implementation.
