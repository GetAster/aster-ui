# Editing records

Aster UI keeps uncommitted edits apart from the stored data. The
`RecordStore` holds the one copy of each record the server has accepted; an
edit model holds what the person has typed since, and nothing reaches the
store until the server accepts a save. Three classes cover the cases:

| Class | Edits | Saves as |
|---|---|---|
| `EditModel` | One record's fields, new or existing | One create (POST) or one update (PATCH) of the changed fields |
| `ListEdit` | The rows of a collection: changed rows, new rows, rows marked for deletion | One write per row, in order: deletions, updates, creations. Not atomic |
| `RecordEdit` | An existing record and the collections it owns (`AsterData.Owned` in `$metadata`) | One deep update (`<navigation>@delta`), all or nothing |

A form binds to an `EditModel` ([[class:Form]] takes it as its `model`); a
grid or repeating group edits through a `ListEdit`, which holds an
`EditModel` per row; a record editor with tabs of child rows uses a
`RecordEdit`, which holds an `EditModel` for the record and a `ListEdit` for
each owned collection.

## Concepts

**Baseline and values.** An edit model has a *baseline*, the stored record
the edit started from (or the defaults, for a new record), and *values*, what
the edit holds now. Both are signals. A field is *pending* when its value
differs from the baseline, or when pending is forced on for it; `dirty` is
true while any field differs. Changing a field back by hand clears its
pending state. New rows of a `ListEdit` are forced pending in every writable
field, so they show as changed in full.

**Validation.** `valid` is a signal that says whether the values would pass,
without showing anything. `validate()` runs the same check and shows the
errors in `errors`. Once a field shows an error, the error follows the
value: it changes as the person types and clears as soon as the value is
valid. The check is the field's metadata (on an update, only the changed
fields), fields required by page rules, then the application's own rules,
whose messages win. See [[group:changes]].

**Field state.** `state(name)` is a signal of the field's `FieldState`
(visible, enabled, read-only, required, with reasons). It combines page rules
([[group:page-rules]]) with what the metadata and record say: computed fields
are read-only, immutable fields once saved, every field of a deleted record,
and every field the server hides from this caller on this record.
`set()` refuses a read-only field and shows the reason as its error.

**Hidden fields.** A field the server hides on a record (`@AsterData.Hidden`)
comes back as `null`, which means "not yours to see". The edit model treats
it as unknown: read-only, never pending, never validated, never sent.

**Conflicts and deletion.** Each edit model watches the store for its
record. A change made elsewhere (another component, another user, a reload)
is followed when nothing is edited here, taken in under the local edits when
it touched other fields, and raised as `conflict` when it touched a field
edited here. Then `save()` refuses until `rebase()` (keep the local values on
top of theirs) or `discard()` (take theirs). If the record is deleted,
`deleted` turns true, every field becomes read-only and `save()` refuses.
Saves send the baseline's ETag; on a 412 the context reloads the record, and
if that reload touched no field edited here the save is sent once more.

**Drafts.** `draft()` returns the working state as plain data that survives
`JSON.stringify`, and `resume(draft)` takes it up after a reload. Where a
draft is kept (IndexedDB, local storage) is the application's choice. A
stored record that moved on since the draft was made is followed or raised as
a conflict, as for any external change.

**Replay.** A saved change is a `ChangeSet` (plain data, see
[[group:changes]]). `replay` shows it over the values it was made against:
the old values become the baseline and the change is applied, so pending
marks exactly what changed, including added, updated and removed rows. A
replay is read-only and never saves. A change log can keep each save's
`before` and `change` as JSON and replay them later.

## Example

A questionnaire field and its answers, edited as one thing. The record has to
be in the store before a `RecordEdit` (or an `EditModel` of an existing
record) is made.

```ts
import { RecordEdit, keyText } from "@getaster/data";

await ctx.collection({ set: "Fields", filter: { op: "eq", field: "id", value: 4 } }).ensure(0, 1);
const field = new RecordEdit(ctx, "Fields", keyText([4]), { owned: { answers: { positionField: "position" } } });
await field.ready;                                  // the owned answers and clauses have loaded

field.edit.set("label", "Type of client");          // the record's own fields
field.edit.pending("label").value;                  // true

const answers = field.owned.answers!;               // a ListEdit
const [first, second] = answers.rows.value;
second!.edit.set("label", "Limited company");
second!.edit.revert();                              // that row is back to its baseline
answers.remove(first!.id);                          // marked for deletion, shown struck through
answers.restore(first!.id);                         // and taken back
answers.add({ key: "club", label: "Club" });        // pending in full; its fieldId is the record's

const result = await field.save();                  // one PATCH with answers@delta
if (result === undefined) {
  // Nothing to save, a conflict, or invalid: see field.problems() and field.edit.conflict
} else if (!result.ok) {
  // Refused: nothing saved, errors are on the fields and rows, or in field.failure
} else {
  log.push(JSON.stringify({ before: result.before, change: result.change }));   // for a change log
}
field.dispose();
```

## Limits

- `ListEdit.save()` writes one record at a time and isn't atomic; a failed row
  stays pending while the others are saved. Only a `RecordEdit` saves a record
  and its owned rows in one request. The client sends no `$batch`.
- A `ListEdit` edits the rows its collection has loaded. Load the collection
  fully (`loadAll()`) before editing; a `RecordEdit` does this for its owned
  collections, so very large owned collections are loaded whole.
- A `RecordEdit` edits an existing record. Create the record first with an
  `EditModel` (or `DataContext.create`), then open it.
- A `RecordEdit` checks for conflicts on the record only: the request carries
  the record's ETag, and the owned rows' changes are sent without one.
- The edit models keep no undo stack. [[method:DataContext.undo]] undoes one
  save of a record's own fields, but [[staticMethod:invert]] throws for a
  change with owned changes, so a `RecordEdit` save that changed rows can't be
  undone that way.
