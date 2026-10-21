import { DataContext, Selection, effect, signal } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

const metadata = { $Version: "4.01", $EntityContainer: "Reports.Container", Reports: {
  Device: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: {}, platform: { "@Validation.AllowedValues": [{ Value: "Linux" }, { Value: "macOS" }, { Value: "Windows" }] }, online: { $Type: "Edm.Boolean" }, site: { $Nullable: true }, cost: { $Type: "Edm.Decimal", $Scale: 2 } },
  Container: { $Kind: "EntityContainer", Devices: { $Collection: true, $Type: "Reports.Device" } },
} };
const requestedCount = Number(new URLSearchParams(location.search).get("devices") ?? 240);
const deviceCount = Number.isSafeInteger(requestedCount) && requestedCount > 0 && requestedCount <= 100_000 ? requestedCount : 240;
const data = { Devices: Array.from({ length: deviceCount }, (_, i) => ({ id: i + 1, name: `Device ${String(i + 1).padStart(3, "0")}`,
  platform: ["Linux", "macOS", "Windows"][i % 3], online: i % 2 === 0, site: ["London", "Paris", null][Math.floor(i / 6) % 3], cost: "10.10" })) };
const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", document.baseURI) });
let failSummary = false;
let failExport = false;
let exporting = false;
const requests = [];
const ctx = await DataContext.connect((r) => {
  requests.push(r);
  if (failExport && exporting && r.url.startsWith("Devices?")) {
    failExport = false;
    return Promise.resolve({ status: 503, headers: {}, body: JSON.stringify({ error: { code: "Unavailable", message: "Export temporarily unavailable" } }) });
  }
  if (failSummary && r.url.includes("$apply")) {
    failSummary = false;
    return Promise.resolve({ status: 503, headers: {}, body: JSON.stringify({ error: { code: "Unavailable", message: "Summary temporarily unavailable" } }) });
  }
  return mock.transport(r);
});
mock.faults.latencyMs = 80;
const collection = ctx.collection({ set: "Devices", orderBy: [{ field: "id" }] }, { pageSize: 20, keepPages: 2 });
const selection = new Selection(ctx.store, collection, { multiple: true, ordered: true, fallback: false });
const columns = [{ field: "name", width: 250 }, { field: "platform", width: 150 }, { field: "online", width: 100 }, { field: "cost", width: 150 }, { field: "id", width: 80 }, { field: "site", width: 140, hidden: true }];
const summaries = [{ method: "count", label: "Devices" }, { field: "cost", method: "sum", label: "Total cost" },
  { field: "cost", method: "average", label: "Average cost" }, { field: "cost", method: "min", label: "Lowest cost" },
  { field: "cost", method: "max", label: "Highest cost" }, { field: "platform", method: "countdistinct", label: "Platforms" }];
