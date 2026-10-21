import type { SearchItem } from "../src/features/search/index.ts";

/** Keep searchable prose and identifiers without downloading API signatures twice. */
export function searchText(value: string): string {
  return value.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]*>/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$1 $2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`#*_>|]/g, "").replace(/\s+/g, " ").trim();
}

export function searchItems(guides: readonly SearchItem[], api: readonly { name: string; definingClass?: string; ref: string; description: string; kind: string }[]): SearchItem[] {
  return [...guides.map(item => ({ ...item, name: searchText(item.name), description: searchText(item.description) })), ...api.map(entry => ({
    name: entry.definingClass ? `${entry.definingClass.replace(/^\w+:/, "")}.${entry.name}` : entry.name,
    description: searchText(entry.description),
    kind: entry.kind === "group" ? "Topic" : "API",
    href: `../reference/#${encodeURIComponent(entry.ref)}`,
  }))];
}

/** Search examples by their short names as well as the published page titles. */
export function exampleSearchItems(examples: readonly { id: string; name: string; description: string; keywords?: readonly string[] }[]): SearchItem[] {
  return examples.map(example => ({
    name: example.name,
    description: example.description,
    keywords: [example.id, ...(example.keywords ?? [])],
    href: `../examples/${example.id}.html`,
    kind: "Example",
  }));
}
