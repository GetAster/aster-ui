import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const fromRegistry = process.argv.includes("--from-registry");
const directory = mkdtempSync(join(tmpdir(), "aster-package-consumer-"));
const run = (args: string[]) => {
  const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(`${args[0]} consumer check failed:\n${result.stdout}\n${result.stderr}`);
};
try {
  const files = JSON.parse(readFileSync(join(root, "dist-release/PACKAGES.json"), "utf8")) as string[];
  const dependencies = Object.fromEntries(await Promise.all(files.map(async file => {
    const name = /^getaster-(.+)-\d+\.\d+\.\d+/.exec(file)?.[1];
    if (!name) throw new Error(`Unexpected tarball: ${file}`);
    const version = JSON.parse(readFileSync(join(root, "dist-release", name, "package.json"), "utf8")).version as string;
    const url = fromRegistry ? `https://registry.npmjs.org/@getaster/${name}/-/${name}-${version}.tgz` : `file:${join(root, "dist-release", file)}`;
    return [`@getaster/${name}`, url];
  })));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }));
  run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  writeFileSync(join(directory, "consumer.ts"), `import { Lifetime } from '@getaster/data';
import { Grid } from '@getaster/elements';
import { ConversationSession } from '@getaster/elements-preview/conversation';
import { createMockService } from '@getaster/mock';
const selection = new Lifetime();
void [selection, Grid, ConversationSession, createMockService];
`);
  const bundled = await Bun.build({ entrypoints: [join(directory, "consumer.ts")], target: "browser" });
  if (!bundled.success) throw new AggregateError(bundled.logs, "Packaged browser modules did not bundle");
  run([join(root, "node_modules/.bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext", "--target", "es2023", "consumer.ts"]);
  cpSync(join(root, "fixtures/aster/metadata.json"), join(directory, "metadata.json"));
  writeFileSync(join(directory, "runtime.mjs"), `import { readFileSync } from 'node:fs';
import { Lifetime } from '@getaster/data';
import { createMockService } from '@getaster/mock';
const selection = new Lifetime();
if (!selection) throw new Error('Data import failed');
const metadata = JSON.parse(readFileSync(new URL('./metadata.json', import.meta.url)));
const wasm = readFileSync(new URL(import.meta.resolve('@getaster/mock/wasm/odata_mock.wasm')));
const mock = await createMockService({metadata, data: {}, wasm});
const response = await mock.transport({method:'GET', url:'/$metadata'});
if (response.status !== 200) throw new Error('Packaged WASM did not load');
console.log('Installed package declarations, data runtime and WASM verified');
`);
  run(["node", "runtime.mjs"]);
  console.log(`Fresh ${fromRegistry ? "registry" : "tarball"} consumer: declarations, module resolution and packaged WASM passed`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
