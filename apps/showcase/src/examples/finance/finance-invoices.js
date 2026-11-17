// The invoice viewer: a list of invoices and, for the one chosen, its details as a form and the
// document itself. Editing the form or the lines updates the document as it is typed.
import { RecordEdit, Selection, keyText } from "@getaster/data";
import { formatDate, formatFigure } from "@getaster/elements";
import { computed, effect, signal } from "@preact/signals-core";
import { html, nothing, render } from "lit-html";
import { seller } from "./finance-mock.js";
import { GBP, lineAmount, pounds, percentOf, pence } from "./finance-amounts.js";

const STATUS = { paid: ["Paid", "positive"], pending: ["Pending", "caution"], overdue: ["Overdue", "negative"] };
export const statusView = status => {
  const [label, tone] = STATUS[status] ?? [String(status ?? ""), undefined];
  return html`<span class="aster-status" data-tone=${tone ?? nothing}>${label}</span>`;
};

export function mountInvoices(root, finance, { toast, showEntry }) {
  const { ctx, invoices, customers } = finance;
  const selection = new Selection(ctx.store, invoices);
  const records = new Map();
  const current = signal(undefined);
  const busy = signal(false);
  const note = signal("");

  // One edit per invoice, kept while another is shown, so a half-finished edit is still there on return.
  const stopSelect = effect(() => {
    const key = selection.key.value;
    if (key === undefined) return void (current.value = undefined);
    let record = records.get(key);
    if (!record) {
      record = new RecordEdit(ctx, "Invoices", key, { owned: { lines: { positionField: "position", defaults: () => ({ description: "", quantity: "1.00", rate: "0.00" }) } } });
      records.set(key, record);
    }
    note.value = "";
    current.value = record;
  });

  const customerOf = id => customers.items.value.find(customer => customer.id === id);
  const lineTotals = (record, values) => {
    const rows = record.owned.lines.rows.value.filter(row => !row.removing);
    const subtotal = rows.reduce((sum, row) => sum + lineAmount(String(row.edit.values.value.quantity ?? "0"), String(row.edit.values.value.rate ?? "0")), 0n);
    const tax = percentOf(subtotal, String(values.taxRate ?? "0"));
    return { count: rows.length, subtotal, tax, total: subtotal + tax };
  };

  // The line editor is made once; the record it edits changes.
  const editor = document.createElement("aster-list-editor");
  editor.editing = "row";
  editor.addLabel = "Add line";
  editor.empty = html`<p class="finance-empty">No lines yet. Add the first one.</p>`;
  // One line of cells, so the editor stacks them on a narrow screen instead of dropping or scrolling any.
  editor.layout = [[
    { field: "description", width: "minmax(10rem, 1fr)" },
    { field: "quantity", width: "5.5rem", format: { maximumFractionDigits: 2 } },
    { field: "rate", width: "7.5rem", format: GBP },
    // The amount is the service's, but it is shown from the typed quantity and rate so it follows an edit before saving.
    { field: "amount", width: "8rem", format: GBP, display: row => pounds(lineAmount(String(row.edit.values.value.quantity ?? "0"), String(row.edit.values.value.rate ?? "0"))) },
  ]];

  async function save(record) {
    busy.value = true;
    note.value = "";
    try {
      const result = await record.save();
      if (result && !result.ok) note.value = "The invoice wasn't saved. Check the fields marked in the form.";
      if (!result && !record.valid.value) {
        record.problems();
        note.value = "Some fields need attention before the invoice can be saved.";
      }
    } finally {
      busy.value = false;
    }
  }

  async function post(record) {
    busy.value = true;
    note.value = "";
    try {
      const invoice = ctx.store.get("Invoices", record.key).entity;
      const entryKey = await finance.postInvoice(invoice);
      const reference = ctx.store.get("JournalEntries", entryKey).entity.reference;
      toast(`Posted ${invoice.number} as ${reference}`, { label: "Undo", run: () => void undo(invoice, entryKey) });
    } catch (error) {
      note.value = `The invoice wasn't posted: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy.value = false;
    }
  }

  async function undo(invoice, entryKey) {
    try {
      await finance.unpostInvoice(invoice, entryKey);
      toast(`${invoice.number} is back out of the ledger`);
    } catch (error) {
      note.value = `The posting wasn't undone: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const row = invoice => html`<span class="invoice-row">
    <strong>${invoice.number}</strong><span class="invoice-row-who">${customerOf(invoice.customerId)?.name ?? ""}</span>
    <span class="invoice-row-due">Due ${formatDate(String(invoice.dueDate))}</span>${statusView(invoice.status)}</span>`;

  // A posted invoice keeps its figures; only its payment status still changes.
  const sections = [{
    title: "Invoice details", columns: 3,
    items: [
      "number", { field: "customerId", options: customers }, "status",
      "issueDate", "dueDate", "taxRate", { field: "reference", span: 3 },
    ],
  }];

  const postedSections = sections.map(section => ({
    ...section,
    items: section.items.map(item => {
      const field = typeof item === "string" ? { field: item } : item;
      return { ...field, readOnly: field.field !== "status" };
    }),
  }));

  const party = (heading, name, lines) => html`<section class="paper-party" aria-label=${heading}>
    <h3>${heading}</h3><address><strong>${name}</strong>${lines.map(line => html`<span>${line}</span>`)}</address></section>`;

  function document_(record) {
    const values = record.edit.values.value;
    const customer = customerOf(values.customerId);
    const posted = values.entryId !== null && values.entryId !== undefined;
    const totals = lineTotals(record, values);
    const entry = posted ? ctx.store.get("JournalEntries", keyText([values.entryId]))?.entity : undefined;
    const reason = posted ? `Already posted as ${entry?.reference ?? "a journal entry"}.`
      : record.dirty.value ? "Save or revert your changes before posting."
      : totals.count === 0 ? "Add at least one line before posting."
      : !record.valid.value ? "Fix the fields marked in the form first."
      : undefined;
    editor.list = record.owned.lines;
    editor.label = `Lines of ${values.number ?? "the invoice"}`;
    editor.readOnlyReason = posted ? "Posted invoices can't be edited; their journal entry has booked these amounts." : undefined;
    return html`<div class="invoice-document">
      <aster-form class="finance-no-print" .model=${record.edit} .sections=${posted ? postedSections : sections} .headingLevel=${3}></aster-form>
      <article class="paper" aria-labelledby="paper-title">
        <header class="paper-head">
          <div><p class="finance-eyebrow">Invoice</p><h2 id="paper-title">${values.number ?? ""}</h2></div>
          ${statusView(values.status)}
        </header>
        <div class="paper-parties">
          ${party("From", seller.name, [...seller.address, seller.email, `Tax no. ${seller.taxNumber}`])}
          ${party("Bill to", customer?.name ?? "No customer chosen", customer ? [...String(customer.address).split(", "), customer.email] : [])}
        </div>
        <dl class="paper-terms">
          <div><dt>Issued</dt><dd>${values.issueDate ? formatDate(String(values.issueDate)) : "—"}</dd></div>
          <div><dt>Due</dt><dd>${values.dueDate ? formatDate(String(values.dueDate)) : "—"}</dd></div>
          <div><dt>Your reference</dt><dd>${values.reference || "—"}</dd></div>
        </dl>
        <div class="paper-lines">${editor}</div>
        <dl class="paper-totals">
          <div><dt>Subtotal</dt><dd class="finance-num">${pounds(totals.subtotal)}</dd></div>
          <div><dt>Tax at ${formatFigure(String(values.taxRate ?? 0), { maximumFractionDigits: 2 })}%</dt><dd class="finance-num">${pounds(totals.tax)}</dd></div>
          <div class="paper-total"><dt>Total due</dt><dd class="finance-num">${pounds(totals.total)}</dd></div>
        </dl>
        <footer class="paper-foot"><p>Pay by bank transfer: ${seller.payment}</p><p>Please quote ${values.number ?? "the invoice number"}.</p></footer>
      </article>
      <div class="finance-actions finance-no-print">
        <aster-button .label=${"Save changes"} .variant=${"primary"} .busy=${busy.value} .reason=${record.dirty.value ? undefined : "No changes to save."} @click=${() => void save(record)}></aster-button>
        <aster-button .label=${"Revert"} .reason=${record.dirty.value ? undefined : "No changes to revert."} @click=${() => record.revert()}></aster-button>
        <aster-button .label=${"Post to ledger"} .busy=${busy.value} .reason=${reason} data-action="post-invoice" @click=${() => void post(record)}></aster-button>
        <aster-button .label=${"Print"} @click=${() => window.print()}></aster-button>
        ${posted && entry ? html`<span class="finance-posted">Posted as <a href="#journal" @click=${event => { event.preventDefault(); showEntry(keyText([values.entryId])); }}>${entry.reference}</a></span>` : nothing}
        <span class="finance-note" role="status">${note.value}</span>
      </div>
    </div>`;
  }

  const stopRender = effect(() => {
    const record = current.value;
    render(html`<div class="finance-split">
      <aside class="finance-list finance-no-print" aria-label="Invoices">
        <h2>Invoices</h2>
        <aster-listbox .label=${"Invoices"} .selection=${selection} .renderRow=${row}></aster-listbox>
      </aside>
      <section class="finance-detail" aria-label="Invoice">${record ? document_(record) : nothing}</section>
    </div>`, root);
  });

  return () => {
    stopSelect();
    stopRender();
    records.forEach(record => record.dispose());
  };
}
