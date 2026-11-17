# Finance workspace

Invoices, a chart of accounts and a journal over one mock dataset. Posting an
invoice creates a journal entry; the service recomputes every account balance
up the tree, and each screen follows without being told.

Start with [finance.js](finance.js) (the three tabs), then
[finance-service.js](finance-service.js) (the data context and the writes that
touch several records), and one screen each:

- [finance-invoices.js](finance-invoices.js): a form for the header, a list
  editor for the lines, a document that updates as you type, and print styles.
- [finance-accounts.js](finance-accounts.js): a tree grid. Parent balances are
  not summed here; they are a server-computed field.
- [finance-journal.js](finance-journal.js): entries and lines with a tree
  picker over the chart of accounts (the hierarchy shows, only leaf accounts
  can be chosen, and an account reads "code name"), totals, and Post, which
  says why it is unavailable from the entry's published rule.

[finance-mock.js](finance-mock.js) holds the `$metadata` and seed. Its
`Aster.Mock.V1.Rollup` and `Product` annotations are what the mock engine
computes balances and line amounts from (see
[the mock service](../../../../../docs/reference/mock.md)). The debits-equal-credits
rule is the service's: `finance-mock.js` publishes it as a
`Validation.Constraint` on `Finance.JournalEntry`, the mock enforces it on the
lines a write leaves, and the record judges the same condition live
(`record.explain`, `record.rules`).

Build from the repository root with `bun run site`; the example runs at
`/playground/finance.html`, with its public filenames in
`apps/showcase/build/assets.ts`. The checks are in `tests/e2e/finance.spec.ts`.
