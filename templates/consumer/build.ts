import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yamlPlugin from "./src/yaml-plugin.ts";

const built = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  plugins: [yamlPlugin],
});
if (!built.success) {
  console.error(built.logs.join("\n"));
  process.exit(1);
}

// Static hosting must serve the engine at /odata_mock.wasm, as the page asks.
mkdirSync("dist", { recursive: true });
copyFileSync(
  fileURLToPath(import.meta.resolve("@getaster/mock/wasm/odata_mock.wasm")),
  "dist/odata_mock.wasm",
);
console.log(`Built ${built.outputs.length} files in dist/. Serve /odata_mock.wasm beside index.html.`);
