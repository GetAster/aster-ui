# The schema

The schema is the client's model of a service: its entity sets, their types,
the fields and navigations of each type, and the validation and display
metadata the server publishes in `$metadata`. It is built once, by
[[staticMethod:parseCsdl]], from a CSDL JSON 4.01 document, and everything
else in the data core reads it: [[group:criteria]] checks field names and
literal types against it, [[group:collections]] take their entity type from
it, and the edit models and elements take labels, limits and allowed values
from it. A [[class:DataContext]] reads `$metadata` and calls `parseCsdl` for
you ([[classMethod:DataContext.connect]]); call it directly for a document you
already have, such as a fixture in a test.

## The model

| Type | What it describes |
|---|---|
| [[object:Schema]] | The service: its namespace, [[object:EntitySet]]s and [[object:EntityType]]s, and what it left out. |
| [[object:EntitySet]] | A set of records of one type that can be queried and written. Carries set-level rules: ETag use, restricted properties, count threshold. |
| [[object:EntityType]] | The shape of a record: key, [[object:Field]]s and [[object:Navigation]]s. |
| [[object:Field]] | A property: its [[type:EdmType]], nullability, limits and annotations. |
| [[object:Navigation]] | A link to another entity set, single-valued or a collection, with the key properties that join them. |

A schema is immutable. Its objects are frozen and its maps throw a
`TypeError` ("schema is immutable") when written to, so a schema can be shared
between contexts and tests.

### Values

Values stay in their OData JSON form, requested with `IEEE754Compatible=true`,
so nothing loses precision on the way through the client. A [[type:Value]] is
a string, number, boolean or `null`:

| Edm type | JS value |
|---|---|
| `Edm.String`, `Edm.Guid`, `Edm.Duration` | `string` |
| `Edm.Boolean` | `boolean` |
| `Edm.Byte`, `Edm.SByte`, `Edm.Int16`, `Edm.Int32`, `Edm.Single`, `Edm.Double` | `number` |
| `Edm.Int64`, `Edm.Decimal` | `string`, the exact decimal text (`"42000.59"`) |
| `Edm.Date` | `string`, `YYYY-MM-DD` |
| `Edm.TimeOfDay` | `string`, `hh:mm:ss[.fff]` |
| `Edm.DateTimeOffset` | `string`, RFC 3339 with an offset |
| `Edm.Binary` | `string`, base64url |
| any, when absent | `null` |

A record as the data core holds it is an [[type:Entity]]: property names to
values.

### Annotations the parser reads

A term is read from the document as `@Namespace.Term`, with the vocabulary's
namespace replaced by the alias the document gives it in `$Reference`
(`@Org.OData.Core.V1.Computed` is read as `Core.Computed`, and `@Core.Computed`
stays as it is). A vocabulary the document doesn't declare in `$Reference` keeps
its full name, so `@Org.OData.Core.V1.Computed` is not recognised as
`Core.Computed` without the reference. The parser keeps every annotation it
finds in `annotations`, and lifts these into typed properties:

| Term | Where it ends up |
|---|---|
| `Core.Description` | [[attr:Field.title]], [[attr:EntityType.title]], [[attr:AllowedValue.label]] |
| `Core.LongDescription` | [[attr:Field.prompt]] |
| `Core.Computed`, `Core.Immutable` | [[attr:Field.computed]], [[attr:Field.immutable]] |
| `Core.OptimisticConcurrency` | [[attr:EntitySet.etag]] |
| `Validation.Pattern`, `Validation.AllowedValues` | [[attr:Field.pattern]], [[attr:Field.allowedValues]] |
| `Validation.Minimum`, `Validation.Maximum`, and `@Validation.Exclusive` on them | [[attr:Field.minimum]], [[attr:Field.maximum]], [[attr:Field.exclusiveMinimum]], [[attr:Field.exclusiveMaximum]] |
| `Capabilities.FilterRestrictions`, `Capabilities.SortRestrictions` | [[attr:EntitySet.nonFilterable]], [[attr:EntitySet.nonSortable]] |
| `AsterData.MinLength`, `AsterData.EmptyAsNull`, `AsterData.RootValue` | [[attr:Field.minLength]], [[attr:Field.emptyAsNull]], [[attr:Field.rootValue]] |
| `AsterData.PluralTitle`, `AsterData.TitleField` | [[attr:EntityType.pluralTitle]], [[attr:EntityType.titleField]] |
| `AsterData.Owned` | [[attr:Navigation.owned]] |
| `AsterData.CountThreshold` | [[attr:EntitySet.countThreshold]] |

