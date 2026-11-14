import "@getaster/elements";
import { DataContext, ListEdit, Selection } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { effect } from "@preact/signals-core";
import { html } from "lit-html";

const kinds = ["Text", "Number", "Date", "Choice"];
const metadata = {
  $Version: "4.01",
  $EntityContainer: "Studio.Container",
  Studio: {
    Field: {
      $Kind: "EntityType", $Key: ["id"], "@AsterData.TitleField": "name",
      id: { $Type: "Edm.Int32" }, name: { $MaxLength: 80 }, kind: { "@Validation.AllowedValues": kinds.map(Value => ({ Value })) },
      description: { $MaxLength: 2000 }, position: { $Type: "Edm.Int32" },
    },
    Container: { $Kind: "EntityContainer", Fields: { $Collection: true, $Type: "Studio.Field" } },
  },
};
const data = {
  Fields: [
    { id: 1, name: "Full name", kind: "Text", description: "What the client is called on paper.", position: 1 },
    { id: 2, name: "Date of birth", kind: "Date", description: "Used to check the client is an adult.", position: 2 },
    { id: 3, name: "Household size", kind: "Number", description: "People living at the address.", position: 3 },
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
editor.columns = [{ field: "name", width: "minmax(8rem, 12rem)" }, { field: "kind", width: "8rem" }, { field: "description" }];
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
