import { DataContext, EditModel, Selection, effect, html, render, signal } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

const $ = selector => document.querySelector(selector);
const status = message => { $("#status").textContent = message; };
const params = new URLSearchParams(location.search);
const oneOf = (value, options, fallback) => options.includes(value) ? value : fallback;
const state = {
  dataset: oneOf(params.get("dataset"), ["devices", "folders"], "devices"),
  view: oneOf(params.get("view"), ["table", "tiles"], "table"),
  sort: oneOf(params.get("sort"), ["name", "name-desc"], "name"),
  selection: oneOf(params.get("selection"), ["single", "multiple", "ordered"], "multiple"),
  q: (params.get("q") ?? "").slice(0, 80),
  platform: oneOf(params.get("platform"), ["", "macOS", "Linux", "Windows"], ""),
  online: params.get("online") === "true",
  size: oneOf(params.get("size"), ["compact", "standard", "large"], "standard"),
};
const metadata = { $Version: "4.01", $EntityContainer: "Explorer.Container",
  $Reference: {
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] },
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Validation.V1.json": { $Include: [{ $Namespace: "Org.OData.Validation.V1", $Alias: "Validation" }] },
    "https://aster.dev/vocabularies/Aster.Data.V1.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
  },
  Explorer: {
    Device: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: { "@Org.OData.Core.V1.Description": "Name", $Nullable: false, "@AsterData.MinLength": 1 },
      platform: { "@Org.OData.Core.V1.Description": "Platform", "@Validation.AllowedValues": ["macOS", "Linux", "Windows"].map(Value => ({ Value })) },
      online: { $Type: "Edm.Boolean" }, owner: { "@Org.OData.Core.V1.Description": "Owner" } },
    Folder: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: { "@Org.OData.Core.V1.Description": "Name", $Nullable: false, "@AsterData.MinLength": 1 },
      owner: { "@Org.OData.Core.V1.Description": "Owner" }, items: { $Type: "Edm.Int32" } },
    Container: { $Kind: "EntityContainer", Devices: { $Collection: true, $Type: "Explorer.Device" }, Folders: { $Collection: true, $Type: "Explorer.Folder" } },
  },
};
const names = ["Design MacBook", "Studio workstation", "Travel laptop", "Build server", "Office desktop", "Support laptop"];
const folders = ["Brand assets", "Client projects", "Design system", "Finance", "Photography", "Product research", "Release notes", "Workshop recordings"];
const data = {
  Devices: Array.from({ length: 96 }, (_, i) => ({ id: i + 1, name: i < names.length ? names[i] : `Team device ${String(i + 1).padStart(3, "0")}`,
    platform: ["macOS", "Linux", "Windows"][i % 3], online: i % 4 !== 1, owner: ["Design", "Engineering", "Operations"][i % 3] })),
  Folders: Array.from({ length: 48 }, (_, i) => ({ id: i + 1, name: i < folders.length ? folders[i] : `Project ${String(i + 1).padStart(2, "0")}`,
    owner: ["Design", "Engineering", "Operations"][i % 3], items: 8 + i * 3 })),
};
const choices = {
  dataset: [ ["devices", "Device fleet"], ["folders", "Workspace folders"] ],
  view: [ ["table", "Table"], ["tiles", "Tiles"] ],
  sort: [ ["name", "Name, A–Z"], ["name-desc", "Name, Z–A"] ],
  selection: [ ["single", "Single"], ["multiple", "Multiple"], ["ordered", "Ordered, maximum 3"] ],
  platform: [ ["", "All platforms"], ["macOS", "macOS"], ["Linux", "Linux"], ["Windows", "Windows"] ],
  size: [ ["compact", "Compact"], ["standard", "Standard"], ["large", "Large"] ],
};
const labels = { dataset: "Sample data", view: "Presentation", sort: "Sort", selection: "Selection", platform: "Platform", size: "Tile size" };
const control = name => name === "selection" ? $("#selection-mode") : $(`#${name}`);
for (const [name, options] of Object.entries(choices)) {
  control(name).options = options.map(([value, label]) => ({ value, label }));
  control(name).label = labels[name];
  control(name).value = state[name];
  control(name).inert = true;
}
$("#query").value = state.q;
$("#online").checked = state.online;
$("#query").disabled = $("#online").disabled = true;
const notify = () => {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(state)) url.searchParams.set(key, String(value));
  history.replaceState(null, "", url);
  if (parent !== window) parent.postMessage({ type: "aster-collection-state", state }, location.origin);
};

