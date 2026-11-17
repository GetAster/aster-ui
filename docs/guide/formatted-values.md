# Format values without changing queries

A date can display as “Yesterday” while remaining a timestamp in the data model.
That separation matters when the grid requests another page, applies a date
filter or exports the query result.

Keep typed values in the service and use `fieldPresentation` for text presentation:

```javascript
const receivedDateText = value => value == null ? '' : new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(String(value)));

grid.fieldPresentation = { fields: { receivedAt: { formatter: ({ value }) => receivedDateText(value) } } };
```

The service declares `receivedAt` as `Edm.DateTimeOffset`. Sorting and filtering
use that raw field; CSV exports its original value. A renderer can supply richer
cell markup and takes precedence over a formatter. Neither presentation function
changes the data or the collection's query.

## Order by another server field

A displayed sender name may need a normalized name or related record's display
field for ordering. Declare the server field explicitly:

```yaml
view:
  columns:
    - field: sender
      sortField: senderSortKey
    - field: receivedAt
  sort: [{ field: sender }]
  filters: {}
  frozen: 0
```

The grid sends an order by `senderSortKey`; filters still refer to the raw
`sender` field. `sortField` also accepts supported navigation paths. The service
must expose and implement the chosen field. The data layer appends entity-key
tie-breakers so equal sort values have stable page boundaries.

A JavaScript normalizer cannot globally order a collection whose other pages
have not been loaded. For paged remote collections, put normalization or
collation in the service and expose its sort key. Client normalizer callbacks for
fully materialized local lists are not part of this API.

## Numbers, currency and percentages

For a number, you rarely need a function. A [ValueFormat](../reference/#object:ValueFormat)
is plain data, and the field's metadata fills what it leaves out (a Decimal's scale is
its places; a `Measures.ISOCurrency` annotation names its currency):

```ts
grid.fieldPresentation = { fields: { price: { format: { kind: "number", style: "currency", currency: "GBP" } } } };
editor.columns = [{ field: "price", format: { style: "currency", currency: "GBP" } }]; // a ListEditor
```

The grid's `format`, a list editor's `ListColumn.format`, the meter and slider labels
and your own text all come from the one exported
[formatFigure](../reference/#staticMethod:formatFigure), so a figure reads the same
everywhere:

```ts
formatFigure("1850.5", { style: "currency", currency: "GBP" }, { field: priceField }); // "£1,850.50"
```

## Use formatters in YAML

Register an ordinary function with the composition registry:

```javascript
const renderers = {
  'received-date': defineCompositeRenderer(['fieldPresentation'], ({ value }) => receivedDateText(value)),
};
```

Then reference it on a Grid child:

```yaml
fieldPresentation:
  fields:
    receivedAt:
      formatter: { renderer: received-date }
```

Function bodies remain in JS/TS. YAML declares their connection to the control.

The [mail workspace](../examples/mail.html) demonstrates sender-name sorting and
real received timestamps displayed as times, “Yesterday” or calendar dates.
The shared Sort panel remains available when a grid switches to narrow cards.
See [shared field presentation](../reference/#object:FieldPresentation) and
[GridColumn.sortField](../reference/#attr:GridColumn.sortField).

## Share display between hosts

Grid, Form and ListEditor accept the same `fieldPresentation` property. Form uses
the treatment when its bound field is read-only; editing keeps the native control.
A local `FormField.presentation` or `ListColumn.presentation` overrides individual
members. Grid geometry and row/cell decoration remain in `Grid.presentation`.

```ts
const display = {
  types: { "Example.EmailAddress": { treatment: "email" } },
  fields: { alternateEmail: { treatment: "email" } },
};
grid.fieldPresentation = display;
form.fieldPresentation = display;
listEditor.fieldPresentation = display;
```

Type keys match `Field.annotations["AsterData.Type"]`. The recognized `email`
hint selects a mailto link automatically. An application can map any declared
type, such as `Example.EmailAddress`, to the same treatment. Unknown metadata
uses the primitive display. Empty and malformed addresses stay readable text.

Each member inherits from the local occurrence, host field, host semantic type,
recognized metadata, then primitive defaults. Content uses `display(context)`,
then `formatter(context)`, then `valueMap`, then typed formatting. Callbacks get
`field`, `name`, raw `value`, `key` and a frozen `entity` projection containing
only loaded, visible values. Hidden and unloaded fields never invoke callbacks.
Register `display` or `formatter` callbacks for `fieldPresentation` through the
existing composition registry. No code is loaded from metadata.

Migration: replace `Grid.renderers` and `ListEditor.renderers` with
`fieldPresentation.fields[name].display`, and `Grid.formatters` with
`fieldPresentation.fields[name].formatter`. Callbacks now accept the context
object. Replace `(entity, key)` with `({ entity, key })` and `(value, entity,
field)` with `({ value, entity, field })`.