`$Nullable`, `$MaxLength`, `$Precision`, `$Scale` and `$DefaultValue` are read
from the property itself.

### A worked example

```ts
import { parseCsdl, SchemaError } from "@getaster/data";

const schema = parseCsdl({
    $Version: "4.01",
  $Reference: {
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": {
      $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }],
    },
  },
  $EntityContainer: "Demo.Container",
  Demo: {
    Person: {
      $Kind: "EntityType",
      $Key: ["id"],
      id: { $Type: "Edm.Int32", "@Org.OData.Core.V1.Computed": true },
      name: { $MaxLength: 80 },
      photo: { $Type: "Edm.Stream", $Nullable: true },
    },
    Container: {
      $Kind: "EntityContainer",
      People: { $Collection: true, $Type: "Demo.Person" },
    },
  },
});

const person = schema.set("People").type;
person.key;                      // ["id"]
person.field("name")?.maxLength; // 80
person.field("id")?.computed;    // true: read from "@Org.OData.Core.V1.Computed" as Core.Computed
person.field("photo");           // undefined: a stream can't be modelled
schema.skipped;                  // [{ path: "/Demo/Person/photo", reason: "a stream" }]

try {
  schema.set("Nobody");
} catch (e) {
  e instanceof SchemaError && e.path; // "/Container"
}
```

## Limits

- Only CSDL JSON is read. CSDL XML is not.
- Only entity sets are modelled. Singletons, actions, functions, complex types
  and enumeration types are ignored; a property of a complex or enumeration type
  is left out and listed in [[attr:Schema.skipped]].
- Keys are lists of property names. A key written as an alias to a path through
  a navigation is rejected with a [[class:SchemaError]].
- A property that is a stream, untyped, collection-valued or of a type that is
  not one of the sixteen Edm types above is left out of its entity type, and the
client never reads or writes it.
- Annotation expressions (`$If`, `$Path`, `$Eq`) are kept as raw values in
  `annotations`; this version of the parser does not turn them into criteria.

## staticMethod:parseCsdl

- `json`: the `$metadata` document as parsed JSON, not as text. Anything else
  is rejected.

Returns a [[object:Schema]]. The result and every object in it are frozen.

How the document maps onto the model:

- The entity container named by `$EntityContainer` gives the sets: each member
  with `$Collection: true` and a `$Type`. The container's namespace becomes
  [[attr:Schema.namespace]].
- Entity types from every namespace in the document are in
  [[attr:Schema.types]], keyed by qualified name (`Demo.Person`), whatever
  alias the document uses for the namespace.
- A type with a `$BaseType` has the base's fields and navigations first, then
  its own, and the key declared nearest to it. Annotations are merged, the
  derived type's winning.
- A navigation's [[attr:Navigation.target]] is the set named in the
  `$NavigationPropertyBinding` of a set of the owning type; failing that, the
  only set of the target type; failing that, the type's own name, for contained
  targets with no set. Its [[attr:Navigation.keys]] come from the navigation's
  `$ReferentialConstraint`, or, for a collection with a `$Partner`, from the
  partner's constraint turned round.

Throws a [[class:SchemaError]] with the JSON path of the offending member when
the document is malformed: not an object, no schema namespace, a missing or
unresolvable `$EntityContainer`, an unknown `$BaseType` or a cycle in them, a
key that isn't a simple property name or names a property the type lacks, a set
of an unknown type, a binding to an unknown set, a navigation to an unknown
type, a navigation with no binding when several sets have the target type, and
a wrong JSON type for a member it reads. A property it can't model is not an
error: see [[attr:Schema.skipped]]. It performs no I/O.

```ts
import { parseCsdl } from "@getaster/data";

const metadata = await (await fetch("https://example.com/odata/$metadata", { headers: { accept: "application/json" } })).json();
const schema = parseCsdl(metadata);
[...schema.sets.keys()]; // ["People", "Projects", …]
```

## class:SchemaError

