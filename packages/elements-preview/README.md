# @getaster/elements-preview

Experimental Aster controls and component integrations. APIs may change or be
removed; inclusion here is not a commitment to ship them in the stable library.

Experiments use the public APIs of `@getaster/data` and `@getaster/elements` and
follow the same ownership, accessibility, reduced-motion and CSS layout rules.
Stable packages must not depend on this package. Applications opt in explicitly;
preview exports are not re-exported by `elements` or the standard browser bundle.

Keep application examples, sample data and showcase-specific composition in
`apps/` or `scripts/site/`. This package is for reusable experiments.

Each experiment should describe its purpose, known limitations and checks needed
for adoption. Promote it to a stable package after review, or remove it when it
does not justify keeping. Vendor dependencies remain optional where practical.

## Install and compatibility

```sh
npm install @getaster/data @getaster/elements @getaster/elements-preview
```

Use matching Aster package versions. The browser entry requires a modern browser
with custom elements and ES modules. A bundler resolves the npm and CSS imports.
TypeScript declarations are included; package tooling requires Node 22 or later.
There are no install scripts. Load the stable base styles and application theme
before the preview stylesheet.

## Conversation reader

The first experiment exports `ConversationSession` and `ConversationReader`.
See [the conversation guide](https://ui.getaster.now/docs/guide/conversation-preview.html). Import its stylesheet explicitly:

```ts
import { ConversationSession, ConversationReader } from '@getaster/elements-preview';
import '@getaster/elements-preview/styles/conversation.css';
```

DOM-free session types are also available from `@getaster/elements-preview/conversation`.
The browser distribution uses a separate `aster-ui-preview.js` and stylesheet,
sharing the stable module's runtime. Existing integrations, including ECharts,
remain in place while future integrations inform packaging decisions.

## Ownership and limitations

Supply a conversation adapter that opens a window and loads older/newer entries.
The application owns its root `ConversationSession` and calls `dispose()` when
leaving the workspace. The reader owns context sessions it creates. Give the
reader a bounded CSS height so history can scroll within the page.

The reader supports bounded history, drafts, discussion contexts and a reading
overlay. It does not provide a chat backend, durable delivery, authorization or
reload persistence. The adapter must handle write safety, ordering, revision
conflicts and reconnection gaps. The
[guide's adapter example](https://ui.getaster.now/docs/guide/conversation-preview.html#supply-a-conversation-window-adapter)
shows the complete connection contract.

## Documentation and support

- [Conversation reader guide](https://ui.getaster.now/docs/guide/conversation-preview.html)
- [Live example](https://ui.getaster.now/docs/playground/conversations.html)
- [API reference](https://ui.getaster.now/docs/reference/)
- [Report a bug](https://github.com/GetAster/aster-ui/issues)

## License

Apache-2.0. See the included `LICENSE` and package-specific `NOTICE`.
Separately installed dependencies retain their own licenses.