- Change sets don't record whether a value was typed or derived from page
  rules; `EditModel.derived(name)` says so while editing.

## class:EditModel

Construct it with `new EditModel(ctx, set, key?, defaults?, options?)`:

- `ctx`: the `DataContext` it reads from and saves through.
- `set`: the entity set's name, such as `"Projects"`.
- `key`: the key text of an existing record (`keyText([2])`). The record must
  already be in the store, or the constructor throws `Projects [2] isn't
  loaded`. Leave it out for a new record.
- `defaults`: for a new record, the starting values, which are also its
  baseline. Ignored when `key` is given.
- `options`: [[object:EditOptions]], the application's validation rules.

The model subscribes to the store when it's made; call `dispose()` when the
editor closes.

```ts
import { EditModel, keyText } from "@getaster/data";

await ctx.reload("Projects", keyText([2]));          // the record must be in the store
const edit = new EditModel(ctx, "Projects", keyText([2]));
edit.set("name", "");
edit.valid.value;                    // false, and nothing is shown yet
edit.validate();                     // false; errors are shown now
edit.errors.value.name;              // ["Project can't be blank."]
edit.set("name", "Brand refresh 2027");
edit.errors.value.name;              // undefined: the error followed the value
edit.pending("name").value;          // true

const saved = await edit.save();     // a Saved, or undefined with the reason in errors, formError, conflict or deleted
edit.dispose();
```

A new record:

```ts
const task = new EditModel(ctx, "Tasks", undefined, { projectId: 3, title: "", done: false });
task.isNew.value;                    // true
task.set("title", "Write the brief");
const created = await task.save();   // POST; afterwards task.key.value is the new key and isNew is false
```

See also [[class:ListEdit]], [[class:RecordEdit]] and [[group:editing]].

## attr:EditModel.entitySet

The entity set the record belongs to, as given to the constructor. Plain,
read-only.

## attr:EditModel.type

The record's entity type from `$metadata`, with its fields, key and
navigations. Plain, read-only. Use it to look up a field's title or
annotations, or to pass to [[staticMethod:criteriaRule]].

## attr:EditModel.key

A signal of the record's key text, or `undefined` for a new record. It
changes once, when a new record's first save succeeds and the server assigns
the key.

## attr:EditModel.baseline

A signal of the values the edit started from: the stored record when the
model was made, or the defaults for a new one. It moves when the store's
record changes and nothing here conflicts with it, on `accept()`,
`rebase()`, `discard()` and after a successful save. In a replay it's the
old values. [[method:EditModel.pending]] compares each field with it.

## attr:EditModel.values

A signal of the current values: the baseline with the local changes applied.
Each change replaces the object, so read `edit.values.value` again rather
than keeping it. To change a field, use [[method:EditModel.set]].

## attr:EditModel.hidden

A signal of the field names the server hides from this caller on this
record, empty when none are. These fields hold `null` in `values`; the model
makes them read-only with the reason "You can't see Budget on this record.",
never marks them pending, never validates them and never sends them.

## attr:EditModel.errors

A signal of the errors shown, by field name, each a list of messages
([[type:FieldErrors]]). It's empty until [[method:EditModel.validate]] or
[[method:EditModel.save]] runs, or until `set()` refuses a read-only field.
After that, an error follows its field's value. A save that the server
refuses puts the server's field errors here. An application rule can return a
message under a name that isn't a field; it's kept here too, and makes
`valid` false.

## attr:EditModel.formError

A signal of the message for a failure that isn't about one field: the
server's message for a refused save with no field errors, or "This record
has been deleted, so these changes can't be saved." `undefined` otherwise.
Cleared when a save starts and on `accept()`.

## attr:EditModel.busy

A signal that is true while a save is in flight. A second `save()` during it
returns `undefined` at once.

## attr:EditModel.conflict

A signal of the current [[object:Conflict]], or `undefined`. It's set when a
change made elsewhere touches a field that's edited here, including a field
that becomes hidden on the record. While it's set, `save()` returns
`undefined`. Clear it with [[method:EditModel.rebase]] or
[[method:EditModel.discard]].

```ts
if (edit.conflict.value) {
  const { theirs, fields } = edit.conflict.value;
  // show theirs[f] beside edit.values.value[f] for each f in fields, then:
  edit.rebase();     // keep my values on top of theirs
  // or edit.discard(); to take theirs
}
```

## attr:EditModel.deleted

A signal that turns true when the store reports the record removed, whether
someone else deleted it (seen on a reload or a 404) or another part of this
client did. Every field becomes read-only with the reason "This record has
been deleted.", `formError` says the changes can't be saved, and `save()`
returns `undefined`. It doesn't turn false again.

## attr:EditModel.isNew

A computed signal: true while the model has no key, so a save would create
the record. A replay is also built without a key, so `isNew` is true there.

## attr:EditModel.dirty

A computed signal: true while any field not hidden on the record differs from
the baseline. Forced pending doesn't make it true, so a new record that
still holds its defaults isn't dirty. A field changed back by hand stops
counting.

## attr:EditModel.valid

A computed signal. It re-runs the whole check (metadata, rules, page rules)
each time the values or the page rules it reads change, but never touches
`errors`. Use it to enable a Save button; use `validate()` to show what's
wrong.

## classMethod:EditModel.replay

- `ctx`: the data context, for the schema.
- `set`: the entity set.
- `before`: the values the change was made against; they become the baseline.
- `after`: the values after the change.
- `forced`: optional field names to show as pending even though `before` and
  `after` agree, such as every field of a created record.

Returns an `EditModel` with no key, so `isNew` is true and
[[attr:EditModel.replaying]] is true. Every field is read-only with the
reason "This is a past change.", `set()` shows that reason as an error,
`save()` returns `undefined`, and derived values from page rules aren't
applied. `revert()` and `discard()` aren't blocked and would put the baseline
back, so don't offer them on a replay.

