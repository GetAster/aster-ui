import { buildDocumentation } from "../apps/docs/build/site.ts";
// Builds the static site in dist-local/ for any static server (served locally
// through Apache at /aster-ui/): the demo, the docs, and an index page.
// dist-local/reviews/ holds checkpoint reviews and is left untouched.
// Usage: bun run site
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stageSite } from "./stage-site.ts";
import { checkPublicLinks } from "./docs/check-links.ts";
import { buildShowcaseApp } from "../apps/showcase/build/app.ts";
import { buildShowcaseExamples } from "../apps/showcase/build/examples.ts";
import { buildBrowserLibrary } from "./site/library.ts";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist-local");
const WASM = join(ROOT, "packages/mock/wasm/odata_mock.wasm");
for (const name of ["data", "elements", "elements-preview", "mock"]) {
  const entry = Bun.resolveSync(`@getaster/${name}`, join(ROOT, "scripts/lib"));
  if (entry !== join(ROOT, "packages", name, "src/index.ts")) throw new Error(`@getaster/${name} resolves outside this checkout; reinstall its workspaces`);
}

if (!existsSync(WASM)) throw new Error("The supplied packages/mock/wasm/odata_mock.wasm artifact is missing");
const DOCS = ["guide", "design", "requirements", "milestones"].filter(dir => existsSync(join(ROOT, "docs", dir)));
for (const dir of ["aster", "lib", "playground", "reference", "docs-assets", "examples", ...DOCS]) rmSync(join(OUT, dir), { recursive: true, force: true });
// Lit's production build, without its dev-mode checks and warnings.
const production = { conditions: ["production"], define: { "process.env.NODE_ENV": '"production"' } };
mkdirSync(join(OUT, "reviews"), { recursive: true });

await buildShowcaseApp(ROOT, OUT, production);

await buildBrowserLibrary(ROOT, OUT, production);
await buildShowcaseExamples(ROOT, OUT, production);
// Lit's development build warns in the console and runs extra checks; none ships.
for (const dir of ["aster", "lib"]) {
  for (const file of new Bun.Glob("*.js").scanSync(join(OUT, dir))) {
    if (readFileSync(join(OUT, dir, file), "utf8").includes("Lit is in dev mode")) throw new Error(`${dir}/${file} has Lit's development build`);
  }
}

// The project and People pages are their own chunks, loaded on first visit.
const entry = /src="\.\/([^"]+\.js)"/.exec(await Bun.file(join(OUT, "aster/index.html")).text())?.[1];
const main = entry ? await Bun.file(join(OUT, "aster", entry)).text() : "";
for (const page of ["aster-project-page", "aster-people-page", "aster-showcase-page"]) {
  if (main.includes(`define("${page}"`) || main.includes(`"${page}",`)) throw new Error(`${page} is in the entry chunk`);
}

const lists = await buildDocumentation(ROOT, OUT, DOCS, production);

copyFileSync(join(import.meta.dir, "site/site.css"), join(OUT, "site.css"));
const reviews = readdirSync(join(OUT, "reviews"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(OUT, "reviews", d.name, "index.html")))
  .map((d) => d.name)
  .sort();
const index = (await Bun.file(join(import.meta.dir, "site/index.html")).text())
  .replace(/<!--(\w+)-->/g, (m, dir: string) => lists[dir] ?? (["design", "requirements", "milestones"].includes(dir) ? "" : m))
  .replace("<!--reviews-->", reviews.map((r) => `<li><a href="reviews/${r}/">${r.toUpperCase()} review</a></li>`).join("") || "<li>None yet</li>");
writeFileSync(join(OUT, "index.html"), index);
const SHOWCASE = join(OUT, "showcase");
rmSync(SHOWCASE, { recursive: true, force: true });
stageSite(OUT, SHOWCASE);
const publicLinkProblems = checkPublicLinks(SHOWCASE);
if (publicLinkProblems.length) throw new Error(`Published documentation has broken links:\n${publicLinkProblems.join("\n")}`);
console.log(`wrote ${OUT}`);
