import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileCompositeYaml } from "../../../scripts/composite-yaml.ts";
import { standaloneExamples } from "../src/app/catalogue.ts";
import { exampleAssets, exampleSource } from "./assets.ts";

/** Flat output URLs preserve links while source remains feature-oriented. */
export async function buildShowcaseExamples(root: string, out: string, production: { conditions: string[]; define: Record<string, string> }): Promise<void> {
  const target = join(out, "playground");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "example-navigation.js"), `export const standaloneExamples = ${JSON.stringify(standaloneExamples)};\n`);
  const imports = {
    "@getaster/data": "../lib/aster-ui.js",
    "@getaster/elements": "../lib/aster-ui.js",
    "@getaster/elements-preview": "../lib/aster-ui-preview.js",
    "@getaster/mock": "../lib/aster-ui-mock.js",
    "lit-html": "../lib/aster-ui.js",
    "@preact/signals-core": "../lib/aster-ui.js",
  };
  for (const file of Object.keys(exampleAssets)) {
    const source = readFileSync(exampleSource(root, file), "utf8");
    let output = source.replaceAll("../../shared/navigation/", "./").replaceAll("../../app/catalogue.ts", "./example-navigation.js");
    if (file.endsWith(".html")) output = output.replace("<head>", `<head><script type="importmap">${JSON.stringify({ imports })}</script>`);
    writeFileSync(join(target, file), output);
    if (file.endsWith(".yaml")) writeFileSync(join(target, file.replace(/\.yaml$/, ".json")), JSON.stringify(compileCompositeYaml(source, file)));
  }
  const vendor = await Bun.build({ entrypoints: [join(root, "apps/showcase/src/examples/charts/vendor/echarts.ts")], outdir: join(target, "vendor"), minify: true, target: "browser", ...production });
  if (!vendor.success) throw new AggregateError(vendor.logs, "The optional chart demo didn't build");
}
