# Page rules

Page rules let components on one page react to each other's state without
holding references to each other: a field required only when another field has a
certain value, a button enabled only while a row is selected, a pane read-only
for a role, a list whose filter follows a chart. All of it lives in
`@getaster/data` and has no DOM.

The idea is a [[class:PageScope]]: a reactive map from keys to what each
component has published. A component publishes under a key it chooses, such as
`tasks`, a fixed set of named signals for its kind
([[staticMethod:selectionPublication]], [[staticMethod:editPublication]] and the
other publications below). Anything else on the page reads those signals by
path, as `tasks.selected.title`, and a rule is a [[type:Condition]] over those
paths. Each rule is a computed signal, and the effects of the rules (visible,
enabled, read-only, required) are signals that elements and edit models bind to
([[method:PageScope.state]]). This
page describes what the code does.

## Scope, keys and paths

- **One publisher per key.** [[method:PageScope.publish]] throws when the key is
  taken in the same scope, and when it contains a dot. It returns a function that
  withdraws the publication.
- **Reading is order-free.** A path whose key isn't published reads as
  `undefined` and follows it when it arrives, so mount order, lazy tabs and
  late-loading panes don't matter.
- **Child scopes.** [[method:PageScope.child]] makes a scope whose own keys shadow
  its parent's and whose other keys fall through to it. A record editor or a
  dialog gets one; it shares the parent's clock and data context.
- **Paths** are `key.name` and then properties: `tasks.selected.title`. `key.name`
  is a signal in the key's publication; the properties are read from the value it
  holds. When the publication gives the record type (its `types`), the path is
  typed: its last property has the CSDL type of the field, and a step that names a
  single-valued navigation reads the related record from the store through the
  scope's [[class:DataContext]] (`task.values.project.lead.name`), fetching it if
  needed. It is `undefined` until the record arrives and `null` when there is no
  related record. There can be at most [[constant:MAX_HOPS]] navigations in one
  path; a path that can't exist, such as an unknown property on a typed record, is
  an error, not a silent `null` ([[method:PageScope.check]]).

### What components publish

| Function | Names | Types and hidden fields |
|---|---|---|
| [[staticMethod:selectionPublication]] | `selected`, `records`, `keys`, `key`, `count`, `any`, `many` | `selected` is typed with the collection's entity type, with the selected record's hidden fields |
| [[staticMethod:editPublication]] | `values`, `record` (as saved), `dirty`, `valid`, `errors`, `mode` (`"create"` or `"update"`), `busy`, `deleted` | `values` and `record` are typed, with the hidden fields |
| [[staticMethod:collectionPublication]] | `total`, `loading`, `complete`, `stale` | none |
| [[staticMethod:listPublication]] | `rows` (the values of the rows not being removed), `count` | `rows` is typed with the list's entity type, so rules can use `any` and `all` over it |
| [[staticMethod:inputPublication]] | `key`, `record` | `record` is typed, with its hidden fields |
| [[staticMethod:valuesPublication]] | whatever you give it | none: values compare as what they are |
| [[staticMethod:filtersPublication]] | `contributions`, `labels`, `count`, `any` | none |

Every component of a kind publishes the same names, so a rule reads
`<key>.selected.state` whichever list published it.

### Conditions

A [[type:Condition]] is a [[type:Criteria]] whose `field` (and `other`) names are
paths into the scope instead of properties, with one shorthand: a bare string is a
path that must be true (`"tasks.any"`). `and`, `or` and `not` take conditions.
[[staticMethod:toCriteria]] spells the shorthand out.

```ts
const rule: Condition = {
  op: "and",
  args: [
    "tasks.any",                                                           // a selection exists
    { op: "eq", field: "tasks.selected.done", value: false },              // and it's open
    { op: "not", arg: { op: "eq", field: "app.role", value: "viewer" } },  // and the user isn't a viewer
  ],
};
```

Evaluation is the criteria evaluation ([[staticMethod:matches]]), with these
additions:

- A path is typed by its publication where it says. Otherwise it takes the type of
  its value (numbers as `Edm.Double`, text as `Edm.String`, booleans), or, while it
  is null, the type of what it is compared with. Untyped text compares only for
  equality; ordering it (is it a date?) would be a guess, so it throws a
  [[class:CriteriaError]].
- A path that is unpublished or `undefined` reads as `null`.
- A field the server hid on its record is unknown, not null: a test of it is
  unknown, and a rule holds only when it is true. This is read from the
  publication's `hidden` for `key.name.field` paths.
