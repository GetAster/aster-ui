// Builds a Custom Elements Manifest (schema 2.1) for one package from the
// extracted API, so editors and tools such as Storybook can list the package's
// elements with their properties, methods and events. Elements are configured
// through properties, never attributes, so the manifest declares no attributes.
import type { Entry } from "./extract.ts";

interface Declaration {
  readonly kind: "class";
  readonly name: string;
  readonly tagName: string;
  readonly customElement: true;
  readonly description: string;
  readonly superclass?: { readonly name: string };
  readonly members: readonly object[];
  readonly events: readonly object[];
}

/** Reference prose links relative to the docs reference page; guides and the reference live under /docs/. */
function absolute(href: string): string {
  if (/^(?:[a-z]+:|#)/i.test(href)) return href;
  const url = new URL(href, "https://ui.getaster.now/reference/");
  if (/^\/(?:guide|reference)\//.test(url.pathname)) url.pathname = `/docs${url.pathname}`;
  return url.href;
}

/** `[[class:Grid]]` and `[[class:Grid|the grid]]` become plain names for tools that show raw text. */
function plain(text: string, names: ReadonlyMap<string, string>): string {
  return text
    .replace(/\[\[([a-zA-Z]+:[^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, ref: string, label?: string) => label ?? names.get(ref) ?? ref.split(":")[1]!)
    .replace(/(\[[^\]\n]*\]\()([^\s)]+)(\))/g, (_m, before: string, href: string, after: string) => `${before}${absolute(href)}${after}`)
    .trim();
}

export function customElementsManifest(entries: readonly Entry[], pkg: string, module = "dist/index.js"): object {
  const names = new Map(entries.map(entry => [entry.ref, entry.definingClass ? `${entry.definingClass.split(":")[1]}.${entry.name}` : entry.name]));
  const declarations: Declaration[] = entries
    .filter(entry => entry.package === pkg && entry.kind === "class" && entry.tag && !entry.definingClass)
    .sort((a, b) => a.tag!.localeCompare(b.tag!))
    .map(element => {
      const own = entries.filter(member => member.definingClass === element.ref && !member.deprecated);
      const members = own.filter(member => member.kind === "attr" || member.kind === "method").map(member => member.kind === "attr"
        ? {
            kind: "field",
            name: member.name,
            ...(member.valueType ? { type: { text: member.valueType } } : {}),
            ...(member.defaultValue === undefined ? {} : { default: member.defaultValue }),
            ...(member.flags === "R" ? { readonly: true } : {}),
            description: plain(member.description, names),
          }
        : {
            kind: "method",
            name: member.name,
            description: plain(member.description, names),
            ...(member.params?.length ? { parameters: member.params.map(param => ({ name: param.name, type: { text: param.type }, ...(param.optional ? { optional: true } : {}), description: plain(param.description, names) })) } : {}),
            ...(member.returns ? { return: { type: { text: member.returns.type } } } : {}),
          });
      const events = own.filter(member => member.kind === "event").map(event => ({
        name: event.name,
        ...(event.valueType ? { type: { text: event.valueType } } : {}),
        description: plain(event.description, names),
      }));
      return {
        kind: "class",
        name: element.name,
        tagName: element.tag!,
        customElement: true,
        description: plain(element.description, names),
        ...(element.inheritsFrom ? { superclass: { name: element.inheritsFrom.replace(/^[a-zA-Z]+:/, "") } } : {}),
        members,
        events,
      };
    });
  return {
    schemaVersion: "2.1.0",
    readme: "README.md",
    modules: [{
      kind: "javascript-module",
      path: module,
      declarations,
      exports: declarations.flatMap(declaration => [
        { kind: "js", name: declaration.name, declaration: { name: declaration.name, module } },
        { kind: "custom-element-definition", name: declaration.tagName, declaration: { name: declaration.name, module } },
      ]),
    }],
  };
}
