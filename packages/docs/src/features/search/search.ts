import { $, esc } from "../../shared/dom.ts";
import { searchURL } from "../../shared/paths.ts";

import { createSearchIndex, searchExcerpt, type SearchItem } from "./index.ts";

export function initSearch(): void {
  const input = $<HTMLInputElement>("#search"), results = $("#results"), status = $("#search-status");
  let search = createSearchIndex([]);
  let loaded = false;
  let open = false;
  const container = $(".ref-search");
  input.setAttribute("aria-controls", "results");
  let indexFailed = false;
  const update = () => {
    const q = input.value.trim();
    const found = q ? search(q) : [];
    results.hidden = !q || !open;
    results.innerHTML = found.map(e => `<li><a href="${esc(e.href)}"><span class="search-result-copy"><strong>${esc(e.name)}</strong><span class="search-result-excerpt">${esc(searchExcerpt(e.description, q))}</span></span><small>${esc(e.kind)}</small></a></li>`).join("") || `<li class="search-empty">${indexFailed ? "Search unavailable. Browse using the sidebar." : loaded ? "No results. Try another word or task name." : "Loading search…"}</li>`;
    status.textContent = !q || !open ? "" : indexFailed ? "Search unavailable" : !loaded ? "Loading search" : `${found.length} results`;
  };
  fetch(searchURL()).then(response => {
    if (!response.ok) throw new Error("Search unavailable");
    return response.json() as Promise<SearchItem[]>;
  }).then(items => {
    search = createSearchIndex(items.map(item => ({ ...item, href: new URL(item.href, searchURL()).href })));
    loaded = true;
    if (open) update();
  }).catch(() => { indexFailed = true; if (open) update(); });
  input.addEventListener("input", () => { open = !!input.value.trim(); update(); });
  input.addEventListener("focus", () => { if (input.value) { open = true; update(); } });
  const close = () => { open = false; results.hidden = true; status.textContent = ""; };
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && !results.hidden && !e.isComposing) { const first = results.querySelector<HTMLAnchorElement>("a"); if (first) { e.preventDefault(); first.click(); } }
    if (e.key === "ArrowDown") { e.preventDefault(); results.querySelector<HTMLAnchorElement>("a")?.focus(); }
  });
  document.addEventListener("pointerdown", event => { if (!container.contains(event.target as Node)) close(); });
  results.addEventListener("click", close);
  results.addEventListener("keydown", e => {
    const links = [...results.querySelectorAll<HTMLAnchorElement>("a")];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); links[Math.min(i + 1, links.length - 1)]?.focus(); break;
      case "ArrowUp": e.preventDefault(); if (i <= 0) input.focus(); else links[i - 1]?.focus(); break;
      case "Escape": input.focus(); close(); break;
    }
  });
  $(".ref-search").addEventListener("focusout", e => { if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) close(); });
  document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.focus(); input.select(); } });
}
