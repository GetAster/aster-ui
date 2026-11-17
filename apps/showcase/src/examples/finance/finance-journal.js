// The journal: entries with their lines, a tree picker over the chart per line, running totals, and the entry's
// own rule: a posted entry has two lines and equal debits and credits. The service publishes that rule; the
// record judges it live over the lines being edited, and says why Post is unavailable.
import { RecordEdit, Selection } from "@getaster/data";
import { TreeChoices, formatDate } from "@getaster/elements";
import { effect, signal } from "@preact/signals-core";
import { html, nothing, render } from "lit-html";
import { GBP, pounds, pence } from "./finance-amounts.js";

// The summary takes focus when a save fails on the entry's rule, as it would for a field.
const formChrome = { autoFocus: true };
const sections = [{ title: "Entry", columns: 3, items: ["reference", "date", "memo"] }];
const readOnly = { readOnly: true };
const none = {};
const amountOf = (values, field) => pence(String(values[field] ?? "0"));
// A journal leaves the side a line does not use blank where it reads as text; the inputs keep their figure.
const blankZero = (values, field) => (amountOf(values, field) === 0n ? "" : pounds(amountOf(values, field)));

// What one line can say for itself. The totals below are across lines, so they aren't a rule.
const eitherSide = values => ({
  credit: amountOf(values, "debit") > 0n && amountOf(values, "credit") > 0n ? "A line is a debit or a credit, not both." : undefined,
  debit: amountOf(values, "debit") === 0n && amountOf(values, "credit") === 0n ? "Enter a debit or a credit." : undefined,
});

export const entryStatus = status => html`<span class="aster-status" data-tone=${status === "posted" ? "positive" : nothing}>${status === "posted" ? "Posted" : "Draft"}</span>`;

/** Debits, credits and their difference over the lines as they are now, unsaved edits included. For display: the rule decides nothing here. */
export function entryFigures(record) {
  const rows = record.owned.lines.rows.value.filter(row => !row.removing);
  let debit = 0n;
  let credit = 0n;
  for (const row of rows) {
    debit += amountOf(row.edit.values.value, "debit");
    credit += amountOf(row.edit.values.value, "credit");
  }
  return { count: rows.length, debit, credit, difference: debit - credit, balanced: debit === credit && debit > 0n };
}

