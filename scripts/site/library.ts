import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export async function buildBrowserLibrary(ROOT: string, OUT: string, production: { conditions: string[]; define: Record<string, string> }): Promise<void> {
    const WASM = join(ROOT, "packages/mock/wasm/odata_mock.wasm");
  // The library: aster-ui.js (data and elements, lit-html and signals inside),
  // aster-ui-mock.js, the styles and themes, declarations, and the demo's data
  // for the playground.
  const LIB = join(OUT, "lib");
  await buildBrowserModules(ROOT, LIB, production);
  if (existsSync(join(ROOT, "packages/data-navigator/src/index.ts"))) {
    const notice = "/* Aster Data Navigator is proprietary. See data-navigator.LICENSE.txt. */\n";
    writeFileSync(join(LIB, "aster-data-navigator.css"), notice + readFileSync(join(ROOT, "packages/data-navigator/src/styles/navigator.css"), "utf8"));
    copyFileSync(join(ROOT, "packages/data-navigator/LICENSE"), join(LIB, "data-navigator.LICENSE.txt"));
  }
  writeFileSync(join(LIB, "aster-ui-preview.css"), ["conversation", "hierarchy"].map(name => readFileSync(join(ROOT, `packages/elements-preview/src/styles/${name}.css`), "utf8")).join("\n"));
  copyFileSync(WASM, join(LIB, "odata_mock.wasm"));
  const STYLES = join(ROOT, "packages/elements/src/styles");
  writeFileSync(join(LIB, "aster-ui.css"), ["base.css", "field-selection.css", "elements.css"].map((f) => readFileSync(join(STYLES, f), "utf8").replace('@import "./field-selection.css";', "")).join("\n"));
  mkdirSync(join(LIB, "themes"), { recursive: true });
  for (const theme of ["lamplight.css", "harbour.css"]) copyFileSync(join(STYLES, theme), join(LIB, "themes", theme));
  mkdirSync(join(LIB, "demo"), { recursive: true });
  for (const f of ["metadata.json", "data.json"]) copyFileSync(join(ROOT, "fixtures/aster", f), join(LIB, "demo", f));
  mkdirSync(join(LIB, "calculations"), { recursive: true });
  for (const f of ["metadata.json", "data.json"]) copyFileSync(join(ROOT, "fixtures/calculations", f), join(LIB, "calculations", f));
  const tsc = Bun.spawnSync(["bunx", "tsc", "-p", join(ROOT, "scripts/lib")], { stdout: "inherit", stderr: "inherit" });
  if (tsc.exitCode !== 0) throw new Error("The library's declarations didn't build");
  // Declarations import the packages by name; on the site they're files beside each other.
  const TYPES = join(LIB, "types");
  const PACKAGES: Record<string, string> = {
    "@getaster/data": "packages/data/src/index.js",
    "@getaster/elements": "packages/elements/src/index.js",
    "@getaster/elements/format": "packages/elements/src/format.js",
    "@getaster/elements/grid-state": "packages/elements/src/grid-state.js",
    "@getaster/elements-preview": "packages/elements-preview/src/index.js",
    "@getaster/mock": "packages/mock/src/index.js",
    "@getaster/data-navigator": "packages/data-navigator/src/index.js",
    "@getaster/data-navigator/model": "packages/data-navigator/src/model/index.js",
  };
  for (const file of new Bun.Glob("**/*.d.ts").scanSync(TYPES)) {
    const path = join(TYPES, file);
    const text = readFileSync(path, "utf8").replace(/(from "\.{1,2}\/[^"]+)\.ts"/g, '$1.js"').replace(/from "(@getaster\/[\w-]+(?:\/(?:grid-state|format|model))?)"/g, (m, name: string) => {
      const target = PACKAGES[name];
      if (!target) return m;
      const rel = relative(dirname(path), join(TYPES, target));
      return `from "${rel.startsWith(".") ? rel : `./${rel}`}"`;
    });
    writeFileSync(path, text);
}
  writeFileSync(join(LIB, "aster-ui.d.ts"), 'export * from "./types/scripts/lib/aster-ui.js";\n');
  writeFileSync(join(LIB, "aster-ui-mock.d.ts"), 'export * from "./types/scripts/lib/aster-ui-mock.js";\n');
  if (existsSync(join(ROOT, "packages/data-navigator/src/index.ts"))) writeFileSync(join(LIB, "aster-data-navigator.d.ts"), 'export * from "./types/scripts/lib/aster-data-navigator.js";\n');
  writeFileSync(join(LIB, "aster-ui-preview.d.ts"), 'export * from "./types/scripts/lib/aster-ui-preview.js";\n');
}

/** Link the emitted extension modules against the exact shared browser artifact. */
export async function buildBrowserModules(ROOT: string, LIB: string, production: { conditions: string[]; define: Record<string, string> }): Promise<void> {
  const lib = await Bun.build({
    entrypoints: [join(ROOT, "scripts/lib/aster-ui.ts"), join(ROOT, "scripts/lib/aster-ui-mock.ts")],
    outdir: LIB,
    minify: true,
    target: "browser",
    ...production,
  });
  if (!lib.success) throw new AggregateError(lib.logs, "The library didn't build");
  // Extension packages share the stable module runtime.
  for (const [entry, source] of [["aster-ui-preview", "elements-preview"], ["aster-data-navigator", "data-navigator"]]) {
    if (!existsSync(join(ROOT, `packages/${source}/src/index.ts`))) continue;
    const extension = await Bun.build({
      entrypoints: [join(ROOT, `scripts/lib/${entry}.ts`)], outdir: LIB,
      minify: true, target: "browser", ...production,
      external: ["./aster-ui.js"],
      plugins: [{ name: "stable-runtime", setup(build) {
        build.onResolve({ filter: /^\.\/aster-ui\.js$/ }, (args) => ({ path: args.path, external: true }));
        build.onLoad({ filter: new RegExp(`/packages/${source}/src/.*\\.ts$`) }, (args) => ({
          contents: readFileSync(args.path, "utf8").replace(/from "(@getaster\/(?:data|elements(?:\/(?:grid-state|format))?)|@preact\/signals-core|lit-html)"/g, 'from "./aster-ui.js"'), loader: "ts",
        }));
      } }],
    });
    if (!extension.success) throw new AggregateError(extension.logs, `${entry} did not build`);
    if (source === "data-navigator") {
      const path = join(LIB, `${entry}.js`);
      writeFileSync(path, "/* Aster Data Navigator is proprietary. See data-navigator.LICENSE.txt. */\n" + readFileSync(path, "utf8"));
    }
  }
  const linked = await Bun.build({
    entrypoints: ["aster-ui-preview", "aster-data-navigator"].map(name => join(LIB, `${name}.js`)).filter(existsSync),
    target: "browser",
  });
  if (!linked.success) throw new AggregateError(linked.logs, "Browser extensions import unavailable shared runtime exports");
}
