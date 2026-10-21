import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { mapMarkdownLinks } from "../../apps/docs/build/agent-docs.ts";

/** Check the deployed tree, so links cannot rely on unpublished build output. */
export function checkPublicLinks(root: string, directories: readonly string[] = ["guide", "examples", "reference"]): string[] {
  const problems = new Set<string>();
  function check(name: string, href: string): void {
    const url = new URL(href.replaceAll("&amp;", "&"), `https://aster-docs.invalid/${name}`);
    if (url.hostname === "forge.emrul.dev" && url.pathname.startsWith("/Aster/aster-ui/")
      && /\/docs\/(?:PLAN\.md|go-no-go\.md|design\/|requirements\/|handoffs\/|clean-room\/)/.test(url.pathname)) {
      problems.add(`${name}: internal documentation link ${href}`);
    }
    if (url.origin !== "https://aster-docs.invalid") return;
    let target = join(root, decodeURIComponent(url.pathname));
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
    if (!existsSync(target)) problems.add(`${name}: missing public target ${href}`);
  }
  function scan(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      const name = relative(root, file);
      if (entry.name.endsWith(".md") || entry.name === "llms.txt") {
        mapMarkdownLinks(readFileSync(file, "utf8"), href => { check(name, href); return href; });
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      const html = readFileSync(file, "utf8");
      for (const tag of html.matchAll(/<(?:a|link|script|iframe|img)\b[^>]*>/gi)) {
        const attribute = /\b(?:href|src)="([^"]*)"/i.exec(tag[0]);
        if (!attribute) continue;
        check(name, attribute[1]!);
      }
    }
  }
  for (const directory of directories) scan(join(root, directory));
  if (existsSync(join(root, "llms.txt"))) mapMarkdownLinks(readFileSync(join(root, "llms.txt"), "utf8"), href => { check("llms.txt", href); return href; });
  return [...problems].sort();
}
