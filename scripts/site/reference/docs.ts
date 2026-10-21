import { documentationRoot } from "./paths.ts";
import { initExplorer } from "./explorer.ts";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
for (const [name, language] of Object.entries({ javascript, typescript, xml, css, json, bash, yaml })) hljs.registerLanguage(name, language);

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
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
  // Reference hashes identify API entries; section jumps preserve that route.
  for (const link of [...outline.querySelectorAll<HTMLAnchorElement>("a"), ...main.querySelectorAll<HTMLAnchorElement>(".heading-anchor")]) {
    link.addEventListener("click", event => {
      if (!document.body.hasAttribute("data-api")) return;
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
  for (const code of main.querySelectorAll<HTMLElement>("pre > code")) {
    const raw = code.textContent ?? "";
    const lang = /language-([\w-]+)/.exec(code.className)?.[1];
    if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(raw, { language: lang }).value;
    const pre = code.parentElement!;
    pre.tabIndex = 0;
    pre.setAttribute("role", "group");
    pre.setAttribute("aria-label", `${lang ?? "API signature"} code example`);
    const frame = document.createElement("div"); frame.className = "code-frame";
    pre.before(frame); frame.append(pre);
    const toolbar = document.createElement("div"); toolbar.className = "code-toolbar";
    const label = document.createElement("span"); label.textContent = lang ?? "Signature";
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copy";
    copy.setAttribute("aria-label", `Copy ${lang ?? "signature"} code`);
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(raw); copy.textContent = "Copied"; $("#doc-status").textContent = "Code copied to clipboard"; }
      catch { $("#doc-status").textContent = "Copy unavailable. Select the code to copy it."; }
      setTimeout(() => { copy.textContent = "Copy"; }, 2000);
    });
    toolbar.append(label, copy); frame.prepend(toolbar);
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>("#nav a")) {
    if (a.href === location.href || (!a.hash && a.pathname === location.pathname && (!document.body.hasAttribute("data-api") || !location.hash))) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

interface SearchItem { name: string; description: string; href: string; kind: string; }
const navigationScrollKey = () => `aster-docs-nav:${documentationRoot().pathname}:${matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop"}`;

export function restoreNavigationScroll(): void {
  const navigation = $("#nav");
  if (!navigation.getClientRects().length) return;
  try {
    const saved = sessionStorage.getItem(navigationScrollKey());
    const position = saved === null ? undefined : Number(saved);
    if (position !== undefined && Number.isFinite(position) && position >= 0) navigation.scrollTop = position;
  } catch { /* Storage is optional. */ }
}

let initialized = false;
export function initDocs(): void {
  if (initialized) return;
  initialized = true;
  $(".skip").addEventListener("click", event => {
    if (!document.body.hasAttribute("data-api")) return;
    event.preventDefault();
    $("#content").focus();
    window.scrollTo(0, 0);
  });
  const scheme = $<HTMLSelectElement>("#doc-scheme");
  try { scheme.value = localStorage.getItem("aster-docs-scheme") ?? "system"; } catch { /* Storage is optional. */ }
  const media = matchMedia("(prefers-color-scheme: dark)");
  const syncPreviews = () => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>("main iframe")) {
      try {
        if (frame.contentDocument) frame.contentDocument.documentElement.dataset.scheme = document.documentElement.dataset.scheme;
        frame.contentWindow?.postMessage({ type: "aster-example-appearance", scheme: document.documentElement.dataset.scheme }, location.origin);
      }
      catch { /* Cross-origin examples own their appearance. */ }
    }
  };
  const apply = () => {
    document.documentElement.dataset.scheme = scheme.value === "system" ? (media.matches ? "dark" : "light") : scheme.value;
    syncPreviews();
  };
  for (const frame of document.querySelectorAll("main iframe")) frame.addEventListener("load", syncPreviews);
  apply(); media.addEventListener("change", apply);
  scheme.addEventListener("change", () => { apply(); try { localStorage.setItem("aster-docs-scheme", scheme.value); } catch { /* Storage is optional. */ } });
  const menu = $<HTMLButtonElement>(".menu-toggle");
  const navigation = $("#nav");
  const rememberNavigationScroll = () => {
    if (!navigation.getClientRects().length) return;
    try { sessionStorage.setItem(navigationScrollKey(), String(navigation.scrollTop)); }
    catch { /* Storage is optional. */ }
  };
  addEventListener("pagehide", rememberNavigationScroll);
  if (!document.body.hasAttribute("data-api")) restoreNavigationScroll();
  const closeMenu = () => { rememberNavigationScroll(); menu.setAttribute("aria-expanded", "false"); document.body.classList.remove("nav-open"); };
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    if (!open) rememberNavigationScroll();
    menu.setAttribute("aria-expanded", String(open)); document.body.classList.toggle("nav-open", open);
    if (open) restoreNavigationScroll();
  });
  $("#nav").addEventListener("click", e => { if ((e.target as Element).closest("a")) closeMenu(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.body.classList.contains("nav-open")) { closeMenu(); menu.focus(); }
  });
  const input = $<HTMLInputElement>("#search"), results = $("#results"), status = $("#search-status");
  let index: SearchItem[] = [];
  let indexFailed = false;
  const update = () => {
    const q = input.value.trim().toLowerCase();
    const score = (entry: SearchItem) => entry.name.toLowerCase() === q ? 0 : entry.name.toLowerCase().startsWith(q) ? 1 : entry.name.toLowerCase().includes(q) ? 2 : entry.description.toLowerCase().includes(q) ? 3 : 9;
    const found = q ? index.map(e => ({ e, score: score(e) })).filter(x => x.score < 9).sort((a, b) => a.score - b.score).slice(0, 40).map(x => x.e) : [];
    results.hidden = !q;
    results.innerHTML = found.map(e => `<li><a href="${esc(e.href)}"><span>${esc(e.name)}</span><small>${esc(e.kind)}</small></a></li>`).join("") || `<li class="search-empty">${indexFailed ? "Search unavailable. Browse using the sidebar." : index.length ? "No results. Try a component or task name." : "Loading search…"}</li>`;
    status.textContent = q ? `${found.length} results` : "";
  };
  Promise.all([fetch(new URL("reference/reference.json", documentationRoot())).then(r => { if (!r.ok) throw new Error("Reference unavailable"); return r.json(); }), fetch(new URL("guide/search.json", documentationRoot())).then(r => { if (!r.ok) throw new Error("Guides unavailable"); return r.json(); })]).then(([api, guides]) => {
    index = [...guides.map((entry: SearchItem) => ({ ...entry, href: new URL(entry.href, new URL("guide/search.json", documentationRoot())).href })), ...api.map((e: { ref: string; name: string; definingClass?: string; description: string; kind: string }) => ({ name: e.definingClass ? `${e.definingClass.replace(/^\w+:/, "")}.${e.name}` : e.name, description: e.description, kind: e.kind === "group" ? "Topic" : "API", href: new URL(`reference/#${encodeURIComponent(e.ref)}`, documentationRoot()).href }))];
    if (input.value) update();
  }).catch(() => { indexFailed = true; if (input.value) update(); });
  input.addEventListener("input", update);
  input.addEventListener("focus", () => { if (input.value) update(); });
  const close = () => { results.hidden = true; };
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowDown") { e.preventDefault(); results.querySelector<HTMLAnchorElement>("a")?.focus(); }
  });
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
if (!document.body.hasAttribute("data-api")) { initDocs(); enhanceArticle(); initExplorer(); }
