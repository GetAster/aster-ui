// CLI over the shipped compiler: `bun scripts/composite-yaml.ts in.ui.yaml out.json`.
import { compileCompositeYaml } from "@getaster/elements/yaml";
export { compileCompositeYaml };

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: bun scripts/composite-yaml.ts input.yaml output.json");
  await Bun.write(output, JSON.stringify(compileCompositeYaml(await Bun.file(input).text(), input), null, 2));
}
