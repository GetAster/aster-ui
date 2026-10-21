import { DataContext, Selection, effect, html } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

export async function mountPagedTiles(metadata) {
  const data = { Devices: Array.from({ length: 100_000 }, (_, i) => ({ id: i + 1,
    name: `Device ${String(i + 1).padStart(6, "0")}`, platform: ["Linux", "macOS", "Windows"][i % 3],
    online: i % 4 !== 0, lastSeen: i % 4 === 0 ? "Yesterday" : "Just now" })) };
  const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", document.baseURI) });
  const requests = [];
  let countMode = document.querySelector("#fleet-count").value;
  const ctx = await DataContext.connect(async (request) => {
    if (request.url.includes("Devices?")) requests.push(request.url);
    const response = await mock.transport(request);
    if (!request.url.includes("Devices?") || response.status !== 200 || countMode === "exact") return response;
    const body = JSON.parse(response.body);
    if (countMode === "unknown") delete body["@odata.count"];
    else { body["@odata.count"] = 120_000; body["@AsterData.CountEstimated"] = true; }
    return { ...response, body: JSON.stringify(body) };
  });
  mock.faults.latencyMs = 100;
  const query = () => ({ set: "Devices", orderBy: [{ field: "id" }] });
  const collection = ctx.collection(query(), { pageSize: 40, keepPages: 4 });
  const grid = document.createElement("aster-tile-grid");
  grid.id = "fleet";
  grid.collection = collection;
  grid.virtualized = true;
  grid.label = "Device fleet";
  grid.presentTile = (d) => ({ title: String(d.name), description: `${d.platform}, ${d.online ? "Online" : "Offline"}` });
  grid.renderTile = (d) => html`<div class="device-card"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="6" width="38" height="28" rx="3"/><path d="M16 42h16M24 34v8"/></svg>
    <strong>${d.name}</strong><span>${d.platform}</span><span class="device-state"><span class="device-dot" ?data-online=${d.online} aria-hidden="true"></span>${d.online ? "Online" : "Offline"}</span><small>Last seen ${d.lastSeen}</small></div>`;
  grid.publish = "fleet";
  const table = document.createElement("aster-grid");
  table.id = "fleet-table";
  table.ctx = ctx;
  table.collection = collection;
  table.label = "Device fleet table";
  table.publish = "fleet";
  table.view = { columns: [{ field: "name", width: 330 }, { field: "platform", width: 140 },
    { field: "online", width: 110 }, { field: "lastSeen", width: 160 }, { field: "id", width: 100 }], sort: [], filters: {}, frozen: 0 };
  let stop;
  const selection = () => {
    stop?.();
    const mode = document.querySelector("#fleet-mode").value;
    grid.selection = new Selection(ctx.store, collection, { multiple: mode !== "single", ordered: mode === "ordered" || mode === "unlimited",
      ...(mode === "ordered" ? { maxOrdered: 3 } : {}), fallback: false });
    table.selection = grid.selection;
    stop = effect(() => {
      document.querySelector("#fleet-selection").textContent = grid.selection.keys.value.length
        ? `Selected${grid.selection.ordered ? " in order" : ""}: ${grid.selection.records.value.map((d) => d.name).join(", ")}` : "No devices selected.";
    });
  };
  selection();
  document.querySelector("#fleet-out").append(grid);
  document.querySelector("#fleet-mode").addEventListener("change", selection);
  let mode = "tiles";
  let switchRequest = 0;
  const scrollPositions = new Map();
  const current = () => mode === "tiles" ? grid : table;
  const scroller = (element) => element.querySelector(element === grid ? ".aster-tile-grid" : ".aster-grid-scroll");
  async function switchView(next) {
    const request = ++switchRequest;
    const control = document.querySelector("#fleet-view");
    control.disabled = true;
    try {
      if (next === mode) return true;
      if (mode === "table" && !(await table.finishEditing())) {
        if (request === switchRequest) document.querySelector("#fleet-view").value = mode;
        return false;
      }
      if (request !== switchRequest) return false;
      const previous = current();
      const key = previous.activeKey;
      scrollPositions.set(mode, { query: collection.query, top: scroller(previous)?.scrollTop ?? 0 });
      previous.remove();
      mode = next;
      const target = current();
      document.querySelector("#fleet-out").append(target);
      document.querySelector("#fleet-view").value = mode;
      await new Promise(requestAnimationFrame);
      if (request !== switchRequest || !target.isConnected) return false;
      const saved = scrollPositions.get(mode);
      if (saved?.query === collection.query && scroller(target)) scroller(target).scrollTop = saved.top;
      if (key && collection.keys.value.includes(key)) {
        if (mode === "table") await table.focusKey(key);
        else grid.focusTile(key);
      } else target.focus();
      return true;
    } finally {
      if (request === switchRequest) control.disabled = false;
    }
  }
  document.querySelector("#fleet-view").disabled = false;
  document.querySelector("#fleet-view").addEventListener("change", (e) => void switchView(e.target.value));
  document.querySelector("#fleet-online").disabled = false;
  document.querySelector("#fleet-online").addEventListener("change", (e) => {
    const { filter, ...query } = collection.query;
    collection.setQuery({ ...query, ...(e.target.checked ? { filter: { op: "eq", field: "online", value: true } } : {}) });
  });
  document.querySelector("#fleet-sort").disabled = false;
  document.querySelector("#fleet-sort").addEventListener("click", () => {
    collection.setQuery({ ...collection.query, orderBy: (collection.query.orderBy ?? [{ field: "id" }]).map((sort) => ({ ...sort, descending: !sort.descending })) });
  });
  document.querySelector("#fleet-count").addEventListener("change", (e) => {
    countMode = e.target.value;
    collection.setQuery({ ...collection.query });
  });
  document.querySelector("#fail-fleet").disabled = false;
  document.querySelector("#fail-fleet").addEventListener("click", () => mock.faults.failNext(503));
  return { ctx, collection, grid, table, mock, requests, switchView };
}