- Relative dates resolve when the rule is evaluated, against the scope's clock.
- `any` and `all` range over a path that holds an array of rows and is typed by the
  publication ([[staticMethod:listPublication]]); `where` names the row's
  properties. `via` isn't supported in a rule.

### A worked example

```ts
import { computed, signal } from "@preact/signals-core";
import { PageScope, Selection, selectionPublication, valuesPublication } from "@getaster/data";

const scope = new PageScope(undefined, { ctx });

const tasks = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "projectId", value: 4 }, orderBy: [{ field: "id" }] });
await tasks.loadAll();
scope.publish("tasks", selectionPublication(new Selection(ctx.store, tasks)));   // single selection, first row by default

const role = signal("viewer");
scope.publish("app", valuesPublication({ role }));

const del = scope.state("deleteButton", {
  enabled: { when: { op: "and", args: ["tasks.any", { op: "eq", field: "app.role", value: "admin" }] }, reason: "Select a task, as an admin." },
});
del.value.enabled;           // false
del.value.reasons.enabled;   // "Select a task, as an admin."
role.value = "admin";
del.value.enabled;           // true

const heading = scope.select([
  { when: "tasks.any", template: "{tasks.selected.title} ({tasks.selected.project.name})" },
  { value: "No task selected" },
]);
heading.value;               // undefined while the task's project loads, then "Prepare release notes (Onboarding emails)"

scope.explain("deleteButton");   // each rule, what it read and what it decided
scope.readers("app.role");       // [{ target: "deleteButton", effect: "enabled" }]
```

## Sharing filters

[[class:SharedFilters]] is a page's shared filter: named contributions, from a
filter chip, a search box or a chart's selection, that collections opt in to
combining with their own query. Nothing contributes or consumes by default. One
call per list opts it in: `filters.query(base)` gives a query signal for
[[method:DataContext.collection]] or [[method:DataContext.groups]].

A contribution applies to a collection whole or not at all:

- **With a set.** It applies to collections on that set. It also applies across
  a unique shortest path of up to three single-valued navigations, unless
  `related` is false: a test of the related record's key alone becomes a test of the foreign
  key; anything else becomes a `via` ([[object:Query]] paths). Equally short paths are ambiguous
  and skip the contribution, as does an unreachable set. A direct path wins
  over longer alternatives. Collection and reverse hops are excluded.
- **Without a set.** It applies by field name to a collection where every field
  exists with a compatible type ([[staticMethod:compatible]]): the same type, an
  integer into any number, a relative date into a date or a timestamp. The field
  types come from the contribution's `fields`, or else from its literals, so text
  is text unless it says otherwise. Numbers are converted to a field's JSON form
  (text for `Int64` and `Decimal`).
- **Loops.** A consumer names its own contributions (`self`) and never takes
  them. A list ignores an identity selection on its own set unless it totals it
  (`sameSetSelections`). A consumer can limit which contributors' selections and
  values drive it (`from`); filters always apply.
- A mismatch skips that contribution for that collection only, and every skip has
  a reason a page can show ([[object:SkippedContribution]]).

```ts
import { SharedFilters, selectionShare, filtersPublication } from "@getaster/data";

const filters = new SharedFilters(ctx.schema);
scope.publish("filters", filtersPublication(filters));

filters.set({ by: "lead", label: "Ada Lovelace", set: "People", criteria: { op: "eq", field: "id", value: 1 } });
const projects = ctx.collection(filters.query({ set: "Projects", orderBy: [{ field: "name" }] }));
// the contribution is on People and reaches Projects across leadId: they get `leadId eq 1`.


const chosen = new Selection(ctx.store, projects, { multiple: true });
const stop = filters.share("projects", selectionShare(chosen, (n) => `${n} projects`), () => chosen.clear());
// A Tasks collection made with filters.query(...) now narrows to `assigneeId eq 1` and the
// chosen projects (`projectId in (...)`); removing the selection's chip clears the selection.
```

## Limits

- Rules are pure: they read the scope and can't write to it. The only writers are
  derived values in edit models.
- A rule can't reach a to-many relation or a collection's records, only what a
  publication gives it; `any` and `all` range over a list publication.
- Paths follow single-valued navigations only, at most [[constant:MAX_HOPS]]
  deep, and need the scope's data context. A path through a navigation fetches the
  related record, so a rule over it is `undefined` first.
- A rule that must hold for security has to hold on the server too; these rules
  are for what the page shows and allows.
- Derived cases support related-list minimum, maximum and average. `via`
  inside a scope rule and rules over several foreign keys to one set remain
  unsupported.
