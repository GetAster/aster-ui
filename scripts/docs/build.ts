// Builds dist-local/reference/reference.json: the extracted entries with the
// text of docs/reference/*.md merged in.
//
// A reference file is Markdown. Its text before the first `## ` heading is a
// topic (`group:<file name>`), titled by its `# ` heading; every entry the file
// documents joins that topic. Each `## kind:Owner.name` section adds its text
// to that entry, after the code's own summary. Fenced code blocks in a section
// are its examples; `[[kind:Owner.name]]` links are its see-also links, and
// must name an entry, as must every heading. `--check` fails on a dangling
// heading or link, and lists public entries with no description.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extract, type Entry } from "./extract.ts";

const ROOT = resolve(import.meta.dir, "../..");
const REFERENCE = join(ROOT, "docs/reference");
const OUT = join(ROOT, "dist-local/reference");

const LINK = /\[\[([a-zA-Z]+:[^\]|]+)(?:\|[^\]]+)?\]\]/g;

interface Section {
  readonly ref: string;
  readonly text: string;
  readonly line: number;
}

function sections(md: string): { title: string; intro: string; sections: Section[] } {
  const lines = md.split("\n");
  const title = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? "";
  const out: Section[] = [];
  const intro: string[] = [];
  let current: { ref: string; line: number; body: string[] } | undefined;
  let fence = false;
  lines.forEach((l, i) => {
    if (l.startsWith("```")) fence = !fence;
    const heading = !fence && /^## ([a-zA-Z]+:\S+)\s*$/.exec(l);
    if (heading) {
      if (current) out.push({ ref: current.ref, line: current.line, text: current.body.join("\n").trim() });
      current = { ref: heading[1]!, line: i + 1, body: [] };
    } else if (current) current.body.push(l);
    else if (!l.startsWith("# ")) intro.push(l);
  });
  if (current) out.push({ ref: current.ref, line: current.line, text: current.body.join("\n").trim() });
  return { title, intro: intro.join("\n").trim(), sections: out };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Reads what a section states in prose into the entry's own fields: a
 * parameter's `- \`name\`: …` item, a paragraph starting "Returns" or
 * "Resolves", and "Default \`x\`" or "defaults to \`x\`". The code's own
 * values stay where it has them.
 */
function structured(entry: Mutable<Entry>, text: string): void {
  if (entry.params) {
    entry.params = entry.params.map((p) => {
      if (p.description) return p;
      const m = new RegExp(`^- \`${escape(p.name)}\`[^:\n]*: (.+(?:\n {2,}.+)*)`, "m").exec(text);
      return m ? { ...p, description: m[1]!.replace(/\s*\n\s*/g, " ").trim() } : p;
    });
  }
  if (entry.returns && !entry.returns.description) {
    const m = /^((?:Returns|Resolves)\b.+(?:\n(?!\n).+)*)/m.exec(text);
    if (m) entry.returns = { ...entry.returns, description: m[1]!.replace(/\s*\n\s*/g, " ").trim() };
  }
  if (entry.defaultValue === undefined) {
    const m = /\b(?:Default|[Dd]efaults to) `([^`]*)`/.exec(text);
    if (m) entry.defaultValue = m[1]!;
  }
}

export function build(): { entries: Entry[]; problems: string[]; undocumented: Entry[] } {
  const entries = extract();
  const byRef = new Map(entries.map((e) => [e.ref, e]));
  const problems: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(REFERENCE).filter((f) => f.endsWith(".md")).sort();
  } catch {
    // No reference files yet: the code's summaries only.
  }
  const groups: Entry[] = [];
  for (const file of files) {
    const group = `group:${file.replace(/\.md$/, "")}`;
    const { title, intro, sections: parts } = sections(readFileSync(join(REFERENCE, file), "utf8"));
    const topic: Entry = { ref: group, kind: "group", name: title || group, package: "docs", description: intro, seeAlso: [], examples: [], groups: [], source: `docs/reference/${file}:1` };
    groups.push(topic);
    for (const s of parts) {
      const entry = byRef.get(s.ref) as Mutable<Entry> | undefined;
      if (!entry) {
        problems.push(`docs/reference/${file}:${s.line}: ${s.ref} isn't a public entry`);
        continue;
      }
      if (s.text) entry.description = [entry.description, s.text].filter(Boolean).join("\n\n");
      structured(entry, s.text);
      for (const m of s.text.matchAll(/```[\s\S]*?```/g)) entry.examples.push(m[0]);
      if (!entry.groups.includes(group)) entry.groups.push(group);
    }
  }
  const known = new Set([...byRef.keys(), ...groups.map((g) => g.ref)]);
  for (const e of [...entries, ...groups]) {
    for (const m of e.description.matchAll(LINK)) {
      const ref = m[1]!;
      if (!known.has(ref)) problems.push(`${e.source}: [[${ref}]] in ${e.ref} names nothing`);
      else if (!e.seeAlso.includes(ref)) e.seeAlso.push(ref);
    }
  }
  const all = [...entries, ...groups];
  return { entries: all, problems, undocumented: entries.filter((e) => !e.description.trim()) };
}

if (import.meta.main) {
  const { entries, problems, undocumented } = build();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "reference.json"), JSON.stringify(entries, null, 1));
  for (const p of problems) console.error(p);
  console.log(`${entries.length} entries; ${undocumented.length} public entries with no description`);
  if (process.argv.includes("--list")) for (const e of undocumented) console.log(`  ${e.ref}  (${e.source})`);
  if (problems.length) process.exit(1);
}
