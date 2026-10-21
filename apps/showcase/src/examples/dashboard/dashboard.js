import { DataContext, PageScope, SharedFilters, Selection } from "@getaster/data";
import { provideScope, echartsAdapter, echartsColors } from "@getaster/elements";
import { signal, computed, effect } from "@preact/signals-core";
import { html } from "lit-html";
import { createMockService } from "@getaster/mock";

const metadata = { $Version:"4.01", $EntityContainer:"C.Container", C:{
  Device: { $Kind:"EntityType", $Key:["id"], "@AsterData.TitleField":"name", id:{$Type:"Edm.Int32"}, name:{}, platform:{"@Validation.AllowedValues":[{Value:"Linux"},{Value:"macOS"},{Value:"Windows"}]}, online:{$Type:"Edm.Boolean"}, cost:{$Type:"Edm.Int32"} },
  Container: { $Kind:"EntityContainer", Devices:{$Collection:true,$Type:"C.Device"} },
} };
const data = { Devices:Array.from({length:240},(_,i)=>({ id:i+1, name:`Device ${String(i+1).padStart(3,"0")}`, platform:["Linux","macOS","Windows"][i%3], online:i%2===0, cost:20+i%50 })) };
const mock = await createMockService({metadata,data,wasm:new URL("../lib/odata_mock.wasm",document.baseURI)});
const ctx = await DataContext.connect(mock.transport);
const scope = new PageScope(undefined,{ctx});
const dashboard = document.querySelector("#dashboard");
provideScope(dashboard,scope);
dashboard.label = "Fleet dashboard";
const filters = new SharedFilters(ctx.schema);
document.querySelector("#filters").filters = filters;
const base = { set:"Devices", orderBy:[{field:"id"}] };
const collection = ctx.collection(filters.query(base),{pageSize:20,keepPages:2});
const selection = new Selection(ctx.store,collection,{multiple:true,fallback:false});
const status = document.querySelector("#dashboard-status");
const say = text => { status.textContent = text; };
const metrics = { created: new Map(), disposed: new Map(), scopes: new Map() };
function track(context, create) {
  metrics.created.set(context.id,(metrics.created.get(context.id)??0)+1);
  metrics.scopes.set(context.id,context.scope);
  const session = create();
  return { ...session, dispose() { metrics.disposed.set(context.id,(metrics.disposed.get(context.id)??0)+1); session.dispose(); } };
}
const confirm = document.querySelector("#confirm");
let settle, decision = false;
function askRemove(title) {
  return new Promise(resolve => {
    settle = resolve; decision = false;
    confirm.labelledBy = "confirm-title";
    confirm.content = html`<h2 id="confirm-title">Remove unsaved ${title}?</h2><p>This widget has unsaved notes. Discard them and remove the widget?</p>
      <div class="bar"><button type="button" class="aster-button" @click=${()=>confirm.close()}>Keep widget</button>
      <button type="button" class="aster-button" @click=${()=>{decision=true;confirm.close();}}>Discard and remove</button></div>`;
    queueMicrotask(()=>confirm.show(document.activeElement));
  });
}
confirm.addEventListener("close",()=>{settle?.(decision);settle=undefined;});

