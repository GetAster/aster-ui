import "@getaster/elements";
import { DataContext } from "@getaster/data";
import { Composite } from "@getaster/elements";
import { createMockService } from "@getaster/mock";
import compiled from "./screen.ui.yaml";
import { authoring } from "./model.ts";
import { metadata, seed } from "./mock.ts";

const mock = await createMockService({
  metadata,
  data: seed,
  // The documented browser route: serve the package's wasm at this URL.
  wasm: new URL("odata_mock.wasm", document.baseURI),
});
const ctx = await DataContext.connect(mock.transport);

const definition = authoring.validate(compiled.definition, compiled.sources);
const screen = document.querySelector<HTMLElement>("#screen");
if (!screen) throw new Error("The template's #screen element is missing");
screen.replaceChildren();
new Composite(definition, authoring.registry, {
  inputs: { ctx },
  ctx,
  sources: compiled.sources,
}).mount(screen);
