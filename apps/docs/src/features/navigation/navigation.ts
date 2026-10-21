import { $ } from "../../shared/dom.ts";
import { documentationRoot } from "../../shared/paths.ts";

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

export function initNavigation(): void {
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
}