```ts
import { EditModel, apply } from "@getaster/data";

// A change log entry kept as JSON: the record before and the update's field changes.
const { before, change } = JSON.parse(entry);
const shown = EditModel.replay(ctx, change.set, before, apply(before, change.changes));
shown.pending("name").value;   // true only for the fields the change touched
```

[[classMethod:RecordEdit.replay]] does this for a record and its owned rows.

## method:EditModel.accept

- `saved`: optional, the record as the server returned it (a
  [[object:StoredRecord]]). Without it, the current values become the
  baseline.

Use it when something else saved this record's values, such as a parent's
deep update that included this row. The baseline (and, with `saved`, the
values, hidden fields and ETag) move to the saved state. Forced pending, the
fields typed over derived values, `errors` and `formError` are cleared.
Nothing is sent. [[method:RecordEdit.save]] calls it on the record's model
and [[method:ListEdit.accept]] on each changed row.

## method:EditModel.showErrors

- `errors`: messages by field name ([[type:FieldErrors]]).

Replaces everything in `errors` with these. It sends nothing and doesn't
validate. [[method:RecordEdit.save]] uses it to put a refused deep update's
errors on the rows they name. Like any shown error, each one follows its
field's value from then on.

## method:EditModel.draft

Returns an [[object:EditDraft]]: the key, baseline, values, ETag, the fields
forced pending, and the fields typed over a derived value. It's plain data,
so `JSON.stringify` keeps it. Taking a draft changes nothing.

```ts
localStorage.setItem("draft:project:2", JSON.stringify(edit.draft()));
// after a reload, once the record is in the store again:
const again = new EditModel(ctx, "Projects", keyText([2]));
again.resume(JSON.parse(localStorage.getItem("draft:project:2")!));
```

## method:EditModel.resume

- `draft`: an [[object:EditDraft]] from `draft()`, possibly read back from
  storage.

Throws when the draft is of another record (or of a new record, for a model
with a key, or the other way round). Otherwise the baseline, values, ETag,
forced pending and typed fields are replaced by the draft's. Then the stored
record is compared with the draft's ETag: if it moved on, the change is
followed where nothing was edited, taken in under the edits where it touched
other fields, or raised as [[attr:EditModel.conflict]]. Nothing is sent.

## method:EditModel.get

- `name`: a field name.

Returns the field's current value, or `undefined` if the values don't have
it (a new record whose defaults left it out). It reads the `values` signal,
so inside a `computed` it tracks the value. Unlike `set`, it doesn't check
that the field exists.

## method:EditModel.set

- `name`: a field of the record's type. An unknown name throws
  `Project has no field nmae`.
- `entered`: the new value in the field's JSON form: text for strings, dates
  (`"2026-10-07"`), Decimal and Int64; numbers for the other numeric types;
  booleans; `null`.

When the field's state is read-only (by metadata, a page rule, a hidden or
deleted record, or a replay), the value doesn't change and the reason is
shown as the field's error. `enabled: false` from a page rule doesn't block
`set`; it's for the element to show. Setting a field that has a derived value
stops suggestions for it ([[method:EditModel.derived]]). Nothing is
validated unless the field already shows an error, which is then replaced by
the current problem or cleared.

```ts
const f = new EditModel(ctx, "Fields", keyText([4]));
f.set("help", "");    // Help text is marked AsterData.EmptyAsNull: the value becomes null
f.set("id", 9);       // computed: unchanged, and f.errors.value.id is ["id is set by the server."]
```

## method:EditModel.applyRules

- `scope`: the page's [[class:PageScope]].
- `target`: the name the rules are registered under, usually the key the
  model is published under; a field's rules are `<target>.<field>` in
  [[method:PageScope.explain]].
- `rules`: [[object:FieldRules]] by field name: `visible`, `enabled`,
  `readOnly`, `required`, `clearWhenHidden` and `derived`.

Call it once, before the fields are shown; a second call adds to the ruled
fields and registers its rules in the scope again. Throws for a field the
type doesn't have, and for a derived value on a computed field. A field's
derived value is applied at once on a new record; on an existing record the
stored value stands until the derived value first changes.

How the effects reach the model:

- **required** is checked by `validate()` and `valid` like the metadata's
  required.
- **readOnly** blocks `set()`. A value changed before the field became
  read-only stays pending and is sent.
- **visible: false** skips the field's client-side validation; its value is
  kept and sent. With `clearWhenHidden`, a change from shown to hidden sets it
  to `null`, and that `null` is the change. A field that starts hidden keeps
  its value.

```ts
import { editPublication, PageScope, type Condition } from "@getaster/data";

const scope = new PageScope(undefined, { ctx });
scope.publish("project", editPublication(edit));
const BEHIND: Condition = { op: "eq", field: "project.values.health", value: "behind" };
edit.applyRules(scope, "project", {
  behindDays: { visible: BEHIND, required: BEHIND, clearWhenHidden: true },
  name: { readOnly: { when: { op: "eq", field: "project.record.state", value: "archived" }, reason: "Archived projects can't be edited." } },
});
```

See [[group:page-rules]].

## method:EditModel.derived

- `name`: a field name.

Returns a cached computed signal. It's true while the field has a derived
value from [[method:EditModel.applyRules]], the person hasn't typed over it,
and the field holds that value now. It's false for a field without a derived
value, and while the derived value is `undefined` (no case applies, or a
related record is still loading). Use it to mark a suggested value in the
UI. `revert(name)` clears the typed mark, so the next change to the derived
value suggests again.

```ts
edit.applyRules(scope, "task", { title: { derived: [{ template: "Follow up on project {task.values.projectId}" }] } });
edit.derived("title").value;   // true on a new task: it holds the suggestion
edit.set("title", "Call the printer");
edit.derived("title").value;   // false: typed over, and later changes no longer suggest
```

