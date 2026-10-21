import { asterComponents, Composite, compositeElement, compositeTypes as t, defineCompositeRegistry, defineCompositeRenderer, deriveComposite, effect, html } from "../lib/aster-ui.js";
import { DataContext } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";
import { deviceWorkspaceType } from "./composition-model.js";
import { DraftStatus } from "./composition-status.js";

const models = { "device-workspace": deviceWorkspaceType };
const components = { DraftStatus: compositeElement(DraftStatus), CommandBar: asterComponents.CommandBar, Grid: asterComponents.Grid, TileGrid: asterComponents.TileGrid };
const renderers = {};

// YAML's renderer names resolve to these ordinary functions.
function deviceCard(device) {
  return html`<div class="composition-device"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="6" width="38" height="28" rx="3"/><path d="M16 42h16M24 34v8"/></svg><strong>${device.name}</strong><span>${device.platform} · ${device.owner}</span></div>`;
}
renderers["device-card"] = defineCompositeRenderer(["renderTile"], deviceCard);
renderers["device-description"] = defineCompositeRenderer(["presentTile"], device => ({ title: device.name, description: `${device.platform}, ${device.owner}` }));

// The allowlisted module loader is code, not a URL supplied by YAML.
let detailsModule;
for (const [type, factory] of [["DeviceDetails", "createDetails"], ["CompactDetails", "createCompactDetails"]]) {
  components[type] = {
    props: { editor: t.optional(t.custom("EditModel", value => !!value?.save)) },
    load: async () => { detailsModule = await import("./composition-details.js"); return detailsModule[factory]; },
    apply: (element, props) => detailsModule.applyDetails(element, props),
  };
}

const authoring = defineCompositeRegistry({ inputs: { ctx: t.instance(DataContext) }, models, components, renderers });
const registry = authoring.registry;

const metadata = { $Version: "4.01", $EntityContainer: "Demo.Container",
  $Reference: {
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] },
    "https://aster.dev/vocabularies/Aster.Data.V1.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
  }, Demo: {
  Device: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: { $Nullable: false, "@Core.Description": "Name", "@AsterData.MinLength": 1 }, platform: { "@Core.Description": "Platform" }, owner: { "@Core.Description": "Owner" } },
  Container: { $Kind: "EntityContainer", Devices: { $Collection: true, $Type: "Demo.Device" } },
} };
const data = { Devices: Array.from({ length: 72 }, (_, i) => ({ id: i + 1, name: `Device ${String(i + 1).padStart(3, "0")}`, platform: ["macOS", "Linux", "Windows"][i % 3], owner: ["Design", "Engineering", "Operations"][i % 3] })) };
const out = document.querySelector("#workspace");
try {
  const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", import.meta.url) });
  const ctx = await DataContext.connect(mock.transport);
  const response = await fetch("./composition.ui.json");
  if (!response.ok) throw new Error("The workspace definition could not be loaded.");
  const { definition: sourceDefinition, sources } = await response.json();
  const definition = authoring.validate(sourceDefinition, sources);
  let instance;
  let stop;
  let timer;
  let variant = "standard";
  const variants = {
    standard: definition,
    semantic: definition,
    single: deriveComposite(definition, { name: "SingleDeviceWorkspace", modelInputs: { selection: { multiple: false, fallback: false } } }),
    inspect: deriveComposite(definition, { name: "DisplayOnlyTable", children: { table: { props: { selectable: false, label: "Devices (selection controlled by Tiles)" } } } }),
    compact: deriveComposite(definition, { name: "CompactDeviceWorkspace", children: { details: { type: "CompactDetails" } } }),
  };
  const variantChoice = document.querySelector("#variant");
  variantChoice.label = "Workspace variant";
  variantChoice.options = [ { value: "standard", label: "Standard" }, { value: "single", label: "Single selection" }, { value: "inspect", label: "Display-only table" }, { value: "compact", label: "Compact inspector" }, { value: "semantic", label: "Semantic layout" } ];
  variantChoice.value = variant;
  function mount() {
    const placement = variant === "semantic" ? authoring.placement(variants[variant], place => html`
      <section class="composition-regions" aria-label="Device workspace">
        <header>${place("views")}${place("actions")}${place("status")}</header>
        <section aria-label="Device views">${place("table")}${place("tiles")}</section>
        <aside aria-label="Device inspector">${place("details")}</aside>
      </section>`) : undefined;
    instance = new Composite(variants[variant], registry, { inputs: { ctx }, ctx, sources, ...(placement ? { placement } : {}) }).mount(out);
    stop = effect(() => {
      document.querySelector("#status").textContent = instance.model.message.value;
      document.querySelector("#rule-status").textContent = instance.commands.save.reason.value ?? "Save is available.";
    });
    document.querySelector("#query").value = "";
    globalThis.compositionDemo = { instance, registry, authoring, definition, variants, sources, ctx, mock };
  }
  mount();
  const schemaLink = document.querySelector("#download-schema");
  const schemaUrl = URL.createObjectURL(new Blob([JSON.stringify(authoring.schema(definition), null, 2)], { type: "application/schema+json" }));
  schemaLink.href = schemaUrl;
  schemaLink.download = "composition.schema.json";
  addEventListener("pagehide", event => { if (!event.persisted) URL.revokeObjectURL(schemaUrl); });
  document.querySelector("#query").addEventListener("input", event => { clearTimeout(timer); const value = event.target.value; timer = setTimeout(() => { instance.model.query.value = value; }, 160); });
  addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void instance.commands.save.execute().catch(() => {}); }
  });
  function teardown() { clearTimeout(timer); stop(); instance.dispose(); }
  document.querySelector("#reset").addEventListener("click", async () => {
    const dirty = instance.model.dirty.value;
    if (instance.model.busy.value) return;
    if (dirty && !await confirmDiscard()) return;
    teardown(); mount();
  });
  let changing = false;
  variantChoice.addEventListener("change", async event => {
    if (event.target !== variantChoice || changing) return;
    const next = variantChoice.value;
    if (instance.model.busy.value) { variantChoice.value = variant; return; }
    changing = true;
    try {
      if (instance.model.dirty.value && !await confirmDiscard()) { variantChoice.value = variant; return; }
      teardown(); variant = next; mount();
    } finally { changing = false; }
  });
  async function confirmDiscard() {
    const dialog = document.querySelector("#confirm-reset");
    dialog.returnValue = "keep";
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener("close", () => resolve(dialog.returnValue === "discard"), { once: true }));
  }
  addEventListener("pagehide", event => { if (!event.persisted) teardown(); });
} catch (error) { out.setAttribute("role", "alert"); out.textContent = error.message; }
