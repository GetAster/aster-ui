// Enforces the package boundaries: no import cycles, and packages depend only downwards.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
/** A package may import only the packages listed for it. */
const ALLOWED: Record<string, readonly string[]> = {
  data: [],
  mock: ["data"],
  elements: ["data"],
  "elements-preview": ["data", "elements"],
  react: ["data", "elements"],
  "app:aster": ["data", "elements", "elements-preview", "mock"],
};

const IMPORT = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Packages by directory name; applications as `app:<name>`. Nothing may import an application. */
function packageOf(path: string): string | undefined {
  const rel = relative(ROOT, path).split("/");
  if (rel[0] === "packages") return rel[1];
  if (rel[0] === "apps") return `app:${rel[1]}`;
  return undefined;
}

const problems: string[] = [];
const graph = new Map<string, string[]>();

const units = [
  ...readdirSync(join(ROOT, "packages")).map((name) => ({ pkg: name, src: join(ROOT, "packages", name, "src") })),
  ...readdirSync(join(ROOT, "apps")).map((name) => ({ pkg: `app:${name}`, src: join(ROOT, "apps", name, "src") })),
];
for (const { pkg, src } of units) {
  if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const file of files(src)) {
    const edges: string[] = [];
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = m[1] ?? m[2]!;
      const target = spec.startsWith("@getaster/")
        ? spec.slice("@getaster/".length).split("/")[0]!
        : spec.startsWith(".")
          ? packageOf(resolve(dirname(file), spec))
          : undefined;
      if (spec.startsWith(".")) edges.push(resolve(dirname(file), spec));
      if (target && target !== pkg && !ALLOWED[pkg]?.includes(target)) {
        problems.push(`${relative(ROOT, file)}: ${pkg} may not import ${target} (${spec})`);
      }
    }
    graph.set(file, edges);
  }
}

const state = new Map<string, "visiting" | "done">();
function visit(file: string, path: string[]): void {
  if (state.get(file) === "done") return;
  if (state.get(file) === "visiting") {
    const cycle = path.slice(path.indexOf(file)).concat(file);
    problems.push(`cycle: ${cycle.map((f) => relative(ROOT, f)).join(" → ")}`);
    return;
  }
  state.set(file, "visiting");
  for (const next of graph.get(file) ?? []) if (graph.has(next)) visit(next, [...path, file]);
  state.set(file, "done");
}
for (const file of graph.keys()) visit(file, []);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`dependency rules hold across ${graph.size} files`);
