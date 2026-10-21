# Change sets and validation

Two pieces of data the editing classes ([[group:editing]]) are built on.

A **change set** says what a save changed, as plain data: a `create` with the
values sent, an `update` with each changed field's old and new value, or a
`delete` with the old values. Every `DataContext` write returns one (inside a
[[object:Saved]] for creates and updates), and `EditModel.changes()`,
`ListEdit.changes()` and `RecordEdit.changes()` say what a save would make.
Because a change set is JSON, it can be stored in a change log, sent,
inverted for undo, merged with the next change to the same record, and
replayed over the values it was made against.

An update can also carry the changes to the collections the record owns
(`owned`, by navigation name), so a record edited across several nested
editors is one change set.

**Validation** follows the same rules on the client as the server applies,
from `$metadata`: required (not nullable), type, length, pattern, minimum and
maximum, allowed values and immutability. `validateField` and
`validateEntity` run those checks; an `EditModel` runs them for you and adds
two more kinds:

- application rules ([[type:Rule]]): functions from the values to messages
  by field, whose messages win over the metadata's;
- criteria validators ([[staticMethod:criteriaRule]]): a rule written as
  criteria, so it can be stored as data rather than code.

Messages use the field's title (`Core.Description`) and say how to fix the
value. `AsterData.RequiredMessage` and `AsterData.ErrorMessage` on a field
replace them.

## Example

```ts
import { invert, merge, keyText, validateField, criteriaRule, EditModel } from "@getaster/data";

const saved = await ctx.update("Projects", keyText([1]), { state: "paused" });
saved.change;          // { kind: "update", set: "Projects", key: [1], changes: { state: { from: "active", to: "paused" } } }
const type = ctx.schema.set("Projects").type;
invert(saved.change, type);   // the update back: state paused → active
merge({ name: { from: "A", to: "B" } }, { name: { from: "B", to: "A" } });   // {}: it ended where it began

validateField(type.field("budget")!, "12.345");   // ["Budget can have at most 2 decimal places."]

const tasks = ctx.schema.set("Tasks").type;
const rules = [criteriaRule(tasks, "title", { failWhen: { op: "startswith", value: "TODO" }, message: "Give it a real title." })];
const edit = new EditModel(ctx, "Tasks", undefined, { projectId: 1, title: "TODO later", done: false }, { rules });
edit.validate();       // false; edit.errors.value.title is ["Give it a real title."]
```

## Limits

- `invert` of an update that carries owned changes throws: undo each child's
  change on its own. `DataContext.run` of an update runs its own field
  changes and ignores `owned`.
- `diff`, `apply` and `merge` work on one record's own fields; they don't
  look at `owned`.
- Client validation is for feedback. The server checks every write again,
  including fields that page rules hid and fields the client can't see.
- Validation `applyWhen` (a rule that decides whether a validator applies)
  isn't built. A [[type:Rule]] can test the values itself.

## type:ChangeSet

One of three shapes, told apart by `kind`:

| `kind` | Fields | Meaning |
|---|---|---|
| `"create"` | `set`, `values` | A record created with these values |
| `"update"` | `set`, `key`, `changes`, optional `owned` | These fields changed from `from` to `to`; `owned` holds the owned collections' changes |
| `"delete"` | `set`, `key`, `values` | This record was deleted; `values` were its values (fields hidden from the caller left out) |

`key` is the key values in key order ([[type:KeyValues]]), such as `[4]`.

What a create holds depends on where it came from: one returned by
`DataContext.create` holds what was sent, which leaves out values equal to
the server's defaults ([[staticMethod:creatable]]); one from
`EditModel.changes()` holds every value.

```ts
import type { ChangeSet } from "@getaster/data";

const change: ChangeSet = {
  kind: "update",
  set: "Fields",
  key: [4],
  changes: { label: { from: "Client type", to: "Type of client" } },
  owned: { answers: [{ kind: "delete", set: "Answers", key: [1], values: { id: 1, fieldId: 4, key: "individual", label: "Individual", position: 1 } }] },
};
await ctx.run({ kind: "update", set: "Projects", key: [2], changes: { health: { from: "onTrack", to: "atRisk" } } });
```

See [[method:DataContext.run]], [[method:DataContext.undo]] and
[[classMethod:RecordEdit.replay]].

## object:FieldChange

One field's change in an update: its value before and after. Both are
[[type:Value]]s in the field's JSON form; a field that had no value counts
as `null`.

## attr:FieldChange.from

The value before the change.

## attr:FieldChange.to

The value after the change: what an update sends for the field.

## type:OwnedChanges

Each entry is a `create`, an `update` or a `delete` [[type:ChangeSet]] on
the child's set. Children are named by key, not by position. A
[[class:RecordEdit]] builds these; each list's changes are in the order the
list saves them: deletions, updates, creations. New children have no key yet,
so a create holds their values only.

