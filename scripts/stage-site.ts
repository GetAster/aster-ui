// Public showcase contents are explicit: app, examples, library and API reference.
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Stages into an empty directory; internal design/requirements/handoff docs stay outside it. */
export function stageSite(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  if (readdirSync(destination).length) throw new Error(`Showcase staging directory is not empty: ${destination}`);
  cpSync(join(source, "aster"), destination, { recursive: true });
  const index = join(destination, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/(name=["']?aster-library-root["']?\s+content=["']?)\.\.\//, "$1./"));
  for (const directory of ["lib", "playground", "reference", "guide", "docs-assets", "examples"]) cpSync(join(source, directory), join(destination, directory), { recursive: true });
  cpSync(join(source, "site.css"), join(destination, "site.css"));
}

if (import.meta.main) stageSite(resolve(process.argv[2] ?? "dist-local"), resolve(process.argv[3] ?? "dist-local/showcase"));
