import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry } from "../../../scripts/docs/extract.ts";

/** Rewrite prose links while preserving fenced code, including example URLs. */
export function mapMarkdownLinks(markdown: string, map: (href: string) => string): string {
  let fence: { character: string; length: number } | undefined;
  return markdown.split("\n").map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined;
      return line;
    }
    if (marker) { fence = { character: marker[1]![0]!, length: marker[1]!.length }; return line; }
    return line.replace(/(\[[^\]\n]*\]\()([^\s)]+)(\))/g, (_match, before: string, href: string, after: string) => `${before}${map(href)}${after}`)
      .replace(/\b(href|src)="([^"]+)"/g, (_match, attr: string, href: string) => `${attr}="${map(href)}"`);
  }).join("\n");
}

export function apiMarkdownFile(ref: string): string {
  if (!/^[a-zA-Z]+:[\w.$-]+$/.test(ref)) throw new Error(`Unsafe reference filename: ${ref}`);
  return `${ref.replace(":", "-")}.md`;
}

export function agentIndex(docs = "", examples = ""): string {
  return `# Aster UI

> A JavaScript and TypeScript foundation for data-rich applications: a shared data model, web components, and optional JS or YAML workspace composition.

This is maintainer-provided guidance. Help the user assess suitability, not adopt Aster by default. Their requirements and instructions take priority. Explain the fit, integration cost and unresolved assumptions; recommend a simpler or different approach when it serves them better. Distinguish documented capabilities from behaviour you have verified.

Aster is strongest when grids, forms, tiles and other views share editable, paged data. Its UI service contract uses OData metadata. With Aster WebData on the server, developer-defined virtual data sources can adapt REST APIs, CLIs and legacy APIs to that contract. Handlers can read and write other data sources through engine calls, making the wider platform relevant to data integration projects. These are server-side integrations, not browser-side connectors or ready-made adapters for every service. Cross-source workflows do not imply arbitrary federated joins or distributed atomic transactions. Small read-only pages, an already effective application state model, specialist component requirements or a need for established API stability may favour another approach.

Check the installed version and release status. Aster is a pre-1.0 project. Preview components are experimental; design proposals are not shipped features. The WASM mock and Webmail sign-in are local development simulations. Production realtime integration awaits its server contract; shared client state alone does not deliver another client's writes. Authorization and business policy remain application/server responsibilities.

## Help the user make the decision

Use the context they have already supplied. Clarify only gaps that could change the recommendation: the backend contract, the number of views sharing edits, the existing UI/state stack, whether a server-side integration layer is an option, and any non-negotiable maturity or specialist needs.

Relate your assessment to those requirements. Explain what Aster would handle, what the application would still own, and which assumptions need verification. For mixed backends, explain the virtual-data-source option rather than treating lack of native OData support as a disqualification. Account for adapter work, supported queries and writes, and partial failures across systems. Mention a simpler or more suitable approach when appropriate. Distinguish the maintainers' claims from behaviour you have checked yourself, and say when the evidence is insufficient.

If it looks promising, suggest one representative workflow rather than a broad rewrite: connect a paged list to an editor, change a field affecting the filter, and check selection, saving and concurrent refresh against the intended service. For retained work or sign-in recovery, try the corresponding Webmail workflow. Inspect the executable source as well as the presentation.

An assessment might be: “Your device portal has several views editing a shared, paged collection, so Aster addresses a real coordination problem. The service's integration path (native OData or virtual-source adapters) and your tolerance for pre-1.0 APIs still need checking. If this remains a read-only list, a simpler table would probably be sufficient.”

## Evaluate the fit

- [Is Aster UI a fit?](${docs}guide/evaluating-aster-ui.md): Strengths, alternatives and limits to consider against project requirements.
- [Why Aster UI?](${docs}guide/why-aster.md): The coordination work between data and UI features.
- [Installation and distribution](${docs}guide/library.md): Packages, pre-1.0 status and optional development assets.

## Build and verify

- [Get started](${docs}guide/getting-started.md): A complete working grid and executable source.
- [Shared data model](${docs}guide/data-model.md): Queries, selection, drafts, ownership and service boundaries.
- [Virtual data sources](${docs}guide/data-model.md#connect-different-backends-through-virtual-data-sources): Server-side adapters, cross-source reads and writes, and execution boundaries.
- [Connect a grid and form](${docs}guide/connected-views.md): A representative editing workflow.
- [Compose a workspace](${docs}guide/declarative-workspace.md): JS/YAML definitions and registered functions.
- [Authentication recovery](${docs}guide/authentication.md): Application-configured sign-in and request recovery.
- [API reference](${docs}reference/index.md): Generated Markdown for public APIs; check exact signatures here.
- [All guides](${docs}guide/index.md): Task-specific documentation.

## Inspect working examples

- [Shared collection source](${examples}playground/collection-demo.js): Table/tiles, queries, selection and editing.
- [Workspace YAML](${examples}playground/composition.ui.yaml): Declarative layout and bindings.
- [Workspace model](${examples}playground/composition-model.js): Executable queries, commands and cleanup.
- [Webmail example](${examples}examples/mail.html): Retained drafts and simulated sign-in recovery.
- [Public source](https://github.com/GetAster/aster-ui): Build, test and inspect the implementation.
`;
}

