# Criteria and templates

A query in Aster UI is data: a [[object:Query]] names an entity set and may
carry a filter, a sort and a field list. The filter is a [[type:Criteria]]
tree. The same tree is compiled to an OData `$filter` for the server and
evaluated in the client with the server's semantics, so a collection can decide
locally whether a changed record still belongs to it. A differential test in the
repository checks the client's answers against aster-odata's engine. Page rules
use the same trees, with paths into the page instead of property names
([[group:page-rules]]). The model the criteria are checked against is in
[[group:schema]], and what a collection does with a query is in
[[group:collections]].

This page also covers display templates, the parsed `{name}` text used for
labels and derived values ([[staticMethod:parseTemplate]]).

## The forms of criteria

Every node has an `op`. Comparisons name a `field` of the entity type; to
write one against a related record use `via`, `any` or `all`. The right-hand
column is what [[staticMethod:toFilter]] returns, before percent-encoding, for
entity type `Project`.

| Form | `$filter` |
|---|---|
| `{ op: "eq", field: "state", value: "active" }` (also `ne`, `gt`, `ge`, `lt`, `le`) | `state eq 'active'` |
| `{ op: "ne", field: "archivedAt", value: null }` | `archivedAt ne null` |
| `{ op: "ge", field: "spent", other: "budget" }`: a property against a property of the same type | `spent ge budget` |
| `{ op: "in", field: "state", values: ["active", "paused"] }` | `state in ('active','paused')` |
| `{ op: "in", field: "state", values: [] }` | `false` |
| `{ op: "contains", field: "name", value: "Spr" }` (also `startswith`, `endswith`) | `contains(name,'Spr')` |
| the same with `caseInsensitive: true` | `contains(tolower(name),'spr')` |
| `{ op: "and", args: [a, b] }`; `or` likewise | `a and b`; an `or` inside an `and` is parenthesised |
| `{ op: "and", args: [] }`; `{ op: "or", args: [] }` | `true`; `false` |
| `{ op: "not", arg: a }` | `not (a)` |
| `{ op: "any", field: "tasks", where: { op: "eq", field: "done", value: false } }` | `tasks/any(x0:x0/done eq false)` |
| the same with `all` | `tasks/all(x0:x0/done eq false)` |
| `{ op: "via", field: "lead", where: { op: "eq", field: "name", value: "Ada Lovelace" } }` | `lead/name eq 'Ada Lovelace'` |

Values are in their JSON form ([[group:schema]]): `Decimal` and `Int64` as
strings (`"10000.00"`, `"5"`), dates as `"2026-10-15"`, timestamps with an
offset. A value that doesn't fit its field throws a [[class:CriteriaError]]:
`Int64` takes a string, so `5` is rejected; `Edm.Binary` isn't allowed in
criteria at all. `any` and `all` range over a to-many navigation and `via`
follows a single-valued one; in each, `where` names the properties of the
related record. Lambdas can be nested (`x0`, `x1`, and so on).

### How a null behaves

Evaluation follows OData's rules for null, so a client-side match and the
server agree:

- `eq` with `null` is true only for a null; `ne` is its exact negation.
- `gt`, `ge`, `lt` and `le` are false when either side is null, so `not` of
  one is true. A null as the literal of an ordering comparison is an error.
- `in` is `eq`-based and never unknown: a `null` in the list matches a null.
- `contains`, `startswith` and `endswith` of a null give unknown, and `not` of
  unknown is unknown, so the row is left out either way.
- `and` is false if any argument is false, else unknown if any is unknown;
  `or` is the mirror. A row matches only when the whole tree is true.
- A field the server hid on this record is unknown to every test, whatever
  value the record holds ([[attr:StoredRecord.hidden]]).

Strings compare by Unicode code point, so `"a"` sorts after `"B"`. Decimals and
Int64 compare exactly, timestamps by instant, GUIDs without regard to case.

### Relative dates

A comparison on a date field may take a [[object:RelativeDate]] as its value
instead of a literal. It stays symbolic in the query and is resolved when the
query runs: a [[class:Collection]] resolves it at each fetch and each local
placement against its context's clock ([[attr:DataContext.now]]), and a page
rule when it is evaluated. So `{ op: "ge", field: "due", value: { relative:
"today", startOf: "week" } }` is still "this week" next week. A relative date
that reaches [[staticMethod:toFilter]] or [[staticMethod:matches]] unresolved
throws; call [[staticMethod:resolveRelative]] first.

