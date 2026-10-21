import { html } from "lit-html";
import { AsterElement, define, type View } from "@getaster/elements";
import { icons } from "../../workspace/icons.ts";
import type { Theme } from "../../workspace/themes.ts";
import { examples } from "../catalogue.ts";
import { exampleUrl, libraryRoot } from "../routing.ts";

/** Discoverable entry points to independent, working component examples. */
class ShowcaseGallery extends AsterElement {
  readonly #theme = this.prop<Theme>("lamplight");
  readonly #scheme = this.prop<"light" | "dark">("light");

  get theme(): Theme { return this.#theme.value; }
  set theme(value: Theme) { this.#theme.value = value; }
  get scheme(): "light" | "dark" { return this.#scheme.value; }
  set scheme(value: "light" | "dark") { this.#scheme.value = value; }

  protected render(): View {
    return html`<div class="head"><h1>Component showcase</h1></div>
      <div class="content showcase-content">
        <div class="showcase-intro"><p class="showcase-eyebrow">Explore the latest components</p>
          <p>Real data interactions, from a folder of tiles to a chart that filters a grid. Open an example and try it with your keyboard, touch, or a different theme.</p>
        </div>
        <div class="showcase-cards">
          ${examples.map(example => html`<article class="showcase-card" aria-labelledby=${`showcase-${example.id}`}>
            ${preview(example.id)}
            <div class="showcase-card-body"><p class="showcase-eyebrow">${example.category}</p>
              <h2 id=${`showcase-${example.id}`}>${example.title}</h2><p>${example.description}</p>
              <p class="showcase-task">${example.task}</p>
              <div class="showcase-actions"><a class="showcase-open" href=${this.#exampleUrl(example.file)}>${example.action}<span aria-hidden="true">→</span></a>
                <a class="showcase-reference" href=${new URL(`${document.querySelector('meta[name="aster-reference-root"]')?.getAttribute("content") ?? "reference/"}#${example.ref}`, libraryRoot()).href}>API reference<span class="aster-sr-only"> for ${example.category}</span></a></div>
            </div>
          </article>`)}
        </div>
        <p class="showcase-note">Each example runs with sample data in your browser. Use the data controls to explore loading, paging, selection and recovery.</p>
        <a class="showcase-back" href="#home">Back to Home</a>
      </div>`;
  }

  #exampleUrl(file: string): string {
    return exampleUrl(file, this.#theme.value, this.#scheme.value);
  }
}

function preview(kind: typeof examples[number]["id"]): View {
  switch (kind) {
    case "foundations":
      return html`<div class="showcase-preview showcase-report" aria-hidden="true"><div><strong>Project finances</strong><span>£42,000.59</span></div><div><span>Notes</span><strong>Draft retained</strong></div><footer><span>Related fields</span><strong>Revert group</strong></footer></div>`;
    case "mail":
      return html`<div class="showcase-preview showcase-report" aria-hidden="true"><div><strong>Inbox</strong><span>16 unread</span></div><div><span>New message</span><strong>Draft retained</strong></div><footer><span>Session expired</span><strong>Sign in and continue</strong></footer></div>`;
    case "tabs":
      return html`<div class="showcase-preview showcase-report" aria-hidden="true"><div><strong>Overview</strong><span>Device 1 ×</span><span>Device 2 ×</span></div><div><span>Workspace notes</span><strong>Draft retained</strong></div><footer><span>Lazy panels</span><strong>Your open devices</strong></footer></div>`;
    case "dataview":
      return html`<div class="showcase-preview showcase-report" aria-hidden="true"><div><span>Amira Ahmed</span><strong>Engineering</strong></div><div><span>Ben Bennett</span><strong>Design</strong></div><footer><span>Custom cards</span><strong>Live collection data</strong></footer></div>`;
    case "tiles":
      return html`<div class="showcase-preview showcase-tiles" aria-hidden="true">${["Projects", "Images", "Documents", "Devices"].map(label => html`<span>${icons.folder}<span>${label}</span></span>`)}</div>`;
    case "filters":
      return html`<div class="showcase-preview showcase-filter" aria-hidden="true"><span>All of these</span><div><span>Platform</span><strong>is one of</strong><span>Linux · Windows</span></div><div><span>Enrolled</span><strong>within</strong><span>Last 7 days</span></div></div>`;
    case "reports":
      return html`<div class="showcase-preview showcase-report" aria-hidden="true"><div><span>▾ Linux</span><strong>80 devices</strong></div><div><span>　▾ Online</span><strong>40 devices</strong></div><div><span>　　 Site A</span><strong>20 devices</strong></div><footer><span>Matching records</span><strong>240</strong></footer></div>`;
    case "dashboard":
      return html`<div class="showcase-preview showcase-report" aria-hidden="true"><div><span>Fleet overview</span><strong>240 devices</strong></div><div><span>Platform mix</span><strong>▂ ▆ ▄</strong></div><footer><span>Your widgets</span><strong>Your layout</strong></footer></div>`;
    case "windows":
      return html`<div class="showcase-preview showcase-report" aria-hidden="true"><div><span>Device details</span><strong>− □ ×</strong></div><div><span>Notes</span><strong>− □ ×</strong></div><footer><span>Your workspace</span><strong>2 open windows</strong></footer></div>`;
    case "charts":
      return html`<div class="showcase-preview showcase-chart" aria-hidden="true"><div class="showcase-bars"><i></i><i></i><i></i><i></i><i></i><i></i></div><span>${icons.links}Shared filters & selection</span></div>`;
  }
}


define("aster-showcase-gallery", ShowcaseGallery);
