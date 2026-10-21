# Format values without changing queries

A date can display as “Yesterday” while remaining a timestamp in the data model.
That separation matters when the grid requests another page, applies a date
filter or exports the query result.

Keep typed values in the service and use `Grid.formatters` for text presentation:

```javascript
const receivedDateText = value => value == null ? '' : new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(String(value)));

grid.formatters = { receivedAt: receivedDateText };
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

## Use formatters in YAML

Register an ordinary function with the composition registry:

```javascript
const renderers = {
  'received-date': defineCompositeRenderer(['formatters'], receivedDateText),
};
```

Then reference it on a Grid child:

```yaml
formatters:
  receivedAt: { renderer: received-date }
```

Function bodies remain in JS/TS. YAML declares their connection to the control.

The [mail workspace](../examples/mail.html) demonstrates sender-name sorting and
real received timestamps displayed as times, “Yesterday” or calendar dates.
The shared Sort menu remains available when a grid switches to narrow cards.
See [Grid.formatters](../reference/#attr:Grid.formatters) and
[GridColumn.sortField](../reference/#attr:GridColumn.sortField).