The only error `parseCsdl` throws on purpose, and the one
[[method:Schema.set]] throws for an unknown set. `name` is `"SchemaError"`.
The message is prefixed with the path, as `/Demo/Person/$Key/0: key property
'ident' is not a property`, and the path is also in [[attr:SchemaError.path]].
A `SchemaError` from [[classMethod:DataContext.connect]] means the service's
`$metadata` is not something the client can read, rather than that a request
failed.

## attr:SchemaError.path

The JSON path of the member the problem is in, as `/Demo/Person/$Key`. The path
is empty for a problem with the document as a whole, and `/Container` (the
container's name) for an unknown set name passed to [[method:Schema.set]].
Plain string, not a signal.

## type:EdmType

The sixteen primitive types the client models, spelled as in CSDL
(`"Edm.Int32"`). A property of any other type is skipped. The table in the
topic text gives each type's JavaScript value.

## type:Value

A primitive as the data core holds it: `string | number | boolean | null`.
`Edm.Int64` and `Edm.Decimal` are `string`s of exact decimal text, so compare
them with [[staticMethod:compareValues]] or the criteria operators, not with `<`
on the strings.

## type:Entity

A read-only record: property names to [[type:Value]]s. A property the server
didn't send, or hid from the caller, is absent. Whether it is hidden or simply
not selected is in [[attr:StoredRecord.known]] and [[attr:StoredRecord.hidden]].
Navigations aren't in it, as the client doesn't expand them; read a related
record with [[method:DataContext.lookup]].

## type:Annotations

All annotations of a field, type or set by qualified term name, with the
namespace turned into the document's alias (`Core.Description`,
`AsterData.DisplayField`). A qualifier stays in the key
(`Core.Description#short`), and an annotation on an annotation is joined with
`@` (`Validation.Minimum@Validation.Exclusive`). Values are the raw JSON. The
typed properties on [[object:Field]], [[object:EntityType]] and
[[object:EntitySet]] cover the terms the client uses; read this for any other.

## object:AllowedValue

One entry of [[attr:Field.allowedValues]], from a record in
`Validation.AllowedValues`. Plain data.

## attr:AllowedValue.value

The value that is stored and sent. It is whatever primitive the record's
`Value` member holds; the parser doesn't check it against the field's type, so
an enumeration of numbers on an `Edm.Int32` field is numbers.

## attr:AllowedValue.label

The text to show for the value. Absent when the record has no
`Core.Description`; show `value` then.

## object:Field

One property of an entity type, as `parseCsdl` read it. Every property of the
object is plain data and optional ones are absent, not `undefined`-valued, so
`"minimum" in field` tells you the server declared one.

## attr:Field.name

The property name, as sent in JSON and used in criteria and `$select`.

## attr:Field.type

The [[type:EdmType]]. A property whose type has no `$Type` is `Edm.String`.

## attr:Field.nullable

`$Nullable`; `false` when the document doesn't say, as CSDL JSON defines.

## attr:Field.maxLength

`$MaxLength`: a non-negative integer, as declared. Absent when the document
doesn't give one. The parser throws a [[class:SchemaError]] for a value that
isn't a
non-negative integer.

## attr:Field.precision

`$Precision`, a non-negative integer: the total digits of a `Decimal`, or the
fractional-second digits of a time type. Absent when the server leaves it open.

## attr:Field.scale

`$Scale`, a non-negative integer: the digits after the decimal point of a
`Decimal`. Absent when the server leaves it open.

## attr:Field.title

`Core.Description` on the property, a short label for it. Absent when the
service gives none.

## attr:Field.prompt

`Core.LongDescription` on the property: longer help or placeholder text. Absent
when the service gives none.

## attr:Field.computed

`true` when the property has `Core.Computed: true`: the server assigns it, so
the client leaves it out of creates and updates ([[staticMethod:creatable]],
[[staticMethod:writable]]) and the server refuses a changed value with
`ReadOnly`.

## attr:Field.immutable

`true` when the property has `Core.Immutable: true`: it can be set on create and
never changed afterwards.

## attr:Field.allowedValues

`Validation.AllowedValues`: the values the server accepts, in the order given,
as [[object:AllowedValue]]s. Absent when any value of the type is allowed.
Throws a [[class:SchemaError]] at parse time when the annotation isn't an array
of records.