### A worked example

```ts
import { parseCsdl, resolveRelative, toQueryString, matches, sortComparator, type Query } from "@getaster/data";

const schema = parseCsdl(metadata);
const type = schema.set("Projects").type;

const query: Query = {
  set: "Projects",
  filter: {
    op: "and",
    args: [
      { op: "eq", field: "state", value: "active" },
      { op: "or", args: [{ op: "eq", field: "health", value: "behind" }, { op: "gt", field: "behindDays", value: 2 }] },
      { op: "ge", field: "updatedAt", value: { relative: "today", days: -7 } },
    ],
  },
  orderBy: [{ field: "updatedAt", descending: true }],
  select: ["id", "name"],
};

const now = Date.parse("2026-10-15T09:30:00Z");
const resolved = { ...query, filter: resolveRelative(query.filter!, type, now) };
toQueryString(resolved, schema);
// "$filter=state%20eq%20'active'%20and%20(health%20eq%20'behind'%20or%20behindDays%20gt%202)%20and%20updatedAt%20ge%202026-10-08T00%3A00%3A00Z
//  &$orderby=updatedAt%20desc%2Cid&$select=id%2Cname"   (one line)

matches(resolved.filter!, { id: 1, name: "Atlas", state: "active", health: "behind", behindDays: null, updatedAt: "2026-10-14T08:00:00Z" }, type); // true
[{ id: 2, updatedAt: "2026-10-01T00:00:00Z" }, { id: 1, updatedAt: "2026-10-14T08:00:00Z" }]
  .sort(sortComparator(resolved.orderBy!, type)); // id 1 first: newest first
```

## Limits

- Comparisons are a property against a literal or against another property of
  the same type. There are no arithmetic or date functions (`year()`,
  `time()`) and no property-to-function comparisons.
- Local evaluation of `any`, `all` and `via` needs the related records on the
  entity (a list for `any` and `all`, a record or `null` for `via`). Records
  from the store don't carry them, so a [[class:Collection]] whose filter has
  one refetches on every change instead of placing the record itself.
- A sort by a path through a navigation (`lead/name`) compiles for the server,
  but [[staticMethod:sortComparator]] can't evaluate it, and a collection with
  such a sort refetches instead of placing a changed record.
- Relative dates are in UTC, and only for `Edm.Date` and `Edm.DateTimeOffset`.
- A template's string literal can't contain `}`: the expression ends at the
  first one.

## type:Criteria

A filter as a tree. The forms and the `$filter` each compiles to are in the
topic text. Plain, serialisable data, so a filter can be kept in JSON, compared
with `JSON.stringify` (two queries that say the same thing are equal) and
published to the page. `and` and `or` take any number of arguments; one
argument compiles to that argument alone, none to `true` or `false`.

A comparison has either `value` or `other`, not both. `eq` and `ne` take
`null`. Case-insensitive matching is through `tolower()` on both sides
(`caseInsensitive: true`), ordinal otherwise.

```ts
import type { Criteria } from "@getaster/data";

const overdue: Criteria = {
  op: "and",
  args: [
    { op: "lt", field: "due", value: { relative: "today" } },
    { op: "eq", field: "done", value: false },
  ],
};
```

## object:Query

What a [[class:Collection]], [[class:Groups]] or [[method:DataContext.collection]]
works over. Plain data. Two queries are the same when `JSON.stringify` gives
the same text, and that is how a collection following a signal decides whether
the query changed.

```ts
const query = { set: "Tasks", filter: { op: "eq", field: "done", value: false }, orderBy: [{ field: "due" }] };
```

## attr:Query.set

The entity set's name, as in [[attr:EntitySet.name]]. A collection stays on the
set it was made with: [[method:Collection.setQuery]] with another set throws.

## attr:Query.filter

The [[type:Criteria]] that records must satisfy. Absent means every record.
Relative dates in it are resolved at each request.

## attr:Query.orderBy

