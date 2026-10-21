# Authentication recovery

## class:Authentication

Coordinates one authentication context across explicitly wrapped transports.
Concurrent challenges share recovery; new requests wait while it is active.
HTTP 401 triggers recovery by default. GET is replayable by default; each
operation may replay once. Construct with [AuthenticationOptions](#object:AuthenticationOptions).
See the [authentication guide](../guide/authentication.md) for integration and replay guarantees.

## method:Authentication.wrap

Returns a [Transport](#type:Transport) using this coordinator. Credential headers
are refreshed per dispatch. Only wrap trusted services belonging to this account
and tenant context. Original body, ETag and idempotency headers are retained.

## attr:Authentication.recovering

Immediate readonly boolean signal indicating a shared recovery is active.
Presentation may use ProgressStatus; the signal does not delay actual busy state.

## method:Authentication.dispose

Aborts recovery and all outstanding wrapped requests with reason `disposed`.
Late recovery cannot resume those requests. Does not undo dispatched server work.

## object:AuthenticationOptions

Application integration for identity, credentials and recovery. Options are
snapshotted at construction. Required functions: `identity` returns a stable
account/tenant key (or undefined before initial sign-in), and `recover` restores
credentials or rejects. Optional `credentials` supplies headers per dispatch,
`challenge` classifies responses (401 by default), `replay` permits challenged
operations (GET by default), and `timeoutMs` sets a positive integer recovery
deadline (300000 by default). Login uses an unwrapped transport or external SDK.

## object:AuthenticationChallenge

Readonly original `request` and challenged `response` provided to classification
and replay decisions. Request metadata may contain sensitive headers or bodies;
avoid logging it indiscriminately.

## object:AuthenticationRecovery

Extends AuthenticationChallenge with the original `identity` and an abort `signal`.
Handlers must honour abort to release their own UI and SDK resources. Resolve
only after credentials are usable. Throw AuthenticationError with reason
`cancelled` when the user cancels; other thrown errors become `failed` causes.

## class:AuthenticationError

Typed failure of authentication coordination. Its `reason` is an
[AuthenticationFailure](#type:AuthenticationFailure); optional cause preserves
an integration failure. Transport or normal service errors remain separate.

## attr:AuthenticationError.reason

Machine-readable AuthenticationFailure. An individual caller AbortSignal keeps
its own cancellation reason instead of being wrapped as AuthenticationError.

## type:AuthenticationFailure

`cancelled`, `timeout`, `failed`, `identity-changed`, `retry-limit`,
`replay-blocked` or `disposed`. Retain drafts and present an appropriate recovery
choice. Identity changes require a fresh application data context.
