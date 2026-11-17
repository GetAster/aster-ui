// The chart of accounts: a tree grid whose balances are the service's own roll-up of posted journal
// lines. Nothing here totals a child; a posting elsewhere changes the rows when the service says so.
import { effect } from "@preact/signals-core";
import { html, render } from "lit-html";
import { pounds, pence } from "./finance-amounts.js";

const view = {
  columns: [{ field: "code", width: 150 }, { field: "name" }, { field: "type", width: 130 }, { field: "balance", width: 170 }],
  sort: [{ field: "code" }],
  filters: {},
  frozen: 0,
};
const presentation = {
  columns: { balance: { format: { kind: "number", style: "currency", currency: "GBP" } } },
  rowClass: [{ when: { field: "postable", op: "eq", value: false }, class: "account-group" }],
};
const tree = { parentField: "parentId", autoOpen: 2 };
const toolbar = { advanced: false, views: false, columns: false };

export function mountAccounts(root, finance) {
  const { ctx, accounts } = finance;
  const total = type => accounts.items.value.filter(account => account.parentId === null && account.type === type).reduce((sum, account) => sum + pence(String(account.balance)), 0n);

  const stop = effect(() => {
    const figures = ["asset", "liability", "equity", "revenue", "expense"].map(type => [type, total(type)]);
    const [assets, liabilities, equity, revenue, expenses] = figures.map(([, amount]) => amount);
    const profit = revenue - expenses;
    const balanced = assets === liabilities + equity + profit;
    render(html`<div class="finance-accounts">
      <dl class="aster-ledger finance-ledger">
        ${[["Assets", assets], ["Liabilities", liabilities], ["Equity", equity], ["Revenue", revenue], ["Expenses", expenses]].map(([title, amount]) => html`
          <div class="aster-figure"><dt>${title}</dt><dd><span class="aster-big finance-num" data-figure=${String(title).toLowerCase()}>${pounds(amount)}</span></dd></div>`)}
      </dl>
      <p class="finance-balance" data-state=${balanced ? "balanced" : "out"} role="status">
        <span aria-hidden="true">${balanced ? "✓" : "!"}</span>
        ${balanced ? "The books balance: assets equal liabilities, equity and profit." : "The books are out of balance."}</p>
      <aster-grid class="finance-grid" .ctx=${ctx} .set=${"Accounts"} .label=${"Chart of accounts"} .view=${view} .tree=${tree}
        .presentation=${presentation} .toolbar=${toolbar}></aster-grid>
      <p class="finance-hint">Each balance is computed by the service: the posted debits less credits on an account and everything under it, shown on its normal side. Drafts don't count.</p>
    </div>`, root);
  });
  return stop;
}
