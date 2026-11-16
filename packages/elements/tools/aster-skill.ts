#!/usr/bin/env bun
// aster-skill [install|check] [--dir <project>]: places the Aster UI agent skill
// in a project, at .claude/skills/aster-ui for Claude Code and
// .agents/skills/aster-ui for Codex and other agents that read that folder.
// The skill ships in this package, so installing it after an upgrade keeps it
// matched to the installed version. A symbolic link at either location marks a
// copy the user manages, and it is left alone. Exits 1 when check finds a
// missing or stale copy, 2 on a usage error.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../skill/aster-ui");
const version = (JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")) as { version: string }).version;
const TARGETS = [".claude/skills/aster-ui", ".agents/skills/aster-ui"];

function usage(message: string): never {
  console.error(`${message}\nusage: aster-skill [install|check] [--dir <project>]`);
  process.exit(2);
}

/** The skill's files, relative to its folder, with the installed version recorded in SKILL.md. */
function skillFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (lstatSync(path).isDirectory()) walk(path);
      else files.set(relative(source, path), readFileSync(path, "utf8"));
    }
  };
  walk(source);
  const skill = files.get("SKILL.md");
  if (skill === undefined) throw new Error(`The skill is missing from ${source}`);
  files.set("SKILL.md", `${skill.trimEnd()}\n\n<!-- Installed by aster-skill from @getaster/elements ${version}. Run it again after upgrading. -->\n`);
  return files;
}

/** Whether a path, or a folder above it inside the project, is a symbolic link the user manages. */
function linked(project: string, target: string): boolean {
  let path = join(project, target);
  while (path.startsWith(project) && path !== project) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) return true;
    path = dirname(path);
  }
  return false;
}

const args = process.argv.slice(2);
let command = "install";
let project = process.cwd();
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  switch (arg) {
    case "install": case "check": command = arg; break;
    case "--dir": {
      const dir = args[++i];
      if (!dir) usage("--dir needs a path");
      project = resolve(dir);
      break;
    }
    case "--help": case "-h": usage("aster-skill places the Aster UI agent skill in a project.");
    default: usage(`unknown argument ${arg}`);
  }
}

const files = skillFiles();
let stale = 0;
for (const target of TARGETS) {
  const folder = join(project, target);
  if (linked(project, target)) {
    console.log(`${target}: a symbolic link, left as it is`);
    continue;
  }
  const current = [...files].every(([name, text]) => existsSync(join(folder, name)) && readFileSync(join(folder, name), "utf8") === text);
  if (command === "check") {
    if (!current) stale++;
    console.log(`${target}: ${current ? "current" : "missing or out of date"} (${version})`);
    continue;
  }
  for (const [name, text] of files) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), text);
  }
  console.log(`${target}: ${current ? "already current" : "installed"} (${version})`);
}
if (stale) {
  console.error("Run aster-skill to install the skill for this version.");
  process.exit(1);
}
