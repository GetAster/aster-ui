import { $ } from "../../shared/dom.ts";

export function initAppearance(onChange?: (scheme: string) => void): void {
  const scheme = $<HTMLSelectElement>("#doc-scheme");
  try { scheme.value = localStorage.getItem("aster-docs-scheme") ?? "system"; } catch { /* Storage is optional. */ }
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.scheme = scheme.value === "system" ? (media.matches ? "dark" : "light") : scheme.value;
    onChange?.(document.documentElement.dataset.scheme);
  };
  apply(); media.addEventListener("change", apply);
  scheme.addEventListener("change", () => { apply(); try { localStorage.setItem("aster-docs-scheme", scheme.value); } catch { /* Storage is optional. */ } });
}
