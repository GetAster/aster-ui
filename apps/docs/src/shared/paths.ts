export { documentationRoot } from "@getaster/docs/browser-paths";

export function referenceArticleLinks(main: HTMLElement): void {
  if (document.querySelector('meta[name="aster-site-layout"]')?.getAttribute("content") !== "product") return;
  for (const link of main.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = link.getAttribute("href")!;
    if (href.startsWith("#") || /^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    const url = new URL(href, new URL("/reference/", location.origin));
    url.pathname = url.pathname.replace(/^\/(guide|reference)(?=\/)/, "/docs/$1");
    if (url.pathname === "/") url.pathname = "/showcase/";
    link.href = url.href;
  }
}
