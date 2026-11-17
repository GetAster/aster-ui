import "@getaster/elements";
import { DataContext, ListEdit, Selection } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { effect } from "@preact/signals-core";
import { html, nothing } from "lit-html";

const kinds = ["Text", "Number", "Date", "Choice"];
const metadata = {
  $Version: "4.01",
  $EntityContainer: "Studio.Container",
  Studio: {
    Field: {
      $Kind: "EntityType", $Key: ["id"], "@AsterData.TitleField": "name",
      id: { $Type: "Edm.Int32" }, name: { $MaxLength: 80 }, kind: { "@Validation.AllowedValues": kinds.map(Value => ({ Value })) },
      description: { $Nullable: true }, position: { $Type: "Edm.Int32" },
      required: { $Type: "Edm.Boolean", $Nullable: true }, source: { $MaxLength: 80, $Nullable: true },
    },
    Container: { $Kind: "EntityContainer", Fields: { $Collection: true, $Type: "Studio.Field" } },
  },
};
const data = {
  Fields: [
    { id: 1, name: "Full name", kind: "Text", description: "What the client is called on paper.", position: 1, required: true },
    { id: 2, name: "Date of birth", kind: "Date", description: "Used to check the client is an adult.", position: 2, required: false },
    { id: 3, name: "Household size", kind: "Number", description: "People living at the address.", position: 3, required: false, source: "Household" },
  ],
};
const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", document.baseURI) });
const ctx = await DataContext.connect(mock.transport);
const collection = ctx.collection({ set: "Fields", orderBy: [{ field: "position" }, { field: "id" }] });
await collection.loadAll();
const list = new ListEdit(ctx, collection, { positionField: "position" });
const selection = new Selection(ctx.store, collection, { fallback: false });

const editor = document.querySelector("#fields");
editor.list = list;
editor.selection = selection;
editor.label = "Fields";
editor.editing = "row";
editor.chrome = { add: false };
editor.empty = "No fields yet.";
// The description is unrestricted text: "multiline" edits it in a growing textarea without inventing a maximum length.
editor.columns = [{ field: "name", width: "minmax(8rem, 12rem)" }, { field: "kind", width: "8rem" }, { field: "description", control: "multiline" }];
// A read row in the page's own layout; the editing row uses the column controls.
editor.row = row => {
  const v = row.edit.values.value;
  return html`<div class="field-row"><strong>${String(v.name ?? "") || "Untitled field"}</strong><span class="kind">${String(v.kind ?? "")}</span>
    <span class="description">${String(v.description ?? "")}</span></div>`;
};

// The page's own Add menu is the only way to add a row.
const menu = document.querySelector("#kinds");
const add = document.querySelector("#add");
add.label = "Add field";
add.popup = "menu";
add.expanded = menu.opened;
add.addEventListener("click", () => menu.openFrom(add.querySelector("button"), kinds.map(kind => ({
  label: kind,
  run: () => editor.edit(list.add({ kind }).id),
})), "Add field"));

const save = document.querySelector("#save");
save.label = "Save";
save.variant = "primary";
const status = document.querySelector("#status");
effect(() => {
  save.reason = list.dirty.value ? undefined : "No changes to save.";
  save.busy = list.busy;
  status.textContent = list.dirty.value ? "Unsaved changes" : "Saved";
});
save.addEventListener("click", () => void list.save());

// The same fields laid out in lines, reading and editing alike. The first line's widths are the tracks.
const inherited = { op: "ne", field: "row.record.source", value: null };
const laidList = new ListEdit(ctx, collection, {
  positionField: "position",
  defaults: () => ({ name: "", description: null, required: false, source: null }),
  fieldRules: {
    // The Add menu chooses the type; it is changed in the model, not here, even on a new row.
    kind: { readOnly: { when: { op: "ne", field: "row.values.kind", value: null }, reason: "Change a field's type in the model." } },
    // An inherited field is renamed and described where it's declared.
    name: { readOnly: { when: inherited, reason: "Rename an inherited field where it's declared." } },
    description: { readOnly: { when: inherited, reason: "Describe an inherited field where it's declared." } },
    source: { visible: { op: "ne", field: "row.values.source", value: null } },
  },
});
const laid = document.querySelector("#laid-out");
laid.list = laidList;
laid.label = "Fields, laid out";
laid.editing = "row";
laid.chrome = { add: false };
const addLaid = document.querySelector("#add-laid");
addLaid.label = "Add field";
addLaid.popup = "menu";
addLaid.expanded = menu.opened;
addLaid.addEventListener("click", () => menu.openFrom(addLaid.querySelector("button"), kinds.map(kind => ({
  label: kind,
  run: () => laid.edit(laidList.add({ kind }).id),
})), "Add field"));
laid.layout = [
  [{ field: "name", width: "minmax(8rem, 1fr)" }, { field: "kind", width: "8rem" }, { field: "required", width: "7rem" }],
  [{ field: "description", span: "all", control: "multiline" }],
  [{ field: "source", span: "all", show: "reading" }],
];
laid.fieldPresentation = { fields: {
  name: { display: ({ value }) => html`<strong>${String(value ?? "") || "Untitled field"}</strong>` },
  required: { display: ({ value }) => (value ? html`<span class="flag">Required</span>` : nothing) },
  source: { display: ({ value }) => html`<small class="source">Inherited from ${String(value)}</small>` },
} };
const saveLaid = document.querySelector("#save-laid");
saveLaid.label = "Save";
effect(() => {
  saveLaid.reason = laidList.dirty.value ? undefined : "No changes to save.";
});
saveLaid.addEventListener("click", () => void laidList.save());
