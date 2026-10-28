import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AssetOptions {
  readonly entrypoints?: readonly string[];
  readonly stylesheets?: readonly string[];
  readonly conditions?: string[];
  readonly define?: Record<string, string>;
}

/** Bundle the shared runtime or project entry points and retain font licence notices. */
export async function buildDocsAssets(outdir: string, options: AssetOptions = {}): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const styles = join(here, "../../styles");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const entrypoints = options.entrypoints ?? [join(here, `../browser/docs.${extension}`)];
  mkdirSync(outdir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [...entrypoints, ...(options.stylesheets ?? [join(styles, "docs.css"), join(styles, "fonts.css")])],
    outdir, naming: "[name].[ext]", splitting: true, minify: true, external: ["*.ttf"],
    ...(options.conditions ? { conditions: options.conditions } : {}),
    ...(options.define ? { define: options.define } : {}),
  });
  if (!result.success) throw new AggregateError(result.logs, "The documentation assets didn't build");
  copyFileSync(join(styles, "theme.css"), join(outdir, "theme.css"));
  copyFileSync(join(styles, "brand/aster-logo.svg"), join(outdir, "aster-logo.svg"));
  for (const family of ["geist", "ibm-plex-mono"]) {
    cpSync(join(styles, "brand", family), join(outdir, "brand", family), { recursive: true });
    copyFileSync(join(styles, "brand", family, "OFL.txt"), join(outdir, `${family}-OFL.txt`));
  }
}
