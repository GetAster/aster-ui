import { $ } from "../../shared/dom.ts";

export function initAppearance(): void {
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
}
