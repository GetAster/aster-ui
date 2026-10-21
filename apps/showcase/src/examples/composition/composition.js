import { metadata, data } from "./composition-mock.js";
import { Composite, deriveComposite } from "@getaster/elements";
import { effect } from "@preact/signals-core";
import { html } from "lit-html";
import { DataContext } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { authoring, registry } from "./composition-registry.js";

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
