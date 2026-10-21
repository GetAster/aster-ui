import { signal } from "@preact/signals-core";
import { Command, command } from "@getaster/data";
import { html } from "lit-html";
import { AsterElement, Composite, asterComponents, compositeElement, compositeTypes as t, define, defineCompositeModel, defineCompositeRegistry, defineCompositeRenderer, type SidebarItem, type CompositeDefinition, type View } from "@getaster/elements";
import { icons } from "../icons.ts";
import type { Theme } from "../themes.ts";

const EXAMPLES = [
  { id: "foundations", title: "Fields and layouts for everyday work", category: "Fields & layouts", file: "foundations.html", action: "Explore fields and layouts", ref: "class:CompositeField",
    description: "Group related editors, keep numeric values exact, resize nested panes and navigate retained settings and context.",
    task: "Edit a budget, revert its group, then resize the workspace and open its settings." },
  { id: "mail", title: "Mail that keeps your draft", category: "Authentication recovery", file: "mail.html", action: "Open the mail workspace", ref: "class:Authentication",
    description: "Read messages, keep several drafts open and recover an expired session through a configurable sign-in flow. The entire example uses local mock data.",
    task: "Start a draft, expire the session, then send it and complete simulated sign-in." },
  { id: "tiles", title: "Folders & device fleets", category: "Tile grids", file: "tiles.html", action: "Explore tile grids", ref: "class:TileGrid",
    description: "Browse folders or a virtual fleet of 100,000 devices. Switch between tiles and a table while keeping your selection.",
    task: "Try ordered selection, change the tile size, then switch views." },
  { id: "filters", title: "Queries you can compose", category: "Advanced filtering", file: "filtering.html", action: "Build an expression", ref: "class:FilterBuilder",
    description: "Combine nested All, Any and Not groups with typed fields, platform choices, related records and relative dates.",
    task: "Open Advanced filter, choose Platform, then try “is one of”." },
  { id: "reports", title: "From rows to answers", category: "Reporting & grouping", file: "reporting.html", action: "Explore grouped reports", ref: "class:Grid",
    description: "Get exact totals across every matching record, expand multiple grouping levels and export the filtered result or ordered picks.",
    task: "Group by Platform → Online → Site, then download a CSV." },
  { id: "charts", title: "Charts that work with your data", category: "Component integration", file: "components.html", action: "Connect charts and grids", ref: "class:ComponentHost",
    description: "Optional ECharts components share filters and selection with a grid. HTML data views provide the same keyboard and touch actions.",
    task: "Choose a platform in the chart, then select a device in either view." },
  { id: "windows", title: "A workspace that keeps your place", category: "Application windows", file: "windows.html", action: "Explore application windows", ref: "class:Window",
    description: "Move between device details and editable notes. Minimize, maximize and restore without recreating content, with guarded close and saved layouts.",
    task: "Write a note, minimize it, then restore it from the task list." },
  { id: "dashboard", title: "Build your own fleet workspace", category: "Dashboard composition", file: "dashboard.html", action: "Compose a dashboard", ref: "class:Dashboard",
    description: "Arrange summaries, charts, device grids and notes. Widgets share live filters and selection, with saved layouts and protected edits.",
    task: "Filter by platform, add a device, then move or maximize a widget." },
  { id: "dataview", title: "A directory made of custom cards", category: "DataView", file: "dataview.html", action: "Explore DataView", ref: "group:data-view",
    description: "Browse a team directory with images, custom templates, live search and server-side sorting. Selection and updates follow the shared data layer.",
    task: "Sort Z to A, try compact cards, then open and rename a colleague." },
  { id: "tabs", title: "A place for every open device", category: "Tabs", file: "tabs.html", action: "Explore tabs", ref: "class:Tabs",
    description: "Open data-driven tabs with lazy panels, retained drafts and optional close actions. A scrolling strip works on touch screens and narrow windows.",
    task: "Write a note, switch tabs, then try closing your unsaved device." },
] as const;

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
          ${EXAMPLES.map(example => html`<article class="showcase-card" aria-labelledby=${`showcase-${example.id}`}>
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
    const url = new URL(`playground/${file}`, libraryRoot());
    url.searchParams.set("theme", this.#theme.value);
    url.searchParams.set("scheme", this.#scheme.value);
    url.searchParams.set("showcase", "1");
    url.searchParams.set("app", new URL(".", document.baseURI).pathname);
    return url.href;
  }
}

function preview(kind: typeof EXAMPLES[number]["id"]): View {
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

function libraryRoot(): URL {
  return new URL(document.querySelector<HTMLMetaElement>('meta[name="aster-library-root"]')?.content ?? "../", document.baseURI);
}

define("aster-showcase-gallery", ShowcaseGallery);

const showcaseModel = defineCompositeModel({
  inputs: { theme: t.signal(t.string), scheme: t.signal(t.string) },
  exports: {
    active: t.signal(t.string), theme: t.signal(t.string), scheme: t.signal(t.string),
    navigation: t.array(t.object({ id: t.string, label: t.string, icon: t.string })),
  },
  commands: Object.fromEntries(["all", ...EXAMPLES.map(example => example.id)].map(id => [id, t.instance(Command)])),
  create: ({ theme, scheme }, lifetime) => {
    const active = signal("all");
    const navigation = [ { id: "all", label: "All examples", icon: "▦" },
      ...EXAMPLES.map(example => ({ id: example.id, label: example.category, icon: "◇" })) ];
    const commands = Object.fromEntries(navigation.map(item => [item.id, lifetime.own(command({
      label: item.label, run: () => { active.value = item.id; },
    }))]));
    return { values: { active, theme, scheme, navigation }, commands };
  },
});

const showcaseAuthoring = defineCompositeRegistry({
  inputs: { theme: t.signal(t.string), scheme: t.signal(t.string) },
  models: { showcase: showcaseModel },
  renderers: { categoryIcon: defineCompositeRenderer(["renderIcon"], (item: SidebarItem) => {
    switch (item.id) {
      case "tiles": return icons.folder;
      case "filters": return icons.tasks;
      case "reports": case "charts": return icons.reports;
      case "windows": case "dashboard": return icons.model;
      case "dataview": return icons.people;
      case "tabs": return icons.projects;
      default: return icons.showcase;
    }
  }) },
  components: {
    Sidebar: asterComponents.Sidebar,
    Gallery: compositeElement("aster-showcase-gallery", { theme: t.string, scheme: t.string }),
    Preview: {
      props: { file: t.string, title: t.string, theme: t.string, scheme: t.string },
      load: async () => (await import("./showcase-preview.ts")).createPreview,
      apply: (element, props) => { for (const [key, value] of Object.entries(props)) Reflect.set(element, key, value); },
    },
  },
});
const appearance = { theme: { bind: "model.theme" }, scheme: { bind: "model.scheme" } } as const;
const showcaseDefinition: CompositeDefinition = showcaseAuthoring.validate({
  version: 1, name: "ShowcaseBrowser", model: { type: "showcase", inputs: { theme: { ref: "inputs.theme" }, scheme: { ref: "inputs.scheme" } } },
  commands: Object.fromEntries(["all", ...EXAMPLES.map(example => example.id)].map(id => [id, { use: `model.commands.${id}` }])),
  children: {
    navigation: { type: "Sidebar", props: { label: "Showcase categories", items: { ref: "model.navigation" }, renderIcon: { renderer: "categoryIcon" }, value: { bind: "model.active" } } },
    gallery: { type: "Gallery", props: appearance },
    ...Object.fromEntries(EXAMPLES.map(example => [example.id, {
      type: "Preview", create: "on-demand", retain: false,
      props: { file: example.file, title: example.category, ...appearance },
    }])),
  },
  layout: { type: "stack", items: [ { child: "navigation" }, { type: "deck", active: { bind: "model.active" }, items: {
    all: { child: "gallery" }, ...Object.fromEntries(EXAMPLES.map(example => [example.id, { child: example.id }])),
  } } ] },
});

/** The showcase uses the same registry, ownership and activation runtime as application screens. */
export class ShowcasePage extends AsterElement {
  readonly #theme = this.prop<Theme>("lamplight");
  readonly #scheme = this.prop<"light" | "dark">("light");
  #workspace: Composite | undefined;
  get theme(): Theme { return this.#theme.value; }
  set theme(value: Theme) { this.#theme.value = value; }
  get scheme(): "light" | "dark" { return this.#scheme.value; }
  set scheme(value: "light" | "dark") { this.#scheme.value = value; }
  protected render(): View { return html`<div class="showcase-workspace"></div>`; }
  protected override updated(): void {
    if (this.#workspace) return;
    this.#workspace = new Composite(showcaseDefinition, showcaseAuthoring.registry, {
      inputs: { theme: this.#theme, scheme: this.#scheme },
      placement: showcaseAuthoring.placement(showcaseDefinition, place => html`
        <div class="showcase-browser"><aside>${place("navigation")}</aside><section aria-label="Component examples">${place("gallery")}${EXAMPLES.map(example => place(example.id))}</section></div>`),
    }).mount(this.querySelector<HTMLElement>(".showcase-workspace")!);
    this.listen(this, "navigate" as keyof WindowEventMap, event => {
      if (!(event instanceof CustomEvent) || !(event.target instanceof HTMLElement) || event.target.localName !== "aster-sidebar") return;
      const action = this.#workspace?.commands[String(event.detail)];
      if (action) { event.preventDefault(); void action.execute().catch(() => {}); }
    });
  }
  override disconnectedCallback(): void {
    this.#workspace?.dispose(); this.#workspace = undefined;
    super.disconnectedCallback();
  }
}
define("aster-showcase-page", ShowcasePage);
