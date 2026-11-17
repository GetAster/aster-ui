// The finance service: its $metadata and a seed. Account balances and invoice line amounts are
// server-computed: the mock's Aster.Mock.V1 annotations stand in for the views a real service keeps.
const CORE = "Org.OData.Core.V1";
const Core = (term, value) => ({ [`@${CORE}.${term}`]: value });
const sums = (title, extra = {}) => ({ "@Org.OData.Core.V1.Description": title, ...extra });
const money = (title, extra = {}) => ({ $Type: "Edm.Decimal", $Precision: 14, $Scale: 2, ...sums(title), ...extra });
const choice = (title, values) => ({ ...sums(title), "@Org.OData.Validation.V1.AllowedValues": values.map(([Value, label]) => ({ Value, "@Org.OData.Core.V1.Description": label })) });
const key = { $Type: "Edm.Int32", ...Core("Computed", true) };
const include = (Namespace, Alias) => ({ $Include: [{ $Namespace: Namespace, $Alias: Alias }] });
// The totals of a column over an entry's lines, as the service publishes an aggregate.
const entryTotal = field => ({ $Apply: [{ $NavigationPropertyPath: "lines" }, { $PropertyPath: field }], $Function: "AsterData.Sum" });

export const metadata = {
  $Version: "4.01",
  $EntityContainer: "Finance.Container",
  $Reference: {
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": include(CORE, "Core"),
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Validation.V1.json": include("Org.OData.Validation.V1", "Validation"),
    "https://aster.dev/vocabularies/Aster.Data.V1.json": include("Aster.Data.V1", "AsterData"),
  },
  Finance: {
    Account: {
      $Kind: "EntityType", $Key: ["id"], ...sums("Account", { "@AsterData.PluralTitle": "Accounts", "@AsterData.TitleField": "name" }),
      id: key,
      code: { $MaxLength: 10, ...sums("Code", { "@AsterData.MinLength": 1 }) },
      name: { $MaxLength: 80, ...sums("Account", { "@AsterData.MinLength": 1 }) },
      // Server-computed: how accountants name an account.
      label: { $MaxLength: 100, ...sums("Account", { ...Core("Computed", true), "@Aster.Mock.V1.Concat": ["code", "name"] }) },
      type: choice("Type", [["asset", "Asset"], ["liability", "Liability"], ["equity", "Equity"], ["revenue", "Revenue"], ["expense", "Expense"]]),
      parentId: { $Type: "Edm.Int32", $Nullable: true, ...sums("Parent account") },
      postable: { $Type: "Edm.Boolean", ...sums("Accepts postings") },
      parent: { $Kind: "NavigationProperty", $Type: "Finance.Account", $Nullable: true, $ReferentialConstraint: { parentId: "id" }, "@AsterData.DisplayField": "name" },
      // A server-computed field: the posted debits less credits of the account and every account under it,
      // taken on the account's normal side.
      balance: money("Balance", {
        ...Core("Computed", true),
        "@Aster.Mock.V1.Rollup": {
          Parent: "parentId", Lines: "JournalLines", Account: "accountId", Debit: "debit", Credit: "credit",
          Entry: { Property: "entryId", Set: "JournalEntries", Status: "status", Value: "posted" },
          Negate: { Property: "type", Values: ["liability", "equity", "revenue"] },
        },
      }),
    },
    JournalEntry: {
      $Kind: "EntityType", $Key: ["id"], ...sums("Journal entry", { "@AsterData.PluralTitle": "Journal entries", "@AsterData.TitleField": "reference" }),
      id: key,
      reference: { $MaxLength: 20, ...sums("Reference", { "@AsterData.MinLength": 1 }) },
      date: { $Type: "Edm.Date", ...sums("Date") },
      memo: { $MaxLength: 200, ...sums("Memo", { "@AsterData.MinLength": 1 }) },
      status: choice("Status", [["draft", "Draft"], ["posted", "Posted"]]),
      invoiceId: { $Type: "Edm.Int32", $Nullable: true, ...sums("Invoice") },
      lines: { $Kind: "NavigationProperty", $Type: "Finance.JournalLine", $Collection: true, $Partner: "entry", "@AsterData.Owned": true },
      // A draft may be anything; a posted entry has two lines and equal debits and credits. The service judges
      // it on the lines a write leaves; the client judges the same condition live over the lines being edited.
      // status ne 'posted' or (lines/$count ge 2 and Sum(lines, debit) eq Sum(lines, credit))
      "@Org.OData.Validation.V1.Constraint#EntryBalances": {
        Condition: {
          $Or: [
            { $Ne: [{ $Path: "status" }, "posted"] },
            { $And: [{ $Ge: [{ $Path: "lines/$count" }, 2] }, { $Eq: [entryTotal("debit"), entryTotal("credit")] }] },
          ],
        },
        FailureMessage: "An entry needs two lines and equal debits and credits to be posted.",
      },
    },
    JournalLine: {
      $Kind: "EntityType", $Key: ["id"], ...sums("Journal line", { "@AsterData.PluralTitle": "Journal lines", "@AsterData.TitleField": "description" }),
      id: key,
      entryId: { $Type: "Edm.Int32", ...sums("Entry") },
      entry: { $Kind: "NavigationProperty", $Type: "Finance.JournalEntry", $Partner: "lines", $ReferentialConstraint: { entryId: "id" } },
      accountId: { $Type: "Edm.Int32", ...sums("Account") },
      account: { $Kind: "NavigationProperty", $Type: "Finance.Account", $ReferentialConstraint: { accountId: "id" }, "@AsterData.DisplayField": "name" },
      description: { $Nullable: true, $MaxLength: 200, ...sums("Description", { "@AsterData.EmptyAsNull": true }) },
      debit: money("Debit", { "@Org.OData.Validation.V1.Minimum": "0" }),
      credit: money("Credit", { "@Org.OData.Validation.V1.Minimum": "0" }),
    },
    Customer: {
      $Kind: "EntityType", $Key: ["id"], ...sums("Customer", { "@AsterData.PluralTitle": "Customers", "@AsterData.TitleField": "name" }),
      id: key,
      name: { $MaxLength: 80, ...sums("Customer", { "@AsterData.MinLength": 1 }) },
      address: { $MaxLength: 200, ...sums("Address") },
      email: { $MaxLength: 120, ...sums("Email") },
    },
    Invoice: {
      $Kind: "EntityType", $Key: ["id"], ...sums("Invoice", { "@AsterData.PluralTitle": "Invoices", "@AsterData.TitleField": "number" }),
      id: key,
      number: { $MaxLength: 20, ...sums("Invoice number", { "@AsterData.MinLength": 1 }) },
      customerId: { $Type: "Edm.Int32", ...sums("Bill to") },
      customer: { $Kind: "NavigationProperty", $Type: "Finance.Customer", $ReferentialConstraint: { customerId: "id" }, "@AsterData.DisplayField": "name" },
      issueDate: { $Type: "Edm.Date", ...sums("Issued") },
      dueDate: { $Type: "Edm.Date", ...sums("Due") },
      status: choice("Status", [["pending", "Pending"], ["paid", "Paid"], ["overdue", "Overdue"]]),
      taxRate: { $Type: "Edm.Decimal", $Precision: 5, $Scale: 2, ...sums("Tax rate (%)", { "@Org.OData.Validation.V1.Minimum": "0", "@Org.OData.Validation.V1.Maximum": "100" }) },
      reference: { $Nullable: true, $MaxLength: 60, ...sums("Customer reference", { "@AsterData.EmptyAsNull": true }) },
      entryId: { $Type: "Edm.Int32", $Nullable: true, ...sums("Journal entry") },
      lines: { $Kind: "NavigationProperty", $Type: "Finance.InvoiceLine", $Collection: true, $Partner: "invoice", "@AsterData.Owned": true },
    },
    InvoiceLine: {
      $Kind: "EntityType", $Key: ["id"], ...sums("Invoice line", { "@AsterData.PluralTitle": "Invoice lines", "@AsterData.TitleField": "description" }),
      id: key,
      invoiceId: { $Type: "Edm.Int32", ...sums("Invoice") },
      invoice: { $Kind: "NavigationProperty", $Type: "Finance.Invoice", $Partner: "lines", $ReferentialConstraint: { invoiceId: "id" } },
      position: { $Type: "Edm.Int32", ...sums("Position") },
      description: { $MaxLength: 200, ...sums("Description", { "@AsterData.MinLength": 1 }) },
      quantity: { $Type: "Edm.Decimal", $Precision: 10, $Scale: 2, ...sums("Qty", { "@Org.OData.Validation.V1.Minimum": "0" }) },
      rate: money("Rate", { "@Org.OData.Validation.V1.Minimum": "0" }),
      amount: money("Amount", { ...Core("Computed", true), "@Aster.Mock.V1.Product": ["quantity", "rate"] }),
    },
    Container: {
      $Kind: "EntityContainer",
      Accounts: { $Collection: true, $Type: "Finance.Account", $NavigationPropertyBinding: { parent: "Accounts" } },
      JournalEntries: { $Collection: true, $Type: "Finance.JournalEntry", $NavigationPropertyBinding: { lines: "JournalLines" } },
      JournalLines: { $Collection: true, $Type: "Finance.JournalLine", $NavigationPropertyBinding: { entry: "JournalEntries", account: "Accounts" } },
      Customers: { $Collection: true, $Type: "Finance.Customer" },
      Invoices: { $Collection: true, $Type: "Finance.Invoice", $NavigationPropertyBinding: { customer: "Customers", lines: "InvoiceLines" } },
      InvoiceLines: { $Collection: true, $Type: "Finance.InvoiceLine", $NavigationPropertyBinding: { invoice: "Invoices" } },
    },
  },
};