[[object:SortKey]]s in priority order. Absent or empty sorts by the key. The
entity type's key properties not already named are appended ascending as
tie-breakers, as the server does, so the order is total and a page boundary
never repeats or skips a record.

## attr:Query.select

Field names to ask for with `$select`. Absent or empty asks for every field.
Each name must be a field of the type; [[staticMethod:toQueryString]] throws
otherwise. The client doesn't add the key properties. Records fetched this way
are stored with only those fields known ([[attr:StoredRecord.known]]). A
collection can't place a changed record whose known fields lack one that its
filter or sort reads, so it refetches.

## object:SortKey

One term of `$orderby`.

## attr:SortKey.field

A property name, or a path through single-valued navigations
(`lead/name`), which needs the schema to follow. A path can't be used with
[[staticMethod:sortComparator]]. Compiling throws a [[class:CriteriaError]] for
an unknown field, a collection navigation in the path, or an `Edm.Binary` field,
and, through [[staticMethod:toQueryString]], for a field or navigation in
[[attr:EntitySet.nonSortable]].

## attr:SortKey.descending

`true` for descending, compiled as ` desc`. Absent or `false` is ascending. In
the client's comparator ascending puts nulls first and descending last, and a
NaN sorts after every number.

## object:RelativeDate

A date computed when a query runs, written as data. Plain; every member except
`relative` is optional.

How it resolves ([[staticMethod:resolveRelative]]): start from the current
instant (`now`) or from UTC midnight of today (`today`); if `startOf` is
given, move back to the Monday of that week or the first of that month
(at midnight); add `months` (landing on the same day of the month, or its last
day when that is shorter, so 31 January plus one month is 28 February); then add
`days` and `weeks`. All of it in UTC.

The result is a date (`2026-10-18`) for an `Edm.Date` field and a timestamp
(`2026-10-18T00:00:00Z`) for an `Edm.DateTimeOffset` field. Any other field
type throws a [[class:CriteriaError]].

```ts
// With the clock at Thursday 2026-10-15T09:30:00Z, on a DateTimeOffset field:
{ relative: "today" }                                         // 2026-10-15T00:00:00Z
{ relative: "now" }                                           // 2026-10-15T09:30:00Z
{ relative: "today", startOf: "week" }                        // 2026-10-12T00:00:00Z
{ relative: "today", startOf: "week", days: 6 }               // 2026-10-18T00:00:00Z
{ relative: "today", startOf: "month", months: 1 }            // 2026-11-01T00:00:00Z
{ relative: "today", weeks: -2 }                              // 2026-10-01T00:00:00Z
```

## attr:RelativeDate.relative

`"today"` starts from UTC midnight of the current day, `"now"` from the
current instant. For a `Date` field the two give the same date. With
`startOf`, both end at midnight.

## attr:RelativeDate.days

Whole days to add after everything else, negative to go back. Absent is 0.

## attr:RelativeDate.weeks

Whole weeks (seven days each) to add, negative to go back. Absent is 0.

## attr:RelativeDate.months

Whole calendar months to add before `days` and `weeks`, negative to go back.
The day of the month is kept, or clamped to the last day of the target month.
Absent is 0.

## attr:RelativeDate.startOf

`"week"` moves back to Monday of the week (a Monday stays), `"month"` to the
first of the month. Applied before `months`, `days` and `weeks`. Absent leaves
the date alone.

## staticMethod:isRelative

- `v`: any value.

Returns `true` when `v` is an object with a `relative` member, narrowing it to
[[object:RelativeDate]]. It doesn't check the other members.

```ts
isRelative({ relative: "today" }); // true
isRelative("today");               // false
```

## staticMethod:hasRelative

- `c`: a criteria tree, or `undefined`.

Returns `true` when any comparison in it, including inside `any`, `all`, `via`,
`and`, `or` and `not`, has a [[object:RelativeDate]] as its value. `undefined`
gives `false`. It reads the tree only.

## staticMethod:resolveRelative

- `criteria`: the tree to resolve.
- `type`: the [[object:EntityType]] the criteria are written against; each
  relative date is typed by the field it is compared with.
- `now`: epoch milliseconds.
- `related`: optional; for relative dates inside `any`, `all` or `via`, a
  function from a navigation name and the type it leaves from to the related
  [[object:EntityType]]. It is called at every lambda, with the inner lambda's
  own type, so lambdas nest to any depth.

