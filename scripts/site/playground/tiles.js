import { DataContext, PageScope, Selection, effect, html, keyText, provideScope, render } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

const metadata = {
  $Version: "4.01", $EntityContainer: "Tiles.Container",
  $Reference: {
    "https://aster.dev/vocabularies/Aster.Data.V1.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
  },
  Tiles: {
    File: { $Kind: "EntityType", $Key: ["id"], "@AsterData.TitleField": "name",
      id: { $Type: "Edm.Int32" }, name: {}, kind: {}, parent: { $Type: "Edm.Int32", $Nullable: true }, thumbnail: { $Nullable: true } },
    Device: { $Kind: "EntityType", $Key: ["id"], "@AsterData.TitleField": "name",
      id: { $Type: "Edm.Int32" }, name: {}, platform: { "@Validation.AllowedValues": [{ Value: "Linux" }, { Value: "macOS" }, { Value: "Windows" }] }, online: { $Type: "Edm.Boolean" }, lastSeen: {} },
    Container: { $Kind: "EntityContainer",
      Files: { $Collection: true, $Type: "Tiles.File" }, Devices: { $Collection: true, $Type: "Tiles.Device" } },
  },
};
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#eef1f8"/><circle cx="160" cy="105" r="58" fill="#556798"/><path d="M30 230 120 140 190 200 260 120 320 220" fill="#889bc0"/></svg>')}`;
const data = {
  Files: [
    { id: 1, name: "Documents", kind: "Folder", parent: null, thumbnail: null },
    { id: 2, name: "Pictures", kind: "Folder", parent: null, thumbnail: null },
    { id: 3, name: "Empty folder", kind: "Folder", parent: null, thumbnail: null },
    { id: 4, name: "Read me.txt", kind: "Text document", parent: null, thumbnail: null },
    { id: 5, name: "An intentionally long filename — design notes for the next release.pdf", kind: "PDF document", parent: null, thumbnail: null },
    { id: 6, name: "仕様書とメモ.txt", kind: "Text document", parent: null, thumbnail: null },
    { id: 7, name: "Project brief.pdf", kind: "PDF document", parent: 1, thumbnail: null },
    { id: 8, name: "Workshop.png", kind: "Image", parent: 2, thumbnail: image },
    { id: 9, name: "Missing preview.png", kind: "Image", parent: 2, thumbnail: "./missing-preview.png" },
  ],
  Devices: [
    { id: 1, name: "Work MacBook", platform: "macOS", online: true, lastSeen: "Just now" },
    { id: 2, name: "Home desktop", platform: "Linux", online: false, lastSeen: "2 hours ago" },
    { id: 3, name: "Travel laptop", platform: "Windows", online: true, lastSeen: "Just now" },
    { id: 4, name: "Studio workstation with a deliberately long device name", platform: "Linux", online: false, lastSeen: "Yesterday" },
  ],
};
const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", document.baseURI) });
const ctx = await DataContext.connect(mock.transport);
const files = ctx.collection({ set: "Files", filter: { op: "eq", field: "parent", value: null }, orderBy: [{ field: "id" }] });
const devices = ctx.collection({ set: "Devices", orderBy: [{ field: "id" }] });
await Promise.all([files.loadAll(), devices.loadAll()]);
const fileSelection = new Selection(ctx.store, files, { multiple: true });
const deviceSelection = new Selection(ctx.store, devices, { fallback: false });
const scope = new PageScope();
provideScope(document.querySelector("main"), scope);
const folderIcon = html`<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 15V10h14l5 5h19v25H5z"/></svg>`;
const deviceIcon = html`<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="6" width="38" height="28" rx="3"/><path d="M16 42h16M24 34v8"/></svg>`;
let folder = null;
const parents = new Map();
const fileGrid = document.createElement("aster-tile-grid");
fileGrid.id = "files";
fileGrid.collection = files;
fileGrid.selection = fileSelection;
fileGrid.label = "Files in Home";
fileGrid.publish = "files";
fileGrid.empty = html`<p>This folder is empty.</p>`;
fileGrid.presentTile = (f) => ({ title: String(f.name), description: String(f.kind), ...(f.thumbnail ? { image: String(f.thumbnail) } : {}), ...(f.kind === "Folder" ? { icon: folderIcon } : {}) });
fileGrid.actions = (f) => [{ label: "Open", run: () => openFile(keyText([f.id])) }];
fileGrid.addEventListener("tile-open", (e) => openFile(e.detail.key));
document.querySelector("#folder-out").append(fileGrid);