// [id, code, name, type, parent code]
const chart = [
  [1, "1000", "Assets", "asset", null],
  [2, "1100", "Current assets", "asset", "1000"],
  [3, "1110", "Bank account", "asset", "1100"],
  [4, "1120", "Accounts receivable", "asset", "1100"],
  [5, "1500", "Fixed assets", "asset", "1000"],
  [6, "1510", "Equipment", "asset", "1500"],
  [7, "2000", "Liabilities", "liability", null],
  [8, "2100", "Current liabilities", "liability", "2000"],
  [9, "2110", "Accounts payable", "liability", "2100"],
  [10, "2120", "Sales tax payable", "liability", "2100"],
  [11, "2500", "Long-term loan", "liability", "2000"],
  [12, "3000", "Equity", "equity", null],
  [13, "3100", "Owner's capital", "equity", "3000"],
  [14, "3200", "Retained earnings", "equity", "3000"],
  [15, "4000", "Revenue", "revenue", null],
  [16, "4100", "Consulting revenue", "revenue", "4000"],
  [17, "4200", "Subscription revenue", "revenue", "4000"],
  [18, "5000", "Expenses", "expense", null],
  [19, "5100", "Operating expenses", "expense", "5000"],
  [20, "5110", "Rent", "expense", "5100"],
  [21, "5120", "Software", "expense", "5100"],
  [22, "5130", "Salaries", "expense", "5100"],
  [23, "5200", "Marketing", "expense", "5000"],
];
const accountId = Object.fromEntries(chart.map(([id, code]) => [code, id]));

