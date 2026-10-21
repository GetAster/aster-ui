import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../cloudflare.config.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "dist-site");
const output = resolve(root, ".cloudflare/output/v0");
const receipt = JSON.parse(await readFile(resolve(source, "deployment.json"), "utf8"));
if (receipt.site !== "https://ui.getaster.now" || !receipt.version || !receipt.revision) throw new Error("Invalid site receipt");
const expected = new Set(Object.keys(receipt.files));
async function verify(directory) {
  for (const entry of await readdir(resolve(source, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await verify(path);
    else {
      if (!entry.isFile()) throw new Error(`Unsupported asset: ${path}`);
      if (path === "deployment.json") continue;
      if (!expected.delete(path)) throw new Error(`Unexpected asset: ${path}`);
      const hash = createHash("sha256").update(await readFile(resolve(source, path))).digest("hex");
      if (hash !== receipt.files[path]) throw new Error(`Changed asset: ${path}`);
    }
  }
}
await verify("");
if (expected.size) throw new Error(`Missing assets: ${[...expected].join(", ")}`);
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "workers/default"), { recursive: true });
await cp(source, resolve(output, "workers/default/assets"), { recursive: true });
await writeFile(resolve(output, "config.json"), JSON.stringify({ buildContext: { isPreview: false } }));
await writeFile(resolve(output, "workers/default/worker.config.json"), JSON.stringify(config.worker));
console.log(`Prepared ${receipt.version} (${receipt.revision}) for ${config.worker.name}; checksums verified.`);
