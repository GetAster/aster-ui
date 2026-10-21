import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/** Checks the supplied binary against its attribution inventory before distribution. */
export function verifyWasm(root = resolve(import.meta.dir, "..")): void {
  const directory = join(root, "packages/mock/wasm");
  const artifact = JSON.parse(readFileSync(join(directory, "ARTIFACT.json"), "utf8")) as {
    sha256: string; bytes: number; license: string;
    dependencies: { name: string; notices: string[] }[]; rustNotices: string;
  };
  const bytes = readFileSync(join(directory, "odata_mock.wasm"));
  if (artifact.license !== "Apache-2.0" || bytes.length !== artifact.bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
    throw new Error("WASM artifact does not match ARTIFACT.json; obtain the matching binary and notices");
  }
  if (!WebAssembly.validate(bytes)) throw new Error("Invalid WASM binary");
  for (const file of ["NOTICE", artifact.rustNotices, ...artifact.dependencies.flatMap(d => d.notices)]) {
    if (!/^(?:NOTICE|licenses\/[\w.-]+)$/.test(file) || !statSync(join(directory, file)).isFile()) throw new Error(`Invalid binary notice: ${file}`);
  }
  if (!artifact.dependencies.length || artifact.dependencies.some(d => !d.notices.length)) throw new Error("Incomplete binary attributions");
}

if (import.meta.main) {
  verifyWasm();
  console.log("WASM checksum, module and attribution files verified");
}