async function navigate(id, restore) {
  parents.set(folder, { key: fileGrid.activeKey, top: document.scrollingElement.scrollTop });
  folder = id;
  files.setQuery({ set: "Files", filter: { op: "eq", field: "parent", value: id }, orderBy: [{ field: "id" }] });
  fileSelection.clear();
  fileGrid.label = `Files in ${id === null ? "Home" : data.Files.find((f) => f.id === id).name}`;
  render(html`<button type="button" class="aster-button" @click=${() => navigate(null, true)}>Home</button>
    ${id === null ? "" : html`<span aria-current="page">${data.Files.find((f) => f.id === id).name}</span>`}`, document.querySelector("#path"));
  await files.loadAll();
  await new Promise(requestAnimationFrame);
  const saved = restore ? parents.get(id) : undefined;
  if (saved?.key) fileGrid.focusTile(saved.key);
  else fileGrid.focus();
  if (saved) document.scrollingElement.scrollTop = saved.top;
  document.querySelector("#opened").textContent = `${fileGrid.label}. ${files.count.value} items.`;
}
function openFile(key) {
  const file = ctx.store.get("Files", key)?.entity;
  if (file?.kind === "Folder") void navigate(file.id, false);
  else if (file) document.querySelector("#opened").textContent = `Opened ${file.name}`;
}
render(html`<span aria-current="page">Home</span>`, document.querySelector("#path"));

const deviceGrid = document.createElement("aster-tile-grid");
deviceGrid.id = "devices";
deviceGrid.collection = devices;
deviceGrid.selection = deviceSelection;
deviceGrid.label = "Your devices";
deviceGrid.publish = "devices";
deviceGrid.presentTile = (d) => ({ title: String(d.name), description: `${d.platform}, ${d.online ? "Online" : "Offline"}, last seen ${d.lastSeen}` });
deviceGrid.renderTile = (d) => html`<div class="device-card">${deviceIcon}<strong>${d.name}</strong><span>${d.platform}</span>
  <span class="device-state"><span class="device-dot" ?data-online=${d.online} aria-hidden="true"></span>${d.online ? "Online" : "Offline"}</span>
  <small>Last seen ${d.lastSeen}</small></div>`;
deviceGrid.actions = (d) => [{ label: "Device details", run: () => deviceSelection.select(keyText([d.id])) },
  { label: "Connect", disabled: d.online ? undefined : "This device is offline", run: () => { document.querySelector("#opened").textContent = `Mock connection to ${d.name}`; } }];
deviceGrid.addEventListener("tile-open", (e) => {
  document.querySelector("#opened").textContent = `Opened ${ctx.store.get("Devices", e.detail.key).entity.name}`;
});
document.querySelector("#device-out").append(deviceGrid);
effect(() => {
  const d = deviceSelection.selected.value;
  document.querySelector("#device-detail").textContent = d ? `Selected: ${d.name} · ${d.online ? "Online" : "Offline"}` : "Select a device to see its details.";
});
document.querySelector("#clear-device").addEventListener("click", () => deviceSelection.clear());
document.querySelector("#online-only").addEventListener("change", async (e) => {
  devices.setQuery({ set: "Devices", ...(e.target.checked ? { filter: { op: "eq", field: "online", value: true } } : {}), orderBy: [{ field: "id" }] });
  await devices.loadAll();
});
document.querySelector("#status-change").addEventListener("click", async () => {
  const before = ctx.store.get("Devices", keyText([1])).entity;
  await ctx.update("Devices", keyText([1]), { online: !before.online });
});
function applyTileSizes() {
  const size = Number(document.querySelector("#size").value);
  fileGrid.style.setProperty("--tile-min-width", `${size}px`);
  deviceGrid.style.setProperty("--tile-min-width", `${size * 1.5}px`);
  deviceGrid.style.setProperty("--tile-height", `${Math.max(190, size)}px`);
  if (fleet) {
    fleet.grid.style.setProperty("--tile-min-width", `${size * 1.7}px`);
    fleet.grid.style.setProperty("--tile-height", `${Math.max(220, size)}px`);
  }
}
document.querySelector("#size").addEventListener("input", applyTileSizes);
if (new URL(location.href).searchParams.has("debug")) globalThis.tileDemo = { ctx, files, devices, fileSelection, deviceSelection, scope, fileGrid, deviceGrid, navigate, mock };


let fleet;
document.querySelector("#load-fleet").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  button.textContent = "Loading collection…";
  try {
    const { mountPagedTiles } = await import("./tiles-paged.js");
    fleet = await mountPagedTiles(metadata);
    applyTileSizes();
    if (globalThis.tileDemo) globalThis.tileDemo.fleet = fleet;
    button.textContent = "Large collection loaded";
  } catch {
    button.disabled = false;
    button.textContent = "Retry large collection";
  }
});

document.querySelector("#load-fleet").disabled = false;
