import "@getaster/elements";
import { DataContext, EditModel } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { html, render } from "lit-html";

document.querySelector("#mixed").indeterminate = true;
render(html`<aster-field-selection .label=${"Project fields"}
  .source=${{ fields: [
    { path: "id", label: "Identifier" }, { path: "name", label: "Project name" },
    { path: "budget", label: "Budget" }, { path: "notes", label: "Notes" },
    { path: "confidential", label: "Confidential" },
  ] }}
  .value=${["id", "name", "budget"]}
  .policy=${{
    id: { hide: "The identifier must remain visible", move: "The identifier cannot be moved directly" },
    budget: { move: "The budget order is managed by the application" },
    confidential: { select: "Confidential fields are unavailable in this view" },
  }}
  @value-change=${event => {
    document.querySelector("#field-selection-status").textContent = `Selected fields: ${event.detail.fields.map(field => field.label).join(", ")}`;
  }}></aster-field-selection>`, document.querySelector("#field-selection"));
document.querySelector("#field-selection-states").dataset.ready = "true";
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
// Inline disclosures, closed and open, inside a sentence.
const errors = html`<code>invalid_grant</code>, <code>invalid_scope</code>, <code>access_denied</code>, <code>server_error</code>`;
render(html`
  <p>authorize(request) raises <aster-disclosure .label=${"4 errors"} .body=${errors}></aster-disclosure></p>
  <p>refresh(token) raises <aster-disclosure .label=${"4 errors"} .body=${errors} .open=${true}></aster-disclosure></p>
`, document.querySelector("#disclosures"));

const json = async name => {
  const response = await fetch(`../lib/demo/${name}.json`);
  if (!response.ok) throw new Error(`Could not load ${name}`);
  return response.json();
};
const mock = await createMockService({ metadata: await json("metadata"), data: await json("data"), wasm: new URL("../lib/odata_mock.wasm", import.meta.url) });
const context = await DataContext.connect(mock.transport);
const models = [false, true, null].map(done => new EditModel(context, "Tasks", undefined, { done }));
// Toolbar-style checks: the label beside the box, on one line.
const beside = [true, false].map(done => new EditModel(context, "Tasks", undefined, { done }));
render(html`${models.map((model, index) => html`<aster-check .model=${model} .field=${"done"}
  .label=${["Unchecked", "Checked", "Mixed"][index]} .labelled=${true}></aster-check>`)}
  <aster-check .model=${beside[0]} .field=${"done"} .label=${"Label after"} .labelled=${true} .labelPosition=${"end"}></aster-check>
  <aster-check .model=${beside[1]} .field=${"done"} .label=${"Label before"} .labelled=${true} .labelPosition=${"start"}></aster-check>`, document.querySelector("#checks"));
const budgets = [["3000", "Within budget"], ["7500", "Near the limit"], ["12400", "Over budget"]].map(([spent]) => new EditModel(context, "Projects", undefined, { budget: "10000", spent }));
const meterFor = (model, label) => html`<aster-meter .model=${model} .field=${"spent"} .maxField=${"budget"} .label=${label} .optimum=${0} .low=${"60%"} .high=${"90%"}
  .format=${{ style: "currency" }} .chrome=${{ value: "ratio" }}></aster-meter>`;
render(html`
  ${budgets.map((model, i) => meterFor(model, ["Within budget", "Near the limit", "Over budget"][i]))}
  <aster-meter .label=${"Storage used"} .value=${42} .min=${0} .max=${100} .format=${{ unit: "GB" }} .chrome=${{ value: "percent" }}></aster-meter>
  <aster-meter .label=${"No reading"} .value=${null}></aster-meter>
  <aster-meter .label=${"Quality score"} .value=${35} .max=${100} .low=${40} .high=${80} .optimum=${100}></aster-meter>
`, document.querySelector("#meters"));
const tuning = new EditModel(context, "Projects", undefined, { budget: "10000", spent: "2500" });
render(html`
  <aster-slider .labelled=${true} .label=${"Volume"} .value=${40}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Ticks"} .value=${30} .step=${10} .ticks=${true} .chrome=${{ tickLabels: true }}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Typed or dragged"} .value=${60} .step=${5} .chrome=${{ input: true }} .hint=${"Drag the thumb or type a value."}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Price"} .range=${true} .values=${[20, 80]} .step=${5} .ticks=${25} .format=${{ style: "currency" }} .chrome=${{ input: true, tickLabels: true }}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Range"} .range=${true} .values=${[30, 70]} .minGap=${10}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Disabled"} .value=${50} .disabled=${true}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Read-only"} .value=${50} .readOnly=${true}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Invalid"} .value=${140}></aster-slider>
  <aster-slider .labelled=${true} .label=${"Empty"} .value=${null}></aster-slider>
  <aster-slider .model=${tuning} .field=${"budget"} .labelled=${true} .label=${"Project budget"} .min=${0} .max=${20000} .step=${500} .format=${{ style: "currency" }} .chrome=${{ input: true }}></aster-slider>
`, document.querySelector("#sliders"));
addEventListener("pagehide", () => [...models, ...beside, ...budgets, tuning].forEach(model => model.dispose()));
document.querySelector("#controls").dataset.ready = "true";
document.querySelector("#measures").dataset.ready = "true";
