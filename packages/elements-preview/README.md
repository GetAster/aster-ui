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

## Conversation reader

The first experiment exports `ConversationSession` and `ConversationReader`.
See [the guide](../../docs/guide/conversation-preview.md) and
[guide](../../docs/guide/conversation-preview.md). Import its stylesheet explicitly:

```ts
import { ConversationSession, ConversationReader } from '@getaster/elements-preview';
import '@getaster/elements-preview/styles/conversation.css';
```

DOM-free session types are also available from `@getaster/elements-preview/conversation`.
The browser distribution uses a separate `aster-ui-preview.js` and stylesheet,
sharing the stable module's runtime. Existing integrations, including ECharts,
remain in place while future integrations inform packaging decisions.
