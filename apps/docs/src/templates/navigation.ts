import { renderNavigation } from "@getaster/docs";
import { navigationGroups } from "../app/navigation.ts";

export function navigation(): string {
  return renderNavigation(navigationGroups, { href: "../reference/", label: "Documentation overview" },
    '<p class="nav-label">API reference</p><div id="api-nav"><a href="../reference/#class:Grid">Browse the API →</a></div>');
}