## method:EditModel.explain

- `name`: a field name.

Returns the field's page rules as [[object:Explanation]]s, with whether each
holds and what it read, at the moment of the call (not a signal). An empty
list before `applyRules`. It doesn't include the metadata's part of the state
(computed, immutable, hidden); [[method:EditModel.state]] has those reasons.

Derived fields include their cases, selected case, input paths and result, plus
the field's current value and whether the user overrode it. A signal computed
in code has a result and override state without authored cases.

## method:EditModel.state

- `name`: a field of the record's type; an unknown name throws.

Returns a cached computed signal of the field's [[object:FieldState]]. Page
rules come first; then, in this order, a replay, a deleted record, a field
hidden on the record, and a computed field (or an immutable one once saved)
make it read-only with a reason. A field that isn't nullable and isn't
computed is required. A page rule's own `readOnly` reason is kept for
computed and immutable fields.

```ts
edit.state("updatedAt").value;   // { readOnly: true, reasons: { readOnly: "Updated is set by the server." }, visible: true, … }
edit.state("name").value.required;   // true: not nullable
```

## method:EditModel.pending

- `name`: a field name.

Returns a cached computed signal: true while the field's value differs from
the baseline (a missing value counts as `null`), or pending is forced on for
it. Always false for a field hidden on the record. Pending styling on fields
and their titles binds to it.

## method:EditModel.forcePending

- `name`: a field name.
- `on`: true to show the field as pending whatever its value, false to stop.

Marks a field pending without a change, as a `ListEdit` does for every
writable field of a new row, or as an application might for a version
number it bumped. It doesn't make the model dirty and doesn't change what a
save sends. A save and `accept()` clear it, `resume` takes the draft's, and
`revert()` leaves it. A field hidden on the record is never pending, forced or not.

## method:EditModel.revert

- `name`: optional, one field to revert. Without it, every field.

Puts the baseline's value back (`null` for a field the baseline lacks) and
clears that field's error, or all errors. A field typed over a derived value
takes suggestions again from the next change; a read-only field with a
derived value takes it again at once. It doesn't clear a conflict, forced
pending or `formError`, and sends nothing.

## method:EditModel.validate

Runs the check that `valid` runs and shows the result in `errors`, replacing
what was shown. Returns true when there are no errors. Fields hidden by a
page rule or by the server aren't checked; the server still checks what it's
sent. On an existing record, the metadata check covers changed fields only,
so a stored value that breaks a newer constraint doesn't block a save of
other fields.

## method:EditModel.changes

Returns a [[type:ChangeSet]] describing the save as it would be now:

- for an existing record, an `update` with the changed fields' `{ from, to }`
  (hidden fields left out), or `undefined` when nothing differs;
- for a new record, always a `create` with every value, even before anything
  has changed. What a create actually sends is smaller: the context leaves
  out values the server would store anyway ([[staticMethod:creatable]]).

It reads without tracking (`peek`), so it isn't reactive.

## method:EditModel.save

Resolves to a [[object:Saved]] (`key`, `record`, `change`) or `undefined`.
In order:

1. Returns `undefined` at once for a replay, while busy, with a conflict, or
   for a deleted record.
2. Validates and shows errors; returns `undefined` if any.
3. Returns `undefined` for an existing record with nothing changed.
4. Sends a POST of the values for a new record, or a PATCH of the changed
   fields with the baseline's ETag (`If-Match`). `busy` is true meanwhile.
5. On a 412 the context reloads the record. If that reload took the other
   change in silently, the values are validated and sent once more; if it
   raised a conflict, `conflict` says so.
6. On success the saved record becomes the baseline, the new key (for a
   create) is set, and forced pending and errors are cleared. Values typed
   while the save was in flight stay on top and remain pending.
7. On an `ODataError`, the server's field errors go to `errors`; anything
   else, unless a conflict or deletion explains it, goes to `formError`.

Errors other than `ODataError` (a transport failure that isn't an OData
response, a bug) are rethrown. The store changes only after the server
accepts the write, and the model ignores the store's echo of its own save.

```ts
const saved = await edit.save();
if (!saved) {
  if (edit.conflict.value) { /* offer rebase() or discard() */ }
  else if (edit.deleted.value) { /* close the editor */ }
  else { /* edit.errors and edit.formError say what's wrong; nothing changed if both are empty */ }
}
```

## method:EditModel.rebase

Does nothing without a conflict, or when the record is no longer in the
store. Otherwise the stored record becomes the baseline (with its ETag and
hidden fields), every local change is reapplied on top, including the fields
both sides changed, so the local value wins, and `conflict` is cleared. A
local change to a field that is now hidden is dropped. Nothing is sent; the
next `save()` sends the local changes against the newer ETag.

## method:EditModel.discard

Drops every local change: the stored record, if there is one, becomes the
baseline and the values, and `errors` and `conflict` are cleared. For a new
record the values go back to the defaults. Nothing is sent.

## method:EditModel.dispose

Stops watching the store and stops the effects `applyRules` started
(clear-when-hidden and derived values). Call it when the editor goes away;
the model's signals still read afterwards but no longer follow the store.
`ListEdit.dispose` and `RecordEdit.dispose` dispose the models they hold.

## attr:EditModel.replaying

Plain, read-only. True for a model made by [[classMethod:EditModel.replay]].
A bound field uses it to draw pending values as a past change.

## attr:EditModel.etag

Plain, read-only, `undefined` for a new record or a set without optimistic
concurrency. It moves with the baseline: after a save, `accept(saved)`,
`rebase()`, `discard()`, or an external change taken in. A save sends it as
`If-Match`.

## object:Conflict

What [[attr:EditModel.conflict]] holds: the server's newer record and the
fields that both it and this edit changed since editing began. Plain data.

