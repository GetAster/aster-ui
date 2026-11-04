import { isAlias, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { CompositeError, defineComposite, located, type CompositeDefinition, type CompositeLocation } from "./composition/definition.ts";

/**
 * Compiles a YAML composition definition into the same plain-data definition
 * that `defineComposite` accepts, plus the file/line/column of every node.
 *
 * YAML carries configuration, never code: tags, anchors and aliases are
 * rejected, so a definition can only contain JSON-compatible values. Pass the
 * sources to `defineCompositeRegistry(...).validate(definition, sources)` to
 * check model, component and renderer names with located diagnostics before
 * mounting.
 *
 * @param text The YAML 1.2 document, at most 256 KiB.
 * @param file The path reported in diagnostics.
 * @returns The detached definition and a path-to-location map.
 */
export function compileCompositeYaml(text: string, file = "composite.yaml"): { definition: CompositeDefinition; sources: Record<string, CompositeLocation> } {
  if (text.length > 262144) throw new Error(`${file}: definition exceeds 256 KiB`);
  const lines = new LineCounter();
  const doc = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines, uniqueKeys: true, strict: true });
  const invalid = doc.errors[0] ?? doc.warnings[0];
  if (invalid) {
    const position = invalid.linePos?.[0];
    throw new Error(position ? `${file}:${position.line}:${position.col}: ${invalid.message}` : `${file}: ${invalid.message}`);
  }
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