// [id, reference, date, memo, status, invoiceId, [[account code, debit, credit]]]
const entries = [
  [1, "JE-0001", "2026-01-02", "Opening capital", "posted", null, [["1110", "50000.00", "0.00"], ["3100", "0.00", "50000.00"]]],
  [2, "JE-0002", "2026-01-15", "Laptops and monitors", "posted", null, [["1510", "4800.00", "0.00"], ["1110", "0.00", "4800.00"]]],
  [3, "JE-0003", "2026-02-01", "February office rent", "posted", null, [["5110", "1200.00", "0.00"], ["1110", "0.00", "1200.00"]]],
  [4, "JE-0004", "2026-02-03", "Design software licences", "posted", null, [["5120", "349.00", "0.00"], ["1110", "0.00", "349.00"]]],
  [5, "JE-0005", "2026-09-15", "Invoice INV-1041", "posted", 1, [["1120", "7200.00", "0.00"], ["4100", "0.00", "6000.00"], ["2120", "0.00", "1200.00"]]],
  [6, "JE-0006", "2026-10-12", "Payment received for INV-1041", "posted", null, [["1110", "7200.00", "0.00"], ["1120", "0.00", "7200.00"]]],
  [7, "JE-0007", "2026-10-31", "October salaries", "posted", null, [["5130", "9500.00", "0.00"], ["1110", "0.00", "9500.00"]]],
  [8, "JE-0008", "2026-11-16", "Month-end software accrual", "draft", null, [["5120", "120.00", "0.00"], ["2110", "0.00", "100.00"]]],
];