Returns a copy with each relative date replaced by its value at `now`, or the
same object when there is none. It doesn't modify its argument. Throws a
[[class:CriteriaError]] for an unknown field, a field that isn't a date or
timestamp, and a relative date inside a lambda when `related` is missing or has
no answer.

```ts
const lambda = { op: "any", field: "tasks", where: { op: "le", field: "due", value: { relative: "today", days: 7 } } } as const;
resolveRelative(lambda, projectType, now, (nav, from) => {
  const target = from.navigation(nav)?.target;
  return target ? schema.set(target).type : undefined;
});
// { op: "any", field: "tasks", where: { op: "le", field: "due", value: "2026-10-22" } }   at 2026-10-15
```

## staticMethod:toFilter

- `criteria`: the tree.
- `type`: the [[object:EntityType]] its fields belong to.
- `set`: optional [[object:EntitySet]]; when given, a field in
  [[attr:EntitySet.nonFilterable]] is an error.
- `schema`: optional [[object:Schema]]; required when the tree has `any`, `all`
  or `via`, to find the related type.

Returns the `$filter` text, not percent-encoded. Throws a [[class:CriteriaError]]
for an unknown field or navigation, a value that doesn't fit its field, a
property comparison across types, `contains` and its kind on a non-string
field, `any` or `all` on a single-valued navigation or `via` on a collection, a
non-filterable field, a missing schema, and a relative date still in the tree.
The forms and their output are in the topic text.

```ts
const set = schema.set("Projects");
toFilter({ op: "any", field: "tasks", where: { op: "eq", field: "done", value: false } }, set.type, set, schema);
// "tasks/any(x0:x0/done eq false)"
```

## staticMethod:toOrderBy

- `sort`: the [[object:SortKey]]s.
- `type`: the entity type.
- `schema`: optional; required for a key that is a path.

Returns the `$orderby` text (not encoded), with the type's key properties
appended ascending where not already sorted on. An empty sort gives just the
key. Throws a [[class:CriteriaError]] for an unknown field, an `Edm.Binary`
field, or a path with no schema or through a collection.

```ts
toOrderBy([{ field: "updatedAt", descending: true }], type); // "updatedAt desc,id"
toOrderBy([{ field: "lead/name" }], type, schema);           // "lead/name,id"
```

## staticMethod:toQueryString

- `query`: the [[object:Query]], with relative dates already resolved.
- `schema`: the [[object:Schema]], to find the set.

Returns the system query options as `a=b&c=d` with percent-encoded values and no
leading `?`: `$filter` if there is a filter, always `$orderby` (so at least the
key), and `$select` if the query has fields. Count, `$skip` and `$top` are not
part of it; the source adds them. Throws a [[class:SchemaError]] for an unknown
set, and a [[class:CriteriaError]] for anything [[staticMethod:toFilter]] or
[[staticMethod:toOrderBy]] rejects, and for a `select` name that isn't a field
of the type. Unlike those two used alone, it knows the set, so it also rejects
fields in [[attr:EntitySet.nonFilterable]] and [[attr:EntitySet.nonSortable]].

## staticMethod:toApply

- `type`, `set`, `schema`: as for [[staticMethod:toFilter]]; `set` and `schema`
  are optional.
- `filter`: a criteria tree, or `undefined` for every record.
- `groupBy`: field names to group by; empty for one total row.
- `aggregates`: [[object:Aggregate]]s to compute.

Returns the `$apply` text: the filter, then the grouping, always with the row
count as `count`:

```ts
toApply(type, { op: "eq", field: "state", value: "active" }, ["health"], [{ field: "budget", method: "sum", as: "budget" }], set, schema);
// "filter(state eq 'active')/groupby((health),aggregate($count as count,budget with sum as budget))"
toApply(type, undefined, [], [{ field: "hue", method: "average", as: "avg" }]);
// "aggregate($count as count,hue with average as avg)"
```

Throws a [[class:CriteriaError]] for an unknown or non-filterable `groupBy` or
aggregate field, and for anything the filter does.

## object:Aggregate

