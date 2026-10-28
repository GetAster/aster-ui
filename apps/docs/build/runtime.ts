import { buildDocsAssets } from "@getaster/docs";
import { cpSync } from "node:fs";
import { join } from "node:path";

export async function buildDocsRuntime(root: string, out: string, production: { conditions: string[]; define: Record<string, string> }): Promise<void> {
  const source = join(root, "apps/docs/src");
  const target = join(out, "docs-assets");
  await buildDocsAssets(target, {
    entrypoints: ["app/docs.ts", "app/viewer.ts"].map(file => join(source, file)),
    stylesheets: ["styles/docs.css", "styles/fonts.css"].map(file => join(source, file)),
    ...production,
  });
  cpSync(join(source, "assets/photography"), join(target, "photography"), { recursive: true });
}
