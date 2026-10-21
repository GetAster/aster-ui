import "@getaster/elements";
import { DataContext, Selection, FilterDraft } from "@getaster/data";
import { html } from "lit-html";
import { createMockService } from "@getaster/mock";
const metadata = { $Version: "4.01", $EntityContainer: "F.Container", F: {
  Device: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: {}, platform: { "@Validation.AllowedValues": [ { Value: "Linux" }, { Value: "macOS" }, { Value: "Windows" } ] }, online: { $Type: "Edm.Boolean" }, cost: { $Type: "Edm.Decimal", $Scale: 2 }, limit: { $Type: "Edm.Decimal", $Scale: 2 }, enrolled: { $Type: "Edm.Date" },
    serial: { $Type: "Edm.Int64", $Nullable: true }, exactAmount: { $Type: "Edm.Decimal", $Precision: 28, $Scale: 10, $Nullable: true },
    ownerId: { $Type: "Edm.Int32" }, owner: { $Kind: "NavigationProperty", $Type: "F.Owner", $Partner: "devices", $ReferentialConstraint: { ownerId: "id" } } },
  Owner: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: {}, devices: { $Kind: "NavigationProperty", $Collection: true, $Type: "F.Device", $Partner: "owner" } },
  Container: { $Kind: "EntityContainer", Devices: { $Collection: true, $Type: "F.Device", $NavigationPropertyBinding: { owner: "Owners" } }, Owners: { $Collection: true, $Type: "F.Owner", $NavigationPropertyBinding: { devices: "Devices" } } },
} };
const data = { Devices: Array.from({ length: 240 }, (_, i) => ({ id: i+1, name: `Device ${String(i+1).padStart(3,"0")}`, platform: ["Linux","macOS","Windows"][i%3], online: i%2===0,
  serial: i < 2 ? ["9007199254740992", "9007199254740993"][i] : i === 2 ? null : "9007199254740994",
  exactAmount: i < 2 ? ["123456789012345678.1234567890", "123456789012345678.1234567891"][i] : i === 2 ? null : "123456789012345678.1234567892",
  cost: "10.10", limit: "20.00", enrolled: `2026-10-${String(i%28+1).padStart(2,"0")}`, ownerId: i%2+1 })), Owners: [{ id:1, name:"Alice" },{ id:2, name:"Bob" }] };
const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", document.baseURI) });
const requests = [];
const ctx = await DataContext.connect((r) => { requests.push(r); return mock.transport(r); }, { now: () => Date.parse("2026-10-19T12:00:00Z") });
mock.faults.latencyMs = 40;
const collection = ctx.collection({ set:"Devices", orderBy:[{field:"id"}] }, { pageSize:20, keepPages:2 });
const selection = new Selection(ctx.store, collection, { multiple:true, ordered:true, fallback:false });
const table = document.createElement("aster-grid");
table.ctx=ctx; table.collection=collection; table.selection=selection; table.label="Devices"; table.persist="advanced-filter-demo";
table.view={ columns:["name","platform","online","cost","enrolled"].map(field=>({field})), sort:[{field:"id"}], filters:{}, frozen:0 };
table.summaries=[{method:"count",label:"Matching devices"},{method:"sum",field:"cost",label:"Total cost"}];
const tiles=document.createElement("aster-tile-grid"); tiles.ctx=ctx; tiles.collection=collection; tiles.selection=selection; tiles.label="Device tiles"; tiles.presentTile=d=>({ title:d.name, description:d.platform });
tiles.renderTile=(d)=>html`<div class="device-card"><strong>${d.name}</strong><span>${d.platform}</span><span>${d.online ? "Online" : "Offline"}</span></div>`;
document.querySelector("#out").append(table);
document.querySelector("#view").addEventListener("change",e=>document.querySelector("#out").replaceChildren(e.target.value==="tiles"?tiles:table));
document.querySelector("#online").addEventListener("change",e=> { const {filter,...rest}=collection.query; collection.setQuery({...rest,...(e.target.checked?{filter:{op:"eq",field:"online",value:true}}:{})}); });
const nested={op:"and",args:[{op:"or",args:[{op:"eq",field:"platform",value:"Linux"},{op:"eq",field:"platform",value:"Windows"}]},{op:"lt",field:"cost",other:"limit"}]};
document.querySelector("#example").addEventListener("click",()=> { table.view={...table.view,criteria:nested}; });
document.querySelector("#missing").addEventListener("click",()=> { table.view={...table.view,criteria:{op:"or",args:[{op:"eq",field:"removed",value:"a"},{op:"eq",field:"platform",value:"Linux"}]}}; });
const builder=document.querySelector("#builder");
builder.model=new FilterDraft(ctx.schema,"Devices",{op:"and",args:[{op:"ge",field:"enrolled",value:{relative:"today",days:-7}},{op:"via",field:"owner",where:{op:"eq",field:"name",value:"Alice"}}]});
builder.addEventListener("apply",e=> { document.querySelector("#applied").textContent=JSON.stringify(e.detail??null); });
if (new URLSearchParams(location.search).has("debug")) globalThis.filterDemo={ctx,collection,selection,table,tiles,mock,requests,builder,nested};
