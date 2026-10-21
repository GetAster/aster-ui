import ts from "typescript";
import { buildVersion } from "./version.ts";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyWasm } from "./verify-wasm.ts";

const root = resolve(import.meta.dir, "..");
const versionIndex = process.argv.indexOf("--version");
const version = versionIndex < 0 ? buildVersion(root) : process.argv[versionIndex + 1];
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) {
  throw new Error("Invalid package version");
}
verifyWasm(root);
const out = join(root, "dist-release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const run = (args: string[], cwd = root) => {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(`${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.toString();
};
run(["bunx", "tsc", "-p", "scripts/lib", "--outDir", join(out, "types")]);
const packages = ["data", "elements", "elements-preview", "mock"];
for (const name of packages) {
  const source = join(root, "packages", name);
  const destination = join(out, name);
  const dist = join(destination, "dist");
  mkdirSync(dist, { recursive: true });
  for (const file of new Bun.Glob("**/*.ts").scanSync(join(source, "src"))) {
    if (/\.(?:test|typecheck|d)\.ts$/.test(file)) continue;
    const target = join(dist, file.replace(/\.ts$/, ".js"));
    mkdirSync(resolve(target, ".."), { recursive: true });
    const result = ts.transpileModule(readFileSync(join(source, "src", file), "utf8"), {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true, rewriteRelativeImportExtensions: true },
    });
    writeFileSync(target, result.outputText);
  }
  cpSync(join(out, "types/packages", name, "src"), dist, { recursive: true });
  for (const file of ["LICENSE", "NOTICE"]) cpSync(join(root, file), join(destination, file));
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  delete manifest.private;
  manifest.version = version;
  manifest.types = "./dist/index.d.ts";
  manifest.publishConfig = { access: "public" };
  manifest.files = ["dist", "LICENSE", "NOTICE", "README.md"];
  manifest.exports = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", default: "./dist/index.js" } };
  manifest.engines = { node: ">=22" };
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (dependency.startsWith("@getaster/")) manifest.dependencies[dependency] = version;
  }
  switch (name) {
    case "elements": {
      cpSync(join(source, "src/styles"), join(destination, "styles"), { recursive: true });
      writeFileSync(join(destination, "styles/aster-ui.css"), ["base.css", "elements.css"].map(f => readFileSync(join(source, "src/styles", f), "utf8")).join("\n"));
      manifest.files.push("styles", "bin");
      manifest.exports["./styles/*"] = "./styles/*";
      manifest.sideEffects = ["./dist/index.js", "./dist/**/*.js", "./styles/*.css"];
      const cli = await Bun.build({ entrypoints: [join(source, "tools/aster-theme-check.ts")], target: "node", outdir: join(destination, "bin"), minify: false });
      if (!cli.success) throw new AggregateError(cli.logs, "Theme CLI build failed");
      const path = join(destination, "bin/aster-theme-check.js");
      writeFileSync(path, readFileSync(path, "utf8").replace(/^#![^\n]+/, "#!/usr/bin/env node"), { mode: 0o755 });
      manifest.bin = { "aster-theme-check": "./bin/aster-theme-check.js" };
      break;
    }
    case "elements-preview":
      cpSync(join(source, "src/styles"), join(destination, "styles"), { recursive: true });
      manifest.files.push("styles");
      manifest.exports["./styles/*"] = "./styles/*";
      manifest.exports["./conversation"] = { types: "./dist/conversation/session.d.ts", import: "./dist/conversation/session.js" };
      manifest.sideEffects = ["./dist/**/*.js", "./styles/*.css"];
      break;
    case "mock":
      cpSync(join(source, "wasm"), join(destination, "wasm"), { recursive: true });
      manifest.files.push("wasm");
      manifest.exports["./wasm/odata_mock.wasm"] = "./wasm/odata_mock.wasm";
      break;
  }
  writeFileSync(join(destination, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(destination, "README.md"), `# ${manifest.name}\n\nAster UI ${name === "elements-preview" ? "experimental controls (API may change)" : name}.\n\nDocumentation: https://ui.getaster.now/docs/guide/library.html\n\nLicensed under Apache-2.0. See LICENSE and NOTICE.\n`);
  const packed = JSON.parse(run(["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", out], destination))[0];
  for (const file of packed.files as { path: string }[]) {
    if (!/^(?:package\.json|LICENSE|NOTICE|README\.md|dist\/|styles\/|bin\/|wasm\/)/.test(file.path) || /\.(?:test|typecheck)\.[jt]s$|\.rs$|Cargo\.(?:toml|lock)$/.test(file.path)) throw new Error(`Unexpected package content: ${file.path}`);
  }
  console.log(`${manifest.name}@${version}: ${packed.files.length} files, ${packed.size} bytes packed`);
}
rmSync(join(out, "types"), { recursive: true });
writeFileSync(join(out, "PACKAGES.json"), JSON.stringify(readdirSync(out).filter(f => f.endsWith(".tgz")).sort(), null, 2) + "\n");
console.log("Local tarballs prepared. No registry publication performed.");
