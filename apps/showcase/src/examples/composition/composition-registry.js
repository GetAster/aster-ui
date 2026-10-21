import { asterComponents, compositeElement, compositeTypes as t, defineCompositeRegistry, defineCompositeRenderer } from "@getaster/elements";
import { DataContext } from "@getaster/data";
import { html } from "lit-html";
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

export const authoring = defineCompositeRegistry({ inputs: { ctx: t.instance(DataContext) }, models, components, renderers });
export const registry = authoring.registry;

