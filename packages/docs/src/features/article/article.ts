import { $, esc } from "../../shared/dom.ts";
import { enhanceCode } from "./code.ts";

let observer: IntersectionObserver | undefined;
/** Rebuild article enhancements after reference navigation. */
export function enhanceArticle(): void {
  observer?.disconnect();
  const main = $("#content");
  const outline = $("#outline");
  const ids = new Set<string>();
  const headings = [...main.querySelectorAll<HTMLHeadingElement>("h2, h3")];
  for (const heading of headings) {
    const base = heading.textContent!.toLowerCase().replace(/[^\p{Letter}\p{Number}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    if (!heading.id) heading.id = id;
    ids.add(heading.id);
    const anchor = document.createElement("a");
    anchor.className = "heading-anchor"; anchor.href = `#${heading.id}`;
    anchor.setAttribute("aria-label", `Link to ${heading.textContent}`); anchor.textContent = "#";
    heading.append(anchor);
  }
  outline.innerHTML = headings.map(h => `<li class="level-${h.tagName.toLowerCase()}"><a href="#${esc(h.id)}">${esc(h.textContent!.replace(/#$/, ""))}</a></li>`).join("");
  // Routed articles keep their route while scrolling to a section.
  for (const link of [...outline.querySelectorAll<HTMLAnchorElement>("a"), ...main.querySelectorAll<HTMLAnchorElement>(".heading-anchor")]) {
    link.addEventListener("click", event => {
      if (!document.body.hasAttribute("data-docs-routed")) return;
      event.preventDefault();
      document.getElementById(decodeURIComponent(link.hash.slice(1)))?.scrollIntoView({ block: "start" });
    });
  }
  observer = new IntersectionObserver(changes => {
    for (const change of changes) if (change.isIntersecting) {
      for (const link of outline.querySelectorAll("a")) {
        if (link.getAttribute("href") === `#${change.target.id}`) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    }
  }, { rootMargin: "-10% 0px -65% 0px" });
  headings.forEach(h => observer!.observe(h));
  enhanceCode(main);
  for (const a of document.querySelectorAll<HTMLAnchorElement>("#nav a")) {
    if (a.href === location.href || (!a.hash && a.pathname === location.pathname && (!document.body.hasAttribute("data-docs-routed") || !location.hash))) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

