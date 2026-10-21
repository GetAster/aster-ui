# Conversation reader preview

`@getaster/elements-preview` contains an experimental conversation reader for
chat, email, topics and ticket activity. It loads a recent window, preserves the
visible message when history or content height changes, and retains drafts while
opening a related discussion. APIs may change or be removed.

[Try the live preview](../playground/conversations.html). The example uses simulated
data and delivery; it does not contact a conversation service or send email.

## Load the optional module

```ts
import { ConversationSession, ConversationReader } from '@getaster/elements-preview';
import '@getaster/elements-preview/styles/conversation.css';
```

Load the ordinary Aster theme/base styles too. For the browser distribution,
import `../lib/aster-ui-preview.js` after the stable module and load
`../lib/aster-ui-preview.css`. Stable pages do not fetch the optional module.
For server-side/headless code, import the session from
`@getaster/elements-preview/conversation` without registering DOM elements.

## Supply a conversation window adapter

Adapters provide latest/around-entry windows and both paging directions. Entries
have stable IDs, deterministic lexically ordered `order` strings, and opaque
per-entry boundary cursors that the adapter accepts for both older and newer requests.
Do not use display time as the ordering key. Each window states whether earlier
or later entries exist; exact counts are unnecessary.

For example, an application's HTTP adapter can translate the requests below to
its own endpoint. These URLs illustrate an application contract, not a supplied
Aster server endpoint:

```ts
import type { ConversationAdapter, ConversationWindow } from '@getaster/elements-preview';

async function windowRequest(scope: string, query: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(scope)}?${new URLSearchParams(query)}`, { signal });
  if (!response.ok) throw new Error('History is temporarily unavailable.');
  return await response.json() as ConversationWindow;
}

const adapter: ConversationAdapter = {
  open: ({ scope, at, signal }) => windowRequest(scope,
    at === 'latest' ? { at: 'latest' } : { around: at.entryId }, signal),
  older: ({ scope, before, signal }) => windowRequest(scope, { before }, signal),
  newer: ({ scope, after, signal }) => windowRequest(scope, { after }, signal),
};

const session = new ConversationSession({ scope: 'design', title: 'Product design', adapter, maxEntries: 80 });
const reader = new ConversationReader();
reader.session = session;
document.querySelector('main')!.append(reader);
await session.open();
```

The host owns the root session and calls `session.dispose()` when leaving its
workspace. Removing the reader releases context sessions it created, but does not
dispose the borrowed root. Give the reader a bounded CSS height or a flex/grid
region with `min-height: 0` so history has its own scrollable area.

`loadOlder()` and `loadNewer()` merge overlapping windows by ID. Windows retain at
most `maxEntries` (120 by default, minimum 10), evicting the opposite edge and
preserving boundary information. The view protects its current reading anchor,
focused message and selected text. If paging would evict protected content, it
keeps the window and explains why. This is bounded windowing, not a variable-height
virtualization engine.

The adapter resolves revision conflicts before delivering a page or notification.
Generation checks reject obsolete requests; they do not substitute for server
versioning or reconnect-gap reconciliation. Do not deliver older revisions over
newer confirmed content.

## Open a discussion and retain drafts

Entries can supply `discussion` and/or `contexts: [{ id, label }]`. The host resolves
those links into another session configuration:

```ts
reader.contextProvider = (entry, sourceScope, signal) => ({
  scope: `${sourceScope}/${entry.discussion}`,
  title: 'Navigation discussion',
  adapter,
  maxEntries: 80,
});
```

The reader owns these context sessions, retains up to eight, and reuses the same
scope without replacing its draft. It keeps one focused discussion visible at a
time. Desktop can show main/context panes together; narrow layouts replace the
main pane. Return restores its reading anchor and source focus. Nested discussion
navigation uses the same surface and a bounded set of retained sessions.

The host integrates browser Back with `reader.returnToSource()` if desired; the
reader does not alter application history. Changing the root session or removing
the reader releases retained contexts. At the eight-context limit, return to or
reuse a retained discussion, or leave the workspace; the preview does not silently
evict drafts. Persistent reload restoration is not implemented.

Each session has its own `draft` signal. An optional `adapter.send` receives scope,
text and an abort signal and returns a confirmed entry. It coalesces concurrent
send calls, retains drafts on error, and preserves text edited while a send is in
flight. The adapter owns write safety/idempotency. No automatic retry or write
replay is introduced. Without `send`, the editor can retain text but sending is disabled.

## Incoming activity and deletions

Route confirmed incoming activity through the reader so focused and selected
messages are protected:

```ts
reader.receive('design', confirmedEntry);
session.remove(deletedEntryId); // confirmed deletion or access revocation
```

While following latest, the reader stays at the latest edge. While browsing, it
preserves the anchor and shows a new-activity action. If newer history is unloaded,
an isolated notification is not inserted across the gap; Latest loads a contiguous
window. A removed anchor falls back to a nearby loaded message with an explanation.
Loading and navigation do not mark anything read.

## Templates and passage discussions

`reader.entryRenderer` supplies the body of an entry using Aster's `View` type.
The wrapper continues to own identity, metadata, focus and measurement. The live
email example uses this to render long messages, attachments and expandable quotes;
source is [available here](../playground/conversations.js).

Passage discussion creation is off unless `reader.passageProvider` is supplied.
Select text in a plain-text body and right-click for **Copy** and **Discuss
passage…**. `Shift+F10` or the keyboard context-menu key opens the same menu for
the current selection. A selection-only **Selection actions** control exposes it
for touch and keyboard use without adding an action under every message.
Unselected content, custom rich content and editors retain their browser menu;
native copy shortcuts remain available. Clipboard failure leaves the selected
text available to those shortcuts. This is Aster's context menu; it does not add
items to the browser or operating system's native selection menu.

The provider receives the source scope/entry,
exact quotation and UTF-16 start/end offsets into `entry.text`, plus cancellation.
It owns the review dialog, title, audience and actual creation command, returning
session options or `undefined` on cancellation. The live example demonstrates this
contract, an attributed quote and a backlink on the unchanged source.

The default reader cannot map arbitrary custom rich-text templates to canonical
text. Passage selection is therefore disabled for custom renderers in this slice.
Durable anchors, source revisions, inherited audiences and authorization remain
host/server responsibilities; UI labels do not enforce visibility. Plain-text
offsets are not a persistence format for edited rich content.

## Read an entire discussion in an overlay

The expand action in each conversation header opens a full-window native modal
with a comfortable reading column. It uses the same session, history adapter and
entry template, with no duplicate data fetch simply to open it. The focused reader
is reading-only: the inline reply draft stays in its original composer. History
can still be loaded in either direction, and normal text selection/copy works.
The overlay fills its document's viewport; an iframe host needs explicit parent
integration to present it outside that iframe.

Escape or Close returns focus to the opener and restores the inline reading
location. The overlay remembers its own location when reopened. If its bounded
history window has evicted the inline anchor, returning loads around that anchor
(or latest when the source was following latest) before restoring it. Server
unavailability is reported through the original history feedback.

```ts
reader.showReader();             // active discussion, or the main conversation
reader.showReader('design');     // a root or retained scope
reader.closeReader();
reader.focusModeEnabled = false; // remove the expand actions
```

Supply existing guarded commands to customize the toolbar. Commands are borrowed;
cache them per session and dispose them with the application owner, rather than
constructing them each time the provider is called:

```ts
import { Command } from '@getaster/data';

