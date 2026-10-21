import { isAlias, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { CompositeError, defineComposite, located, type CompositeDefinition, type CompositeLocation } from "../packages/elements/src/composition/definition.ts";

/** Build-time YAML adapter; the browser consumes the resulting JSON definition. */
export function compileCompositeYaml(text: string, file = "composite.yaml"): { definition: CompositeDefinition; sources: Record<string, CompositeLocation> } {
  if (text.length > 262144) throw new Error(`${file}: definition exceeds 256 KiB`);
  const lines = new LineCounter();
  const doc = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines, uniqueKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) throw new Error(`${file}: ${(doc.errors[0] ?? doc.warnings[0])!.message}`);
  if (doc.directives?.yaml.version !== "1.2") throw new Error(`${file}: only YAML 1.2 is supported`);
  const sources: Record<string, CompositeLocation> = Object.create(null);
  let count = 0;
  function walk(node: Node | null, path: string, depth: number): void {
    if (++count > 10000 || depth > 40) throw located(new CompositeError(path, "definition exceeds node/depth limit"), sources);
    if (!node) return;
    const { line, col } = lines.linePos(node.range?.[0] ?? 0);
    sources[path] = { file, line, column: col };
    if (isAlias(node) || node.tag || node.anchor) throw located(new CompositeError(path, "tags, anchors and aliases are not supported"), sources);
    if (isMap(node)) for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw located(new CompositeError(path, "mapping keys must be strings"), sources);
      const next = `${path}.${pair.key.value}`;
      walk(isNode(pair.value) ? pair.value : null, next, depth + 1);
    }
    else if (isSeq(node)) node.items.forEach((item, i) => walk(isNode(item) ? item : null, `${path}.${i}`, depth + 1));
  }
  walk(doc.contents, "definition", 0);
  try { return { definition: defineComposite(doc.toJS({ maxAliasCount: 0 })), sources }; }
  catch (error) { throw located(error, sources); }
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: bun scripts/composite-yaml.ts input.yaml output.json");
  await Bun.write(output, JSON.stringify(compileCompositeYaml(await Bun.file(input).text(), input), null, 2));
}
