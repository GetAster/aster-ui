// Installs the consumer template from the locally built tarballs, then checks
// that it typechecks, builds and serves its page, styles and mock engine.
// Run `bun run packages:build` first, as for check-package-consumer.ts.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const project = mkdtempSync(join(tmpdir(), "aster-template-consumer-"));
const port = 4196;
const run = (args: string[], cwd = project) => {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(`${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.toString();
};

try {
  const files = JSON.parse(readFileSync(join(root, "dist-release/PACKAGES.json"), "utf8")) as string[];
  const versions = Object.fromEntries(files.map((file) => {
    const name = /^getaster-(.+)-\d+\.\d+\.\d+/.exec(file)?.[1];
    if (!name) throw new Error(`Unexpected tarball: ${file}`);
    return [name, JSON.parse(readFileSync(join(root, "dist-release", name, "package.json"), "utf8")).version as string];
  }));
  cpSync(join(root, "templates/consumer"), project, {
    recursive: true,
    filter: (source) => !/(?:\/node_modules|\/dist)$/.test(source),
  });
  const manifestPath = join(project, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Local tarballs stand in for the not-yet-published next version. The
  // overrides make Bun resolve the packages' exact internal pins to them, so
  // the check still exercises the template's own `bun install` command.
  manifest.overrides = {};
  for (const section of ["dependencies", "devDependencies"] as const) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      const short = name.replace(/^@getaster\//, "");
      if (name.startsWith("@getaster/") && versions[short]) {
        const tarball = `file:${join(root, "dist-release", files.find((file) => file.startsWith(`getaster-${short}-`))!)}`;
        manifest[section][name] = tarball;
        manifest.overrides[name] = tarball;
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  run(["bun", "install", "--ignore-scripts"]);
  run(["bun", "run", "typecheck"]);
  run(["bun", "run", "build"]);
  if (!existsSync(join(project, "dist/index.html"))) throw new Error("The static build did not emit dist/index.html");
  const wasm = readFileSync(join(project, "dist/odata_mock.wasm"));
  if (!WebAssembly.validate(wasm)) throw new Error("The static build did not copy a valid odata_mock.wasm");

  const server = Bun.spawn(["bun", "serve.ts"], { cwd: project, env: { ...process.env, PORT: String(port) }, stdout: "pipe", stderr: "pipe" });
  try {
    let html = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        if (response.ok) { html = await response.text(); break; }
      } catch { /* The server may still be bundling. */ }
      await Bun.sleep(100);
    }
    if (!html) throw new Error("The template's development server did not answer");
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]!);
    const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1]!);
    if (!scripts.length) throw new Error("The served page has no bundled script");
    for (const asset of [...scripts, ...styles]) {
      const response = await fetch(new URL(asset, `http://127.0.0.1:${port}/`));
      if (!response.ok) throw new Error(`Served asset ${asset} returned ${response.status}`);
      const body = await response.text();
      if (asset.endsWith(".css") && (!body.includes("@font-face") || !body.includes("format(woff2)")))
        throw new Error("The composed theme did not survive the CSS bundler");
    }
    const engine = await fetch(`http://127.0.0.1:${port}/odata_mock.wasm`);
    if (!engine.ok || !WebAssembly.validate(await engine.arrayBuffer()))
      throw new Error("The development server did not serve /odata_mock.wasm");
    if (!statSync(join(project, "node_modules/@getaster/mock/wasm/odata_mock.wasm")).isFile())
      throw new Error("The mock package did not install its wasm file");
    console.log("Template consumer: install, typecheck, build, served page, styles and /odata_mock.wasm passed");
  } finally {
    server.kill();
    await server.exited;
  }
} finally {
  rmSync(project, { recursive: true, force: true });
}
