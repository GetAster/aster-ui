import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { esc } from "../shared/dom.ts";

export interface DiagramSpec {
  readonly source: string;
  readonly description: string;
  readonly narrow?: string;
}

export function parseDiagram(spec: string): DiagramSpec {
  const value: unknown = JSON.parse(spec);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A diagram block must be a JSON object");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !["source", "description", "narrow"].includes(key)) ||
      typeof item.source !== "string" || !item.source.trim() ||
      typeof item.description !== "string" || !item.description.trim() ||
      (item.narrow !== undefined && (typeof item.narrow !== "string" || !item.narrow.trim()))) {
    throw new Error("A diagram needs source, description and an optional narrow SVG path");
  }
  return item as unknown as DiagramSpec;
}

/** Each renderer belongs to one page; instance IDs must be unique within that page. */
export function createDiagramRenderer(root: string): (spec: DiagramSpec) => string {
  const base = realpathSync(root);
  let sequence = 0;
  return spec => {
    const prefix = `aster-diagram-${++sequence}`;
    const variant = (source: string, layout: string) => {
      const path = realpathSync(resolve(base, source));
      const rel = relative(base, path);
      if (isAbsolute(source) || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || !path.endsWith(".svg")) throw new Error(`Diagram must be an SVG within the project: ${source}`);
      let svg = readFileSync(path, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
      const rootTag = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(svg);
      if (!rootTag || /<(?:style|script|foreignObject)\b/i.test(svg)) throw new Error(`Diagram needs a static SVG using shared styles: ${source}`);
      const viewBox = /\bviewBox\s*=\s*(["'])(.*?)\1/.exec(rootTag[1]!)?.[2];
      const dimensions = viewBox?.trim().split(/[\s,]+/).map(Number);
      if (!dimensions || dimensions.length !== 4 || dimensions.some(n => !Number.isFinite(n)) || dimensions[2]! <= 0 || dimensions[3]! <= 0) throw new Error(`Diagram needs a valid viewBox: ${source}`);
      // Root accessibility belongs to the shared figure, not to either visual variant.
      svg = rootTag[2]!.replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/g, "");
      const ids = new Map<string, string>();
      svg = svg.replace(/\bid\s*=\s*(["'])(.*?)\1/g, (_, quote: string, id: string) => {
        if (!/^[A-Za-z_][\w.-]*$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate diagram ID: ${id}`);
        const name = `${prefix}-${layout}-${id}`;
        ids.set(id, name);
        return `id=${quote}${name}${quote}`;
      });
      const reference = (id: string) => {
        const name = ids.get(id);
        if (!name) throw new Error(`Missing diagram ID: ${id}`);
        return name;
      };
      svg = svg.replace(/url\(\s*(["']?)#([\w.-]+)\1\s*\)/g, (_, _quote: string, id: string) => `url(#${reference(id)})`)
        .replace(/\b((?:xlink:)?href)\s*=\s*(["'])#([^"']+)\2/g, (_, attr: string, quote: string, id: string) => `${attr}=${quote}#${reference(id)}${quote}`);
      return `<div class="diagram-${layout}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="${dimensions.join(" ")}" style="--diagram-width:${dimensions[2]}px" aria-hidden="true" focusable="false">${svg}</svg></div>`;
    };
    return `<figure class="docs-diagram${spec.narrow ? " has-narrow" : ""}"><div class="diagram-scroll" role="img" aria-label="${esc(spec.description)}" tabindex="0">${variant(spec.source, "wide")}${spec.narrow ? variant(spec.narrow, "narrow") : ""}</div><figcaption>${esc(spec.description)}</figcaption></figure>`;
  };
}
