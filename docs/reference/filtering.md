# Advanced filtering

The [playground](../../scripts/site/playground/filtering.html) combines a paged
shared table/tile collection, saved views, summaries and a standalone editor.
The query editor and persisted-record RuleEditor have different data models.
They share the scalar input and finite multi-choice renderers, select controls,
nested-group chrome, focus styling and theme tokens.

## class:FilterDraft

Construct with `(schema, set, criteria?)`. This data-only model owns a local
editable tree and an applied Criteria snapshot; it never performs a database
write or query. Every mutation replaces the tree, and consumers read signals.

```ts
import { FilterDraft } from "@getaster/data";
const draft = new FilterDraft(ctx.schema, "Devices", {
  op: "or", args: [
    { op: "eq", field: "platform", value: "Linux" },
    { op: "eq", field: "platform", value: "Windows" },
  ],
});
const editor = document.createElement("aster-filter-builder");
editor.model = draft;
editor.addEventListener("apply", (event) => {
  const criteria = (event as CustomEvent).detail;
  collection.setQuery({ set: "Devices", ...(criteria ? { filter: criteria } : {}) });
});
```

Use the grid’s built-in toolbar entry for its own filtering, or set
[[attr:GridView.criteria]] programmatically. On first binding, a saved grid expression combines with the incoming collection
query as its base; later external membership changes replace the grid’s owned
filter controls. External sort/projection changes preserve them. Filters do not bypass server
permissions. Only metadata filterable fields and supported AST operators apply.

## class:FilterBuilder

Tag `aster-filter-builder`. Bind `.model` to a [[class:FilterDraft]], optionally
set `.label` and `.readOnlyReason`. Add condition/group/related actions build a
nested expression, with local validation and a readable preview. Apply is
unavailable while any clause is invalid; Cancel and Clear expression are
available during ordinary editing. A read-only reason disables editing and
removes the commit controls so hosts can implement asynchronous guards.

## event:FilterBuilder.apply

Bubbling, cancellable CustomEvent. `detail` is a validated Criteria expression,
or undefined when cleared. Emitted before committing the model. Without
`preventDefault()`, the model applies synchronously after handlers run. An async
host must prevent default, capture the model, disable editing while awaiting its
guard, recheck lifecycle/query identity, then call `model.apply()` itself.

## event:FilterBuilder.cancel

Bubbling CustomEvent after the draft resets to the applied snapshot. It does not
change a live query; the host can close its surrounding dialog.

## attr:FilterDraft.schema

The immutable metadata schema supplied to the constructor.

## attr:FilterDraft.set

Entity set whose fields and navigations scope the root expression.

## attr:FilterDraft.root

Readonly signal containing the editable root boolean group. Use the model’s
mutation methods to preserve stable IDs and reactive updates. A synthetic root
wraps a single expression without adding a redundant AND on apply.

## attr:FilterDraft.applied

Readonly signal with the last committed criteria. Constructor/reset clone the
input so editing never mutates the caller’s saved expression.

## attr:FilterDraft.dirty

Readonly boolean signal indicating that the draft differs from its baseline.

## attr:FilterDraft.result

Readonly [[object:FilterResult]] signal. A partially valid expression never
appears as executable criteria. Relative dates are checked but remain symbolic,
so the data layer resolves them against its clock when fetching.

## type:FilterNode

Editable node union: boolean [[object:FilterGroup]], scalar
[[object:FilterCondition]] or navigation-scoped [[object:FilterRelated]]. IDs are
stable during edits, local to the model, and unrelated to database record keys.
Save `result.criteria` or `applied`, rather than this UI tree.

## object:FilterProblem

One validation problem associated with an editable clause or group.

## object:FilterResult

Complete validation outcome, read from the draft’s result signal. Clearing a
synthetic root is valid and yields undefined criteria. Empty explicit boolean or
related groups need a condition; imported invalid clauses stay visible.

## object:FilterChange

Patch passed to `draft.change(id, patch)`. Existing incompatible values remain
visible for repair when a field/operator/mode changes; no clause is discarded.

## attr:FilterGroup.kind

Discriminator `group`.

