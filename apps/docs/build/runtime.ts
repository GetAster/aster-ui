import { copyFileSync, cpSync } from "node:fs";
import { join } from "node:path";

export async function buildDocsRuntime(root: string, out: string, production: { conditions: string[]; define: Record<string, string> }): Promise<void> {
  const source = join(root, "apps/docs/src");
  const target = join(out, "docs-assets");
  const result = await Bun.build({ entrypoints: ["app/docs.ts", "app/viewer.ts", "styles/docs.css"].map(file => join(source, file)), outdir: target, naming: "[name].[ext]", splitting: true, minify: true, external: ["*.ttf"], ...production });
  if (!result.success) throw new AggregateError(result.logs, "The documentation runtime didn't build");
  cpSync(join(source, "assets/photography"), join(target, "photography"), { recursive: true });
  copyFileSync(join(source, "styles/brand/aster-logo.svg"), join(target, "aster-logo.svg"));
  for (const family of ["geist", "ibm-plex-mono"]) {
    cpSync(join(source, "styles/brand", family), join(target, "brand", family), { recursive: true });
    copyFileSync(join(source, "styles/brand", family, "OFL.txt"), join(target, `${family}-OFL.txt`));
  }
}
