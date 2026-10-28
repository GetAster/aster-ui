import { $ } from "../shared/dom.ts";
import { initNavigation } from "../features/navigation/navigation.ts";
import { initAppearance } from "../features/appearance/appearance.ts";
import { initSearch } from "../features/search/search.ts";

let initialized = false;
/** Shared shell startup for static articles and the routed API reference. */
export function initDocs(options: { onAppearanceChange?: (scheme: string) => void } = {}): void {
  if (initialized) return;
  initialized = true;
  $(".skip").addEventListener("click", event => {
    if (!document.body.hasAttribute("data-docs-routed")) return;
    event.preventDefault();
    $("#content").focus();
    window.scrollTo(0, 0);
  });
  initNavigation();
  initAppearance(options.onAppearanceChange);
  initSearch();
}
