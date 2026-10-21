import { marked } from "marked";
import { esc } from "../../shared/dom.ts";
import type { Entry } from "./types.ts";

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

export const label = (e: Entry) => (e.definingClass ? `${e.definingClass.replace(/^\w+:/, "")}.${e.name}` : e.tag ? `${e.name} <${e.tag}>` : e.name);
const link = (ref: string, text?: string) => `<a href="#${encodeURIComponent(ref)}">${esc(text ?? ref.replace(/^\w+:/, ""))}</a>`;

export function referencePages(entries: Entry[], revision = "", assets = "../docs-assets/") {
  const SOURCE = `https://github.com/GetAster/aster-ui/blob/${/^[a-f0-9]{40}$/.test(revision) ? revision : "main"}/`;
  const byRef = new Map(entries.map(entry => [entry.ref, entry]));
  const members = new Map<string, Entry[]>();
  for (const entry of entries) if (entry.definingClass) members.set(entry.definingClass, [...(members.get(entry.definingClass) ?? []), entry]);
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
      <div class="doc-cards doc-photo-cards">
      <a class="doc-card doc-photo-card" href="../guide/getting-started.html"><img src="${assets}photography/building-screen.jpg" alt="" width="960" height="540"><div><strong>From data to a working screen</strong><span>Run a complete example with a local OData service, then connect your own.</span></div></a>
      <a class="doc-card doc-photo-card" href="../examples/"><img src="${assets}photography/interface-components.jpg" alt="" width="960" height="540"><div><strong>See the components in action</strong><span>Try shared collections, inspect the source, and build the same pattern.</span></div></a>
      <a class="doc-card doc-photo-card" href="../guide/connected-views.html"><img src="${assets}photography/connected-views.jpg" alt="" width="960" height="540"><div><strong>Connect a grid, form and detail view</strong><span>Share records, selection and edits across a complete workflow.</span></div></a>
    </div>
    <p class="photo-credits">Photography: <a href="https://unsplash.com/photos/source-code-screengrab-JNz9bQD3Oio">Florian Olivo</a>, <a href="https://unsplash.com/@alvarordesign">Alvaro Reyes</a> and <a href="https://unsplash.com/photos/two-people-drawing-on-whiteboard-26MJGnCM0Wc">Kaleidico</a> / Unsplash.</p>
    <h2>Built around your data</h2><p>Aster combines a shared data core with accessible custom elements. Start with the data model, choose a view, then compose the workflows your application needs.</p>
      <h2>Explore the reference</h2><ul class="index">${entries.filter(e => e.kind === "group").sort((a,b) => a.name.localeCompare(b.name)).map(t => `<li>${link(t.ref,t.name)} <span>${summary(t)}</span></li>`).join("")}</ul>`;
  }

  function nav(): string {
    const topics = entries.filter((e) => e.kind === "group").sort((a, b) => a.name.localeCompare(b.name));
    const ungrouped = entries.filter((e) => !e.definingClass && e.kind !== "group" && !e.groups.length);
    const tops = (list: Entry[]) => list.sort((a, b) => a.name.localeCompare(b.name)).map((e) => `<li>${link(e.ref, e.name)}</li>`).join("");
    return `<ul>${topics
      .map((t) => `<li><details><summary>${esc(t.name)}</summary><ul><li>${link(t.ref, "Overview")}</li>${tops(entries.filter((e) => !e.definingClass && e.kind !== "group" && e.groups.includes(t.ref)))}</ul></details></li>`)
      .join("")}${ungrouped.length ? `<li><details><summary>Not in a topic</summary><ul>${tops(ungrouped)}</ul></details></li>` : ""}</ul>`;
  }

  return { byRef, entryPage, home, nav };
}
