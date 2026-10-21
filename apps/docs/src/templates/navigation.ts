import { navigationGroups } from "../app/navigation.ts";
import { esc } from "../shared/dom.ts";

export function navigation(): string {
  return `<a class="nav-overview" href="../reference/">Documentation overview</a>
    ${navigationGroups.map(group => `<p class="nav-label">${esc(group.label)}</p><ul>${group.links.map(link => `<li><a href="${esc(link.href)}">${esc(link.label)}</a></li>`).join("")}</ul>`).join("")}
    <p class="nav-label">API reference</p><div id="api-nav"><a href="../reference/#class:Grid">Browse the API →</a></div>`;
}