## attr:Field.pattern

`Validation.Pattern`: a regular expression the whole value must match, as the
server states it. Absent when there is none. The parser doesn't compile it;
[[staticMethod:validateField]] does when it checks.

## attr:Field.minimum

`Validation.Minimum` as written in metadata: a number, or a string for types
whose values are strings (`Decimal`, `Date`). Absent when there's no lower
bound. See [[attr:Field.exclusiveMinimum]].

## attr:Field.maximum

`Validation.Maximum` as written in metadata: a number, or a string for
`Decimal` and date types. Absent when there's no upper bound. See
[[attr:Field.exclusiveMaximum]].

## attr:Field.exclusiveMinimum

`true` only when `Validation.Minimum` carries `@Validation.Exclusive: true`:
the value must be greater than [[attr:Field.minimum]], not equal to it. Absent
otherwise.

## attr:Field.exclusiveMaximum

`true` only when `Validation.Maximum` carries `@Validation.Exclusive: true`: the
value must be less than [[attr:Field.maximum]]. Absent otherwise.

## attr:Field.minLength

`AsterData.MinLength`: the fewest characters a string may have. Absent when
there is no minimum. aster-odata answers a shorter value with `TooShort`.

## attr:Field.emptyAsNull

`true` when the property has `AsterData.EmptyAsNull: true`: text entered as the
empty string is stored as `null`, so the edit model turns an emptied field into
`null` rather than `""`. Absent otherwise.

## attr:Field.defaultValue

`$DefaultValue`: what the server stores when a create leaves the field out.
[[method:DataContext.create]] leaves a value equal to this out of the request.
Absent when the property has none, which is different from a default of `null`.

## attr:Field.rootValue

`AsterData.RootValue`, set on a parent-key field of a self-referencing type: the
value that top-level records hold in it (for instance `0` rather than `null`).
[[object:TreeOptions]] uses it as the default for
[[attr:TreeOptions.rootValue]]. Absent when roots hold `null`.

## attr:Field.annotations

Every annotation on the property, by qualified term, including the ones lifted
into typed properties. See [[type:Annotations]]. Always present, empty when
there are none.

## object:Navigation

A link from one entity type to another. The client doesn't `$expand`
navigations; it uses them for criteria (`any`, `all`, `via`, and sort paths), for
paths in page rules and for finding foreign keys.

## attr:Navigation.name

The navigation property's name, as used in criteria such as
`{ op: "via", field: "lead", … }`.

## attr:Navigation.target

The name of the entity set it leads to. How it is chosen is in
[[staticMethod:parseCsdl]]. For a navigation with no set of its own (a contained
type) this is the target type's name.

## attr:Navigation.collection

`true` for a to-many navigation (`$Collection: true`). Collection navigations
take `any` and `all` in criteria; single-valued ones take `via`, and can appear
in a sort path such as `lead/name`.

## attr:Navigation.keys

The joining properties as `[property of this type, property of the target]`
pairs, in the order the document lists them. For `Task.project` that is
`[["projectId", "id"]]`; for the inverse `Project.tasks` it is
`[["id", "projectId"]]`. Empty when the document has no referential constraint
for the navigation or its partner. Page paths read a related record by these
keys, so a path through a single-valued navigation with none can't find it.

## attr:Navigation.partner

`$Partner`: the name of the navigation on the target type that leads back.
Absent when none is declared.

## attr:Navigation.owned

`true` when the navigation has `AsterData.Owned: true`: the children can't
exist without the parent. They are saved with it, through deep insert and the
`@delta` deep update ([[method:DataContext.update]]). `false` otherwise.

## object:EntityType

The shape of a record. It is an object with two lookup methods; the rest is
plain data. Several sets can share a type.

## attr:EntityType.name

The type's simple name (`Project`), without the namespace. Error messages from
the criteria and validation code use it, as in `unknown field 'nope' on
Project`.

## attr:EntityType.qualifiedName

The name with its namespace (`AsterDemo.Project`), the key of the type in
[[attr:Schema.types]].

## attr:EntityType.key

The key property names in key order. Composite keys are allowed here; a
[[class:Tree]] requires a single property.

## attr:EntityType.fields