const customers = [
  [1, "Northwind Traders", "12 Quay Street, Bristol BS1 4DJ", "accounts@northwind.example"],
  [2, "Harbour & Vale Ltd", "Unit 4, Dockside Works, Cardiff CF10 4AH", "finance@harbourvale.example"],
  [3, "Lumen Studio", "3 Lantern Row, Edinburgh EH3 9QG", "hello@lumenstudio.example"],
];

// [id, number, customer, issued, due, status, reference, entry, [[description, qty, rate]]]
const invoices = [
  [1, "INV-1041", 1, "2026-09-15", "2026-10-15", "paid", "PO 7731", 5, [["Discovery workshop (2 days)", "2.00", "1500.00"], ["Prototype build", "1.00", "3000.00"]]],
  [2, "INV-1042", 2, "2026-11-02", "2026-11-30", "pending", "HV-2026-118", null, [["Quarterly design retainer", "1.00", "3600.00"], ["Accessibility audit", "1.00", "1850.50"], ["Workshop travel", "3.00", "125.00"]]],
  [3, "INV-1043", 3, "2026-09-28", "2026-10-28", "overdue", null, null, [["Brand identity refresh", "1.00", "2400.00"], ["Printed collateral (per set)", "12.00", "35.00"]]],
  [4, "INV-1044", 1, "2026-11-10", "2026-12-10", "pending", "PO 7802", null, [["Support subscription, 25 seats", "25.00", "18.00"], ["Onboarding session", "2.00", "250.00"]]],
];

let lineId = 0;
let invoiceLineId = 0;
export const data = {
  // Only a leaf account takes journal lines; the others total what is under them.
  Accounts: chart.map(([id, code, name, type, parent]) => ({
    id, code, name, type, parentId: parent ? accountId[parent] : null, postable: !chart.some(row => row[4] === code),
  })),
  JournalEntries: entries.map(([id, reference, date, memo, status, invoiceId]) => ({ id, reference, date, memo, status, invoiceId })),
  JournalLines: entries.flatMap(([entryId, , , , , , lines]) => lines.map(([code, debit, credit]) => ({
    id: ++lineId, entryId, accountId: accountId[code], description: null, debit, credit,
  }))),
  Customers: customers.map(([id, name, address, email]) => ({ id, name, address, email })),
  Invoices: invoices.map(([id, number, customerId, issueDate, dueDate, status, reference, entryId]) => ({
    id, number, customerId, issueDate, dueDate, status, taxRate: "20.00", reference, entryId,
  })),
  InvoiceLines: invoices.flatMap(([invoiceId, , , , , , , , lines]) => lines.map(([description, quantity, rate], i) => ({
    id: ++invoiceLineId, invoiceId, position: i + 1, description, quantity, rate,
  }))),
};

/** The company that issues the invoices. */
export const seller = {
  name: "Fernbank Design Studio Ltd",
  address: ["8 Mill Lane", "Leeds LS1 5AB"],
  email: "billing@fernbank.example",
  taxNumber: "GB 123 4567 89",
  payment: "Sort code 40-12-76 · Account 1234 5678",
};
