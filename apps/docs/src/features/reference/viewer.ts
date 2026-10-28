import { documentationRoot, referenceArticleLinks } from "../../shared/paths.ts";
import { $, esc } from "@getaster/docs/html";
import { initDocs } from "../../app/main.ts";
import { enhanceArticle, restoreNavigationScroll } from "@getaster/docs/browser";
import { referencePages, label } from "./render.ts";
import type { Entry } from "./types.ts";

let pages: ReturnType<typeof referencePages>;

function show(): void {
  const ref = decodeURIComponent(location.hash.slice(1));
  const e = ref ? pages.byRef.get(ref) : undefined;
  const main = $<HTMLElement>("#content");
  main.innerHTML = ref && !e ? `<h1 tabindex="-1">Not found</h1><p>No entry is called <code>${esc(ref)}</code>.</p>` : e ? pages.entryPage(e) : pages.home();
  document.title = e ? `${e.kind === "group" ? e.name : label(e)} · Aster UI reference` : "Aster UI reference";
  if (ref) main.querySelector<HTMLElement>("h1")?.focus();
  referenceArticleLinks(main);
  enhanceArticle();
  for (const a of document.querySelectorAll<HTMLAnchorElement>("#api-nav a")) {
    if (a.hash.slice(1) === encodeURIComponent(e?.definingClass ?? ref)) {
      a.setAttribute("aria-current", "page");
      a.closest("details")?.setAttribute("open", "");
    }
  }
  document.querySelector(".menu-toggle")?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("nav-open");
}

async function start(): Promise<void> {
  const entries = (await (await fetch("reference.json", { cache: "no-cache" })).json()) as Entry[];
  pages = referencePages(entries, document.querySelector('meta[name="aster-release-revision"]')?.getAttribute("content") ?? "", new URL("../docs-assets/", documentationRoot()).href);
  $("#api-nav").innerHTML = pages.nav();
  initDocs();
  addEventListener("hashchange", () => {
    show();
    window.scrollTo(0, 0);
  });
  show();
  restoreNavigationScroll();
}

initDocs();
void start().catch(() => {
  restoreNavigationScroll();
  $("#content").innerHTML = '<h1>Reference unavailable</h1><p>Reload to try again, or <a href="../guide/getting-started.html">open the getting started guide</a>.</p>';
});
