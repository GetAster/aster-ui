import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { compileCompositeYaml } from "./composite-yaml.ts";

/** The browser receives a validated definition, never a YAML parser. */
const compositeYamlPlugin: Bun.BunPlugin = {
  name: "aster-composite-yaml",
  setup(build) {
    build.onLoad({ filter: /\.ui\.yaml$/ }, ({ path }) => ({
      contents: JSON.stringify(compileCompositeYaml(readFileSync(path, "utf8"), relative(resolve(import.meta.dir, ".."), path))),
      loader: "json",
    }));
  },
};
export default compositeYamlPlugin;
