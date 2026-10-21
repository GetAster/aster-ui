import { referenceArticleLinks } from "./paths.ts";
// The API reference viewer: reference.json as a searchable site. Routes are
// hashes (`#class:Grid`); a topic, a class or object, and a member each have a
// page. Search runs here over the entries' names, owners and text.
import { marked } from "marked";
import { enhanceArticle, initDocs, restoreNavigationScroll } from "./docs.ts";

interface Param {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly description: string;
}

interface Entry {
  readonly ref: string;
  readonly kind: string;
  readonly name: string;
  readonly package: string;
  readonly definingClass?: string;
  readonly tag?: string;
  readonly inheritsFrom?: string;
  readonly valueType?: string;
  readonly defaultValue?: string;
  readonly flags?: string;
  readonly params?: readonly Param[];
  readonly returns?: { readonly type: string; readonly description: string };
  readonly description: string;
  readonly seeAlso: readonly string[];
  readonly groups: readonly string[];
  readonly source: string;
  readonly deprecated?: string;
}

const revision = document.querySelector('meta[name="aster-release-revision"]')?.getAttribute("content") ?? "";
const SOURCE = `https://github.com/GetAster/aster-ui/blob/${/^[a-f0-9]{40}$/.test(revision) ? revision : "main"}/`;
const KIND_TITLES: Readonly<Record<string, string>> = {
  attr: "Properties",
  classAttr: "Static properties",
  method: "Methods",
  classMethod: "Static methods",
  event: "Events",
};
const MEMBER_ORDER = ["attr", "classAttr", "method", "classMethod", "event"];
const TOP_KINDS: Readonly<Record<string, string>> = {
  class: "Classes and elements",
  object: "Option and record shapes",
  type: "Types",
  staticMethod: "Functions",
  constant: "Constants",
};

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const label = (e: Entry) => (e.definingClass ? `${e.definingClass.replace(/^\w+:/, "")}.${e.name}` : e.tag ? `${e.name} <${e.tag}>` : e.name);
const link = (ref: string, text?: string) => `<a href="#${encodeURIComponent(ref)}">${esc(text ?? ref.replace(/^\w+:/, ""))}</a>`;

let entries: Entry[] = [];
let byRef = new Map<string, Entry>();
let members = new Map<string, Entry[]>();