One value computed by the server per group, in the `with` form of OData data
aggregation. Plain data. Used by [[method:DataContext.groups]] and
[[method:ODataSource.aggregate]].

## attr:Aggregate.field

The property to aggregate. Must be a field of the entity type.

## attr:Aggregate.method

`"sum"`, `"min"`, `"max"`, `"average"` or `"countdistinct"`. It is written to
the request as is; whether it suits the field's type is up to the server, which
answers with an error if it doesn't.

## attr:Aggregate.as

The alias the result is returned under, and the key in
[[attr:GroupRow.totals]]. The row count is always returned as `count`, so don't
use that.

## staticMethod:formatLiteral

- `value`: a [[type:Value]].
- `field`: the [[object:Field]] it is a value of.

Returns the OData URL literal: `null` for `null`; text in single quotes with
quotes doubled; `duration'P1DT2H'` for a duration; `NaN`, `INF` and `-INF`, and
`0` for `-0`, for floating-point fields; for the other types the value as
written (`12.50`, `2026-10-15`, `true`). Throws a [[class:CriteriaError]] when
the value doesn't fit the field's type, as `n: expected an integer string
(Edm.Int64), got 5`.

```ts
formatLiteral("it's", nameField);  // "'it''s'"
formatLiteral("12.50", budgetField); // "12.50"
```

## class:CriteriaError

Thrown by the criteria compile and evaluate functions, and by page rules, when a
filter or sort can't be used: an unknown field or navigation, a value of the
wrong type, a field the set marks as not filterable or sortable, a relative date
on the wrong type of field, or a stored value the field's type can't read.
`name` is `"CriteriaError"`. A mistake in criteria is a programming error, so the
data core throws rather than sending a request it knows is wrong.

```ts
try {
  toFilter({ op: "eq", field: "nope", value: 1 }, type);
} catch (e) {
  e instanceof CriteriaError && e.message; // "unknown field 'nope' on Project"
}
```

## staticMethod:matches

- `criteria`: the tree, with relative dates resolved.
- `entity`: the record to test, as stored.
- `type`: its entity type.
- `related`: optional; for `any`, `all` and `via`, a function from the type and a
  navigation name to the related type ([[type:Related]]). Without it those
  forms throw.
- `unknown`: optional set of field names hidden on this record; a test of one is
  unknown.

Returns `true` only when the whole tree is true, with the server's rules for
null and unknown ([[group:criteria]]). Throws a [[class:CriteriaError]] for an
unknown field, a literal that doesn't fit, a string function on a non-string
field, a value in the entity of the wrong type, an `any` or `all` whose
property isn't an array, a `via` whose property is missing, and a relative date
left in the tree.

```ts
const e = { id: 1, state: "active", behindDays: null };
matches({ op: "eq", field: "behindDays", value: null }, e, type);                       // true
matches({ op: "gt", field: "behindDays", value: 3 }, e, type);                          // false
matches({ op: "not", arg: { op: "gt", field: "behindDays", value: 3 } }, e, type);      // true
matches({ op: "eq", field: "state", value: "active" }, e, type, undefined, new Set(["state"])); // false: hidden, so unknown
```

## type:Related

`(from: EntityType, navigation: string) => EntityType | undefined`: given the
type a lambda or `via` starts from and a navigation name, the type of the
records it leads to. [[staticMethod:matches]] calls it for `any`, `all` and
`via`, and again for criteria nested in them. Return `undefined` for a
navigation you can't type, which makes `matches` throw.

```ts
const related: Related = (from, nav) => {
  const target = from.navigation(nav)?.target;
  return target ? schema.set(target).type : undefined;
};
matches({ op: "via", field: "lead", where: { op: "eq", field: "name", value: "Ada" } }, { ...project, lead: { name: "Ada" } }, type, related);
```

## staticMethod:compareValues

- `a`, `b`: [[type:Value]]s of the field's type.
- `field`: the [[object:Field]], which decides how they compare.

Returns a negative number, zero or a positive number, for sorting. A total
order, unlike `eq` and `lt` in a filter: `null` is first and equal to itself, a
NaN is after every number and equal to other NaNs. Strings compare by code
point, Decimal and Int64 exactly, timestamps by instant, durations by length.
Throws a [[class:CriteriaError]] for a value the type can't read, and for
`Edm.Binary`.

