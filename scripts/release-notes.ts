// release-notes.ts <version>: prints that version's section of CHANGELOG.md,
// without its heading, as the notes for the GitHub release. Exits 1 when the
// changelog has no section for the version. GitHub renders a single line break
// in release notes as a break, so wrapped lines are joined; code blocks are kept.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The body of the `## <version>` section, or undefined when there is none. */
export function releaseNotes(changelog: string, version: string): string | undefined {
  const lines = changelog.split("\n");
  const start = lines.findIndex(line => line.trim() === `## ${version}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const body = unwrap(lines.slice(start + 1, end < 0 ? undefined : end)).join("\n").trim();
  return body || undefined;
}

/** Joins each paragraph's and list item's wrapped lines onto one line. */
function unwrap(lines: readonly string[]): string[] {
  const out: string[] = [];
  let fenced = false;
  let open = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const startsBlock = fenced || /^\s*```/.test(line) || line.trim() === "" || /^\s*(?:#|[-*+] |\d+\. |\||>)/.test(line);
    if (open && !startsBlock) out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
    open = !fenced && line.trim() !== "" && !/^\s*(?:#|```|\|)/.test(line);
  }
  return out;
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) throw new Error("usage: release-notes.ts <version>");
  const notes = releaseNotes(readFileSync(resolve(import.meta.dirname, "../CHANGELOG.md"), "utf8"), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
