import "@getaster/elements";
import { html } from "lit-html";
import { signal, computed } from "@preact/signals-core";

const tabs = document.querySelector("#devices");
const confirm = document.querySelector("#confirm");
const status = document.querySelector("#status");
const records = signal(Array.from({ length: 6 }, (_, i) => ({ id: `device-${i+1}`, name: `Studio workstation ${i+1}`, platform: i % 2 ? "Linux" : "Windows", notes: "", dirty: false })));
const selected = signal("overview");
let next = 7;
let pending;
let queuedClose;
tabs.label = "Open devices";
tabs.items = computed(() => [{ value: "overview", label: "Overview" }, ...records.value.map(r => ({ value: r.id, label: r.name + (r.dirty ? " •" : ""), closable: true }))]);
tabs.value = selected;
tabs.addEventListener("change", e => { if (e.target === tabs) { e.stopPropagation(); selected.value = e.detail; } });
const update = (id, patch) => { records.value = records.value.map(r => r.id === id ? { ...r, ...patch } : r); };
tabs.renderPanel = item => {
  if (item.value === "overview") return html`<h2>Your device workspace</h2><p>Choose a device tab to mount its panel for the first time. Returning to a tab preserves its fields and draft notes.</p><dl><dt>Open devices</dt><dd>${records.value.length}</dd><dt>Rendering</dt><dd>Panels mount on first visit</dd></dl>`;
  const record = records.value.find(r => r.id === item.value);
  return html`<h2>${record.name}</h2><p>${record.platform} · Managed device · Connected</p><div class="device-fields">
    <label>Device name<span class="aster-field"><input .value=${record.name} @input=${e => update(record.id, { name: e.target.value, dirty: true })}></span></label>
    <label>Workspace notes<textarea placeholder="Write a note, then switch tabs…" @input=${e => update(record.id, { notes: e.target.value, dirty: true })}>${record.notes}</textarea></label>
    <div class="bar"><button type="button" class="aster-button" @click=${() => { update(record.id, { dirty: false }); status.textContent = "Changes saved for this visit."; }}>Save changes</button><span>${record.dirty ? "Unsaved changes" : "All changes saved"}</span></div></div>`;
};
function remove(id) {
  const items = tabs.items.peek();
  const index = items.findIndex(t => t.value === id);
  records.value = records.value.filter(r => r.id !== id);
  if (selected.value === id) selected.value = items[index + 1]?.value ?? items[index - 1]?.value ?? "overview";
  queueMicrotask(() => tabs.querySelector('[role="tab"][aria-selected="true"]')?.focus());
  status.textContent = "Tab closed. Other device drafts are retained.";
}
function requestClose(id) {
  const record = records.peek().find(r => r.id === id);
  if (!record) return;
  if (pending) {
    if (!confirm.open) queuedClose = id;
    return;
  }
  if (!record.dirty) { remove(record.id); return; }
  pending = record.id;
  confirm.labelledBy = "discard-title";
  confirm.content = html`<h2 id="discard-title">Close unsaved device?</h2><p>Your draft will be discarded.</p><div class="bar"><button class="aster-button" @click=${() => confirm.close()}>Keep editing</button><button class="aster-button" @click=${() => { const id = pending; confirm.close(); remove(id); }}>Discard and close</button></div>`;
  queueMicrotask(() => confirm.show(document.activeElement));
}
tabs.addEventListener("close", e => { if (e.target === tabs) requestClose(e.detail); });
confirm.addEventListener("close", () => {
  pending = undefined;
  const queued = queuedClose;
  queuedClose = undefined;
  if (queued) queueMicrotask(() => requestClose(queued));
});
document.querySelector("#add").addEventListener("click", () => {
  const id = `device-${next}`;
  records.value = [...records.value, { id, name: `Studio workstation ${next++}`, platform: "Linux", notes: "", dirty: false }];
  selected.value = id;
  status.textContent = "Device added to the data-driven tab list.";
});
document.querySelector("#manual").addEventListener("change", e => { tabs.activation = e.target.checked ? "manual" : "automatic"; });