## attr:FilterGroup.id

Stable local draft node ID.

## attr:FilterGroup.op

Boolean operator: `and`, `or` or `not`. The editor labels these All, Any and Not all.

## attr:FilterGroup.children

Ordered child conditions or groups. Several children under NOT mean NOT(AND(children)).

## attr:FilterGroup.synthetic

Internal root wrapper marker; when true, one child compiles directly and no children clears the expression.

## attr:FilterCondition.kind

Discriminator `condition`.

## attr:FilterCondition.id

Stable local draft node ID.

## attr:FilterCondition.field

Scalar metadata field in the current entity scope.

## attr:FilterCondition.op

Typed comparison operator, including editor forms `isnull` and `notnull`, which compile to eq/ne null.

## attr:FilterCondition.mode

Literal `value`, another `field` or symbolic `relative` date.

## attr:FilterCondition.text

Unparsed text, retained during invalid edits. Internally, lists and relative offsets use JSON; the editor presents one-per-line lists and named offset controls.

## attr:FilterCondition.other

Comparison field name when mode is field. It must have the same metadata type.

## attr:FilterCondition.caseInsensitive

Use case-insensitive text matching for contains/startswith/endswith.

## attr:FilterRelated.kind

Discriminator `related`.

## attr:FilterRelated.id

Stable local draft node ID.

## attr:FilterRelated.field

Metadata navigation in the parent entity scope.

## attr:FilterRelated.op

`any`/`all` for a collection navigation, or `via` for one related record.

## attr:FilterRelated.children

Conditions scoped to the related entity type. Multiple children combine with AND.

## attr:FilterProblem.id

Local ID of the clause needing attention.

## attr:FilterProblem.message

Plain-text explanation displayed next to the clause.

## attr:FilterResult.valid

True only when the complete draft is valid.

## attr:FilterResult.criteria

Executable AST when valid, or undefined for an invalid or deliberately cleared draft. Check valid to distinguish the two.

## attr:FilterResult.problems

Validation failures; empty for a valid draft.

## attr:FilterChange.field

Replacement scalar field or related navigation.

## attr:FilterChange.op

Replacement comparison or group operator.

## attr:FilterChange.mode

Replacement comparison mode for a scalar condition.

## attr:FilterChange.text

Replacement unparsed value text.

## attr:FilterChange.other

Replacement comparison field name.

## attr:FilterChange.caseInsensitive

Replacement text matching case policy.


## staticMethod:filterOperators

Operator choices follow metadata semantics:

| Field | Operators |
| --- | --- |
| Free text | Equality, inequality, list membership, null checks, contains, starts with, ends with |
| Numeric, date, time, timestamp, duration | Equality, inequality, list membership, null checks, greater/less than and inclusive comparisons |
| Boolean, GUID, or finite allowed-value choices | Equality, inequality, list membership and null checks |
| Binary or missing field | None |

Text ordering is available in the low-level Criteria compiler but is not offered
or accepted by the query editor. When a field change makes its existing operator
incompatible, the draft retains its value and shows a validation error; choose a
supported operator before Apply. Imported incompatible expressions also require
repair, rather than being rewritten or partially applied.


### Value controls and field transitions

`Validation.AllowedValues` supplies finite choices. Equality uses the existing
select control; “is one of” uses the same labeled checkbox group as the infomodel
rule editor. Booleans offer typed Yes/No choices. Lists preserve nulls where
metadata permits them and retain unavailable selected values visibly for repair.
Unavailable choices and empty finite selections block Apply; no selected value
is silently removed. Plain fields without finite metadata retain typed list input.

Changing a scalar equality to membership carries its current value into a
one-item list. A one-item list converts back to a scalar when changing back.
Several selected values remain visible for repair if a single-value operator is
chosen. Field comparisons and relative-date modes are under “Compare with…” for
ordinary literal conditions; focus moves to the new value control when changing
modes. New clauses first ask for a field and reveal the test and value after it
is chosen. Incomplete new values use neutral prompts rather than immediate red
errors. Related groups require choosing their navigation before adding children.
The editor responds to its own container width, including when embedded in a
narrow panel on a wide screen.
