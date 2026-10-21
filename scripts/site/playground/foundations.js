import { DataContext, EditModel, html, render, effect } from "../lib/aster-ui.js";
import "../lib/aster-ui-preview.js";
import { createFolderPicker } from "./folder-picker.js";
import { createMockService } from "../lib/aster-ui-mock.js";

const byId = id => document.getElementById(id);
const folderPicker = createFolderPicker(byId("folder-picker"));
window.folderPickerDemo = folderPicker;
addEventListener("pagehide", () => folderPicker.dispose());
const exact = byId("exact"), quantity = byId("quantity");
Object.assign(exact, { label: "Unit price", labelled: true, value: "9007199254740993.25", step: "0.05", stepButtons: true, prefixText: "£", min: "0" });
Object.assign(quantity, { label: "Quantity", labelled: true, numericType: "integer", value: "2", min: "0", max: "9", stepButtons: true, suffixText: "devices" });
effect(() => { byId("exact-output").textContent = `Canonical value: ${exact.value ?? "empty"}`; byId("quantity-output").textContent = `Canonical value: ${quantity.value ?? "empty"}`; });
render(html`<aster-composite-field .label=${"Dimensions"} .help=${"An application-owned structured value; no implicit serialization."}
  .value=${{ width: "20", height: "10" }} .renderValue=${({ value, commit, readOnly }) => html`
    <aster-number-field .label=${"Width"} .labelled=${true} .value=${value.width} .readOnly=${readOnly} .suffixText=${"cm"}
      @value-change=${e => commit({ ...value, width: e.detail.value })}></aster-number-field>
    <aster-number-field .label=${"Height"} .labelled=${true} .value=${value.height} .readOnly=${readOnly} .suffixText=${"cm"}
      @value-change=${e => commit({ ...value, height: e.detail.value })}></aster-number-field>`}></aster-composite-field>`, byId("structured"));

const split = byId("layout-split");
Object.assign(split, { size: 280, min: 160, max: 520, label: "Resize project navigation", collapsible: true,
  start: html`<div class="layout-content"><h3>Project navigation</h3><aster-vertical-layout .gap=${"small"} .content=${html`<a href="#group-heading">Project budget</a><a href="#accordion-heading">Settings</a><a href="#path-heading">Workspace folders</a>`}></aster-vertical-layout></div>`,
  end: html`<aster-split id="level-split" .orientation=${"vertical"} .size=${135} .min=${80} .max=${240} .label=${"Resize project notes"}
    .start=${html`<div class="layout-content"><h3>Project notes</h3><label class="demo-note">Working note<span class="aster-field aster-field-prose" data-ring-owner><textarea aria-label="Working note" placeholder="This note survives resizing and collapse"></textarea></span></label></div>`}
    .end=${html`<div class="layout-content"><aster-horizontal-layout .gap=${"large"} .content=${html`<div><strong>Budget review</strong><p>Friday, 10:00</p></div><div><strong>Owner</strong><p>Alex Morgan</p></div>`}></aster-horizontal-layout></div>`}></aster-split>` });
byId("responsive").onchange = e => split.responsive = e.target.checked;
byId("narrow").onclick = () => { const narrow = split.style.maxWidth !== "460px"; split.style.maxWidth = narrow ? "460px" : ""; byId("narrow").textContent = narrow ? "Use full container" : "Use narrow container"; };

const accordion = byId("settings");
let lazyCalls = 0;
accordion.items = [
  { id: "general", heading: "General", body: html`<label class="demo-note">Workspace name<span class="aster-field" data-ring-owner><input aria-label="Workspace name" value="Design operations"></span></label>` },
  { id: "notes", heading: "Notes", summary: html`<span>Created when first opened</span>`, create: () => { lazyCalls++; return html`<label class="demo-note">Private note<span class="aster-field aster-field-prose" data-ring-owner><textarea aria-label="Private note"></textarea></span></label>`; } },
  { id: "limits", heading: "Limits", body: html`<aster-number-field id="limit" .label=${"Storage limit"} .labelled=${true} .value=${"10"} .min=${"0"} .max=${"100"} .suffixText=${"GB"}></aster-number-field>` },
  { id: "managed", heading: "Managed by administrator", disabled: true, body: html`<p>Contact your administrator.</p>` },
];
byId("multiple").onchange = e => accordion.multiple = e.target.checked;
byId("show-error").onclick = () => { byId("limit").value = "-1"; };
const path = byId("path");
const hierarchy = byId("hierarchy");
const locations = [
  { id: "workspace", title: "Workspace", summary: "Teams and shared projects" },
  { id: "engineering", parent: "workspace", title: "Engineering" },
  { id: "platform", parent: "engineering", title: "Platform" },
  { id: "projects", parent: "platform", title: "Projects" },
  { id: "aster", parent: "projects", title: "Aster", summary: "Project folders" },
  { id: "design", parent: "aster", title: "Design", summary: "Layouts and interaction notes", editable: true },
  { id: "research", parent: "aster", title: "Research", summary: "Saved studies and references", editable: true },
  { id: "design-details", parent: "design", title: "Folder details" },
  { id: "research-details", parent: "research", title: "Folder details" },
];
const locationsById = new Map(locations.map(location => [location.id, location]));
const folderNotes = new Map();

