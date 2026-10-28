import { renderShell } from "@getaster/docs";
import { navigation } from "./navigation.ts";

export function shell(title: string, body: string, script = "../docs-assets/docs.js"): string {
  return renderShell(title, body, {
    siteName: "Aster UI",
    description: "Aster UI developer documentation. Connect SQL and backend APIs through Aster WebData virtual data sources, then build connected web interfaces.",
    wordmark: "aster.",
    section: "UI / Docs",
    homeHref: "../reference/",
    assetsHref: "../docs-assets/",
    rootHref: "../",
    searchHref: "../guide/search.json",
    llmsHref: "../llms.txt",
    stylesheets: ["../lib/themes/lamplight.css", "../docs-assets/docs.css"],
    navigationHtml: navigation(),
    headerLink: { href: "../#showcase", label: "Showcase ↗" },
  }, { script });
}