- Shared contributions follow a unique shortest path of up to three
  single-valued navigations, never a reverse collection hop (parents narrowed
  by their children).

## class:PageScope

The page's published state, by key. Components publish under a key; rules and
other components read by path without a reference to the publisher.

Invariants: a key has one publisher per scope; reading an unpublished key gives
`undefined` and follows it once published; a child scope's keys shadow its
parent's.

`new PageScope(parent?, { now?, ctx? })`: `parent` makes a child scope; `now` is
the clock relative dates in rules resolve against (the parent's, else
`Date.now`); `ctx` is the [[class:DataContext]] that paths through navigations
read related records with (the parent's when not given).

```ts
const scope = new PageScope(undefined, { ctx, now: () => Date.parse("2026-10-15T09:00:00Z") });
const dialog = scope.child();
dialog.publish("form", editPublication(edit));   // visible to the dialog; the page doesn't see it
dialog.value("tasks.selected.title");            // falls through to the page's tasks
```

## attr:PageScope.parent

The enclosing scope, or `undefined` for a root. Plain, read only.

## attr:PageScope.now

`() => number`, epoch milliseconds: the clock for relative dates in rules, read at
each evaluation. A child scope has its parent's unless given its own. Plain
function.

## attr:PageScope.ctx

The [[class:DataContext]] that paths through navigations read related records
with, or `undefined`, in which case such a path is an error. A child scope has its
parent's.

## method:PageScope.child

Returns a new `PageScope` with this one as its parent, sharing its clock and data
context. Keys published in the child shadow the parent's for readers in the child
and don't affect the parent. Withdrawing the child's publications is up to the
caller.

## method:PageScope.publish

- `key`: the name to publish under. Must not contain `.`.
- `publication`: a [[object:Publication]].

Returns a function that withdraws the publication; readers see `undefined` from
then on, and rules that read it re-evaluate. The function does nothing if the key
has since been published by someone else. Throws an `Error` when the key contains
a dot (`a scope key can't contain '.': a.b`) or is already published in this scope
(`'tasks' is already published in this scope`); a child scope may reuse a parent's
key.

```ts
const off = scope.publish("tasks", selectionPublication(selection));
off();   // when the component goes away
```

## method:PageScope.keys

Returns the published keys, this scope's first and then those of its ancestors
that it doesn't shadow. A plain array read now, not a signal.

## method:PageScope.schema

Returns a [[type:ScopeSchema]]: for every key, each published name, with the
record type's name and its fields' CSDL types where the publication gives a type.
A snapshot taken now, as plain data, for rule builders and tools that offer and
check paths before a rule exists.

```ts
scope.schema().tasks.selected;   // { type: "Task", fields: { id: "Edm.Int32", title: "Edm.String", … } }
scope.schema().app.role;         // {}: untyped
```

## method:PageScope.check

- `path`: a path such as `tasks.selected.project.name`.

Returns why the path can't be read, or `undefined` if it can. Reasons: `nothing is
published as 'x'`, `'tasks' has no 'nope'`, `Task has no field 'nope'`,
`'tasks.selected.title.x' goes past a field`, `'p' on Task is a list; a path
follows single records (…)`, the path follows more than three navigations, and a
path through a navigation when the scope has no data context. Doesn't throw and
sends nothing. Paths into an untyped value aren't checked past its name.

```ts
scope.check("tasks.selected.project.lead.name");   // undefined
scope.check("tasks.selected.nope");                // "Task has no field 'nope'"
```

## method:PageScope.value

- `path`: a path.

Returns a computed signal of the path's value: the key's signal, then properties
of what it holds. It follows the key being published or withdrawn. From a typed
record a step that names a single-valued navigation reads the related record from
the store through [[attr:PageScope.ctx]], fetching it when it isn't loaded (see
[[method:DataContext.lookup]]): `undefined` until it arrives, `null` when the
foreign key is null (and for everything under that step). Reading it throws a
[[class:CriteriaError]] for a typed path that can't exist; use
[[method:PageScope.check]] first.

```ts
const projectName = scope.value("tasks.selected.project.name");
effect(() => console.log(projectName.value));   // undefined, then "Onboarding emails"
```

## method:PageScope.select

- `cases`: [[type:Case]]s, in order.
- `target`: optional name for [[method:PageScope.explain]].

Returns a [[object:SelectedValue]] signal of a derived value: the first case whose rule holds
gives it, and a case without a rule is the default. A case's value is its literal
`value`, the value at its `path`, a related-list aggregate, or its `template` rendered over the scope
([[staticMethod:parseTemplate]]). It is `undefined` when no case applies. It is
also `undefined` while a path a rule has to read is `undefined` (an unpublished
key, a related record still loading), and a case after such a rule isn't looked at,
so nothing is decided on missing data; a template renders only once every path in
it has a value. A `null` counts as a value. Throws a [[class:TemplateError]] when a
template doesn't parse; the rules are evaluated, and may throw, when the signal is
read.

```ts
const greeting = scope.select([
  { when: { op: "eq", field: "app.role", value: "admin" }, value: "Welcome back, admin" },
  { when: "tasks.any", template: "Working on {tasks.selected.title}" },
  { value: "Pick a task" },
]);
```

## method:PageScope.field

- `path`: a path of at least three parts.

Returns a copy of the [[object:Field]] the path reads, when its publication gives
the record type and the path ends on a property of that record or of a record
reached through its navigations. `undefined` for any other path, including one
into an untyped value or one that stops at a record. Throws a [[class:CriteriaError]]
naming the path for a property the type doesn't have, or a bad step.

```ts
scope.field("tasks.selected.project.lead.name")?.type;   // "Edm.String"
```

## method:PageScope.when

- `rule`: a [[type:Condition]].

Returns a computed signal that is `true` while the rule holds. A rule holds only
when the whole tree is true: null and unknown (a hidden field, an unpublished key
in a comparison) leave it false. Reading the signal throws a [[class:CriteriaError]]
for a path that can't exist, a value that isn't a plain value, untyped text that is
ordered, `any` over something that isn't a list, and `via`. It reads each path
through [[method:PageScope.value]], so it follows everything it reads.

```ts
const ready = scope.when({ op: "and", args: ["tasks.any", { op: "gt", field: "tasks.selected.due", value: { relative: "today" } }] });
```

## method:PageScope.state

- `target`: a name for what the rules are for, such as a field or a button.
  [[method:PageScope.explain]] and [[method:PageScope.readers]] report by it.
- `rules`: [[object:StateRules]]: any of `visible`, `enabled`, `readOnly` and
  `required`, each a [[type:Condition]] or a [[object:Ruled]] with a reason.

Returns a computed signal of the [[object:FieldState]]. An effect with no rule has
its default ([[constant:DEFAULT_STATE]]); with a rule it is whether the rule holds
(`visible: cond` is visible while `cond` holds, `readOnly: cond` is read-only
while it holds). A rule's `reason` is in `reasons` when the effect is away from its
default. The rules are registered, so calling it again for the same target adds to
what `explain` reports.

```ts
const state = scope.state("budget", {
  readOnly: { when: { op: "eq", field: "project.record.state", value: "archived" }, reason: "Archived projects can't be edited." },
  required: { op: "eq", field: "project.values.health", value: "behind" },
});
```

## method:PageScope.explain

- `target`: the name given to [[method:PageScope.state]].

Returns an [[object:Explanation]] for each state rule or derived selection registered for the target, in
registration order: the rule, its reason, whether it holds, and what each path it
reads held. Empty for an unknown target. It reads the signals without subscribing,
so it is a snapshot for a debug panel or a test, answering "why is this disabled?".

## method:PageScope.readers

- `path`: a path, such as `app.role`.

Returns `{ target, effect }` for every registered rule that reads the path, a path
under it, or a path it is under: `readers("tasks.selected")` finds a rule that reads
`tasks.selected.title`, and `readers("tasks.selected.title")` finds one that reads
`tasks.selected`. One entry for each such rule, so a target with two matching rules
is listed twice. Only rules registered with [[method:PageScope.state]] are known.

```ts
scope.readers("app.role");   // [{ target: "deleteButton", effect: "enabled" }]
```

## staticMethod:toCriteria

- `condition`: a [[type:Condition]].

Returns the same condition as plain [[type:Criteria]], each bare path spelled as
`{ op: "eq", field: path, value: true }`, recursively through `and`, `or` and
`not`. Criteria nodes pass through unchanged. It doesn't check that the paths
exist.

```ts
toCriteria({ op: "not", arg: "tasks.any" });
// { op: "not", arg: { op: "eq", field: "tasks.any", value: true } }
```

## constant:DEFAULT_STATE

The [[object:FieldState]] of a target with no rules: visible, enabled, not
read-only, not required, no reasons. Frozen; compare an effect with it to see
whether a rule moved it.

## constant:MAX_HOPS

3: how many single-valued navigations a path may follow from a published record,
so `task.values.project.lead.name` follows two. A path with more is an error.

## type:Condition

A [[type:Criteria]] over paths: `field` and `other` name paths in the scope, and a
bare string is a path that must be true. `and`, `or` and `not` take conditions, so
strings can appear anywhere in them. `any` and `all` are only for list paths.
[[staticMethod:toCriteria]] converts it to plain criteria.

## object:Ruled

A rule with the reason to show when it applies. Plain data.

## attr:Ruled.when

The [[type:Condition]].

## attr:Ruled.reason

Text shown when the rule moves the effect off its default, such as "Select a task
first". Optional, and reported in [[attr:FieldState.reasons]].

## object:StateRules

The rules of [[method:PageScope.state]]. Each is optional.

## attr:StateRules.visible

Visible only while this holds. Without it the target is visible. A hidden field's
value is kept and still sent unless the edit model clears it when hidden.

## attr:StateRules.enabled

Enabled only while this holds. Without it, enabled. It is for the element to show:
an edit model doesn't block `set` for a disabled field.

## attr:StateRules.readOnly

Read-only while this holds. Without it, editable. An edit model refuses to set a
read-only field, showing the reason.

## attr:StateRules.required

Required while this holds. Without it, not required. An edit model checks a
required field like one the metadata requires.

## type:Effect

`"visible" | "enabled" | "readOnly" | "required"`: the keys of
[[object:StateRules]].

## object:FieldState

What [[method:PageScope.state]] gives. Plain, frozen.

## attr:FieldState.visible

`true` unless a `visible` rule exists and doesn't hold.

## attr:FieldState.enabled

`true` unless an `enabled` rule exists and doesn't hold.

## attr:FieldState.readOnly

`false` unless a `readOnly` rule exists and holds.

## attr:FieldState.required

`false` unless a `required` rule exists and holds.

## attr:FieldState.reasons

The reason of each effect that is away from its default and whose rule gave one,
as an object by effect name: `{ enabled: "Select a task first" }`. Empty when no
reason applies, so show it beside the control that is disabled.

## type:Case

An aggregate case has `aggregate: "min" | "max" | "average"`, `path` naming
a related list, and `field` naming the property to aggregate. The whole list
is queried through `$apply`, including unloaded rows. `average` needs a numeric
field; min and max also accept text and temporal fields. Nulls are ignored;
an empty or absent list gives null, loading gives undefined. Paths need a typed
publication and data context, and at most three navigations ending on a list
with foreign keys. Dispose the returned signal when done.

One case of a derived value ([[method:PageScope.select]]): an optional `when`
([[type:Condition]]) and one of `value` (a literal), `path` (the value at a path)
or `template` (a [[object:Template]] source rendered over the scope). Without
`when` it always applies.

```ts
const cases: Case[] = [
  { when: "tasks.many", template: "{tasks.count} tasks" },
  { when: "tasks.any", path: "tasks.selected.title" },
  { value: "Nothing selected" },
];
```

## object:Publication

What a component makes visible to the page. Plain data, built by the publication
functions or by hand for an app's own component.

## attr:Publication.values

Names to signals. These are the names a path reads after the key.

## attr:Publication.types

Optional: for a name that holds a record (or, for a list, its rows), the
[[object:EntityType]]. It types paths into it and allows `any`, `all` and
navigations. A name without one is read as what its value is.

## attr:Publication.hidden

Optional: for a name that holds a record, a signal of the set of its fields the
server hides from the caller ([[attr:StoredRecord.hidden]]). A rule's test of
`key.name.field` for one of them is unknown.

## object:ScopeName

One published name in [[method:PageScope.schema]]. Plain data.

## attr:ScopeName.type

The record type's name (`Task`), when the publication typed the name. Absent
otherwise.

## attr:ScopeName.fields

The type's fields by name with their CSDL types, when it has a type. Absent
otherwise.

## type:ScopeSchema

`Record<key, Record<name, ScopeName>>`: everything published, typed where it can
be. Plain data, a snapshot.

## object:Explanation

One step of [[method:PageScope.explain]]. Plain data.

## attr:Explanation.effect

Which effect the rule is for ([[type:Effect]]).

## attr:Explanation.rule

The rule's [[type:Condition]], as registered.

## attr:Explanation.reason

The rule's reason text, when it has one.

## attr:Explanation.holds

Whether the rule held when `explain` was called.

## attr:Explanation.reads

An object from each path the rule reads to the value it had then.

## attr:Explanation.unknown

The paths among them that were unknown because the field is hidden on its record.
Absent when none.

## staticMethod:selectionPublication

- `selection`: a [[class:Selection]].

Returns a [[object:Publication]] with `selected`, `records`, `keys`, `key`,
`count`, `any` and `many`, typed with the selection's entity type for `selected`,
and `hidden` from [[attr:Selection.hidden]]. Rules read `tasks.selected.title`,
`tasks.any` or `tasks.count`.

## staticMethod:editPublication

- `edit`: an [[class:EditModel]].

Returns a [[object:Publication]] with `values`, `record` (the baseline as saved),
`dirty`, `valid`, `errors`, `mode` (`"create"` for a new record, `"update"`
otherwise), `busy` and `deleted`; `values` and `record` are typed and carry the
hidden fields. So a rule can compare what is typed with what is stored:
`project.values.health` against `project.record.health`.

## staticMethod:collectionPublication

- `collection`: a [[class:Collection]].

Returns a [[object:Publication]] with `total` (its count), `loading` (status is
`"loading"`), `complete` and `stale`. Not typed.

## staticMethod:listPublication

- `list`: a [[class:ListEdit]].

Returns a [[object:Publication]] with `rows`, the values of the rows not marked for
removal, and `count`, typed so that rules can range over the rows with `any` and
`all`: `{ op: "any", field: "answers.rows", where: … }`.

## staticMethod:inputPublication

- `ctx`: the [[class:DataContext]].
- `set`, `key`: the entity set and [[type:KeyText]] the page was opened with.

Returns a [[object:Publication]] with `key` and `record`: the record the page was
opened with, as a live, typed signal (`undefined` until it loads), with its hidden
fields. The input is the key as plain text, so the same address opens the same
page in another tab or window. Throws a [[class:SchemaError]] for an unknown set.

```ts
scope.publish("page", inputPublication(ctx, "Projects", keyText([2])));
scope.value("page.record.lead.name");   // the lead's name, once both records load
```

## staticMethod:valuesPublication

- `values`: names to signals.

Returns a [[object:Publication]] of just those signals, with no types: app state
under names you choose. Their values compare as what they are: numbers and booleans
fully, text for equality only.

```ts
scope.publish("app", valuesPublication({ role, theme }));
```

## class:SharedFilters

The page's shared filter. A contributor puts a [[object:Contribution]] in under its
own name (a chip, a search form, a chart's bar, a selection); a collection opts in
to take the ones that apply to it. Make one with `new SharedFilters(schema)` and
publish it with [[staticMethod:filtersPublication]] if rules or labels should read
it.

Invariants: one entry per contributor; a contribution applies to a collection whole
or not at all; relative dates stay symbolic here and are resolved by each collection
when it fetches.

## attr:SharedFilters.schema

The [[object:Schema]] contributions are checked against. Plain, read only.

## attr:SharedFilters.contributions

Signal of the contributions in order of arrival. A replacement keeps its place.

## method:SharedFilters.set

- `contribution`: a [[object:Contribution]].

Adds it, or replaces the entry with the same `by`, keeping its place. A contribution
that says the same as the one it replaces changes nothing and wakes no reader. If
it has a `set`, its criteria are compiled against that set now, so an unknown field
or a wrong value fails here. Throws a [[class:CriteriaError]] for that, a
[[class:SchemaError]] for an unknown set, and an `Error` when `by` follows a signal
through [[method:SharedFilters.share]].

```ts
filters.set({ by: "status", label: "Status is approved", set: "TimeEntries", criteria: { op: "eq", field: "status", value: "approved" } });
```

## method:SharedFilters.remove

- `by`: the contributor's name.

Withdraws its entry; unknown names do nothing. A contributor that follows a signal
is asked to withdraw through the `clear` it gave to `share`, so its own state agrees
(a chip's remove button clears the selection behind it). Throws an `Error` for a
followed contributor that gave no `clear`.

## method:SharedFilters.removable

- `by`: the contributor's name.

Returns `true` when [[method:SharedFilters.remove]] can withdraw it: it was set by
hand, or follows a signal and gave a `clear`. `false` for a followed contributor
without one, so a chip can be shown unpressable.

## method:SharedFilters.clear

Withdraws every entry that can be removed. Followed contributors without a `clear`
stay.

## method:SharedFilters.share

- `by`: the contributor's name.
- `source`: a signal of a [[type:Shared]] contribution, or `undefined` for none.
- `clear`: optional; how the contributor withdraws when someone else removes its
  entry. It should make `source` `undefined`, such as clearing a selection.

Contributes whatever `source` holds under `by` and follows it: each new value
replaces the entry, `undefined` withdraws it. Returns a function that stops
following and withdraws. A name has one follower at a time; a second `share` for
the same name throws an `Error` (`'projects' is already shared`), and so does
[[method:SharedFilters.set]] for it. Use [[staticMethod:selectionShare]] to share a
selection.

```ts
const stop = filters.share("projects", selectionShare(chosen, (n) => `${n} projects`), () => chosen.clear());
```

## method:SharedFilters.consume

- `set`: the entity set of the collection that will use them.
- `options`: [[object:ConsumeOptions]].

Returns a computed signal of a [[object:Consumed]]: the criteria that apply to a
collection on `set`, which contributions they came from, and which were skipped
and why. Throws a [[class:SchemaError]] for an unknown set. Contributions the
consumer names in `self`, ones scoped to other sets with `only`, and identity
selections on its own set (unless `sameSetSelections`) are left out without a
skip. How each contribution is matched is in the topic text.

```ts
const c = filters.consume("Tasks").value;
c.criteria;          // the applicable criteria, ANDed, or undefined
c.skipped;           // [{ by: "billable", label: "Billable", reason: "Tasks has no field 'billable'" }]
```

## method:SharedFilters.query

- `base`: a [[object:Query]], or a signal of one. Its set decides what applies; a
  signal's set is read once.
- `options`: [[object:ConsumeOptions]].

Returns a computed signal of the query: `base` with the contributions that apply to
its set ANDed onto its filter, after the base's own. When none applies, it is `base`
itself. Hand it to [[method:DataContext.collection]] or [[method:DataContext.groups]]:
they follow it, so a contribution changing reloads the collection.

```ts
const entries = ctx.collection(filters.query({ set: "TimeEntries", orderBy: [{ field: "date", descending: true }] }, { self: "table" }));
```

## staticMethod:filtersPublication

- `filters`: a [[class:SharedFilters]].

Returns a [[object:Publication]] with `contributions`, `labels` (the labels, for
chips and announcements), `count` and `any`, so rules and labels can read the shared
filter: `filters.any`, `filters.labels`.

## staticMethod:selectionShare

- `selection`: a [[class:Selection]].
- `label`: `(count: number) => string`, the contribution said in words.

Returns a signal of a [[type:Shared]] to pass to [[method:SharedFilters.share]]: the
selected keys as "key in these" (an `or` of `and`s for a composite key) on the
selection's set, with kind `"selection"`. Nothing is contributed (`undefined`) while
nothing is selected, so deselecting, or the rows leaving the data, withdraws it.

## staticMethod:compatible

- `from`: the type of a value, or `"relative"` for a [[object:RelativeDate]].
- `to`: the [[type:EdmType]] of the field it would filter.

Returns whether a value of type `from` can filter a field of type `to`: the same
type, or any integer type against any numeric type. `"relative"` is compatible with
`Edm.Date` and `Edm.DateTimeOffset`. A time of day doesn't filter a timestamp.

```ts
compatible("Edm.Int32", "Edm.Decimal");     // true
compatible("Edm.Decimal", "Edm.Int32");     // false
compatible("relative", "Edm.Date");         // true
compatible("relative", "Edm.TimeOfDay");    // false
```

## object:Contribution

One component's part of the shared filter. Plain data.

## attr:Contribution.by

The contributor's name. A new contribution under the same name replaces only that
one, and a consumer can name its own contributions to leave them out.

## attr:Contribution.label

The contribution in words, for chips and announcements: "Status is approved".

## attr:Contribution.criteria

The [[type:Criteria]]. With a `set`, it names that set's properties; without one,
fields by name, which must exist with a compatible type wherever it is applied. It
may use relative dates, which stay symbolic. Without a `set`, `any`, `all` and `via`
aren't allowed.

## attr:Contribution.set

The entity set the criteria are written against. It applies there, and across a
unique shortest path of up to three single-valued navigations, unless
[[attr:Contribution.related]] is `false`. Absent means "by field name".

## attr:Contribution.related

`false` to apply only to collections on `set`, not across foreign keys. Default
`true`. Skipped collections get the reason `<label> applies to <set> only`.

## attr:Contribution.fields

The types of the criteria's fields, by name, when there is no `set`. Without them
the types are inferred from the literals: whole numbers as `Edm.Int32`, other
numbers as `Edm.Double`, text as `Edm.String`, booleans as `Edm.Boolean`. Give them
to filter a `Decimal`, a date or a `Int64` by name.

## attr:Contribution.only

Limits the contribution to collections on these sets; others neither apply it nor
list it as skipped.

## attr:Contribution.kind

[[type:ContributionKind]]; `"filter"` by default.

## type:ContributionKind

`"filter" | "selection" | "value"`. A `filter` is a slice someone chose. A
`selection` is records chosen by identity ("these keys"). A `value` is a value
picked from data ("status is approved", a chart's bar). Only identity selections
are ignored by a list on its own set, and a consumer can take selections and values
from named contributors only ([[attr:ConsumeOptions.from]]); filters always apply.

## type:Shared

A [[object:Contribution]] without its name: what a contributor gives
[[method:SharedFilters.share]], which supplies `by`.

## object:Applied

A contribution as it applies to one collection. Plain data.

## attr:Applied.by

The contributor's name.

## attr:Applied.label

The contribution's label.

## attr:Applied.criteria

The criteria as they apply to this collection: the contribution's own, or, across a
foreign key, a test of the foreign key or a `via`, or, for one without a set,
adapted to the field's JSON form.

## attr:Applied.via

The navigation the contribution was followed through, for one on a related set.
Absent for a contribution on the collection's own set or by field name.

## object:SkippedContribution

A contribution that doesn't apply to one collection, and why: the contributor, its
label, and a reason a page can show ("Tasks has no field 'billable'", "TimeEntries
has no foreign key to Projects"). Plain data. Not to be confused with
[[attr:Schema.skipped]], which lists the metadata the schema left out.

## attr:SkippedContribution.by

The contributor's name.

## attr:SkippedContribution.label

The contribution's label, for showing beside the reason.

## attr:SkippedContribution.reason

Why it doesn't apply: an unknown field, a type mismatch, no foreign key to the
contribution's set, several that make the choice ambiguous, or that it applies to
its own set only.

## object:Consumed

What [[method:SharedFilters.consume]] gives for one collection. Plain data.

## attr:Consumed.criteria

The applied contributions' criteria, ANDed (alone when there is one), or
`undefined` when none applies.

## attr:Consumed.applied

The contributions that apply, as [[object:Applied]], in order.

## attr:Consumed.skipped

The contributions that don't, with reasons, as [[object:SkippedContribution]].

## object:ConsumeOptions

How a consumer takes the shared filter. All optional.

## attr:ConsumeOptions.self

The consumer's own contributor name or names. A component never consumes what it
contributed, so a list that contributes its selection doesn't filter itself by it.

## attr:ConsumeOptions.from

Take selections and values only from these contributors; filters always apply. `[]`
follows none, and absent follows all.

## attr:ConsumeOptions.sameSetSelections

`true` to take an identity selection on the consumer's own set. Off by default, for
lists, which would only copy a peer's selection; turn it on for a KPI that totals
the selected rows.

## object:SelectedValue

A read-only derived signal returned by [[method:PageScope.select]]. It owns any
related-list aggregate requests and subscriptions. Read `value` or `peek()` as
on a signal; dispose it when the consumer goes away. Edit models dispose their
case-based derived signals automatically.

## method:SelectedValue.dispose

Stops aggregate refreshes, ignores outstanding answers, and withdraws the
derived explanation registered by this selection. Safe to call again.

## method:SharedFilters.snapshot

Returns a detached [[object:FilterSnapshot]] of manual slices for saving with a
screen. Symbolic relative dates are retained. Identity selections and
signal-following contributions are excluded.

## method:SharedFilters.restore

- `snapshot`: a [[object:FilterSnapshot]] saved with the screen.

Validates all set-scoped criteria before atomically replacing manual slices.
Preserves live signal owners and identity selections; refuses saved entries
that conflict with a live owner. Invalid versions, duplicate names and invalid
criteria throw without changing the channel. Restore before creating consumers.

## object:FilterSnapshot

Versioned plain data holding the screen's manual filter slices. Serialize it
with the screen's storage and restore using [[method:SharedFilters.restore]].

## attr:FilterSnapshot.version

Snapshot format version, currently `1`. Other versions are refused.

## attr:FilterSnapshot.contributions

Detached manual filter and value contributions in chip order; excludes identity
selections and signal-following owners. Relative dates remain symbolic.

## attr:Explanation.cases

For a derived explanation, the cases that decide its value, in priority order.

## attr:Explanation.matched

Zero-based selected case, or undefined while undecided or when no case applies.

## attr:Explanation.value

The current derived result, including null or undefined for missing data.

## attr:Explanation.overridden

In [[method:EditModel.explain]], whether the user has typed over the suggestion.

## attr:Explanation.current

In [[method:EditModel.explain]], the field's actual current value.

## attr:Explanation.error

Related-list aggregate request error, said as text. A failed aggregate leaves
its value undefined and can be retried by a parent-key change or target-set write.