function locationContent(location) {
  if (location.editable) return html`<label class="demo-note">Folder note
    <span class="aster-field aster-field-prose" data-ring-owner><textarea aria-label=${`${location.title} note`}
      .value=${folderNotes.get(location.id) ?? ""} @input=${e => folderNotes.set(location.id, e.target.value)}></textarea></span>
    </label><button class="aster-button" type="button" @click=${e => showLocation(`${location.id}-details`, e.currentTarget)}>Open folder details</button>`;
  if (location.id.endsWith("-details")) return html`<p>Shared with the project team.</p>`;
  const children = locations.filter(child => child.parent === location.id);
  return html`<aster-vertical-layout .content=${html`${children.map(child => html`<button class="aster-button" type="button"
    @click=${e => showLocation(child.id, e.currentTarget)}>${child.title} →</button>`)}`}></aster-vertical-layout>`;
}

// Breadcrumbs, child navigation and Back all change the same application-owned path.
function showLocation(id, opener) {
  const trail = [];
  for (let location = locationsById.get(id); location; location = locationsById.get(location.parent)) trail.unshift(location);
  hierarchy.navigate(trail.map(location => ({ id: location.id, title: location.title, summary: location.summary, content: locationContent(location) })), opener);
  path.items = trail.map(location => ({ id: location.id, label: location.title, activate: () => showLocation(location.id) }));
}
showLocation("aster");
hierarchy.addEventListener("back", e => showLocation(e.detail.id));

const rail = byId("rail");
rail.label = "Related projects";
rail.slides = ["Spring launch", "Brand refresh", "Billing update"].map((label, i) => ({ id: String(i), label, view: html`<article class="demo-box"><h3>${label}</h3><p>${["Campaign assets and launch checklist", "Updated identity and shared templates", "Invoices, exports and reconciliation"][i]}</p><label class="demo-note">Quick note<span class="aster-field" data-ring-owner><input aria-label=${`Note for ${label}`} placeholder="Keep a note on this card"></span></label></article>` }));
byId("reorder").onclick = () => rail.slides = [...rail.slides].reverse();
byId("rtl").onchange = e => { rail.dir = e.target.checked ? "rtl" : "ltr"; rail.show(0); };
byId("view-all").onclick = () => { const all = byId("all-cards"); all.hidden = !all.hidden; byId("view-all").textContent = all.hidden ? "View all" : "Hide list"; render(html`<ul>${rail.slides.map(s => html`<li>${s.label}</li>`)}</ul>`, all); };

let model, ctx, collection;
try {
  const json = async name => { const response = await fetch(`../lib/demo/${name}.json`); if (!response.ok) throw new Error(`Could not load ${name}`); return response.json(); };
  const mock = await createMockService({ metadata: await json("metadata"), data: await json("data"), wasm: new URL("../lib/odata_mock.wasm", import.meta.url) });
  ctx = await DataContext.connect(mock.transport);
  collection = ctx.collection({ set: "Projects", sort: [{ field: "id" }] }, { pageSize: 1 });
  await collection.ensure(0, 1);
  model = new EditModel(ctx, "Projects", collection.keys.peek()[0]);
  byId("group").replaceChildren();
  render(html`<aster-field .model=${model} .field=${"name"} .labelled=${true}></aster-field>
    <aster-composite-field id="budget-group" .model=${model} .fields=${["budget", "spent"]} .label=${"Project finances"} .help=${"Amounts in GBP. Both values belong to the same project edit."}
      .content=${html`<aster-number-field .model=${model} .field=${"budget"} .labelled=${true} .prefixText=${"£"} .stepButtons=${true}></aster-number-field><aster-number-field .model=${model} .field=${"spent"} .labelled=${true} .prefixText=${"£"} .stepButtons=${true}></aster-number-field>`}></aster-composite-field>`, byId("group"));
  effect(() => { byId("group-output").textContent = model.dirty.value ? "Unsaved changes in this project" : "Project matches its saved values"; });
  byId("lock-group").onchange = e => byId("budget-group").disabled = e.target.checked;
  byId("validate").onclick = () => { const valid = model.validate(); byId("group-output").textContent = valid ? "Project values are valid" : "Review the highlighted fields"; if (!valid) byId("budget-group").focus(); };
} catch (error) { byId("group").textContent = error.message; byId("group").setAttribute("role", "alert"); }
window.foundationsDemo = { exact, quantity, split, accordion, hierarchy, rail, get model() { return model; }, get lazyCalls() { return lazyCalls; } };
addEventListener("pagehide", () => { model?.dispose(); if (collection) ctx.release(collection); });