The fields, in declaration order, with a base type's first. Fields that were
skipped are not in it.

## attr:EntityType.navigations

The navigations, in declaration order, base type's first.

## attr:EntityType.title

`Core.Description` on the type: its singular name for display. Absent when none.

## attr:EntityType.pluralTitle

`AsterData.PluralTitle`: the plural name for display ("Projects"). Absent when
none.

## attr:EntityType.titleField

`AsterData.TitleField`: the name of the field that best names a record, for
display. Absent when none; the parser doesn't check that it is in `fields`.

## attr:EntityType.annotations

Every annotation on the type, merged from its base types, by qualified term.
See [[type:Annotations]].

## method:EntityType.field

- `name`: a property name.

Returns the [[object:Field]], or `undefined` when the type has no such field
(including one that was skipped). Does not throw.

```ts
schema.set("Projects").type.field("budget")?.type; // "Edm.Decimal"
```

## method:EntityType.navigation

- `name`: a navigation name.

Returns the [[object:Navigation]], or `undefined`. Does not throw.

```ts
schema.set("Projects").type.navigation("tasks")?.collection; // true
```

## object:EntitySet

A queryable, writable collection of records of one type, from the entity
container.

## attr:EntitySet.name

The set's name, as in the URL (`Projects`), and what [[attr:Query.set]] and the
[[class:RecordStore]] use.

## attr:EntitySet.type

The [[object:EntityType]] of its records.

## attr:EntitySet.etag

`true` when the set has `Core.OptimisticConcurrency` with an array value (the
properties that make up the ETag): writes send `If-Match`, and aster-odata
answers a write without one with 428. `false` when the annotation is missing, or
is not an array.

## attr:EntitySet.nonFilterable

The property names in `Capabilities.FilterRestrictions/NonFilterableProperties`,
as a read-only set. [[staticMethod:toFilter]] throws a [[class:CriteriaError]]
for a field in it. Empty when there are no restrictions. The set is frozen:
adding to it throws a `TypeError`.

## attr:EntitySet.nonSortable

The property names (or navigation names, for a path sort) in
`Capabilities.SortRestrictions/NonSortableProperties`, as a read-only set.
[[staticMethod:toQueryString]] throws a [[class:CriteriaError]] for a sort on
one. Empty when there are no
restrictions.

## attr:EntitySet.countThreshold

`AsterData.CountThreshold`: below this many results the server's count is
exact; at or above it the server estimates the count or leaves it out unless
the request has `Prefer: aster.count=exact` ([[attr:CollectionOptions.exactCount]]).
Absent when the annotation is missing, negative or not a number, and then the
count is taken as exact.

## attr:EntitySet.annotations

Every annotation on the set, by qualified term. See [[type:Annotations]].

## object:Schema

The parsed `$metadata`. Read it from [[attr:DataContext.schema]] or
[[attr:ODataSource.schema]]. All members are read-only, and the maps throw a
`TypeError` if written.

## attr:Schema.namespace

The namespace of the entity container (`AsterDemo`). Types in other namespaces
of the document are still in [[attr:Schema.types]], under their own.

## attr:Schema.sets

The entity sets by name, in the container's order. Use [[method:Schema.set]]
when a missing set should be an error.

## attr:Schema.types

Every entity type of the document by qualified name (`AsterDemo.Project`),
including abstract base types and types no set uses.

## attr:Schema.skipped

What the parser left out because the client can't model it, as
[[object:Skipped]] entries. Empty for a schema that was read in full. Use it to
tell the person why a column is missing, or fail a test when the service grows
something the client ignores.

## object:Skipped

One member of `$metadata` that [[staticMethod:parseCsdl]] left out, listed in
[[attr:Schema.skipped]].

## attr:Skipped.path

The JSON path of the member in the CSDL document, such as
`/AsterDemo/Person/photo`.

## attr:Skipped.reason

Why it was left out: a phrase such as `a stream`, `an untyped value`,
`a collection-valued property` or `type AsterDemo.Colour`.

## method:Schema.set

- `name`: an entity set name.

Returns the [[object:EntitySet]]. Throws a [[class:SchemaError]] with path
`/<container name>` when the schema has no such set.

```ts
const projects = schema.set("Projects");
projects.type.titleField; // "name"
```