try {
  const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", import.meta.url) });
  const ctx = await DataContext.connect(mock.transport);
  const collections = {
    devices: ctx.collection({ set: "Devices" }, { pageSize: 24, keepPages: 3 }),
    folders: ctx.collection({ set: "Folders" }, { pageSize: 24, keepPages: 3 }),
  };
  const table = document.createElement("aster-grid");
  table.ctx = ctx;
  const tiles = document.createElement("aster-tile-grid");
  tiles.virtualized = true;
  const active = signal(state.dataset);
  const currentSelection = signal();
  let model;
  let stopEditor;
  let busy = false;
  const collection = () => collections[active.value];
  const hasDraft = () => model !== undefined;
  const query = () => {
    const clauses = [];
    if (state.q.trim()) clauses.push({ op: "contains", field: "name", value: state.q.trim() });
    if (state.dataset === "devices") {
      if (state.platform) clauses.push({ op: "eq", field: "platform", value: state.platform });
      if (state.online) clauses.push({ op: "eq", field: "online", value: true });
    }
    const previous = collection().query;
    collection().setQuery({ ...previous, filter: clauses.length ? { op: "and", args: clauses } : undefined,
      orderBy: [{ field: "name", descending: state.sort === "name-desc" }] });
  };
  const size = () => {
    const folder = state.dataset === "folders";
    const widths = folder ? { compact: 140, standard: 164, large: 196 } : { compact: 208, standard: 248, large: 288 };
    tiles.style.setProperty("--tile-min-width", `${widths[state.size]}px`);
    tiles.style.setProperty("--tile-height", `${folder ? widths[state.size] + 32 : 194}px`);
    $("#size-control").hidden = state.view !== "tiles";
  };
  const show = () => {
    const next = state.view === "table" ? table : tiles;
    if (next.parentElement !== $("#out")) $("#out").replaceChildren(next);
    $("#platform-control").hidden = $(".online-control").hidden = state.dataset !== "devices";
    $("#simulate").hidden = state.dataset !== "devices";
    size();
  };
  function bindSelection() {
    const selection = new Selection(ctx.store, collection(), { multiple: state.selection !== "single", ordered: state.selection === "ordered",
      ...(state.selection === "ordered" ? { maxOrdered: 3 } : {}), fallback: false });
    table.selection = tiles.selection = selection;
    currentSelection.value = selection;
  }
  function bindDataset() {
    active.value = state.dataset;
    const folder = state.dataset === "folders";
    table.selection = tiles.selection = undefined;
    table.collection = tiles.collection = collection();
    table.label = folder ? "Workspace folders table" : "Device fleet table";
    tiles.label = folder ? "Workspace folder tiles" : "Device fleet tiles";
    table.view = { columns: folder ? [{ field: "name" }, { field: "owner", width: 140 }, { field: "items", width: 90 }]
      : [{ field: "name" }, { field: "platform", width: 140 }, { field: "online", width: 90 }], sort: [], filters: {}, frozen: 0 };
    tiles.toggleAttribute("data-folders", folder);
    tiles.presentTile = row => ({ title: row.name, description: folder ? `${row.items} items, ${row.owner}` : `${row.platform}, ${row.online ? "Online" : "Offline"}` });
    tiles.renderTile = folder
      ? row => html`<svg class="folder-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M5 15V10h14l5 5h19v25H5z"/></svg><strong class="folder-name">${row.name}</strong><span class="folder-meta">${row.items} items · ${row.owner}</span>`
      : row => html`<div class="device-card"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="6" width="38" height="28" rx="3"/><path d="M16 42h16M24 34v8"/></svg><strong>${row.name}</strong><span>${row.platform} · ${row.owner}</span><span class="device-state" ?data-online=${row.online}>${row.online ? "Online" : "Offline"}</span></div>`;
    query(); bindSelection(); show();
  }
  bindDataset();
  function syncActions() {
    const any = currentSelection.value?.any.value ?? false;
    $("#edit").disabled = busy || hasDraft() || !any;
    $("#clear").disabled = busy || !any;
    $("#simulate").disabled = busy || hasDraft() || !any;
  }
  const stopSelection = effect(() => {
    const selection = currentSelection.value;
    const records = selection?.records.value ?? [];
    $("#selected-summary").textContent = records.length ? `${records.length} selected${selection.ordered ? " in pick order" : ""}: ${records.map(r => r.name).join(", ")}` : "No items selected.";
    $("#edit").disabled = busy || hasDraft() || !records.length;
    $("#clear").disabled = busy || !records.length;
    $("#simulate").disabled = busy || hasDraft() || !records.length;
  });
  function closeEditor() {
    stopEditor?.(); model?.dispose(); model = undefined;
    render(html``, $("#editor-out"));
    $("#save-actions").hidden = true;
    $("#edit").disabled = $("#simulate").disabled = !currentSelection.value.any.value;
    for (const name of ["dataset", "selection"]) control(name).inert = false;
  }
  $("#edit").addEventListener("click", () => {
    const key = currentSelection.value.key.value;
    if (key === undefined || model) return;
    model = new EditModel(ctx, collection().query.set, key);
    const folder = state.dataset === "folders";
    render(html`<aster-form .model=${model} .sections=${[{ title: "Edit record", columns: 1, items: ["name", folder ? "owner" : "platform"] }]}></aster-form>`, $("#editor-out"));
    $("#save-actions").hidden = false;
    $("#edit").disabled = $("#simulate").disabled = true;
    for (const name of ["dataset", "selection"]) control(name).inert = true;
    stopEditor = effect(() => { $("#save").disabled = model.busy.value || !model.dirty.value; $("#cancel").disabled = model.busy.value; });
    status("Editing a separate draft. Switch presentation to see that it stays open.");
    queueMicrotask(() => $("#editor-out input")?.focus());
  });
  $("#cancel").addEventListener("click", () => { closeEditor(); status("Draft discarded."); $("#edit").focus(); });
  $("#save").addEventListener("click", async () => {
    busy = true;
    try {
      const saved = await model.save();
      if (saved) { closeEditor(); status("Saved to the shared record store. Both presentations show the change."); $("#edit").focus(); }
      else status("The draft could not be saved. Review the form errors.");
    } catch { status("Save failed. Your draft is still open; try again."); }
    finally { busy = false; syncActions(); }
  });
  $("#clear").addEventListener("click", () => currentSelection.value.clear());
  $("#simulate").addEventListener("click", async () => {
    const selection = currentSelection.value;
    const key = selection.key.value;
    if (key === undefined || busy || model) return;
    busy = true; $("#simulate").disabled = true;
    try { await ctx.update("Devices", key, { online: !selection.selected.value.online }); status("Status updated through the mock service and shared store."); }
    catch { status("Could not update the status. Try again."); }
    finally { busy = false; syncActions(); }
  });
  for (const name of Object.keys(choices)) {
    control(name).inert = false;
    control(name).addEventListener("change", event => {
      if (event.target !== control(name)) return;
      if (hasDraft() && ["dataset", "selection"].includes(name)) return;
      state[name] = control(name).value;
      switch (name) {
        case "dataset": bindDataset(); break;
        case "view": show(); break;
        case "selection": bindSelection(); break;
        case "size": size(); break;
        default: query();
      }
      notify();
    });
  }
  let debounce;
  const applyName = () => { clearTimeout(debounce); state.q = $("#query").value; query(); notify(); };
  $("#query").disabled = $("#online").disabled = false;
  $("#query").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(applyName, 180); });
  $("#query").addEventListener("change", applyName);
  $("#query").addEventListener("keydown", e => { if (e.key === "Enter") applyName(); });
  $("#online").addEventListener("change", () => { state.online = $("#online").checked; query(); notify(); });
  tiles.addEventListener("tile-open", event => status(`Opened ${ctx.store.get(collection().query.set, event.detail.key)?.entity.name} (demonstration only).`));
  notify();
  status("Ready. Paging and selection are shared between the table and tiles.");
  addEventListener("pagehide", event => {
    if (event.persisted) return;
    clearTimeout(debounce); stopSelection(); stopEditor?.(); model?.dispose();
    table.remove(); tiles.remove(); Object.values(collections).forEach(c => ctx.release(c));
  });
} catch (error) {
  render(html`<p role="alert">The example could not start. Reload to try again.</p>`, $("#out"));
  status(error instanceof Error ? error.message : String(error));
}

// The documentation host observes this content's size; CSS owns the preview layout.
const observer = new ResizeObserver(entries => {
  const height = entries[0]?.borderBoxSize[0]?.blockSize;
  if (height && parent !== window) parent.postMessage({ type: "aster-collection-height", height: Math.ceil(height) }, location.origin);
});
observer.observe(document.body);
addEventListener("message", event => {
  if (event.origin === location.origin && event.source === parent && event.data?.type === "aster-collection-request") {
    notify();
    parent.postMessage({ type: "aster-collection-height", height: Math.ceil(document.body.getBoundingClientRect().height) }, location.origin);
  }
});
