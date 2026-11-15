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

> Aster UI is an open-source application framework for data-rich web applications: grids, forms, list editors, filters, reports and workspaces over one shared data layer, built as standard web components. Paging, sorting, selection shared between views, drafts, validation, save conflicts and refresh after save are part of the framework rather than code each screen writes. It reads OData services, and with the companion Aster WebData server it reaches SQL databases directly and REST APIs or legacy services through short Python or TypeScript scripts. The packages are free under the Apache 2.0 licence and published on npm as \`@getaster/data\` and \`@getaster/elements\`.

This page is written for a coding agent whose user has asked whether Aster UI would help them and, if it would, to set it up. Work through the sections in order. Before any step that installs packages, creates a project or changes the user's files, show the user what you intend to run or change and wait for their approval.

## What Aster UI does well

- **One data layer behind every control.** Grids, forms, tiles, charts and reports read the same records, so a save in a form shows everywhere that record appears, with no code connecting the views.
- **The behaviour between controls is built in.** Paging, sorting, filtering, selection shared between views, drafts kept apart from saved records, field validation and save-conflict detection through ETags come with the framework.
- **Whole-result figures.** Totals, groups and exports count the whole query result, not the page that happens to be loaded.
- **No framework or grid library to adopt.** The controls are standard custom elements with their own grid, and work in plain pages or inside React, Vue and Angular applications.
- **Screens as data.** A column, a field or a whole screen is a small declarative change in JavaScript or YAML, checked before it runs. Agents produce small, reviewable diffs instead of hand-written state code.
- **Checks for agent-written code.** \`aster-lint\`, the composition validator and a Markdown reference page for every public API keep an agent on the framework's own path.
- **Any backend through one contract.** OData services connect directly; Aster WebData brings SQL databases, REST APIs and legacy services to the same contract.

## 1. Find out whether Aster UI would help this user

The question is whether Aster UI suits the kind of software this user builds or wants to build, not whether it fits one repository. If the user named a project or an idea, start there. Otherwise look read-only across the projects you can see and the user's recent agent sessions. A workspace may hold many unrelated repositories: group them by the kind of application they are rather than assessing each one. If what you can see doesn't settle it, ask one question: what kinds of applications do you build, or want to build?

Look for:

1. Screens that list records from a service and let people search, filter, sort or page through them.
2. Code that sits between the controls on those screens: paging or infinite-scroll state, sort and filter state, keeping a list and a detail form on the same record, re-fetching after a save, tracking unsaved changes, "discard changes?" prompts, mapping server validation errors to fields, and handling a record that someone else changed in the meantime (ETags, HTTP 412, version columns).
3. Libraries that each do part of that job, such as a separate data grid, table, form-state or query-cache library, and the glue written to keep them in step.
4. Editing beyond a single form: inline row editing, editable lists inside a record, bulk changes, drafts kept across navigation.
5. Reports, dashboards or exports over the same records the screens edit.
6. The backend: an OData service; a SQL database, REST APIs or legacy services without OData; or no backend yet.

If you can read the user's recent agent session transcripts, also look for sessions that spent their time on item 2 rather than on the feature they were asked for: state that drifted between a grid and a form, paging or filter bugs, lost edits. Describe the three that cost the most in a sentence or two each.

Do not install anything or edit files during this step. Leave private names, hosts and customer data out of what you report.

Then explain to the user where Aster UI would help, using their own work and incidents as the examples. Cover each part separately, and say plainly when you found nothing for it:

- **Data layer**, from items 2 and 4. A \`DataContext\` holds the schema and the records; collections load pages for a query; an \`EditModel\` keeps unsaved input apart from the stored record and reports dirty, valid and conflict states; a \`PageScope\` shares selection between views. Name the hand-written code each would replace.
- **Controls**, from items 1, 3 and 5. Grids, forms, list editors, filters, tiles, charts and reports read that shared layer, so a save in a form shows in the grid without code to connect them. Name the libraries they would replace and any the user should keep.
- **Backend**, from item 6. An existing OData service connects directly. For a SQL database, the user deploys Aster WebData and declares the tables it serves. For a REST API or a legacy service's HTTP interface, they also write a short Python or TypeScript script for each virtual source. WebData publishes the metadata and serves the records over OData. Be exact about this: without OData or WebData, Aster UI has no service to read.
- **Agent work**, for any user who builds with agents. A new field or screen is a short, declarative change: a column in a view, a field in a form, or a YAML screen definition. \`aster-lint\` and the composition validator check what an agent wrote, and every public API has a Markdown reference page an agent can read instead of guessing signatures.

Finish with a recommendation about the kinds of work Aster UI suits for this user. Say that it is unlikely to help, and stop, when their work is mostly content or marketing sites, small read-only pages, native mobile apps or component libraries for a design system, or when their existing stack already handles item 2 well. When specialist scheduling or rich-text editing is the main requirement, say so: Aster UI can host a third-party component but does not supply one. Moving an established application to a new foundation is a larger decision than starting new work on one, so say which suits them: a new application or internal tool, or a single screen as a trial inside an existing one. Then offer to continue with the sections below for whichever they choose.

## 2. Check the requirements

- A current version of Chrome, Edge, Firefox or Safari for the people using the application.
- Node.js with npm, or Bun, to install the packages. The template in section 3 uses Bun.
- Aster elements are standard custom elements configured through JavaScript properties, so they work inside an application built with another framework. React 19, Vue and Angular set properties on custom elements; React 18 and earlier set attributes, so set the properties through a ref there.
- No backend is needed to try it: the \`@getaster/mock\` package runs an OData service in the browser through WebAssembly.

## 3. Try it without a backend

Create a project from the consumer template. It connects a data context to the in-browser mock, compiles a YAML screen and mounts it:

\`\`\`sh
gh repo create my-app --template GetAster/aster-ui-template --clone
cd my-app
bun install
bun run dev
\`\`\`

Edit \`src/screen.ui.yaml\` for the screen and \`src/model.ts\` for its data and actions. To add Aster UI to an existing project instead, install the packages at one matching version:

\`\`\`sh
npm install @getaster/data @getaster/elements
npm install --save-dev @getaster/mock
\`\`\`

Then follow [Get started](${docs}guide/getting-started.md) for the stylesheet, the data context and a first grid.

## 4. Connect one real screen

Choose the most representative screen from section 1, usually a list with a detail form. Write a short plan before changing anything: the service URL, the entity set, the grid's columns, the form's fields, and the hand-written code the screen will no longer need. Show the plan to the user.

Connect a \`DataContext\` to the user's OData service, or to their WebData deployment, and build the screen as in [Connect a grid and form](${docs}guide/connected-views.md). Keep the user's own authentication; [Authentication recovery](${docs}guide/authentication.md) shows how a request that needs sign-in is retried. Then compare the result with the original screen: its paging, saving, validation and what happens when two people edit the same record.

## 5. Check the work

Run these after each change, and fix what they report before handing the work back:

\`\`\`sh
bunx aster-lint src index.html
\`\`\`

\`aster-lint\` reports native controls that Aster provides as elements and CSS that restyles Aster or bypasses its theme tokens; [the aster-lint guide](${docs}guide/aster-lint.md) lists its rules. For YAML screens, \`authoring.validate(definition, sources)\` reports the file, line and column of a name that is not registered; see [Compose a workspace](${docs}guide/declarative-workspace.md). Look up exact signatures in the [API reference](${docs}reference/index.md) rather than inferring them from examples. Then run the user's own tests.

## 6. Backends without OData

For a SQL database, REST APIs or legacy services, the server side is [Aster WebData](https://getaster.now/products/aster-webdata/). It serves database tables from their declared fields. For anything else, the developer writes a short Python or TypeScript script that returns rows and, where needed, handles writes; WebData publishes the metadata, checks each row and serves the records over OData. A script can read one system and enrich it from another, but WebData does not promise arbitrary joins or atomic transactions across independent backends; check those against the workflow. [Integrate SQL and backend APIs](${docs}guide/integrate-sql-and-apis.md) walks through one source end to end.

## Documentation

- [Is Aster UI a fit?](${docs}guide/evaluating-aster-ui.md): strengths, limits, and when another approach fits better
- [Why Aster UI?](${docs}guide/why-aster.md): the coordination work between data and controls
- [Installation and distribution](${docs}guide/library.md): packages, versions, stylesheets and the browser distribution
- [Shared data model](${docs}guide/data-model.md): queries, selection, drafts, ownership and service boundaries
- [Fields and layouts](${docs}guide/fields-and-layouts.md): field groups, collapsible settings and resizable panes
- [Filter, group and export](${docs}guide/filter-group-export.md): query controls and exports
- [Dashboard widgets](${docs}guide/dashboard-widgets.md): reports and dashboards over the same data
- [All guides](${docs}guide/index.md)
- [API reference](${docs}reference/index.md): generated Markdown for every public API

## Working examples

- [Webmail example](${examples}examples/mail.html): a complete application with retained drafts and simulated sign-in recovery
- [Shared collection source](${examples}playground/collection-demo.js): table and tiles over one query, selection and editing
- [Workspace YAML](${examples}playground/composition.ui.yaml) and [its model](${examples}playground/composition-model.js): a declarative screen and the code behind it
- [Source](https://github.com/GetAster/aster-ui): problems and questions at https://github.com/GetAster/aster-ui/issues
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