const table = document.createElement("aster-grid");
table.ctx = ctx;
table.collection = collection;
table.selection = selection;
table.view = { columns, sort: [{ field: "id" }], filters: {}, frozen: 0 };
const grouped = document.createElement("aster-grid");
grouped.ctx = ctx;
grouped.set = "Devices";
if (new URLSearchParams(location.search).has("persist")) grouped.persist = "reporting-groups";
grouped.view = { columns, sort: [{ field: "platform" }, { field: "id" }], filters: {}, frozen: 0 };
for (const grid of [table, grouped]) { grid.id = "report"; grid.label = "Device costs"; grid.summaries = summaries; }
let grid = grouped.persist ? grouped : table;
const active = signal(grid);
document.querySelector("#out").append(grid);
const status = document.querySelector("#status");
const groupingControl = document.querySelector("#levels");
groupingControl.label = "Grouping levels";
const groupingOptions = [
  { value: "", label: "No grouping" },
  { value: "platform", label: "Platform" },
  { value: "platform,online", label: "Platform → Online" },
  { value: "platform,online,site", label: "Platform → Online → Site" },
];
function fieldsOf(current) {
  const groupBy = current === grouped ? grouped.view?.groupBy : undefined;
  return typeof groupBy === "string" ? [groupBy] : groupBy ?? [];
}
function syncGrouping(fields = fieldsOf(grid)) {
  const value = fields.join(",");
  groupingControl.options = groupingOptions.some(option => option.value === value) ? groupingOptions
    : [...groupingOptions, { value, label: `Custom: ${fields.join(" → ")}` }];
  groupingControl.value = value;
  document.querySelector("#scope").disabled = fields.length > 0;
  if (fields.length) document.querySelector("#scope").value = "query";
}
function showGrid(next) {
  if (next === grid) return;
  grid.remove(); grid = next;
  document.querySelector("#out").append(grid);
  active.value = grid;
}
effect(() => {
  const current = active.value;
  const fields = fieldsOf(current);
  syncGrouping(fields);
  if (current === grouped && fields.length === 0) queueMicrotask(() => {
    if (grid === grouped && fieldsOf(grid).length === 0) {
      showGrid(table);
      status.textContent = "Grouping removed.";
    }
  });
});
window.addEventListener("pageshow", () => syncGrouping());
let groupingRequest = 0;
groupingControl.addEventListener("change", async (e) => {
  const value = e.target.value;
  const request = ++groupingRequest;
  const before = grid;
  if (!(await before.finishEditing())) {
    if (request === groupingRequest) { syncGrouping(); status.textContent = "Finish editing before changing grouping."; }
    return;
  }
  if (request !== groupingRequest || before !== grid) return;
  if (value) {
    showGrid(grouped);
    const fields = value.split(",");
    grouped.view = { ...grouped.view, groupBy: fields.length === 1 ? fields[0] : fields };
  } else {
    const { groupBy, ...flat } = grouped.view;
    grouped.view = flat;
    showGrid(table);
  }
  syncGrouping();
  status.textContent = value ? `Grouped by ${groupingControl.options.find(option => option.value === value)?.label ?? value}.` : "Grouping removed.";
});
document.querySelector("#online").addEventListener("change", (e) => {
  const filter = e.target.checked ? { op: "eq", field: "online", value: true } : undefined;
  const { filter: previous, ...query } = collection.query;
  collection.setQuery({ ...query, ...(filter ? { filter } : {}) });
  grouped.base = filter;
});
document.querySelector("#change").addEventListener("click", async () => {
  try { await ctx.reload("Devices", "[1]"); await ctx.update("Devices", "[1]", { cost: "20.20" }); status.textContent = "First device cost updated."; }
  catch { status.textContent = "Couldn’t update the device."; }
});
document.querySelector("#fail").addEventListener("click", () => {
  failSummary = true;
  if (grid === grouped) void grouped.groupingModel.retry();
  else grid.summaries = [...summaries];
});
let controller;
document.querySelector("#fail-export").addEventListener("click", () => { failExport = true; });
document.querySelector("#cancel").addEventListener("click", () => controller?.abort());
document.querySelector("#export").addEventListener("click", async () => {
  controller = new AbortController();
  const button = document.querySelector("#export");
  const cancel = document.querySelector("#cancel");
  button.disabled = true;
  cancel.disabled = false;
  status.textContent = "Preparing CSV…";
  exporting = true;
  try {
    const csv = await grid.exportCsv({ scope: document.querySelector("#scope").value, maxRows: Number(document.querySelector("#limit").value),
      pageSize: 40, signal: controller.signal, onProgress: (n) => { status.textContent = `Exporting ${n} rows…`; } });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "devices.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "CSV ready.";
  } catch (error) { status.textContent = controller.signal.aborted ? "Export cancelled." : `Couldn’t export: ${error.message}`; }
  finally { exporting = false; button.disabled = false; cancel.disabled = true; controller = undefined; }
});
if (new URLSearchParams(location.search).has("debug")) globalThis.reportDemo = { ctx, collection, selection, table, grouped, mock, requests, get grid() { return grid; } };
