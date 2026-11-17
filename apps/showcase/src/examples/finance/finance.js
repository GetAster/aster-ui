import "@getaster/elements";
import { effect, signal, untracked } from "@preact/signals-core";
import { html } from "lit-html";
import { mountAccounts } from "./finance-accounts.js";
import { mountInvoices } from "./finance-invoices.js";
import { mountJournal } from "./finance-journal.js";
import { connect } from "./finance-service.js";

const $ = selector => document.querySelector(selector);
const tabs = $("#screens");

try {
  const finance = await connect();
  const toaster = $("aster-toaster");
  const toast = (message, action) => toaster.show(message, action);
  const selected = signal("invoices");
  const roots = {};
  const stops = [];
  let journal;
  const mount = {
    invoices: root => stops.push(mountInvoices(root, finance, { toast, showEntry })),
    accounts: root => stops.push(mountAccounts(root, finance)),
    journal: root => stops.push((journal = mountJournal(root, finance, { toast })).dispose),
  };
  // A screen is built the first time its tab shows, and kept: its drafts stay while another screen is open.
  const screen = name => {
    if (!roots[name]) {
      roots[name] = Object.assign(document.createElement("div"), { className: "finance-screen" });
      untracked(() => mount[name](roots[name]));
    }
    return roots[name];
  };
  function showEntry(key) {
    selected.value = "journal";
    screen("journal");
    journal.show(key);
  }

  tabs.label = "Finance screens";
  tabs.items = [{ value: "invoices", label: "Invoices" }, { value: "accounts", label: "Chart of accounts" }, { value: "journal", label: "Journal" }];
  tabs.value = selected;
  tabs.renderPanel = item => html`${screen(item.value)}`;
  tabs.addEventListener("change", event => { if (event.target === tabs) selected.value = event.detail; });
  $("#loading").remove();

  // The same store the screens read, for the tests and for poking at from the console.
  globalThis.finance = Object.defineProperty(finance, "journal", { get: () => journal });
  const stop = effect(() => { document.documentElement.dataset.screen = selected.value; });
  addEventListener("pagehide", event => {
    if (event.persisted) return;
    stop();
    stops.forEach(dispose => dispose());
    finance.dispose();
  });
} catch (error) {
  const failure = $("#loading");
  failure.setAttribute("role", "alert");
  failure.textContent = `The finance workspace could not load: ${error instanceof Error ? error.message : String(error)}. Reload to try again.`;
}
