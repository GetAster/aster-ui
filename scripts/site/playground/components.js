import { DataContext, PageScope, SharedFilters, Selection, FilterDraft, viewQuery, echartsAdapter, echartsColors, provideScope, signal, computed, effect, html } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

const metadata = { $Version:"4.01", $EntityContainer:"C.Container", C:{
  Device: { $Kind:"EntityType", $Key:["id"], "@AsterData.TitleField":"name", id:{$Type:"Edm.Int32"}, name:{}, platform:{"@Validation.AllowedValues":[{Value:"Linux"},{Value:"macOS"},{Value:"Windows"}]}, online:{$Type:"Edm.Boolean"}, cost:{$Type:"Edm.Int32"} },
  Container: { $Kind:"EntityContainer", Devices:{$Collection:true,$Type:"C.Device"} },
} };
const data = { Devices:Array.from({length:240},(_,i)=>({ id:i+1, name:`Device ${String(i+1).padStart(3,"0")}`, platform:["Linux","macOS","Windows"][i%3], online:i%2===0, cost:20+i%50 })) };
const mock = await createMockService({metadata,data,wasm:new URL("../lib/odata_mock.wasm",document.baseURI)});
const requests=[];
const ctx=await DataContext.connect(r=>{requests.push(r);return mock.transport(r);});
const scope=new PageScope(undefined,{ctx});
provideScope(document.querySelector("main"),scope);
const filters=new SharedFilters(ctx.schema);
document.querySelector("#filters").filters=filters;
const platform=signal(undefined);
const stopShare=filters.share("platform-chart",computed(()=>platform.value===undefined?undefined:{set:"Devices",kind:"value",label:`Platform is ${platform.value}`,criteria:{op:"eq",field:"platform",value:platform.value}}),()=>platform.value=undefined);
const base={set:"Devices",orderBy:[{field:"id"}]};
const collection=ctx.collection(filters.query(base),{pageSize:20,keepPages:2});
const selection=new Selection(ctx.store,collection,{multiple:true,fallback:false});
const grid=document.querySelector("#devices");
grid.ctx=ctx; grid.collection=collection; grid.selection=selection; grid.label="Devices"; grid.publish="devices"; grid.editable=true;
grid.view={columns:["name","platform","online","cost"].map(field=>({field})),sort:[{field:"id"}],filters:{},frozen:0};
const gridView=scope.value("devices.view");
const groupBase=computed(()=>{
  const view=gridView.value??grid.view;
  const valid=!view.criteria||new FilterDraft(ctx.schema,"Devices",view.criteria).result.value.valid;
  return viewQuery("Devices",valid?view:{...view,criteria:{op:"or",args:[]}});
});
const groups=ctx.groups(filters.query(groupBase,{self:"platform-chart"}),"platform");
const platforms=document.querySelector("#platforms");
const costs=document.querySelector("#costs");
let vendor,attempt=0;
const load=()=>vendor??=import(`./vendor/echarts.js${attempt?`?attempt=${attempt}`:""}`).catch(error=>{vendor=undefined;attempt++;throw error;});
const choosePlatform=value=>platform.value=platform.peek()===value?undefined:value;
const loaded=computed(()=>collection.keys.value.flatMap(key=>{
  if(key===undefined)return [];
  const entity=ctx.store.record("Devices",key).value?.entity;
  return entity?[{key,entity}]:[];
}).slice(0,20));
const chooseDevice=key=>selection.toggle(key);
platforms.label="Devices by platform";
platforms.alternative=()=>html`<table aria-busy=${groups.status.value === "loading" ? "true" : "false"}><caption>Server totals for all matching devices. Choose a platform to filter the grid.
  <aster-progress-status class="component-data-state" .busy=${groups.status.value === "loading"}
    .pendingText=${"Updating totals…"} .completeText=${"Totals updated"}
    .error=${groups.status.value === "error" ? "Unable to update totals." : undefined}></aster-progress-status>
  ${groups.status.value === "error" ? html`<button class="aster-button" @click=${()=>groups.refresh()}>Retry totals</button>` : ""}</caption><thead><tr><th scope="col">Platform</th><th scope="col">Devices</th></tr></thead><tbody>
  ${groups.rows.value!==undefined?groups.rows.value.map(row=>html`<tr><td><button class="aster-button" type="button" aria-pressed=${platform.value===row.value} @click=${()=>choosePlatform(row.value)}>${row.value??"Unspecified"}</button></td><td>${row.count}</td></tr>`):html`<tr><td colspan="2">${groups.status.value==="error"?html`Unable to load totals. <button class="aster-button" @click=${()=>groups.refresh()}>Retry totals</button>`:"Loading totals…"}</td></tr>`}
</tbody></table>`;
platforms.adapter=echartsAdapter({load,updateMode:"merge",option:env=>{
  const colors=echartsColors(env);
  // Groups retain the last result during a same-query refresh; keep those bars mounted.
  const rows=groups.rows.value??[];
  return {animation:true,animationDuration:250,animationDurationUpdate:200,animationEasing:"cubicOut",grid:{left:55,right:15,top:25,bottom:35},xAxis:{type:"category",data:rows.map(r=>r.value??"Unspecified"),axisLabel:{color:colors.muted}},yAxis:{type:"value",minInterval:1,max:range=>Math.max(10,Math.ceil(range.max*1.15/10)*10),axisLabel:{color:colors.muted},splitLine:{lineStyle:{color:colors.rule}}},series:[{id:"platform-counts",type:"bar",data:rows.map(r=>({id:String(r.value),name:String(r.value),value:r.count,platform:r.value,itemStyle:{color:platform.value===r.value?colors.text:colors.accent}})),label:{show:true,position:"top",color:colors.text}}]};
},click:event=>{if(event.componentType==="series"&&event.data&&"platform" in event.data)choosePlatform(event.data.platform);}});
costs.label="Loaded device costs";
costs.alternative=()=>html`<table><caption>First ${loaded.value.length} loaded devices of ${collection.count.value??"…"} matching. Grid scrolling loads other records. Select devices here or in the grid.</caption><thead><tr><th scope="col">Device</th><th scope="col">Cost</th></tr></thead><tbody>
  ${loaded.value.map(({key,entity})=>html`<tr><td><button class="aster-button" type="button" aria-pressed=${selection.keys.value.includes(key)} @click=${()=>chooseDevice(key)}>${entity.name}</button></td><td>${entity.cost}</td></tr>`)}
</tbody></table>`;
costs.adapter=echartsAdapter({load,updateMode:"merge",option:env=>{
  const colors=echartsColors(env);
  const selected=selection.keys.value;
  return {animation:true,animationDuration:250,animationDurationUpdate:200,animationEasing:"cubicOut",grid:{left:45,right:15,top:25,bottom:50},xAxis:{type:"category",data:loaded.value.map(r=>String(r.entity.id)),axisLabel:{color:colors.muted}},yAxis:{type:"value",axisLabel:{color:colors.muted},splitLine:{lineStyle:{color:colors.rule}}},series:[{id:"device-costs",type:"bar",data:loaded.value.map(({key,entity})=>({id:key,name:key,key,value:entity.cost,itemStyle:{color:selected.includes(key)?colors.text:colors.accent}}))}]};
},click:event=>{if(event.componentType==="series"&&typeof event.data?.key==="string")chooseDevice(event.data.key);}});
document.querySelector("#online").addEventListener("change",event=>event.target.checked?filters.set({by:"online",label:"Online only",set:"Devices",criteria:{op:"eq",field:"online",value:true}}):filters.remove("online"));
document.querySelector("#hide").addEventListener("click",event=>{const charts=document.querySelector("#charts");charts.hidden=!charts.hidden;event.target.textContent=charts.hidden?"Show charts":"Hide charts";});
document.querySelector("#reload").addEventListener("click",()=>{platforms.remove();costs.remove();document.querySelector("#charts").append(platforms,costs);});
const changing=signal(false);
const targets=()=>selection.records.peek().length?selection.records.peek():loaded.peek().map(row=>row.entity);
effect(()=>{
  const busy=changing.value;
  const selected=selection.count.value;
  const count=selected||loaded.value.length;
  document.querySelector("#raise-costs").textContent=selected?"Raise selected costs":"Raise displayed costs";
  document.querySelector("#toggle-status").textContent=selected?"Toggle selected status":"Toggle displayed status";
  for(const id of ["raise-costs","toggle-status"])document.querySelector(`#${id}`).disabled=busy||count===0;
  for(const id of ["add-linux","add-windows"])document.querySelector(`#${id}`).disabled=busy;
});
async function changeData(action) {
  if(changing.peek())return;
  changing.value=true;
  try {
    if(!(await grid.finishEditing())){document.querySelector("#data-status").textContent="Finish the current edit before changing the fleet.";return;}
    document.querySelector("#data-status").textContent=await action();
  }
  catch(error){document.querySelector("#data-status").textContent=`Couldn’t change the fleet: ${error.message}`;}
  finally{changing.value=false;}
}
document.querySelector("#raise-costs").addEventListener("click",()=>changeData(async()=>{
  const records=[...targets()];
  await Promise.all(records.map(record=>ctx.update("Devices",JSON.stringify([record.id]),{cost:Number(record.cost)+10})));
  return `Raised costs by 10 for ${records.length} ${records.length===1?"device":"devices"}.`;
}));
document.querySelector("#toggle-status").addEventListener("click",()=>changeData(async()=>{
  const records=[...targets()];
  await Promise.all(records.map(record=>ctx.update("Devices",JSON.stringify([record.id]),{online:!record.online})));
  return `Updated online status for ${records.length} ${records.length===1?"device":"devices"}.`;
}));
let nextId=241;
for(const [id,platform] of [["add-linux","Linux"],["add-windows","Windows"]])document.querySelector(`#${id}`).addEventListener("click",()=>changeData(async()=>{
  const number=nextId++;
  await ctx.create("Devices",{id:number,name:`Device ${String(number).padStart(3,"0")}`,platform,online:true,cost:35});
  return `Added ${platform} device ${number}. Only devices matching the current filters appear in the grid.`;
}));
// The page owns borrowed data models; individual hosts dispose only their sessions.
window.addEventListener("pagehide",()=>{stopShare();groups.dispose();ctx.release(collection);},{once:true});
if(new URLSearchParams(location.search).has("debug"))globalThis.componentDemo={ctx,mock,requests,collection,selection,filters,groups,platforms,costs,loaded,platform};