export function mountJournal(root, finance, { toast }) {
  const { ctx, entries } = finance;
  const selection = new Selection(ctx.store, entries);
  const records = new Map();
  const current = signal(undefined);
  const busy = signal(false);
  const note = signal("");
  // The chart as accountants read it, with only the accounts that take postings chosen; the groups stay open to browse.
  const choices = new TreeChoices(ctx, {
    set: "Accounts", parentField: "parentId", orderBy: [{ field: "code" }],
    display: "label", searchFields: ["code", "name"], choosable: account => account.postable === true,
  });

  const stopSelect = effect(() => {
    const key = selection.key.value;
    if (key === undefined) return void (current.value = undefined);
    let record = records.get(key);
    if (!record) {
      record = new RecordEdit(ctx, "JournalEntries", key, { owned: { lines: { ...finance.entryLines, rules: [eitherSide] } } });
      records.set(key, record);
    }
    note.value = "";
    current.value = record;
  });

  const editor = document.createElement("aster-list-editor");
  editor.addLabel = "Add line";
  editor.empty = html`<p class="finance-empty">No lines yet. Add a debit and a credit.</p>`;
  editor.columns = [
    { field: "accountId", width: "minmax(11rem, 2fr)", options: choices },
    { field: "description", width: "minmax(8rem, 2fr)" },
    { field: "debit", width: "8.5rem", format: GBP, display: row => blankZero(row.edit.values.value, "debit") },
    { field: "credit", width: "8.5rem", format: GBP, display: row => blankZero(row.edit.values.value, "credit") },
  ];

  // Why Post is unavailable: the entry is posted, a field or line is invalid, or the entry's rule would fail once posted.
  function why(record, posted) {
    if (posted) return "Already posted.";
    if (!record.valid.value) return "Fix the lines marked first.";
    return record.explain({ status: "posted" })[0]?.message;
  }

  async function save(record) {
    busy.value = true;
    note.value = "";
    try {
      // A draft is saved as a draft: a post that was refused left the status set.
      record.edit.set("status", record.edit.baseline.value.status);
      const result = await record.save();
      if (!result) {
        record.problems();
        note.value = "Fix the fields marked before saving.";
      } else if (!result.ok) note.value = "The entry wasn't saved.";
    } finally {
      busy.value = false;
    }
  }

  async function post(record) {
    busy.value = true;
    note.value = "";
    try {
      const reference = record.edit.values.value.reference;
      const key = record.key;
      const result = await finance.postEntry(record);
      if (!result?.ok) {
        note.value = "The entry wasn't posted.";
        return;
      }
      toast(`Posted ${reference}`, { label: "Undo", run: () => void finance.setEntryStatus(key, "draft").then(() => toast(`${reference} is a draft again`)) });
    } catch (error) {
      note.value = `The entry wasn't posted: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy.value = false;
    }
  }

  async function create() {
    busy.value = true;
    try {
      selection.select(await finance.createEntry());
    } finally {
      busy.value = false;
    }
  }

  const row = entry => html`<span class="invoice-row">
    <strong>${entry.reference}</strong><span class="invoice-row-who">${entry.memo}</span>
    <span class="invoice-row-due">${formatDate(String(entry.date))}</span>${entryStatus(entry.status)}</span>`;

  function detail(record) {
    const values = record.edit.values.value;
    // Posted as saved: a post in flight (the status set, not yet accepted) leaves the lines open, so a refusal can be fixed.
    const posted = record.edit.baseline.value.status === "posted";
    const figures = entryFigures(record);
    const reason = why(record, posted);
    editor.list = record.owned.lines;
    editor.label = `Lines of ${values.reference ?? "the entry"}`;
    editor.readOnlyReason = posted ? "Posted entries can't be changed." : undefined;
    const side = figures.difference > 0n ? "Debits exceed credits" : "Credits exceed debits";
    const state = figures.count === 0 ? "empty" : figures.balanced ? "balanced" : "out";
    return html`<div class="journal-entry">
      <header class="journal-head"><h2>${values.reference ?? ""}</h2>${entryStatus(record.edit.baseline.value.status)}
        ${values.invoiceId ? html`<span class="finance-hint">Booked from an invoice</span>` : nothing}</header>
      <aster-form class="finance-no-print" .model=${record.edit} .sections=${sections} .chrome=${formChrome} .headingLevel=${3} .policy=${posted ? readOnly : none}></aster-form>
      <div class="journal-lines">${editor}</div>
      <div class="journal-totals" role="group" aria-label="Totals">
        <span class="journal-totals-label">Totals</span>
        <span class="finance-num" data-total="debit"><span class="finance-sr">Debits </span>${pounds(figures.debit)}</span>
        <span class="finance-num" data-total="credit"><span class="finance-sr">Credits </span>${pounds(figures.credit)}</span>
      </div>
      <p class="finance-balance" data-state=${state} role="status">
        <span aria-hidden="true">${state === "balanced" ? "✓" : "!"}</span>
        ${state === "balanced" ? "Balanced: debits equal credits."
          : state === "empty" ? "No lines yet."
          : `Out of balance by ${pounds(figures.difference < 0n ? -figures.difference : figures.difference)}. ${side}.`}</p>
      <div class="finance-actions finance-no-print">
        <aster-button .label=${"Post entry"} .variant=${"primary"} .busy=${busy.value} .reason=${reason} data-action="post-entry" @click=${() => void post(record)}></aster-button>
        <aster-button .label=${"Save draft"} .busy=${busy.value} .reason=${posted ? "Posted entries can't be changed." : record.dirty.value ? undefined : "No changes to save."} @click=${() => void save(record)}></aster-button>
        <aster-button .label=${"Revert"} .reason=${record.dirty.value ? undefined : "No changes to revert."} @click=${() => record.revert()}></aster-button>
        <span class="finance-note" role="status">${note.value}</span>
      </div>
    </div>`;
  }

  const stopRender = effect(() => {
    const record = current.value;
    render(html`<div class="finance-split">
      <aside class="finance-list" aria-label="Journal entries">
        <div class="finance-list-head"><h2>Entries</h2><aster-button .label=${"New entry"} .busy=${busy.value} @click=${() => void create()}></aster-button></div>
        <aster-listbox .label=${"Journal entries"} .selection=${selection} .renderRow=${row}></aster-listbox>
      </aside>
      <section class="finance-detail" aria-label="Journal entry">${record ? detail(record) : nothing}</section>
    </div>`, root);
  });

  return {
    show: key => selection.select(key),
    /** Runs the Post button's handler on the entry being edited; the button itself stays disabled while the rule would fail, so the tests use this to send a post the service refuses. */
    post: () => (current.peek() ? post(current.peek()) : undefined),
    dispose: () => {
      stopSelect();
      stopRender();
      records.forEach(record => record.dispose());
    },
  };
}
