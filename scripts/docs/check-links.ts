import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Check the deployed tree, so links cannot rely on unpublished build output. */
export function checkPublicLinks(root: string, directories: readonly string[] = ["guide", "examples", "reference"]): string[] {
  const problems = new Set<string>();
  function scan(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!entry.name.endsWith(".html")) continue;
      const name = relative(root, file);
      const html = readFileSync(file, "utf8");
      for (const tag of html.matchAll(/<(?:a|link|script|iframe|img)\b[^>]*>/gi)) {
        const attribute = /\b(?:href|src)="([^"]*)"/i.exec(tag[0]);
        if (!attribute) continue;
        const href = attribute[1]!.replaceAll("&amp;", "&");
        const url = new URL(href, `https://aster-docs.invalid/${name}`);
        if (url.hostname === "forge.emrul.dev" && url.pathname.startsWith("/Aster/aster-ui/")
          && /\/docs\/(?:PLAN\.md|go-no-go\.md|design\/|requirements\/|handoffs\/|clean-room\/)/.test(url.pathname)) {
          problems.add(`${name}: internal documentation link ${href}`);
        }
        if (url.origin !== "https://aster-docs.invalid") continue;
        let target = join(root, decodeURIComponent(url.pathname));
        if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
        if (!existsSync(target)) problems.add(`${name}: missing public target ${href}`);
      }
    }
  }
  for (const directory of directories) scan(join(root, directory));
  return [...problems].sort();
}