## attr:Conflict.theirs

The other side's values for the whole record. The local values are in
`edit.values`, and the values both started from in `edit.baseline`.

## attr:Conflict.fields

Field names edited here that the other change also changed, or that became
hidden on the record. Fields only one side changed aren't listed;
[[method:EditModel.rebase]] keeps the local value for these and takes theirs
for the rest.

## object:FieldRules

What [[method:EditModel.applyRules]] takes for one field: the state rules of
[[object:StateRules]] (`visible`, `enabled`, `readOnly`, `required`, each a
condition over the page scope), plus the two edit-only rules below.

```ts
// The project form's fields, published in the scope as "project".
edit.applyRules(scope, "project", {
  behindDays: { visible: { op: "eq", field: "project.values.health", value: "behind" }, clearWhenHidden: true },
});
// A time entry's billable suggestion, from whether its project has a client.
entry.applyRules(scope, "entry", {
  billable: { derived: [{ when: { op: "ne", field: "entry.values.project.clientId", value: null }, value: true }, { value: false }] },
});
```

## attr:FieldRules.clearWhenHidden

`true` sets the field to `null` when it goes from shown to hidden, so a
value the person can no longer see isn't saved. A field that starts hidden
keeps its value; only the change from shown to hidden clears it, whatever
order the page was set up in. The cleared value is an ordinary change:
pending, and revertible while the field is shown again.

## attr:FieldRules.derived

Gives the field a value from the page: cases for [[method:PageScope.select]]
(the first case whose rule holds wins; see [[type:Case]]), or a signal
computed in code holding the value in the field's JSON form. On a read-only
field the derived value always replaces the value. On an editable field it's
a suggestion: it follows the cases until the person changes the field, and
then their value stays (drafts remember this). A record opened for editing
keeps its stored value until the derived value first changes. A computed
field can't have one: [[method:EditModel.applyRules]] throws.

## object:EditDraft

Returned by [[method:EditModel.draft]] and taken by
[[method:EditModel.resume]]. Keep it as JSON; don't build one by hand.

## attr:EditDraft.key

The record's key text, absent for a new record. `resume` throws if it isn't
the model's key.

## attr:EditDraft.baseline

The values the edit started from when the draft was taken.

## attr:EditDraft.values

The edit's values when the draft was taken.

## attr:EditDraft.etag

The ETag of the baseline's version, absent for a new record or a set without
concurrency. On `resume`, a stored record with a different ETag is treated as
an external change.

## attr:EditDraft.forced

The field names forced pending, such as every writable field of a new row.

## attr:EditDraft.typed

Absent when there are none. On `resume` these fields keep the person's value
and take no suggestions.

## object:EditOptions

The options of an [[class:EditModel]]. [[object:ListEditOptions]] and
[[object:RecordEditOptions]] extend it, and pass the rules to every row's
model.

## attr:EditOptions.rules

Application validation rules, run in order after the metadata checks; the
first rule to give a message for a field wins over the metadata's message
and over later rules. Default: none. See [[type:Rule]] and
[[staticMethod:criteriaRule]].

```ts
const taken = new Set(["ada lovelace"]);
const invite = new EditModel(ctx, "Members", undefined, { name: "", role: "view" }, {
  rules: [(v) => ({ name: taken.has(String(v.name ?? "").toLowerCase()) ? `${v.name} already has access.` : undefined })],
});
```

## class:ListEdit

Construct it with `new ListEdit(ctx, collection, options?)`:

- `ctx`: the data context.
- `collection`: the [[class:Collection]] whose rows are edited. Load it fully
  first (`await collection.loadAll()`): only loaded rows are rows.
- `options`: [[object:ListEditOptions]]: defaults for new rows, a position
  field, and validation rules for every row.

Each existing row gets its own [[class:EditModel]], made when the row first
appears and kept while the row stays in the collection, so its edits survive
re-sorting and refreshes. New rows and pending deletions are held by the
list until `save()`.

```ts
import { ListEdit } from "@getaster/data";

const rows = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "projectId", value: 3 }, orderBy: [{ field: "id" }] });
await rows.loadAll();
const tasks = new ListEdit(ctx, rows, { defaults: () => ({ projectId: 3, title: "", done: false }) });
tasks.rows.value[0]!.edit.set("done", true);   // an ordinary EditModel per row
tasks.add({ title: "Write the brief" });       // pending in full
tasks.remove(tasks.rows.value[1]!.id);         // marked, not deleted
tasks.changes().map((c) => c.kind);            // ["delete", "update", "create"]
const { saved, failed } = await tasks.save();  // failed rows stay pending, with their errors
```

To save a record and the rows it owns atomically, use [[class:RecordEdit]].

## attr:ListEdit.type

The rows' entity type. Plain, read-only.

## attr:ListEdit.set

The rows' entity set: the collection's set, or the one given to `replay`.
Plain, read-only.

## attr:ListEdit.collection

The collection the rows come from. Plain, read-only.

## attr:ListEdit.rows

A computed signal of [[object:ListRow]]s. A row marked for deletion stays in
the list with `removing` true until it's saved. With a `positionField`, rows
are sorted by that field's current value (ties in the collection's order, a
row without a position last), so a `move` or a typed position reorders them
at once. The row objects are rebuilt on every change; keep a row's `id` or
`edit`, not the object.

## attr:ListEdit.dirty

A computed signal: true while there is a new row, a pending deletion, or a
row whose edit model is dirty.

## attr:ListEdit.valid

A computed signal: true while every row not marked for deletion is valid.
Errors aren't shown; call `validate()` on each row's `edit` for that.

## attr:ListEdit.busy

A signal that is true while `save()` runs. A second `save()` meanwhile
resolves at once with nothing saved.

## classMethod:ListEdit.replay