## staticMethod:apply

- `entity`: a record's values.
- `changes`: field changes, such as an update's `changes`.

Returns a new object: `entity` with each changed field set to its `to`. It
doesn't check that `from` matches `entity`. Use it to rebuild the values
after a change, for example to replay a logged update:

```ts
import { apply, EditModel } from "@getaster/data";

const after = apply(before, change.changes);
const shown = EditModel.replay(ctx, change.set, before, after);
```

## staticMethod:creatable

- `type`: the entity type.
- `values`: the values a create would send.

Returns the writable values ([[staticMethod:writable]]) that differ from the
field's `$DefaultValue`, or from `null` for a field without one. Values are
compared exactly (`Object.is`), so `"1.0"` and a default of `"1"` count as
different. `DataContext.create` and a `RecordEdit`'s new rows send this, so
the server applies its own defaults.

```ts
creatable(ctx.schema.set("Tasks").type, { id: 99, projectId: 1, title: "Brief", parentId: null });
// { projectId: 1, title: "Brief" }: id is computed, parentId is null and has no default
```

## staticMethod:diff

- `baseline`: the values before.
- `current`: the values now.

Returns the field changes by name, `{ from, to }` each. Values are compared
exactly; a field missing from `baseline` counts as `null`. A field missing
from `current` isn't a change, so pass whole records to see every
difference.

```ts
diff({ name: "A", state: "active" }, { name: "B", state: "active" });   // { name: { from: "A", to: "B" } }
```

## staticMethod:invert

- `change`: the change set to undo.
- `type`: the entity type of `change.set`, for leaving out computed fields.
- `created`: for a create, the key the server gave the record.

Returns the change set that undoes it:

- a create becomes a delete of `created` with the created values; without
  `created` it throws;
- an update becomes an update with each `from` and `to` swapped; with
  `owned` it throws;
- a delete becomes a create of the old values less computed fields, so the
  record comes back with a new server-assigned key.

[[method:DataContext.undo]] does this for a [[object:Saved]] and pins the
undo to the version the save produced, so a change made since is a 412
rather than overwritten.

```ts
const created = await ctx.create("Tasks", { projectId: 1, title: "Brief", done: false });
const undo = invert(created.change, ctx.schema.set("Tasks").type, keyFromText(created.key));
await ctx.run(undo);   // deletes it again
```

## staticMethod:merge

- `a`: the first change's field changes.
- `b`: the later change's field changes.

Returns one set of field changes: for each field, `a`'s `from` and `b`'s
`to`. Fields that end where they began are dropped. Neither argument is
changed. Use it to collapse two updates of one record in a change log into
one entry; it takes the `changes` of each, not the whole change sets.

```ts
merge({ name: { from: "A", to: "B" } }, { name: { from: "B", to: "C" }, state: { from: "active", to: "paused" } });
// { name: { from: "A", to: "C" }, state: { from: "active", to: "paused" } }
```

## staticMethod:writable

- `type`: the entity type.
- `values`: any values.

Returns the values of fields that exist on the type and aren't computed
(`Core.Computed`). Names the type doesn't have are dropped too.
`DataContext.run` and `invert` use it so a replayed or undone change never
sends a server-set field.

## staticMethod:validateEntity

- `type`: the entity type.
- `values`: the values to check.
- `mode`: `"create"` checks every field that isn't computed, so a missing
  required field is an error; `"update"` checks only the fields present in
  `values`, so pass the changed fields.

Returns the errors by field ([[type:FieldErrors]]), empty when everything
passes. Computed fields are never checked. On update, an immutable
(`Core.Immutable`) field among `values` is an error whatever its value.
Each field gets at most one message, from [[staticMethod:validateField]].

```ts
const type = ctx.schema.set("Tasks").type;
validateEntity(type, {}, "create");
// { projectId: ["Project is required."], title: ["Task is required."], done: ["Done is required."] }
validateEntity(type, { title: "" }, "update");   // { title: ["Task can't be blank."] }
```

## staticMethod:validateField

- `field`: a field from the entity type (`type.field("budget")`).
- `value`: its value in the field's JSON form; `undefined` counts as missing.

Returns an empty list when the value passes, otherwise a list with one
message. The checks, in order, stopping at the first failure:

1. Missing or `null`: an error unless the field is nullable or computed.
2. Type: a boolean; a finite number for `Edm.Single` and `Edm.Double`; a
   whole number for `Edm.Byte`, `Edm.SByte`, `Edm.Int16` and `Edm.Int32`;
   digits as text or a number for `Edm.Int64` (no fraction or exponent) and
   `Edm.Decimal` (an exponent is allowed, and the field's scale limits the
   decimal places); a real calendar date as `YYYY-MM-DD` for `Edm.Date`;
   text for every other type.