const actions = new Map<string, readonly Command[]>();
reader.readerActions = session => {
  if (!actions.has(session.scope)) actions.set(session.scope, [
    new Command({
      label: 'Copy loaded messages',
      run: () => navigator.clipboard.writeText(
        session.entries.peek().map(entry => `${entry.author}\n${entry.text}`).join('\n\n')
      ),
    }),
  ]);
  return actions.get(session.scope)!;
};
```

The live example also offers Download loaded messages. These actions explicitly
operate on the current loaded window; exporting all server history would require
a separate application command. The toolbar uses the shared CommandBar for guarded,
busy and error state. Resolve, bookmark, print or domain-specific actions can use
the same hook without becoming conversation-reader features.

## Composition and accessibility

Register the preview explicitly; it is not part of the stable built-in catalog:

```ts
registry.component('Conversation', compositeElement(ConversationReader));
```

Its static property contract provides validation/editor metadata for `session`,
`contextProvider`, `passageProvider`, `entryRenderer`, `autoLoadHistory`,
`focusModeEnabled` and `readerActions` through
the existing JS/YAML composition registry. Bind live sessions/providers from
registered code; YAML does not serialize functions or services.

History is a semantic ordered list in a labelled scroll region. Visible buttons
provide earlier/newer loading, previous/next-message navigation and Latest.
`Alt+ArrowUp/Down` moves between messages outside editors. Focused content remains
mounted; historical pages are not announced as incoming messages. Status/error
presentation uses Aster's shared progress timing. Reduced motion uses immediate
scroll correction, and forced colors retain message/note boundaries.

Chrome CDP mobile emulation, cross-engine tests and native Safari automation form
the automated review. Physical touch selection, an actual phone keyboard and
manual screen-reader reading remain separate checks; short-viewport simulation
does not prove those native behaviours.


Message actions use the same compact floating controls as the InfoModel grid.
Hover over a message or tab to its controls to copy its text or focus the
conversation's reply box. Reply preserves the current draft; it does not create
an implicit quoted reply. On touch screens, these controls stay visible with
44px targets. Discussion links remain visible below their source messages.
The focused reader provides Copy without a reply action.