- `ctx`: the data context.
- `set`: the rows' entity set.
- `before`: the rows as they were before the changes.
- `changes`: the rows' change sets, as in a parent's
  [[type:OwnedChanges]] or a list of saved changes.
- `options`: optional [[object:ListEditOptions]]; a `positionField` sorts
  the rows.

Returns a list with no collection whose rows are replays
([[classMethod:EditModel.replay]]): an updated row is pending in the fields
that changed, a deleted row has `removing` true, and a created row is new and
pending in every writable field. `add` throws; `remove`, `restore`, `move`
and `save` do nothing; `ordered` is false. `revert()` isn't blocked and
would clear what's shown.

```ts
const shown = ListEdit.replay(ctx, "Answers", before.owned.answers, change.owned.answers);
shown.rows.value.map((r) => [r.id, r.isNew, r.removing]);
```

## method:ListEdit.add

- `values`: optional values for the new row, over the defaults and the
  position. Default `{}`.
- `links`: optional, by field name, the `id` of another new row in this list
  whose key that field takes when saved, such as a child clause pointing at
  a new group clause. Default `{}`.

Returns the new [[object:ListRow]], with an id `new:<n>`. Its values are
`defaults()`, then the next position (one more than the highest position of
any row, including rows marked for deletion), then `values`. Every writable
field is forced pending. Throws on a replay. Nothing is sent until `save()`.

With links, [[method:ListEdit.save]] creates the rows in the order added and
sets the field from the key the other row was given; only the first key
property of that row is used, so links need a single-property key. A
[[class:RecordEdit]] instead nests the child inside its parent's entry in
one request.

```ts
const clauses = field.owned.clauses!;          // field is a RecordEdit of a Fields record
const rootId = 31;                             // an existing clause of that field
const group = clauses.add({ category: "visibility", op: "or", position: 2, parentClauseId: rootId });
clauses.add({ category: "visibility", op: "eq", fieldRef: 12, value: "trust", position: 1, parentClauseId: null }, { parentClauseId: group.id });
```

## method:ListEdit.remove

- `id`: a row's `id`.

A new row is disposed and leaves the list. An existing row is marked
(`removing` true) and deleted on `save()`; take it back with `restore`. Does
nothing on a replay. The id isn't checked: an id that names no row is still
recorded as a pending deletion and makes the list dirty, and `save()` then
rejects, so pass ids from `rows`.

## method:ListEdit.restore

- `id`: the id of a row marked for deletion.

Unmarks it and clears its `removeError`. Its field edits, if any, are kept.
Does nothing on a replay.

## method:ListEdit.move

- `id`: the row to move.
- `index`: its new place among the rows not marked for deletion, from 0.
  It's clamped to the list.

Does nothing without a `positionField`, on a replay, or for an id not in the
list. Otherwise it renumbers the position field of the rows not marked for
deletion from 1, as ordinary `set` calls on each row whose number changed, so
a reorder is pending, revertible per row, and in the change set like any
other edit.

```ts
answers.move(answers.rows.value[4]!.id, 0);   // the fifth answer first; positions 1–5 again
```

## method:ListEdit.changes

Returns the [[type:ChangeSet]]s a save would make: a `delete` per row marked
for deletion (with its old values, less any fields hidden on it), an
`update` per changed existing row, and a `create` per new row with all its
values. Empty when nothing is pending. Not reactive.

## method:ListEdit.revert

Discards the new rows, unmarks every deletion and reverts every existing
row's edit model. Nothing is sent. Use a row's `edit.revert()` to revert one
row.

## method:ListEdit.save

Resolves to a [[object:ListSaveResult]]. Each write is its own request, in
this order:

1. Each row marked for deletion is deleted with its ETag. A refusal leaves it
   marked with `removeError` "Couldn’t delete it: <the server's message>".
2. Each changed existing row's `edit.save()` runs; a refusal leaves its
   errors, conflict or form error on that row's model.
3. Each new row is created in the order added, its links filled from rows
   created before it. A created row leaves the new rows; it reappears as an
   existing row, with the same edit model, when the collection places it.

A failed write doesn't stop the others. On a replay, or while a save is
running, it resolves at once to empty lists. A failure that isn't an
`ODataError` rejects and stops the remaining writes; that includes a pending
deletion of a row no longer in the store. `busy` is true meanwhile.

```ts
const { saved, failed } = await tasks.save();
for (const id of failed) {
  const row = tasks.rows.value.find((r) => r.id === id);
  // row.removeError, or row.edit.errors / formError / conflict, says why
}
```

## method:ListEdit.accept

Use it after something else saved the list's changes, such as a parent's
deep update. Changed rows take their current values as the new baseline; new
rows are disposed and dropped, and pending deletions and delete errors are
cleared, since the collection's refresh brings the saved rows. Nothing is
sent.

## method:ListEdit.draft

Returns a [[object:ListDraft]]: plain data, safe to `JSON.stringify`. Only
rows whose edit model is dirty are in `edits`.

## method:ListEdit.resume

- `draft`: a [[object:ListDraft]] from `draft()`.

First reverts everything pending, then takes up the draft's new rows (with
their ids and links), its pending deletions and its row edits. Deletions and
edits of rows that are no longer in the collection are dropped. Each row
edit is resumed as in [[method:EditModel.resume]], so a row changed elsewhere
since is followed or raised as a conflict. Call it once the collection has
loaded.

## method:ListEdit.dispose

Disposes every row's edit model. It doesn't release the collection; call
`ctx.release(collection)` for that if nothing else uses it.

## attr:ListEdit.ordered

Plain, read-only. True when a `positionField` was given and this isn't a
replay. An element shows drag handles or move buttons when it's true.

## object:ListDraft

Returned by [[method:ListEdit.draft]] and taken by
[[method:ListEdit.resume]]. Plain data; keep it as JSON.

## attr:ListDraft.added

The new rows: each one's `id` (`new:<n>`), its [[object:EditDraft]] and its
links.

