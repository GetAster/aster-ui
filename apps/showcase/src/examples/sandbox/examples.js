// The playground's examples: plain JavaScript modules, run as written.
// Each starts the mock (aster-odata in WebAssembly) with the demo's data.

const setup = `import { DataContext, PageScope, PickerOptions, EditModel, editPublication, effect, html, keyText, render, provideScope } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

// The demo's OData service, in this page.
const json = (f) => fetch(\`../lib/demo/\${f}\`).then((r) => r.json());
const mock = await createMockService({
  metadata: await json("metadata.json"),
  data: await json("data.json"),
  wasm: new URL("../lib/odata_mock.wasm", document.baseURI),
});
const ctx = await DataContext.connect(mock.transport);
const out = document.querySelector("#out");
`;

export const EXAMPLES = [
  {
    name: "A grid, a form and a picker on the same data",
    about: "Choose a project in the grid; the form edits it. Save, and the grid shows the change at once: both read the same records.",
    code: `${setup}
// The grid publishes its selection to the page scope; the form follows it.
const scope = new PageScope();
provideScope(out, scope);
const people = new PickerOptions(ctx, { set: "People" });
let edit;

function view() {
  render(html\`
    <aster-grid .ctx=\${ctx} .set=\${"Projects"} .label=\${"Projects"} .publish=\${"projects"}
      .lookups=\${{ leadId: { set: "People", display: "name" } }}
      .view=\${{ columns: [{ field: "name" }, { field: "leadId" }, { field: "state" }, { field: "health" }], sort: [{ field: "name" }], filters: {}, frozen: 1 }}
      style="height: 300px"></aster-grid>
    \${edit
      ? html\`<aster-form .model=\${edit} .sections=\${[{ title: "Project", columns: 2, items: [{ field: "name", span: 2 }, { field: "leadId", options: people }, "state"] }]}></aster-form>
          <aster-button .label=\${"Save"} .variant=\${"primary"} @click=\${() => edit.save()}></aster-button>\`
      : html\`<p>Choose a project.</p>\`}
  \`, out);
}

effect(() => {
  const key = scope.value("projects.key").value;
  edit?.dispose();
  edit = key === undefined ? undefined : new EditModel(ctx, "Projects", key);
  view();
});
`,
  },
  {
    name: "Page rules",
    about: "Days behind shows, and is required, only while Status is Behind. The rule is data the form reads, not code in it.",
    code: `${setup}
const scope = new PageScope();
provideScope(out, scope);
// An edit model works on a loaded record.
await ctx.reload("Projects", keyText([2]));
const edit = new EditModel(ctx, "Projects", keyText([2]));
scope.publish("project", editPublication(edit));
const behind = { op: "eq", field: "project.values.health", value: "behind" };
edit.applyRules(scope, "project", { behindDays: { visible: behind, required: behind, clearWhenHidden: true } });

effect(() => render(html\`
  <aster-form .model=\${edit} .sections=\${[{ title: "Schedule", columns: 2, items: ["health", "behindDays"] }]}></aster-form>
  <p>Valid: \${edit.valid.value ? "yes" : "no"}</p>
\`, out));
`,
  },
  {
    name: "Pickers: search, columns, chips",
    about: "One picker per person, bound to a task; another holds several people as chips and reports them.",
    code: `${setup}
const people = new PickerOptions(ctx, { set: "People", columns: ["email"] });
await ctx.reload("Tasks", keyText([1]));
const task = new EditModel(ctx, "Tasks", keyText([1]));
let chosen = [];

effect(() => render(html\`
  <aster-picker .model=\${task} .field=\${"assigneeId"} .options=\${people} .labelled=\${true}></aster-picker>
  <aster-picker .options=\${people} .multiple=\${true} .values=\${chosen} .label=\${"Reviewers"} .labelled=\${true}
    @change=\${(e) => { chosen = e.detail; document.querySelector("#chosen").textContent = chosen.join(", ") || "none"; }}></aster-picker>
  <p>Reviewer ids: <span id="chosen">none</span></p>
  <p>Assignee pending: \${task.dirty.value ? "yes" : "no"}</p>
\`, out));
`,
  },
];
