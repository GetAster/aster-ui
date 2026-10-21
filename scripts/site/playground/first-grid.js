import { DataContext, html, render } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";

const out = document.querySelector("#out");
try {
  // The local OData engine lets this example run without a backend.
  const json = async name => {
    const response = await fetch(`../lib/demo/${name}.json`);
    if (!response.ok) throw new Error(`Could not load ${name}`);
    return response.json();
  };
  const mock = await createMockService({
    metadata: await json("metadata"),
    data: await json("data"),
    wasm: new URL("../lib/odata_mock.wasm", import.meta.url),
  });
  const ctx = await DataContext.connect(mock.transport);

  render(html`
    <aster-grid
      .ctx=${ctx}
      .set=${"Projects"}
      .label=${"Projects"}
      .view=${{
        columns: [
          { field: "name" },
          { field: "state" },
          { field: "health" },
        ],
        sort: [{ field: "name" }],
        filters: {},
        frozen: 0,
      }}
      style="height: 300px"
    ></aster-grid>
  `, out);
} catch (error) {
  out.setAttribute("role", "alert");
  out.textContent = `The example could not load: ${error instanceof Error ? error.message : String(error)}. Reload to try again.`;
}