## attr:ListDraft.removing

The ids (key text) of the rows marked for deletion.

## attr:ListDraft.edits

The changed existing rows' [[object:EditDraft]]s, by key text.

## attr:ListDraft.counter

The number of the last new row made. `resume` continues from it, so new rows
added after a resume don't reuse a resumed row's id.

## object:ListEditOptions

The options of a [[class:ListEdit]]. It extends [[object:EditOptions]]:
`rules` apply to every row. In a [[class:RecordEdit]], give them per owned
collection with [[attr:RecordEditOptions.owned]].

## attr:ListEditOptions.defaults

A function called for each new row, so every row gets fresh values. Values
given to `add` override it. Default: none. In a `RecordEdit` the foreign key
to the record is added on top.

```ts
new ListEdit(ctx, tasks, { defaults: () => ({ projectId: 3, title: "", done: false, due: null }) });
```

## attr:ListEditOptions.positionField

Default: none, and rows keep the collection's order. The field should be a
number. With it, [[attr:ListEdit.ordered]] is true and
[[method:ListEdit.move]] works. A `RecordEdit` also sorts the owned
collection's query by it.

## object:ListRow

One row of [[attr:ListEdit.rows]]. Plain data, rebuilt whenever the list
changes; `edit` is the lasting part.

## attr:ListRow.id

Pass it to `remove`, `restore`, `move`, `add`'s links, and match it against
[[attr:ListSaveResult.failed]] and [[attr:RecordProblems.owned]]. A new row's
id stops being valid once the row is saved; the saved row appears under its
key text.

## attr:ListRow.edit

The row's [[class:EditModel]]. Bind the row's cells to it, read its
`pending`, `errors` and `state`, and use `edit.revert()` for a per-row
Revert.

## attr:ListRow.isNew

True for a row added with `add` and not yet saved. Removing such a row
discards it at once.

## attr:ListRow.removing

The row stays in `rows`, and an element shows it struck through with Undo
(`restore`). Always false for a new row.

## attr:ListRow.removeError

The message from the last `save()` that couldn't delete this row, absent
otherwise. Cleared by `restore`.

## attr:ListRow.links

Present on new rows (empty when none were given), absent on existing ones.

## object:ListSaveResult

What [[method:ListEdit.save]] resolved to.

## attr:ListSaveResult.saved

The change sets the server accepted, in the order sent: deletions, updates,
creations. Each create holds what was sent, not the server-assigned key.

## attr:ListSaveResult.failed

Row ids. A failed deletion keeps its old id; a failed new row keeps its
`new:<n>` id.

## class:RecordEdit

Construct it with `new RecordEdit(ctx, set, key, options?)`:

- `ctx`: the data context.
- `set`: the record's entity set.
- `key`: the record's key text. The record must be in the store already, or
  the constructor throws.
- `options`: [[object:RecordEditOptions]]: rules for the record, and
  [[object:ListEditOptions]] per owned collection.

The owned collections are the record type's collection navigations marked
`AsterData.Owned`. For each, the constructor opens a collection of the
target set filtered by the foreign key to this record (sorted by the
position field, or by the target's key) and makes a [[class:ListEdit]] whose
new rows take the record's key. They load in the background; wait for
[[attr:RecordEdit.ready]] before showing or resuming. Nothing about the
record type is written by hand.

```ts
import { RecordEdit, keyText } from "@getaster/data";

const field = new RecordEdit(ctx, "Fields", keyText([4]), { owned: { answers: { positionField: "position" } } });
await field.ready;
Object.keys(field.owned);                  // ["answers", "clauses"], from $metadata
field.edit.set("label", "Type of client");
field.owned.answers!.add({ key: "club", label: "Club" });
field.changes();                           // one update: changes.label, owned.answers = [create]
const result = await field.save();         // one PATCH; { ok: true, change, before, failed: [] }
```

See [[group:editing]] for a longer example.

## attr:RecordEdit.set

The record's entity set. Plain, read-only.

## attr:RecordEdit.key

The record's key text. Plain, read-only. A replay of a create has `""`.

## attr:RecordEdit.edit

The [[class:EditModel]] for the record's own fields. Bind the record's form
to it, and read its `conflict` and `deleted`, which govern the whole save.

## attr:RecordEdit.owned

A frozen object of [[class:ListEdit]]s by navigation name, one per owned
collection, such as `field.owned.answers`. Plain; the lists themselves are
reactive.

## attr:RecordEdit.dirty

A computed signal: true while the record's model or any owned list is dirty.

## attr:RecordEdit.valid

A computed signal: true while the record's model and every owned list are
valid. Nothing is shown; [[method:RecordEdit.problems]] shows and names what
fails.

## attr:RecordEdit.ready

A promise. Until it settles, the owned lists may have no rows yet;
[[method:RecordEdit.resume]] waits for it. On a replay it's already settled.

## classMethod:RecordEdit.replay

- `ctx`: the data context.
- `before`: a [[object:RecordSnapshot]], such as a save's
  [[attr:RecordSave.before]].
- `change`: the [[type:ChangeSet]] to show, such as [[attr:RecordSave.change]].

Returns a read-only `RecordEdit` whose `edit` and owned lists are replays.
For an update, the record's changed fields and each owned list's row changes
are pending. A delete shows every owned row as removed. A create shows its
values as pending over an empty record, with no row changes. Owned rows are in `before`'s order (position fields from
the options aren't applied). `save()` returns `undefined`; `revert()` isn't
blocked and would clear what's shown.

```ts
const result = (await field.save())!;
const entry = JSON.stringify({ before: result.before, change: result.change });
// later, in the change log:
const { before, change } = JSON.parse(entry);
const shown = RecordEdit.replay(ctx, before, change);
shown.edit.pending("label").value;                  // true if the save changed it
shown.owned.answers!.rows.value.filter((r) => r.removing);   // the answers it removed
```

## method:RecordEdit.snapshot

Returns a [[object:RecordSnapshot]] of the baselines: the record's, and each
owned list's existing rows (including rows marked for deletion, without new
rows). Plain data. `save()` takes one before sending, for the result's
`before`.