3. Text length, counted in characters (code points), against
   `$MaxLength` and `AsterData.MinLength`, then `Validation.Pattern`.
4. `Validation.Minimum` and `Validation.Maximum`, exclusive where marked,
   compared by the field's type.
5. `Validation.AllowedValues`, compared by type, so Decimal `"1.0"` matches
   `"1"`.

```ts
const budget = ctx.schema.set("Projects").type.field("budget")!;
validateField(budget, "1.25e2");     // []
validateField(budget, "1.2345e1");   // ["Budget can have at most 2 decimal places."]
validateField(ctx.schema.set("TimeEntries").type.field("date")!, "2026-02-30");   // ["Date must be a date, like 7 Oct 2026."]
```

## type:FieldErrors

Messages by field name. Plain data. [[attr:EditModel.errors]] holds one;
there an application rule may also add a name that isn't a field.

## type:Rule

Pass rules in [[attr:EditOptions.rules]]. A rule gets the whole record's
current values, including fields hidden by page rules, and returns a message
for each field it finds wrong, or `undefined` for a field that's fine.
Fields it leaves out are untouched.

The edit model runs rules on every check, after the metadata's: the first
rule to give a message for a field replaces the metadata's message for it,
and later rules' messages for that field are ignored. Errors on fields a page
rule hides aren't shown. Because `valid` re-runs the check whenever the
values change, a rule should be quick, and it should be pure; if it reads
signals, `valid` follows them.

```ts
import { EditModel, type Rule } from "@getaster/data";

const withinBudget: Rule = (v) => ({
  spent: Number(v.spent ?? 0) > Number(v.budget ?? 0) ? "Spent can't be more than the budget." : undefined,
});
const edit = new EditModel(ctx, "Projects", keyText([1]), {}, { rules: [withinBudget] });
```

## staticMethod:criteriaRule

- `type`: the entity type of the edited record.
- `field`: the field the message goes on.
- `validator`: a [[object:CriteriaValidator]] with exactly one of `passWhen`
  and `failWhen`, and the message.
- `now`: optional clock for relative dates, in milliseconds. Default
  `Date.now`; pass the context's (`ctx.now`) so rules and queries agree.

Returns a [[type:Rule]] for [[attr:EditOptions.rules]]. Throws when the
validator has neither or both of `passWhen` and `failWhen`. The rule gives no
error while the field is empty (`null` or missing): required is checked
separately. Otherwise it evaluates the criteria against the record's values
with the type's OData semantics, relative dates resolved at that moment.

```ts
const type = ctx.schema.set("Tasks").type;
const rules = [
  criteriaRule(type, "title", { failWhen: { op: "startswith", value: "TODO" }, message: "Give it a real title." }),
  criteriaRule(type, "due", { passWhen: { op: "ge", value: { relative: "today", days: -365 } }, message: "Due dates go back a year at most." }, ctx.now),
  // A test that names a field reads the record; one without names the validated field.
  criteriaRule(type, "assigneeId", {
    failWhen: { op: "and", args: [{ op: "eq", field: "done", value: true }, { op: "eq", value: 12 }] },
    message: "Ken can't hold done tasks.",
  }),
];
const edit = new EditModel(ctx, "Tasks", key, {}, { rules });
```

## object:CriteriaValidator

The input to [[staticMethod:criteriaRule]]. Plain data, so it can be stored
with a screen's definition or authored in a rule builder.

## attr:CriteriaValidator.passWhen

The value is valid while this holds; give this or `failWhen`. See
[[type:OwnCriteria]].

## attr:CriteriaValidator.failWhen

The value is invalid while this holds; give this or `passWhen`. See
[[type:OwnCriteria]].

## attr:CriteriaValidator.message

The error shown on the field when the value fails. It wins over the
metadata's message for that field.

## type:OwnCriteria

The criteria of a [[object:CriteriaValidator]]: ordinary [[type:Criteria]],
with `and`, `or` and `not`, except that a leaf can leave out `field`
([[type:OwnTest]]), and then it tests the field being validated. A leaf that
names a field reads that field of the record.

```ts
// "the field is after the start", for an end-date field:
const after: OwnCriteria = { op: "gt", other: "start" };
// "between 1 and 10, unless the task is done":
const ranged: OwnCriteria = { op: "or", args: [{ op: "eq", field: "done", value: true }, { op: "and", args: [{ op: "ge", value: 1 }, { op: "le", value: 10 }] }] };
```

## type:OwnTest

Any comparison leaf of [[type:Criteria]] without its `field`: `eq`, `ne`,
`gt`, `ge`, `lt`, `le` against a `value` or another field (`other`), `in`
with `values`, and `contains`, `startswith`, `endswith`. In
[[type:OwnCriteria]] the validated field fills the missing `field`.
