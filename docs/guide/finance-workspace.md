# Keep a ledger in step with an invoice

[Open the finance workspace](../examples/finance.html) to post an invoice and watch a journal entry appear and every account balance up the chart change. Three screens read one store: nothing refreshes them by hand.

## Edit a record and the rows it owns as one thing

An invoice and its lines are a `RecordEdit`: the header is an edit model bound to a form, and the lines are a `ListEdit` shown in a list editor. Saving sends one deep update, all or nothing. The document beside them reads the same values, so a typed quantity changes the totals before anything is saved.

```javascript
const record = new RecordEdit(ctx, "Invoices", key, { owned: { lines: { positionField: "position" } } });
form.model = record.edit;
editor.list = record.owned.lines;
await record.save();
```

Keep one `RecordEdit` per invoice while another is shown, so a half-finished edit is still there on return.

## Let the service total the tree

An account's balance is the posted debits less credits on it and everything beneath it. The tree grid does not add children up: the service computes the field, and the grid shows what it sends. The mock service does this from an annotation on the property (see [the mock service](../reference/#staticMethod:createMockService)), standing in for the view a real service would keep.

A write that changes a balance the client never sent has no change feed to announce it. The example listens to the mock's `onChange` and reads each reported account again with origin `"external"`; the tree grid, the summary figures and the picker follow the store.

## Choose an account from the chart

A journal line's account is a position in the chart of accounts, so the line's cell is a tree picker, not a flat list. Give the list column a `TreeChoices` as its `options`: the popup shows the hierarchy, `choosable` allows only the accounts that take postings (the groups open to browse but never choose), `display: "label"` shows the account as "code name" from the field the service computes, and `searchFields` lets a person type a code or a name.

```javascript
const accounts = new TreeChoices(ctx, {
  set: "Accounts", parentField: "parentId", orderBy: [{ field: "code" }],
  display: "label", searchFields: ["code", "name"], choosable: account => account.postable === true,
});
editor.columns = [{ field: "accountId", options: accounts }, { field: "debit" }, { field: "credit" }];
```

The keyboard and every cell state come with the picker: arrows open and walk the tree, Enter chooses a leaf, a changed account is marked, an empty one is flagged on save, and a posted entry reads as text. A form needs no configuration for the same thing: a field that is a foreign key into a tree gets a tree picker by itself.

## Declare the rule once, on the service

"Debits equal credits" is a property of an entry's lines together, so it is a rule over a record and the rows it owns. The service declares it once, as a `Validation.Constraint` on `Finance.JournalEntry`, and enforces it on the lines a write leaves: `status ne 'posted' or (lines/$count ge 2 and Sum(lines, debit) eq Sum(lines, credit))`. A draft may be anything; a posted entry has two lines and balances.

The client reads the same condition from `$metadata` (`EntityType.rules`) and judges it live over the lines being edited, new rows and unsaved edits included, with removed rows left out. The Post button asks `record.explain({ status: "posted" })` and shows the first message as its reason; nothing in the page checks the totals. The totals and the "Out of balance" line are figures for display. If a post gets past the client, the service refuses it with the rule's id and message, and the record shows it in the form's summary and under the lines, as it shows a client failure. Saving a draft is never held up by the rule.

## Print the document

The invoice has a print stylesheet: the list, form, tabs and buttons are hidden and the document loses its card chrome. Everything else is the same markup you see on screen.

See [Grid](../reference/#class:Grid), [ListEditor](../reference/#class:ListEditor) and [Form](../reference/#class:Form) for the contracts.