## method:RecordEdit.changes

Returns `undefined` when nothing is dirty. Otherwise a single `update`
[[type:ChangeSet]] for the record: its changed fields in `changes` (empty
when only rows changed) and, in `owned`, each list's change sets that has
any, in the order the list would save them. Rows are named by key, not by
position. Not reactive.

## method:RecordEdit.problems

Runs `validate()` on the record's model and on every row not marked for
deletion, so errors show even on tabs nobody opened, and returns a
[[object:RecordProblems]]. Use it to say where the errors are ("2 problems
on Answers") or to switch to the first tab with one.

```ts
const p = field.problems();
p.record;            // ["name"]
p.owned.answers;     // [{ id: "new:1", fields: ["key", "label"] }]
```

## method:RecordEdit.save

Resolves to a [[object:RecordSave]], or `undefined` without sending anything
when this is a replay, a save is already running, nothing is dirty, the
record's model has a conflict or is deleted, or `problems()` finds any error.

Otherwise it sends one PATCH of the record with `If-Match` from the record's
ETag: the record's changed fields, and for each changed owned collection
`<navigation>@delta` entries:

- a row marked for deletion is a removed entry with its key;
- a changed row is its key and changed fields;
- a new row is its values that differ from what the server would store
  without them ([[staticMethod:creatable]]); a new row linked to another new
  row in the same list goes inside that row's entry, under the child
  navigation whose foreign key is the link field, and the link field is left
  out. Only a row's first link is used for nesting.

On success, the record's model takes the response as its baseline and ETag,
each list `accept`s, and the owned collections refresh before the promise
resolves, so new rows appear with their keys. On a 412 the context reloads
the record; with no overlap with the local edits the request is sent once
more, otherwise `edit.conflict` is set and the result has `ok: false`. On any
other refusal nothing is saved, everything stays pending, and the server's
error details are placed: a target such as `answers[2]/label` on that row's
field, a bare field name on the record's field, and anything else in
[[attr:RecordEdit.failure]]. Errors other than `ODataError` are rethrown.

## attr:RecordEdit.failure

A signal of the last save's message when the server refused it and no
detail named a field or row (including a conflict); `undefined` otherwise.
Cleared when the next save starts.

## method:RecordEdit.revert

Reverts the record's model and every owned list
([[method:ListEdit.revert]]): field changes, new rows and pending deletions
go. Nothing is sent.

## method:RecordEdit.draft

Returns a [[object:RecordDraft]]: the record's [[object:EditDraft]] and a
[[object:ListDraft]] per owned list. Plain data; it survives
`JSON.stringify` and resumes onto a fresh `DataContext`.

## method:RecordEdit.resume

- `draft`: a [[object:RecordDraft]] from `draft()`.

Waits for [[attr:RecordEdit.ready]], then resumes the record's model and
each owned list that the draft has. A record or row changed elsewhere since
the draft is followed or raised as a conflict, as in
[[method:EditModel.resume]]. Resolves when done; rejects if the draft is of
another record.

```ts
const saved = JSON.stringify(field.draft());
// after a reload, once the record is in the store:
const again = new RecordEdit(ctx, "Fields", keyText([4]), { owned: { answers: { positionField: "position" } } });
await again.resume(JSON.parse(saved));
```

## method:RecordEdit.dispose

Disposes the record's model and every owned list, and releases the owned
collections from the context. Call it when the editor closes.

## object:RecordDraft

Returned by [[method:RecordEdit.draft]] and taken by
[[method:RecordEdit.resume]].

## attr:RecordDraft.edit

The record's own [[object:EditDraft]].

## attr:RecordDraft.owned

A [[object:ListDraft]] per owned collection, by navigation name.

## object:RecordEditOptions

The options of a [[class:RecordEdit]]. It extends [[object:EditOptions]]:
`rules` apply to the record's own model.

## attr:RecordEditOptions.owned

Default: none for every list. A list's `defaults` are merged under the
foreign key to the record, which always wins, and its `positionField` also
sorts the owned collection.

```ts
new RecordEdit(ctx, "Fields", keyText([4]), {
  owned: { answers: { positionField: "position", defaults: () => ({ label: "" }) }, clauses: { positionField: "position" } },
});
```

## object:RecordProblems

Returned by [[method:RecordEdit.problems]]. Empty lists and an empty object
mean nothing fails.

## attr:RecordProblems.record

The record's field names with errors (keys of `edit.errors`).

## attr:RecordProblems.owned

By navigation name, the failing rows of that list: each row's
[[attr:ListRow.id]] and the field names with errors. A list with no failing
rows is left out.

## object:RecordSave

What [[method:RecordEdit.save]] resolved to when it sent a request.

## attr:RecordSave.ok

True when the server accepted the save; false when it refused, in which case
nothing was saved and everything stays pending.

## attr:RecordSave.change

The [[type:ChangeSet]] taken before sending: the record's field changes and
the owned rows' changes. Owned creates hold the rows' full values and no
keys, so they can be more than the request carried. Keep it with
[[attr:RecordSave.before]] for a change log and
[[classMethod:RecordEdit.replay]].

## attr:RecordSave.before

A [[object:RecordSnapshot]] taken just before the request was sent.

## attr:RecordSave.failed

Empty when `ok` is true.

## object:RecordSnapshot

What [[method:RecordEdit.snapshot]] returns and
[[classMethod:RecordEdit.replay]] takes. Keep it as JSON.

## attr:RecordSnapshot.record

The record's values.

## attr:RecordSnapshot.owned

Each owned collection's rows, by navigation name.
