import { parseDiagram, type DiagramSpec } from "./diagram.ts";
import { Marked } from "marked";
import { esc } from "../shared/dom.ts";

export interface MarkdownOptions {
  readonly resolveLink?: (href: string) => string;
  /** Enable only for project-controlled Markdown containing intentional HTML. */
  readonly allowHtml?: boolean;
  readonly renderDiagram?: (spec: DiagramSpec) => string;
}

export interface MarkdownPage {
  readonly title: string;
  readonly html: string;
  readonly headings: readonly { readonly id: string; readonly text: string; readonly level: number }[];
}

export function searchText(value: string): string {
  return value.replace(/^```diagram[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*$/gm, (_, spec: string) => parseDiagram(spec).description).replace(/```[\s\S]*?```/g, " ").replace(/<[^>]*>/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$1 $2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`#*_>|]/g, "").replace(/\s+/g, " ").trim();
}

export async function renderMarkdown(markdown: string, options: MarkdownOptions = {}): Promise<MarkdownPage> {
  const ids = new Set<string>();
  const headings: { id: string; text: string; level: number }[] = [];
  const parser = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type !== "link" && token.type !== "image") return;
      if (/^(?:javascript|vbscript|data|file):/i.test(token.href.replace(/[\s\u0000-\u001f]/g, ""))) throw new Error(`Unsupported documentation link: ${token.href}`);
      token.href = options.resolveLink?.(token.href) ?? token.href;
    },
    renderer: {
      code(token) {
        if (token.lang?.trim() !== "diagram") return false;
        if (!options.renderDiagram) throw new Error("Diagram blocks need a diagram renderer");
        return options.renderDiagram(parseDiagram(token.text));
      },
      heading({ tokens, depth, text }) {
        const plain = searchText(text);
        const base = plain.toLowerCase().replace(/[^\p{Letter}\p{Number}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
        let id = base;
        for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
        ids.add(id);
        headings.push({ id, text: plain, level: depth });
        return `<h${depth} id="${esc(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      html({ text }) { return /^\s*<!--[\s\S]*?-->\s*$/.test(text) ? "" : options.allowHtml ? text : esc(text); },
    },
  });
  const html = await parser.parse(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""));
  return { title: headings.find(heading => heading.level === 1)?.text ?? "Documentation", html, headings };
}