/** Markdown with `[[ref]]` and `[[ref|text]]` as links to entries. */
function prose(md: string): string {
  const linked = md.replace(/\[\[([a-zA-Z]+:[^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, ref: string, text?: string) => `[${text ?? (byRef.get(ref) ? label(byRef.get(ref)!) : ref)}](#${encodeURIComponent(ref)})`);
  return marked.parse(linked, { async: false });
}

function summary(e: Entry): string {
  const first = e.description.split(/\n\s*\n/)[0] ?? "";
  return marked.parseInline(first.replace(/\[\[(?:\w+:)?([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, r: string, t?: string) => t ?? r), { async: false });
}

function signature(e: Entry): string {
  const params = e.params?.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ");
  switch (e.kind) {
    case "method":
    case "classMethod":
    case "staticMethod":
      return `${e.name}(${params ?? ""})${e.returns ? `: ${e.returns.type}` : ""}`;
    case "attr":
    case "classAttr":
    case "constant":
      return `${e.flags === "R" ? "readonly " : ""}${e.name}: ${e.valueType ?? "unknown"}`;
    case "type":
      return `type ${e.name} = ${e.valueType ?? ""}`;
    case "event":
      return `"${e.name}" event`;
    default:
      return e.tag ? `<${e.tag}>` : e.name;
  }
}

function sourceLink(e: Entry): string {
  const [path, line] = e.source.split(":");
  return path?.startsWith("docs/") ? "" : `<a href="${SOURCE}${path}#L${line}">Source</a>`;
}

function memberTable(owner: Entry): string {
  const list = members.get(owner.ref) ?? [];
  return MEMBER_ORDER.map((kind) => {
    const of = list.filter((m) => m.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
    if (!of.length) return "";
    return `<h2>${KIND_TITLES[kind]}</h2><table><thead><tr><th scope="col">Name</th><th scope="col">Summary</th></tr></thead><tbody>${of
      .map((m) => `<tr><td>${link(m.ref, m.name)}</td><td>${summary(m)}</td></tr>`)
      .join("")}</tbody></table>`;
  }).join("");
}

function entryPage(e: Entry): string {
  const owner = e.definingClass ? byRef.get(e.definingClass) : undefined;
  const crumbs = [
    ...e.groups.map((g) => link(g, byRef.get(g)?.name ?? g)),
    ...(owner ? [link(owner.ref, owner.name)] : []),
  ].join(" › ");
  const params = e.params?.length
    ? `<h2>Parameters</h2><dl>${e.params.map((p) => `<dt><code>${esc(p.name)}${p.optional ? "?" : ""}: ${esc(p.type)}</code></dt><dd>${p.description ? marked.parseInline(p.description, { async: false }) : ""}</dd>`).join("")}</dl>`
    : "";
  const returns = e.returns ? `<h2>Returns</h2><p><code>${esc(e.returns.type)}</code> ${e.returns.description ? marked.parseInline(e.returns.description, { async: false }) : ""}</p>` : "";
  const facts = [
    e.defaultValue !== undefined ? `<dt>Default</dt><dd><code>${esc(e.defaultValue)}</code></dd>` : "",
    e.inheritsFrom ? `<dt>Extends</dt><dd>${byRef.has(`class:${e.inheritsFrom}`) ? link(`class:${e.inheritsFrom}`) : esc(e.inheritsFrom)}</dd>` : "",
    e.tag ? `<dt>Tag</dt><dd><code>&lt;${esc(e.tag)}&gt;</code></dd>` : "",
    `<dt>Package</dt><dd><code>@getaster/${esc(e.package)}</code></dd>`,
  ].join("");
  const seeAlso = e.seeAlso.length ? `<h2>See also</h2><ul>${e.seeAlso.map((r) => `<li>${link(r, byRef.get(r) ? label(byRef.get(r)!) : r)}</li>`).join("")}</ul>` : "";
  const inGroup = e.kind === "group" ? groupContents(e) : "";
  return `<p class="crumbs">${crumbs}</p>
    <h1 tabindex="-1">${esc(e.kind === "group" ? e.name : label(e))}</h1>
    ${e.kind === "group" ? "" : `<p class="kind">${esc(e.kind)} ${sourceLink(e)}</p><pre class="sig"><code>${esc(signature(e))}</code></pre>`}
    ${e.deprecated !== undefined ? `<p class="deprecated">Deprecated. ${esc(e.deprecated)}</p>` : ""}
    ${e.description ? prose(e.description) : `<p class="missing">Not described yet.</p>`}
    ${params}${returns}
    ${e.kind === "group" ? "" : `<dl class="facts">${facts}</dl>`}
    ${members.has(e.ref) ? memberTable(e) : ""}
    ${inGroup}${seeAlso}`;
}

function groupContents(g: Entry): string {
  const inIt = entries.filter((e) => e.groups.includes(g.ref) && !e.definingClass);
  return Object.entries(TOP_KINDS)
    .map(([kind, title]) => {
      const of = inIt.filter((e) => e.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
      return of.length ? `<h2>${title}</h2><ul class="index">${of.map((e) => `<li>${link(e.ref, label(e))} <span>${summary(e)}</span></li>`).join("")}</ul>` : "";
    })
    .join("");
}

function home(): string {
  return `<p class="eyebrow">Aster UI / Developer documentation</p>
    <h1>Connected data.<br>Considered interfaces.</h1>
    <p class="lead">Build data-rich applications with controls that share records, queries and edits. Explore the model, try the components, and make them your own.</p>
    <div class="doc-actions"><a class="doc-action primary" href="../guide/why-aster.html">Why Aster UI? →</a><a class="doc-action" href="../guide/getting-started.html">Get started</a></div>
    <div class="doc-cards">
    <a class="doc-card" href="../guide/getting-started.html"><span class="card-index">01 / START BUILDING</span><strong>From data to a working screen</strong><span>Run a complete example with a local OData service, then connect your own.</span></a>
    <a class="doc-card" href="../examples/"><span class="card-index">02 / EXPLORE</span><strong>See the components in action</strong><span>Try shared collections, inspect the source, and build the same pattern.</span></a>
    <a class="doc-card" href="../guide/connected-views.html"><span class="card-index">03 / LEARN THE PATTERNS</span><strong>One record. Every view.</strong><span>Connect a grid and form through shared data, selection and an edit model.</span></a>
    <a class="doc-card" href="#class:Grid"><span class="card-index">04 / LOOK IT UP</span><strong>Find the precise API</strong><span>Typed properties, methods, events and defaults, linked to their source.</span></a></div>
    <h2>Built around your data</h2><p>Aster combines a shared data core with accessible custom elements. Start with the data model, choose a view, then compose the workflows your application needs.</p>
    <h2>Explore the reference</h2><ul class="index">${entries.filter(e => e.kind === "group").sort((a,b) => a.name.localeCompare(b.name)).map(t => `<li>${link(t.ref,t.name)} <span>${summary(t)}</span></li>`).join("")}</ul>`;
}

function show(): void {
  const ref = decodeURIComponent(location.hash.slice(1));
  const e = ref ? byRef.get(ref) : undefined;
  const main = $<HTMLElement>("#content");
  main.innerHTML = ref && !e ? `<h1 tabindex="-1">Not found</h1><p>No entry is called <code>${esc(ref)}</code>.</p>` : e ? entryPage(e) : home();
  document.title = e ? `${e.kind === "group" ? e.name : label(e)} · Aster UI reference` : "Aster UI reference";
  if (ref) main.querySelector<HTMLElement>("h1")?.focus();
  referenceArticleLinks(main);
  enhanceArticle();
  for (const a of document.querySelectorAll<HTMLAnchorElement>("#api-nav a")) {
    if (a.hash.slice(1) === encodeURIComponent(e?.definingClass ?? ref)) {
      a.setAttribute("aria-current", "page");
      a.closest("details")?.setAttribute("open", "");
    }
  }
  document.querySelector(".menu-toggle")?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("nav-open");
}

function nav(): string {
  const topics = entries.filter((e) => e.kind === "group").sort((a, b) => a.name.localeCompare(b.name));
  const ungrouped = entries.filter((e) => !e.definingClass && e.kind !== "group" && !e.groups.length);
  const tops = (list: Entry[]) => list.sort((a, b) => a.name.localeCompare(b.name)).map((e) => `<li>${link(e.ref, e.name)}</li>`).join("");
  return `<ul>${topics
    .map((t) => `<li><details><summary>${esc(t.name)}</summary><ul><li>${link(t.ref, "Overview")}</li>${tops(entries.filter((e) => !e.definingClass && e.kind !== "group" && e.groups.includes(t.ref)))}</ul></details></li>`)
    .join("")}${ungrouped.length ? `<li><details><summary>Not in a topic</summary><ul>${tops(ungrouped)}</ul></details></li>` : ""}</ul>`;
}

async function start(): Promise<void> {
  entries = (await (await fetch("reference.json", { cache: "no-cache" })).json()) as Entry[];
  byRef = new Map(entries.map((e) => [e.ref, e]));
  members = new Map();
  for (const e of entries) if (e.definingClass) members.set(e.definingClass, [...(members.get(e.definingClass) ?? []), e]);
  $("#api-nav").innerHTML = nav();
  initDocs();
  addEventListener("hashchange", () => {
    show();
    window.scrollTo(0, 0);
  });
  show();
  restoreNavigationScroll();
}

initDocs();
void start().catch(() => {
  restoreNavigationScroll();
  $("#content").innerHTML = '<h1>Reference unavailable</h1><p>Reload to try again, or <a href="../guide/getting-started.html">open the getting started guide</a>.</p>';
});
