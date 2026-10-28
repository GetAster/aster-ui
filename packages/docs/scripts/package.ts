import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const source = join(root, "packages/docs");
const out = join(root, "dist-docs");
const destination = join(out, "package");
rmSync(out, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
const types = Bun.spawnSync(["bunx", "tsc", "-p", join(source, "tsconfig.build.json")], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (types.exitCode) throw new Error("Documentation package compilation failed");
cpSync(join(source, "styles"), join(destination, "styles"), { recursive: true });
for (const file of ["LICENSE", "NOTICE"]) cpSync(join(root, file), join(destination, file));
cpSync(join(source, "README.md"), join(destination, "README.md"));
const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
manifest.exports = Object.fromEntries(Object.entries(manifest.exports as Record<string, string>).map(([key, value]) => [key, value.startsWith("./src/")
  ? { types: value.replace("./src/", "./dist/").replace(/\.ts$/, ".d.ts"), import: value.replace("./src/", "./dist/").replace(/\.ts$/, ".js") }
  : value]));
manifest.types = "./dist/build/index.d.ts";
manifest.publishConfig = { access: "public" };
writeFileSync(join(destination, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
const pack = Bun.spawnSync(["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", out], { cwd: destination, stdout: "pipe", stderr: "pipe" });
if (pack.exitCode) throw new Error(`Documentation package packing failed: ${pack.stderr}`);
const [packed] = JSON.parse(pack.stdout.toString()) as { filename: string; files: { path: string }[]; size: number }[];
if (!packed) throw new Error("No documentation tarball was produced");
for (const file of packed.files) {
  if (!/^(?:package\.json|LICENSE|NOTICE|README\.md|dist\/|styles\/)/.test(file.path) || /\.(?:test|typecheck)\.[jt]s$/.test(file.path)) throw new Error(`Unexpected documentation package content: ${file.path}`);
}
console.log(`${join(out, packed.filename)}: ${packed.files.length} files, ${packed.size} bytes. No registry publication performed.`);
