import "@getaster/elements";
import { DataContext, EditModel } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { html, render } from "lit-html";

document.querySelector("#mixed").indeterminate = true;
render(html`
  <aster-field .label=${"Project"} .labelled=${true} .value=${"Spring launch"}></aster-field>
  <aster-field .label=${"Read-only project"} .labelled=${true} .value=${"Spring launch"} .readOnly=${true}></aster-field>
  <aster-number-field .label=${"Quantity"} .labelled=${true} .value=${"3"} .min=${0} .stepButtons=${true}></aster-number-field>
  <aster-number-field .label=${"Invalid quantity"} .labelled=${true} .value=${"-1"} .min=${0} .stepButtons=${true}></aster-number-field>
`, document.querySelector("#fields"));
render(html`
  <aster-button .label=${"Save"} .variant=${"primary"}></aster-button>
  <aster-button .label=${"Cancel"}></aster-button>
  <aster-button .label=${"Unavailable"} .reason=${"No changes to save"}></aster-button>
  <aster-button .label=${"Submit"} .busyLabel=${"Submitting…"} .busy=${true}></aster-button>
`, document.querySelector("#buttons"));

const json = async name => {
  const response = await fetch(`../lib/demo/${name}.json`);
  if (!response.ok) throw new Error(`Could not load ${name}`);
  return response.json();
};
const mock = await createMockService({ metadata: await json("metadata"), data: await json("data"), wasm: new URL("../lib/odata_mock.wasm", import.meta.url) });
const context = await DataContext.connect(mock.transport);
const models = [false, true, null].map(done => new EditModel(context, "Tasks", undefined, { done }));
render(html`${models.map((model, index) => html`<aster-check .model=${model} .field=${"done"}
  .label=${["Unchecked", "Checked", "Mixed"][index]} .labelled=${true}></aster-check>`)}`, document.querySelector("#checks"));
addEventListener("pagehide", () => models.forEach(model => model.dispose()));
document.querySelector("#controls").dataset.ready = "true";