dashboard.registerType("summary",{create:context=>track(context,()=>{
  const summary = ctx.summary(filters.query(base),[{field:"cost",method:"sum",as:"cost"}]);
  return { render() {
    const metric = context.config.value.metric ?? "count";
    const values = summary.status.value === "idle" ? summary.values.value : undefined;
    return html`<div class="dashboard-metric"><aster-choice .label=${"Summary metric"} .value=${metric}
      .options=${[{value:"count",label:"Matching devices"},{value:"cost",label:"Monthly cost"}]}
      @change=${event=>dashboard.configure(context.id,{metric:event.detail})}></aster-choice>
      <output aria-label=${metric === "cost" ? "Monthly cost" : "Matching devices"}>${values ? Number(values[metric]).toLocaleString("en-GB") : "…"}</output>
      <p>Exact totals across all matching records, including devices outside the loaded page.</p>
      ${summary.status.value === "error" ? html`<p role="status">Unable to load totals. <button type="button" class="aster-button" @click=${()=>summary.refresh()}>Retry totals</button></p>` : html``}</div>`;
  },dispose:()=>summary.dispose() };
})});
let vendor;
const load = ()=>vendor??=import("./vendor/echarts.js").catch(error=>{vendor=undefined;throw error;});
dashboard.registerType("platforms",{create:context=>track(context,()=>{
  const platform=signal(undefined);
  const share=`dashboard-chart:${context.id}`;
  const stop=filters.share(share,computed(()=>platform.value===undefined?undefined:{set:"Devices",kind:"value",label:`Platform is ${platform.value}`,criteria:{op:"eq",field:"platform",value:platform.value}}),()=>platform.value=undefined);
  const groups=ctx.groups(filters.query(base,{self:share}),"platform");
  const choose=value=>platform.value=platform.peek()===value?undefined:value;
  const host=document.createElement("aster-component");
  host.className="dashboard-chart";
  host.label="Devices by platform";
  host.alternative=()=>html`<table><caption>All matching devices. Choose a platform to filter every widget.</caption><thead><tr><th scope="col">Platform</th><th scope="col">Devices</th></tr></thead><tbody>
    ${groups.status.value==="idle"?(groups.rows.value??[]).map(row=>html`<tr><td><button type="button" class="aster-button" aria-pressed=${String(platform.value===row.value)} @click=${()=>choose(row.value)}>${row.value}</button></td><td>${row.count}</td></tr>`):html`<tr><td colspan="2">${groups.status.value==="error"?html`Unable to load totals. <button class="aster-button" @click=${()=>groups.refresh()}>Retry totals</button>`:"Loading totals…"}</td></tr>`}
    </tbody></table>`;
  host.adapter=echartsAdapter({load,option:env=>{
    const colors=echartsColors(env);
    const rows=groups.status.value==="idle"?(groups.rows.value??[]):[];
    return {animation:true,animationDuration:450,animationDurationUpdate:450,grid:{left:50,right:20,top:25,bottom:30},xAxis:{type:"category",data:rows.map(row=>row.value),axisLabel:{color:colors.muted}},yAxis:{type:"value",minInterval:1,axisLabel:{color:colors.muted},splitLine:{lineStyle:{color:colors.rule}}},series:[{id:"platforms",type:"bar",data:rows.map(row=>({id:String(row.value),value:row.count,platform:row.value,itemStyle:{color:platform.value===row.value?colors.text:colors.accent}})),label:{show:true,position:"top",color:colors.text}}]};
  },click:event=>{if(event.componentType==="series"&&event.data&&"platform" in event.data)choose(event.data.platform);}});
  return {render:()=>html`${host}`,dispose(){stop();groups.dispose();}};
})});
dashboard.registerType("devices",{create:context=>track(context,()=>{
  const grid=document.createElement("aster-grid");
  grid.className="dashboard-devices";
  grid.ctx=ctx; grid.collection=collection; grid.selection=selection; grid.label="Devices"; grid.publish="devices"; grid.editable=true;
  grid.view={columns:["name","platform","online","cost"].map(field=>({field})),sort:[{field:"id"}],filters:{},frozen:0};
  return {render:()=>html`${grid}`,beforeRemove:()=>grid.finishEditing(),dispose(){}};
})});
dashboard.registerType("notes",{create:context=>track(context,()=>{
  const dirty=signal(false);
  const input=document.createElement("textarea");
  input.setAttribute("aria-label","Notes text");
  input.placeholder="Keep a note while you explore the fleet…";
  input.addEventListener("input",()=>dirty.value=true,{signal:context.signal});
  return {render:()=>html`<div class="dashboard-notes"><p>Your draft stays here when you move, resize or maximize this widget.</p>${input}
    <footer><button type="button" class="aster-button" @click=${()=>{dirty.value=false;say("Notes saved for this visit.");}}>Save notes</button><span role="status">${dirty.value?"Unsaved changes":"Saved"}</span></footer></div>`,
    beforeRemove:()=>dirty.peek()?askRemove(dashboard.widgets.find(widget=>widget.id===context.id)?.title??"notes"):true,dispose(){}};
})});
const defaults = [
  {id:"summary-1",type:"summary",title:"Fleet overview",width:1,height:1,config:{metric:"count"}},
  {id:"platforms-1",type:"platforms",title:"Platform mix",width:2,height:2},
  {id:"notes-1",type:"notes",title:"Notes",width:1,height:1},
  {id:"devices-1",type:"devices",title:"Device fleet",width:3,height:2},
];
await dashboard.restore({version:1,widgets:defaults});
const picker=document.querySelector("#widget-type");
picker.label="Widget type"; picker.value="summary";
picker.options=[{value:"summary",label:"Summary"},{value:"platforms",label:"Platform chart"},{value:"devices",label:"Device grid"},{value:"notes",label:"Notes"}];
const titles={summary:"Fleet overview",platforms:"Platform mix",devices:"Device fleet",notes:"Notes"};
let nextWidget=2;
document.querySelector("#add-widget").addEventListener("click",()=>{
  const type=picker.value;
  let number;
  do { number=nextWidget++; } while(dashboard.widgets.some(widget=>widget.id===`${type}-${number}`));
  dashboard.add({id:`${type}-${number}`,type,title:`${titles[type]} ${number}`,width:type==="devices"?3:1,height:type==="platforms"?2:1,config:type==="summary"?{metric:"count"}:{}});
  say(`${titles[type]} widget added.`);
});
const storageKey="aster-showcase-dashboard-v1";
document.querySelector("#save-layout").addEventListener("click",()=>{
  try {localStorage.setItem(storageKey,JSON.stringify(dashboard.snapshot()));say("Dashboard layout saved on this browser.");}
  catch {say("The dashboard layout could not be saved.");}
});
async function restore(saved) {
  try {say(await dashboard.restore(saved)?"Dashboard layout restored. Retained widgets keep their content.":"Layout unchanged. Your widget content is still here.");}
  catch {say("The saved dashboard layout is invalid. Your layout is unchanged.");}
}
document.querySelector("#restore-layout").addEventListener("click",()=>{
  try {const json=localStorage.getItem(storageKey);if(!json)return say("Save a layout first.");void restore(JSON.parse(json));}
  catch {say("The saved dashboard layout could not be read.");}
});
document.querySelector("#reset-layout").addEventListener("click",()=>restore({version:1,widgets:defaults}));
document.querySelector("#online").addEventListener("change",event=>event.target.checked?filters.set({by:"online",label:"Online only",set:"Devices",criteria:{op:"eq",field:"online",value:true}}):filters.remove("online"));
const changing=signal(false);
let nextId=241;
async function change(action) {
  if(changing.peek())return;
  changing.value=true;
  try {await action();} catch(error){say(`Could not update devices: ${error.message}`);} finally {changing.value=false;}
}
document.querySelector("#add-device").addEventListener("click",()=>change(async()=>{
  const id=nextId++;
  await ctx.create("Devices",{id,name:`Device ${String(id).padStart(3,"0")}`,platform:"Linux",online:true,cost:35});
  say(`Added Linux device ${id}. The widgets share the updated data.`);
}));
document.querySelector("#raise-costs").addEventListener("click",()=>change(async()=>{
  const records=[...selection.records.peek()];
  await Promise.all(records.map(record=>ctx.update("Devices",JSON.stringify([record.id]),{cost:Number(record.cost)+10})));
  say(`Raised costs by 10 for ${records.length} selected devices.`);
}));
effect(()=>{
  for(const id of ["add-widget","save-layout","restore-layout","reset-layout"])document.querySelector(`#${id}`).disabled=dashboard.busy;
  document.querySelector("#raise-costs").disabled=changing.value||selection.count.value===0;
  document.querySelector("#add-device").disabled=changing.value;
});
say("Ready. Filter the fleet, change data, or make this layout your own.");
window.addEventListener("pagehide",()=>ctx.release(collection),{once:true});
if(new URLSearchParams(location.search).has("debug"))globalThis.dashboardDemo={dashboard,ctx,filters,selection,collection,scope,metrics,mock,defaults};
