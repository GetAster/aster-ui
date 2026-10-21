import type { Signal, ReadonlySignal } from "@preact/signals-core";
import { examples } from "./catalogue.ts";

export const mobileExamples = "(max-width: 720px), (pointer: coarse) and (max-width: 1024px)";

export function exampleUrl(file: string, theme: string, scheme: string): string {
  const url = new URL(`playground/${file}`, libraryRoot());
  url.searchParams.set("theme", theme);
  url.searchParams.set("scheme", scheme);
  url.searchParams.set("showcase", "1");
  url.searchParams.set("app", new URL(".", document.baseURI).pathname);
  return url.href;
}

export function libraryRoot(): URL {
  return new URL(document.querySelector<HTMLMetaElement>('meta[name="aster-library-root"]')?.content ?? "../", document.baseURI);
}


/** Native links remain usable with modifier keys and browser history. */
export function bindShowcaseRouting(target: HTMLElement, active: Signal<string>, theme: ReadonlySignal<string>, scheme: ReadonlySignal<string>): () => void {
  const select = (id: string, replace: boolean) => {
    const example = examples.find(example => example.id === id);
    if (id !== "all" && !example) return;
    if (example && matchMedia(mobileExamples).matches) {
      const url = exampleUrl(example.file, theme.peek(), scheme.peek());
      if (replace) location.replace(url); else location.assign(url);
      return;
    }
    active.value = id;
  };
  const navigate = (event: Event) => {
    if (!(event instanceof CustomEvent) || !(event.target instanceof HTMLElement) || event.target.localName !== "aster-sidebar") return;
    const id = String(event.detail);
    if (id !== "all" && !examples.some(example => example.id === id)) return;
    event.preventDefault();
    if (!matchMedia(mobileExamples).matches || id === "all") {
      const hash = id === "all" ? "#showcase" : `#showcase/${id}`;
      if (location.hash !== hash) history.pushState(null, "", hash);
    }
    select(id, false);
  };
  const readLocation = () => select(location.hash.slice(1).split("/")[1] ?? "all", true);
  target.addEventListener("navigate", navigate);
  window.addEventListener("popstate", readLocation);
  window.addEventListener("hashchange", readLocation);
  readLocation();
  return () => {
    target.removeEventListener("navigate", navigate);
    window.removeEventListener("popstate", readLocation);
    window.removeEventListener("hashchange", readLocation);
  };
}
