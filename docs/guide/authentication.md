# Recover an expired session

A session can expire while a user sends a message, saves an edit or waits for a
background refresh. Put recovery around the transport once so every connected
control can wait for sign-in without losing its draft.

[Try the mock mail workspace](../playground/mail.html). Start a message, open **Demo controls**, choose
**Expire session**, then send it. The dialog offers simulated passkey, email and
SSO flows adapted from Aster's account-access preview. Nothing is sent outside
the local mock service. Cancelling sign-in leaves the draft available for retry.

## Connect your authentication mechanism

```typescript
import { Authentication, DataContext, fetchTransport } from '@getaster/data';

const authentication = new Authentication({
  // Include the tenant as well as the account. Use your SDK's verified identity.
  identity: () => session.accountKey,
  credentials: async () => ({ Authorization: `Bearer ${await session.accessToken()}` }),
  recover: async ({ signal }) => {
    // Your implementation can renew silently, then offer interactive sign-in.
    // Resolve only when fresh credentials are ready; honour cancellation.
    await session.restore({ signal });
  },
  timeoutMs: 120_000,
});

const ctx = await DataContext.connect(
  authentication.wrap(fetchTransport('/odata')),
);
```

`session` above is your application or identity-provider integration; Aster does
not supply an identity provider. For cookie sessions, omit `credentials` and
configure `fetchTransport('/odata', { credentials: 'include' })` where appropriate.
Use an SDK or an unwrapped transport for sign-in itself so it cannot wait on its
own recovery. Only wrap services trusted to receive that context's credentials.

One coordinator represents one authentication context. Concurrent challenged
requests share recovery, and requests arriving during recovery wait before
sending. Late failures from the old credentials do not open another dialog after
successful recovery. Each challenged operation can be replayed once.

## Return useful API errors

The default trigger is **401**. Use **403** for access denied; it does not open
login. Return a `WWW-Authenticate` challenge with 401, rather than redirecting API
calls to an HTML login page. Network failures and CORS failures do not trigger
re-authentication. If you inspect challenge headers across origins, the server
must expose those headers through its CORS configuration.

For a legacy server, supply a narrow classifier:

```typescript
challenge: ({ response }) => response.status === 401 || (
  response.status === 403 && response.headers['x-session-state'] === 'expired'
),
```

Treat ordinary permission denial separately. A login endpoint rejecting entered
credentials should display that failure in the login UI, without starting another
recovery cycle.

## Choose which operations may replay

Only GET is replayable by default. A rejected write throws
`AuthenticationError` with reason `replay-blocked` before opening login. Allow
writes only when the server guarantees the rejected operation was not applied,
or when a stable idempotency key and server deduplication make replay safe.

The mail mock rejects expired sessions before touching data, so its explicit
policy is:

```javascript
replay: ({ response }) => response.status === 401,
```

This is a guarantee of that mock server, not a policy to copy blindly for another
API. Aster retains the original body, ETag and idempotency key across replay and
rebuilds credential headers for every send. It does not retry an ambiguous network
failure or assume aborting a dispatched write undoes it.

## Cancellation, account changes and feedback

A low-level `ODataRequest` accepts an `AbortSignal`. Cancelling one request leaves
other recovery waiters alive; cancelling all waiters aborts recovery. Call
`authentication.dispose()` when the owning context ends. Recovery has a five-minute
default deadline, configurable with `timeoutMs`, even if an integration ignores
abort. Your handler must honour its signal to close its own UI and release SDK work.

When `identity()` initially returns a stable key, switching accounts or tenants
fails waiting operations with `identity-changed`. Rebuild your data context,
record store and permissions for the new identity instead of replaying the old
account's operations. Returning undefined permits an initial login; provide the
stable key once signed in.

`authentication.recovering` is an immediate readonly signal. Bind it to
[ProgressStatus](./progress-status.md) for delayed silent-renewal feedback. An
interactive sign-in dialog should appear when user action is required. Keep
errors immediate and preserve the form or draft beneath it.

Failures expose a typed `reason`: `cancelled`, `timeout`, `failed`,
`identity-changed`, `retry-limit`, `replay-blocked` or `disposed`. Individual
caller cancellation preserves its AbortSignal reason. Successful recovery does
not imply the retried operation succeeds: validation, conflicts and permission
errors still flow through the normal data APIs.

## Put failures beside the affected task

Keep transport error details in the command state and translate them into useful
application text. The mail example shows a failed send above the same draft's
fields, with **Try sending again** and **Dismiss**. Refresh failures use one
workspace notification. Single-click previews a message; double-click or Enter
opens a keyed tab through Grid's cancellable `row-open` event.

CommandBar supports `formatError(error, action)` for application wording, or
`showErrors: false` when another surface owns feedback. The mail YAML selects the
latter so the same exception is not repeated in the toolbar, draft and footer.
Cancellation retains the draft; it does not display a successful-send message.

## Read the working implementation

The [workspace YAML](../playground/mail.ui.yaml) declares the Sidebar, shared Grid,
CommandBar and retained Tabs. [Application code](../playground/mail.js) contains
the full authentication handler, mock server boundary and composition registry.
The [mail model](../playground/mail-model.js) owns keyed open messages, drafts,
commands and selection. [Presentation](../playground/mail.css) supplies the
responsive layout. These are the actual files executed by the demo.

Open-tab keys and drafts in this example belong to its application model.
Persistent sessions, generalized keyed composition children and resumable
redirect/reload recovery remain separate work. The 30-second refresh option is
explicitly controlled by the page; no hidden background subscription is implied.

See [Authentication](../reference/#class:Authentication) and
[transport](../reference/#type:Transport) for the public APIs.
