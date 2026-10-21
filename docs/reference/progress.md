# Progress status

Shared presentation timing for asynchronous work. See the
[progress guide](../guide/progress-status.html) for customisation and examples.

## object:ProgressPolicy

Optional `delayMs` (default 250) and `minVisibleMs` (default 400), in integer
milliseconds from 0 to 2147483647. Local settings merge over inherited defaults.
Neither setting delays data, errors, actual busy state or action availability.

## constant:DEFAULT_PROGRESS_POLICY

Frozen framework defaults: `{ delayMs: 250, minVisibleMs: 400 }`.

## staticMethod:progressPolicy

Validates and snapshots a partial policy, filling omitted values with framework
defaults. Rejects unknown keys, non-plain objects and invalid timing values.

## object:ProgressWork

Borrowed source state: required boolean `busy` and optional `error`. Any non-null,
non-undefined error enters the error phase immediately, even while busy.

## type:ProgressPhase

`idle`, `waiting`, `working`, `complete` or `error`. Waiting is silent. Completion
fills only the remaining minimum visible interval; it is skipped when that
interval has already elapsed. A fast operation never enters a visible phase.

## class:ProgressState

Headless, signal-tracked progress presentation. Construct with a function returning
ProgressWork and an optional policy object or reactive policy callback. Exposes
read-only signals `busy`, `error`, `phase` and `visible`. The first two always
reflect actual source state. New work during completion retains continuous
feedback; policy changes recalculate against elapsed time.

## method:ProgressState.dispose

Idempotently stops timers and subscriptions and returns the phase to idle.
Does not cancel or release the borrowed operation. Busy and error retain their
last observed values after disposal.

## class:ProgressStatus

`aster-progress-status`, a stable atomic ARIA status line driven by ProgressState.
Disconnect disposes its presentation state; reconnect observes current properties
afresh. No motion or spinner is required. Keep actual `aria-busy` on the owning
region independently of this presentation.

## attr:ProgressStatus.busy

Actual work state, default false. Changing this property never delays the source.

## attr:ProgressStatus.error

Optional user-facing error string. Errors appear immediately and remain until
cleared. An empty string uses the generic failure message. No retry action is
created automatically.

## attr:ProgressStatus.progressPolicy

Partial local timing overrides, default `{}`. Merges over inherited providers.
The setter validates and snapshots its input.

## attr:ProgressStatus.pendingText

Working-phase text, default `Working…`.

## attr:ProgressStatus.completeText

Completion-phase text, default `Updated`. This phase does not hold back results.

## attr:ProgressStatus.reserveSpace

Default true. Reserves one text line, including during silent phases, to keep
nearby content stable. Set false when the surrounding layout reserves its space.

## staticMethod:provideProgressPolicy

`provideProgressPolicy(root, options)` snapshots application or region overrides
on an Element. Mounted descendants react to additions and updates. Partial
policies inherit unspecified values; `{}` removes that root's overrides.

## staticMethod:progressPolicyOf

Resolves frozen, complete timing defaults for an element, merging ancestor
providers from outer to inner, including shadow hosts. Reads provider signals
when called inside a reactive effect. Per-control overrides are applied separately.

## attr:Grid.progressPolicy

Partial local timing overrides for the grid's summary status. Errors and actual
summary `aria-busy` stay immediate. Default `{}` inherits application/region policy.

## attr:ComponentHost.progressPolicy

Partial local timing overrides for vendor-loading status. Mount failures and
retry availability stay immediate. Does not control progress inside the
application-supplied alternative; use ProgressStatus there. Default `{}`.
