// The finance workspace's data: one mock service, one DataContext, and the writes that touch
// several records at once. Every view reads the same store, so a write is seen everywhere.
import { DataContext, RecordEdit, keyText } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { data, metadata } from "./finance-mock.js";
import { decimalText, percentOf, pence } from "./finance-amounts.js";

/** The accounts an invoice posts to. */
export const postingAccounts = { receivable: "1120", revenue: "4100", salesTax: "2120" };

const today = () => new Date().toISOString().slice(0, 10);

export async function connect() {
  const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", import.meta.url) });
  const ctx = await DataContext.connect(mock.transport);

  // Balances are the service's to compute, so a write the client never made to an account still
  // changes it. The service says which; each is read again into the store, and every view follows.
  const reading = new Set();
  const stop = mock.onChange(change => {
    if (change.set !== "Accounts" || change.kind !== "update") return;
    const read = ctx.reload("Accounts", keyText([Number(change.key)]), "external").finally(() => reading.delete(read));
    reading.add(read);
  });
  /** Resolves once the accounts a write changed have been read again. */
  const settled = async () => { while (reading.size) await Promise.allSettled([...reading]); };

  const load = async options => {
    const collection = ctx.collection(options);
    await collection.loadAll();
    return collection;
  };
  const accounts = await load({ set: "Accounts", orderBy: [{ field: "code" }] });
  const customers = await load({ set: "Customers", orderBy: [{ field: "name" }] });
  const invoices = await load({ set: "Invoices", orderBy: [{ field: "issueDate", descending: true }, { field: "id", descending: true }] });
  const entries = await load({ set: "JournalEntries", orderBy: [{ field: "date", descending: true }, { field: "id", descending: true }] });
  const accountByCode = code => accounts.items.value.find(account => account.code === code);
  const entryLines = { defaults: () => ({ description: null, debit: "0.00", credit: "0.00" }) };

  function nextReference() {
    const used = entries.items.value.map(entry => Number(/(\d+)$/.exec(String(entry.reference))?.[1] ?? 0));
    return `JE-${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
  }

  /** A draft entry with no lines. Resolves to its key. */
  async function createEntry(values = {}) {
    const saved = await ctx.create("JournalEntries", { reference: nextReference(), date: today(), memo: "New journal entry", status: "draft", invoiceId: null, ...values });
    return saved.key;
  }

  /** The entry for an invoice: receivable for the total, revenue for the subtotal and sales tax for the tax. */
  async function postInvoice(invoice) {
    const saved = ctx.collection({ set: "InvoiceLines", filter: { op: "eq", field: "invoiceId", value: invoice.id } });
    await saved.loadAll();
    const subtotal = saved.items.value.reduce((sum, line) => sum + pence(String(line.amount)), 0n);
    ctx.release(saved);
    const tax = percentOf(subtotal, String(invoice.taxRate));
    const key = await createEntry({ memo: `Invoice ${invoice.number}`, invoiceId: invoice.id });
    const entry = new RecordEdit(ctx, "JournalEntries", key, { owned: { lines: entryLines } });
    try {
      await entry.ready;
      const description = `Invoice ${invoice.number}`;
      const add = (code, debit, credit) => entry.owned.lines.add({ accountId: accountByCode(code).id, description, debit: decimalText(debit), credit: decimalText(credit) });
      add(postingAccounts.receivable, subtotal + tax, 0n);
      add(postingAccounts.revenue, 0n, subtotal);
      if (tax > 0n) add(postingAccounts.salesTax, 0n, tax);
      entry.edit.set("status", "posted");
      const result = await entry.save();
      if (!result?.ok) throw new Error("The journal entry wasn't accepted.");
      await ctx.update("Invoices", keyText([invoice.id]), { entryId: ctx.store.get("JournalEntries", key).entity.id });
    } catch (error) {
      await ctx.remove("JournalEntries", key).catch(() => {});
      throw error;
    } finally {
      entry.dispose();
    }
    await settled();
    return key;
  }

  /** Takes an invoice's entry back out of the ledger. */
  async function unpostInvoice(invoice, entryKey) {
    await ctx.update("Invoices", keyText([invoice.id]), { entryId: null });
    await ctx.remove("JournalEntries", entryKey);
    await settled();
  }

  /**
   * Posts a draft entry whose lines are in `entry` (a RecordEdit) as one request. A refusal leaves the
   * status set and the failure showing on the record, so the lines can be fixed and the post tried again.
   */
  async function postEntry(entry) {
    entry.edit.set("status", "posted");
    const result = await entry.save();
    await settled();
    return result;
  }

  const setEntryStatus = async (key, status) => {
    await ctx.update("JournalEntries", key, { status });
    await settled();
  };

  return {
    mock, ctx, accounts, customers, invoices, entries, entryLines, settled, accountByCode, createEntry, postInvoice, unpostInvoice, postEntry, setEntryStatus,
    dispose: () => { stop(); [accounts, customers, invoices, entries].forEach(collection => ctx.release(collection)); },
  };
}
