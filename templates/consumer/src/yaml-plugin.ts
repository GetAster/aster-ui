// Build-time loader: a `.ui.yaml` import becomes the compiler's JSON result.
// The browser receives a validated plain-data definition, never the parser.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { BunPlugin } from "bun";
import { compileCompositeYaml } from "@getaster/elements/yaml";

const yamlPlugin: BunPlugin = {
  name: "aster-yaml",
  setup(build) {
    build.onLoad({ filter: /\.ui\.yaml$/ }, ({ path }) => ({
      contents: JSON.stringify(compileCompositeYaml(readFileSync(path, "utf8"), relative(import.meta.dir, path))),
      loader: "json",
    }));
  },
};

export default yamlPlugin;
