import { DataContext, PageScope, Selection, provideScope, signal, effect, html, keyText } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

const teams=["Engineering","Design","Operations","Support"];
const roles=["Software engineer","Product designer","Operations lead","Support specialist"];
const locations=["London","Berlin","Toronto","Amsterdam"];
function portrait(index) {
  const colors=["#456b7c","#765b87","#856649","#44736b"];
  const color=colors[(index+Math.floor(index/8))%colors.length];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="${color}"/><circle cx="80" cy="61" r="28" fill="#f2dfcc"/><path d="M24 160v-12a56 56 0 0 1 112 0v12" fill="#e2edf0"/><path d="M51 58c-4-25 12-36 29-36 23 0 36 15 29 42-4-18-18-14-25-29-7 16-27 12-33 23" fill="#28373e"/></svg>`)}`;
}
const first=["Amira","Ben","Cleo","Dev","Elena","Finn","Gia","Hugo"];
const last=["Ahmed","Bennett","Chen","Diaz","Evans","Fischer","Gupta","Hassan","Ito","Jones","Khan","Lopez"];
const people=Array.from({length:96},(_,i)=>({id:i+1,name:`${first[i%first.length]} ${last[Math.floor(i/first.length)]}`,team:teams[i%4],role:roles[i%4],location:locations[Math.floor(i/4)%4],available:i%3!==0,portrait:portrait(i)}));
const metadata={$Version:"4.01",$EntityContainer:"Directory.Container",Directory:{
  Person:{$Kind:"EntityType",$Key:["id"],"@AsterData.TitleField":"name",id:{$Type:"Edm.Int32"},name:{$MaxLength:80},team:{"@Validation.AllowedValues":teams.map(Value=>({Value}))},role:{},location:{},available:{$Type:"Edm.Boolean"},portrait:{}},
  Container:{$Kind:"EntityContainer",People:{$Collection:true,$Type:"Directory.Person"}},
}};
const mock=await createMockService({metadata,data:{People:people},wasm:new URL("../lib/odata_mock.wasm",document.baseURI)});
const requests=[];
const ctx=await DataContext.connect(request=>{requests.push(request);return mock.transport(request);});
const collection=ctx.collection({set:"People",orderBy:[{field:"name"},{field:"id"}]},{pageSize:24,keepPages:3});
const selection=new Selection(ctx.store,collection,{multiple:true,fallback:false});
const scope=new PageScope(undefined,{ctx});
provideScope(document.querySelector("main"),scope);
const grid=document.querySelector("#people");
grid.collection=collection;grid.selection=selection;grid.publish="people";grid.label="Team directory";grid.virtualized=true;
grid.empty=html`<p>No colleagues match your search. Change the search or team filter.</p>`;
const field=(entity,state,name)=>state.hidden.has(name)?"Hidden":String(entity[name]??"");
grid.presentTile=(person,state)=>({title:field(person,state,"name"),description:`${field(person,state,"role")}, ${field(person,state,"team")}, ${field(person,state,"location")}, ${state.hidden.has("available")?"Availability hidden":person.available?"Available":"Away"}`});
grid.renderTile=(person,state)=>html`<article class="directory-card">
  <div class="directory-portrait">${state.hidden.has("portrait")?html``:html`<img src=${person.portrait} width="76" height="76" alt="" loading="lazy">`}</div>
  <strong class="directory-name">${field(person,state,"name")}</strong><span class="directory-role">${field(person,state,"role")}</span>
  <span class="directory-team">${field(person,state,"team")}</span><span class="directory-location">${field(person,state,"location")}</span>
  <span class="directory-availability"><i class="directory-dot" aria-hidden="true" data-available=${String(!state.hidden.has("available")&&person.available)}></i>${state.hidden.has("available")?"Availability hidden":person.available?"Available":"Away"}</span>
</article>`;
const choices=[
  ["team","Team",[{value:"",label:"All teams"},...teams.map(value=>({value,label:value}))],""],
  ["sort","Sort by",[{value:"name",label:"Name: A to Z"},{value:"name-desc",label:"Name: Z to A"},{value:"team",label:"Team, then name"},{value:"available",label:"Available first"}],"name"],
  ["presentation","Presentation",[{value:"cards",label:"Profile cards"},{value:"compact",label:"Compact cards"}],"cards"],
];
for(const [id,label,options,value] of choices){const choice=document.querySelector(`#${id}`);choice.label=label;choice.options=options;choice.value=value;}
let searchTimer;
function applyQuery(){
  clearTimeout(searchTimer);
  const search=document.querySelector("#search").value.trim();
  const team=document.querySelector("#team").value;
  const parts=[];
  if(search)parts.push({op:"or",args:["name","role","team"].map(field=>({op:"contains",field,value:search,caseInsensitive:true}))});
  if(team)parts.push({op:"eq",field:"team",value:team});
  let orderBy;
  switch(document.querySelector("#sort").value){
    case "name-desc":orderBy=[{field:"name",descending:true},{field:"id"}];break;
    case "team":orderBy=[{field:"team"},{field:"name"},{field:"id"}];break;
    case "available":orderBy=[{field:"available",descending:true},{field:"name"},{field:"id"}];break;
    default:orderBy=[{field:"name"},{field:"id"}];
  }
  collection.setQuery({set:"People",orderBy,...(parts.length?{filter:{op:"and",args:parts}}:{})});
}
document.querySelector("#search").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(applyQuery,150);});
for(const id of ["team","sort"])document.querySelector(`#${id}`).addEventListener("change",applyQuery);
document.querySelector("#presentation").addEventListener("change",()=>grid.dataset.template=document.querySelector("#presentation").value);
document.querySelector("#clear-selection").addEventListener("click",()=>selection.clear());
const changing=signal(false);
const action=document.querySelector("#directory-action");
async function change(run){
  if(changing.peek())return;
  changing.value=true;
  try{await run();}catch(error){action.textContent=`Could not update the directory: ${error.message}`;}finally{changing.value=false;}
}
let nextId=97;
document.querySelector("#add-person").addEventListener("click",()=>change(async()=>{
  const id=nextId++;
  const name=`New colleague ${String(id).padStart(3,"0")}`;
  await ctx.create("People",{id,name,team:"Operations",role:"Operations specialist",location:"London",available:true,portrait:portrait(id)});
  action.textContent=`Added ${name}. Only colleagues matching your current search and team appear.`;
}));
document.querySelector("#toggle-availability").addEventListener("click",()=>change(async()=>{
  const selected=[...selection.records.peek()];
  await Promise.all(selected.map(person=>ctx.update("People",keyText([person.id]),{available:!person.available})));
  action.textContent=`Updated availability for ${selected.length} ${selected.length===1?"colleague":"colleagues"}.`;
}));
effect(()=>{
  const count=collection.count.value;
  const selected=selection.count.value;
  const status=collection.status.value;
  const message=status==="error"?"Unable to load the directory. Use Retry loading tiles below.":count===undefined?"Loading the directory…":`${count} ${count===1?"colleague":"colleagues"} · ${selected} selected`;
  const output=document.querySelector("#directory-status");
  if(output.textContent!==message)output.textContent=message;
  document.querySelector("#toggle-availability").disabled=changing.value||selected===0;
  document.querySelector("#clear-selection").disabled=selected===0;
  document.querySelector("#add-person").disabled=changing.value;
});
const profile=document.querySelector("#profile");
const opened=signal(undefined);
const saving=signal(false);
const error=signal("");
let profileVersion=0;
effect(()=>{
  const key=opened.value;
  if(!key)return;
  const record=ctx.store.record("People",key).value;
  if(!record)return;
  const person=record.entity;
  const hidden=record.hidden?.has("name");
  const name=hidden?"Hidden":String(person.name);
  profile.labelledBy="profile-title";
  profile.content=html`<form class="profile-form" @submit=${async event=>{
    event.preventDefault();if(saving.peek()||hidden)return;
    const value=new FormData(event.currentTarget).get("name").trim();
    if(!value){error.value="Enter a name.";return;}
    const version=profileVersion;
    saving.value=true;error.value="";
    try{await ctx.update("People",key,{name:value});action.textContent=`Updated profile: ${value}.`;if(version===profileVersion)profile.close();}
    catch(problem){if(version===profileVersion)error.value=String(problem.message??problem);}finally{if(version===profileVersion)saving.value=false;}
  }}><h2 id="profile-title">${name}</h2><p>${record.hidden?.has("role")?"Role hidden":person.role} · ${record.hidden?.has("team")?"Team hidden":person.team}</p>
  <label>Profile name<span class="aster-field"><input name="name" .value=${name} required maxlength="80" ?readOnly=${hidden} ?disabled=${saving.value}></span></label>
  ${error.value?html`<p role="alert">${error.value}</p>`:html``}
  <footer><button type="submit" class="aster-button" ?disabled=${saving.value||hidden}>${saving.value?"Saving…":"Save changes"}</button>
  <button type="button" class="aster-button" @click=${()=>profile.close()}>Cancel</button></footer></form>`;
});
grid.addEventListener("tile-open",event=>{opened.value=event.detail.key;error.value="";queueMicrotask(()=>profile.show(grid.tileFor(event.detail.key)));});
profile.addEventListener("close",()=>{profileVersion++;opened.value=undefined;saving.value=false;});
window.addEventListener("pagehide",()=>{clearTimeout(searchTimer);ctx.release(collection);},{once:true});
if(new URLSearchParams(location.search).has("debug"))globalThis.dataViewDemo={ctx,collection,selection,grid,scope,mock,requests};
