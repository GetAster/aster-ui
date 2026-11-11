#!/usr/bin/env bun
// aster-lint [--theme <file>]… [--allowances] [path…]: checks an application's
// templates, HTML and CSS for native controls Aster provides as elements, and
// for CSS that restyles Aster or bypasses its theme tokens. Rules and the
// aster-allow comment that silences one are in docs/guide/aster-lint.md.
// Exits 1 on any finding, 2 on a usage error.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { kindOf, lintSource, type Allowance, type Finding } from "./lint.ts";

const SKIP = new Set(["node_modules", "dist", "build", "coverage", "out"]);

function usage(message: string): never {
  console.error(`${message}\nusage: aster-lint [--theme <file>]… [--allowances] [path…]`);
  process.exit(2);
}

const args = process.argv.slice(2);
const themes = new Set<string>();
const paths: string[] = [];
let listAllowances = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  switch (arg) {
    case "--theme": {
      const file = args[++i];
      if (!file) usage("--theme needs a file");
      themes.add(resolve(file));
      break;
    }
    case "--allowances": listAllowances = true; break;
    case "--help": case "-h": usage("aster-lint checks templates, HTML and CSS against the Aster catalogue.");
    default:
      if (arg.startsWith("-")) usage(`unknown option ${arg}`);
      paths.push(arg);
  }
}
if (paths.length === 0) paths.push(".");

function* files(path: string): Generator<string> {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) usage(`no such file or directory: ${path}`);
  if (stat.isFile()) { yield path; return; }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) yield* files(child);
    else if (kindOf(entry.name)) yield child;
  }
}

const findings: Finding[] = [];
const allowances: Allowance[] = [];
let checked = 0;
for (const root of paths) for (const file of files(root)) {
  const name = relative(process.cwd(), file) || file;
  const report = lintSource(name, readFileSync(file, "utf8"), { theme: themes.has(resolve(file)) });
  if (!report) continue;
  checked++;
  findings.push(...report.findings);
  allowances.push(...report.allowances);
}
for (const f of findings) console.log(`${f.file}:${f.line}:${f.column}  ${f.rule}  ${f.message}`);
if (listAllowances) for (const a of allowances) console.log(`allowed ${a.file}:${a.line}  ${a.rules.join(", ")}: ${a.reason || "(no reason)"}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
console.log(`${findings.length ? "✗" : "✓"} ${plural(checked, "file")} checked, ${plural(findings.length, "problem")}, ${plural(allowances.length, "allowance")}`);
process.exit(findings.length ? 1 : 0);