```ts
compareValues("9", "10", budgetField);  // -1: as numbers, not text
compareValues(null, 1, hueField);       // -1
```

## staticMethod:sortComparator

- `sort`: the [[object:SortKey]]s.
- `type`: the entity type.

Returns a comparator for `Array.prototype.sort` that orders entities as
`$orderby=<sort>` would, with the key properties appended as tie-breakers, so
equal records order by key. A descending key reverses everything, nulls
included. Throws a [[class:CriteriaError]] for an unknown field, an
`Edm.Binary` field, and a path (`lead/name`), which needs related values the
entity doesn't have.

```ts
people.sort(sortComparator([{ field: "name" }, { field: "hue", descending: true }], personType));
```

## object:Template

Display text with values in it, parsed once and rendered many times:
`"{name} ({count == 1 ? 'one task' : count})"`. It is walked as a tree and never
compiled to code, so text from an untrusted source can't run anything, and a
strict content security policy is no obstacle.

Inside braces you can write:

- paths: `project.name`, names joined by dots, each starting with a letter or `_`;
- string literals in single or double quotes, with `\` to escape a character,
  non-negative numbers (`1`, `1.5`), `true`, `false` and `null`;
- comparisons `==`, `!=`, `<`, `<=`, `>` and `>=`;
- `&&`, `||` and `!`, and the conditional `a ? b : c`, which nests to the
  right; parentheses.

`{{` and `}}` are literal braces. Everything else is text. How it evaluates:

- A path's value is whatever the lookup gives you; `undefined` counts as `null`.
- `==` and `!=` are strict, so `1 == "1"` is false.
- Ordering compares number with number and text with text, and is false for
  anything else, including `null`.
- `&&`, `||` and `!` work on truthiness and give a boolean. `null`, `false`,
  `0` and `""` are false and everything else, including `"0"`, is true. So `a ||
  'none'` renders `true` or `false`; write `a ? a : 'none'` for a fallback.
- A null or missing value renders as nothing, `true` as `true`, a number as
  JavaScript prints it (`1.50` renders `1.5`).

```ts
const t = parseTemplate("{name} ({count == 1 ? 'one task' : count}) {{ok}}");
t.paths;                                                                     // ["name", "count"]
t.render((p) => ({ name: "Spring", count: 1 } as Record<string, unknown>)[p]); // "Spring (one task) {ok}"
t.render((p) => ({ name: "Spring", count: 3 } as Record<string, unknown>)[p]); // "Spring (3) {ok}"
```

## attr:Template.source

The text it was parsed from, unchanged. Read only.

## attr:Template.paths

The distinct paths the template mentions, in order of first use, including those
in a branch that a particular render doesn't take. A caller that needs a value
for each (as [[method:PageScope.select]] does) follows them all, so a template
renders only once every path it can read has a value. Read only.

## method:Template.render

- `lookup`: `(path) => unknown`, called with each path as written, for each time
  the path is evaluated; it may be called more than once for one path, and not at
  all for a branch not taken.

Returns the text. It never throws on its own: a missing value is empty, and a
`lookup` that throws propagates. One template can render for any number of
lookups, and inside an effect it follows whatever signals `lookup` reads.

```ts
const label = parseTemplate("{first} {last}");
effect(() => console.log(label.render((p) => scope.value(p).value)));
```

## staticMethod:parseTemplate

- `source`: the template text.

Returns a [[object:Template]]. Throws a [[class:TemplateError]] for `{` with no
`}`, `}` with no `{` (write `}}` for a literal one), an expression that is empty
or ends early, text it can't read, such as `a-b`, `-1`, `.5` or an unclosed
string, a missing `:` in a conditional, and a string literal containing `}`,
which ends the expression at the first `}`. An empty string gives a template
that renders as the empty string.

```ts
parseTemplate("{a +}"); // TemplateError: unexpected text at 2 in "{a +}"
```

## class:TemplateError

Thrown by [[staticMethod:parseTemplate]]. `name` is `"TemplateError"`. The
message is `<problem> at <n> in <source as JSON>`, where `<n>` is the zero-based
index into the source where it stopped, so the text can be shown beside the
template for the author to fix.
