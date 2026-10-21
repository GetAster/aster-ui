import { copyFileSync } from "node:fs";
import { join } from "node:path";
import compositeYamlPlugin from "../../../scripts/composite-yaml-plugin.ts";

export async function buildShowcaseApp(ROOT: string, OUT: string, production: { conditions: string[]; define: Record<string, string> }): Promise<void> {
    const WASM = join(ROOT, "packages/mock/wasm/odata_mock.wasm");
  const built = await Bun.build({
    entrypoints: [join(ROOT, "apps/showcase/index.html")],
    outdir: join(OUT, "aster"),
    minify: true,
    splitting: true,
    plugins: [compositeYamlPlugin],
    ...production,
  });
  if (!built.success) throw new AggregateError(built.logs, "The demo didn't build");
  const worker = await Bun.build({
    entrypoints: [join(ROOT, "apps/showcase/src/workspace/mock-worker.ts")],
    outdir: join(OUT, "aster"),
    naming: "mock-worker.js",
    minify: true,
    target: "browser",
    ...production,
  });
  if (!worker.success) throw new AggregateError(worker.logs, "The mock worker didn't build");
  copyFileSync(WASM, join(OUT, "aster/odata_mock.wasm"));

}