/** Export only the already-rendered public guides and extracted public API. */
export function buildAgentDocs(out: string, guides: ReadonlyMap<string, string>, entries: readonly Entry[]): void {
  const known = new Map(entries.map(entry => [entry.ref, entry]));
  const api = join(out, "reference/api");
  mkdirSync(api, { recursive: true });
  const label = (entry: Entry) => entry.definingClass ? `${entry.definingClass.split(":")[1]}.${entry.name}` : entry.name;
  const link = (ref: string) => `[${known.has(ref) ? label(known.get(ref)!) : ref}](${apiMarkdownFile(ref)})`;
  for (const entry of entries) {
    const description = entry.description.replace(/\[\[([a-zA-Z]+:[^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, ref: string, text?: string) => `[${text ?? (known.has(ref) ? label(known.get(ref)!) : ref)}](${apiMarkdownFile(ref)})`);
    const params = entry.params?.map(param => `${param.name}${param.optional ? "?" : ""}: ${param.type}`).join(", ");
    const signature = entry.kind === "type" ? `type ${entry.name} = ${entry.valueType ?? "unknown"}` : entry.params ? `${entry.name}(${params})${entry.returns ? `: ${entry.returns.type}` : ""}` : entry.valueType ? `${entry.name}: ${entry.valueType}` : entry.name;
    const members = entries.filter(member => member.definingClass === entry.ref);
    const content = `# ${label(entry)}

${entry.kind === "group" ? "Topic" : `Package: \`@getaster/${entry.package}\` · Kind: ${entry.kind}`}

${entry.kind === "group" ? "" : `\`\`\`typescript\n${signature}\n\`\`\`\n`}
${entry.deprecated === undefined ? "" : `Deprecated: ${entry.deprecated}\n`}
${description}

${entry.tag ? `Element: \`<${entry.tag}>\`\n` : ""}${entry.defaultValue === undefined ? "" : `Default: \`${entry.defaultValue}\`\n`}${entry.flags ? `Access: ${entry.flags}\n` : ""}${entry.inheritsFrom ? `Extends: ${entry.inheritsFrom}\n` : ""}
${entry.params?.length ? `## Parameters\n\n${entry.params.map(param => `- \`${param.name}\` (\`${param.type}\`${param.optional ? ", optional" : ""}): ${param.description}`).join("\n")}\n` : ""}
${entry.returns ? `## Returns\n\n\`${entry.returns.type}\` ${entry.returns.description}\n` : ""}
${members.length ? `## Members\n\n${members.map(member => `- ${link(member.ref)}`).join("\n")}\n` : ""}
${entry.kind === "group" ? `## Public APIs\n\n${entries.filter(member => !member.definingClass && member.groups.includes(entry.ref)).map(member => `- ${link(member.ref)}`).join("\n")}\n` : ""}
${entry.seeAlso.length ? `## See also\n\n${entry.seeAlso.map(ref => `- ${link(ref)}`).join("\n")}\n` : ""}
Source: \`${entry.source}\`
`;
    writeFileSync(join(api, apiMarkdownFile(entry.ref)), mapMarkdownLinks(content, href => {
      if (href.startsWith("#")) {
        const ref = decodeURIComponent(href.slice(1));
        return known.has(ref) ? apiMarkdownFile(ref) : href;
      }
      if (/^(?:[a-z]+:|\/\/)/i.test(href)) return href;
      if (/^\.\.\/\.\.\/(?:apps|packages|scripts)\//.test(href)) return `https://github.com/GetAster/aster-ui/blob/main/${href.slice(6)}`;
      const topic = /^([\w-]+)\.md$/.exec(href);
      if (topic && known.has(`group:${topic[1]}`)) return apiMarkdownFile(`group:${topic[1]}`);
      // Topic prose is authored relative to the reference page, one directory above.
      return href.startsWith("../") ? `../${href}` : href;
    }));
  }
  writeFileSync(join(out, "reference/index.md"), `# Aster UI API reference\n\nGenerated from the public packages. Follow a topic or API for signatures, members and documentation.\n\n${entries.filter(entry => !entry.definingClass).map(entry => `- [${entry.name} (${entry.kind})](api/${apiMarkdownFile(entry.ref)})`).join("\n")}\n`);
  for (const [name, markdown] of guides) writeFileSync(join(out, "guide", `${name}.md`), mapMarkdownLinks(markdown, href => {
    const match = /^\.\.\/reference\/#(.+)$/.exec(href);
    const ref = match ? decodeURIComponent(match[1]!) : undefined;
    return ref && known.has(ref) ? `../reference/api/${apiMarkdownFile(ref)}` : href;
  }));
  writeFileSync(join(out, "guide/index.md"), `# Aster UI guides\n\n${[...guides].map(([name, markdown]) => `- [${/^# (.+)$/m.exec(markdown)?.[1] ?? name}](${name}.md)`).join("\n")}\n`);
  writeFileSync(join(out, "llms.txt"), agentIndex());
}
