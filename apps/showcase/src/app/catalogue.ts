export const examples = [
  { id: "foundations", navigationLabel: "Fields & layouts", title: "Fields and layouts for everyday work", category: "Fields & layouts", file: "foundations.html", action: "Explore fields and layouts", ref: "class:CompositeField",
    description: "Group related editors, keep numeric values exact, resize nested panes and navigate retained settings and context.",
    task: "Edit a budget, revert its group, then resize the workspace and open its settings." },
  { id: "mail", navigationLabel: "Mail workspace", title: "Mail that keeps your draft", category: "Authentication recovery", file: "mail.html", action: "Open the mail workspace", ref: "class:Authentication",
    description: "Read messages, keep several drafts open and recover an expired session through a configurable sign-in flow. The entire example uses local mock data.",
    task: "Start a draft, expire the session, then send it and complete simulated sign-in." },
  { id: "tiles", navigationLabel: "Tile grids", title: "Folders & device fleets", category: "Tile grids", file: "tiles.html", action: "Explore tile grids", ref: "class:TileGrid",
    description: "Browse folders or a virtual fleet of 100,000 devices. Switch between tiles and a table while keeping your selection.",
    task: "Try ordered selection, change the tile size, then switch views." },
  { id: "filters", navigationLabel: "Filtering", title: "Queries you can compose", category: "Advanced filtering", file: "filtering.html", action: "Build an expression", ref: "class:FilterBuilder",
    description: "Combine nested All, Any and Not groups with typed fields, platform choices, related records and relative dates.",
    task: "Open Advanced filter, choose Platform, then try “is one of”." },
  { id: "reports", navigationLabel: "Reporting", title: "From rows to answers", category: "Reporting & grouping", file: "reporting.html", action: "Explore grouped reports", ref: "class:Grid",
    description: "Get exact totals across every matching record, expand multiple grouping levels and export the filtered result or ordered picks.",
    task: "Group by Platform → Online → Site, then download a CSV." },
  { id: "charts", navigationLabel: "Charts", title: "Charts that work with your data", category: "Component integration", file: "components.html", action: "Connect charts and grids", ref: "class:ComponentHost",
    description: "Optional ECharts components share filters and selection with a grid. HTML data views provide the same keyboard and touch actions.",
    task: "Choose a platform in the chart, then select a device in either view." },
  { id: "windows", navigationLabel: "Windows", title: "A workspace that keeps your place", category: "Application windows", file: "windows.html", action: "Explore application windows", ref: "class:Window",
    description: "Move between device details and editable notes. Minimize, maximize and restore without recreating content, with guarded close and saved layouts.",
    task: "Write a note, minimize it, then restore it from the task list." },
  { id: "dashboard", navigationLabel: "Dashboard", title: "Build your own fleet workspace", category: "Dashboard composition", file: "dashboard.html", action: "Compose a dashboard", ref: "class:Dashboard",
    description: "Arrange summaries, charts, device grids and notes. Widgets share live filters and selection, with saved layouts and protected edits.",
    task: "Filter by platform, add a device, then move or maximize a widget." },
  { id: "dataview", navigationLabel: "DataView", title: "A directory made of custom cards", category: "DataView", file: "dataview.html", action: "Explore DataView", ref: "group:data-view",
    description: "Browse a team directory with images, custom templates, live search and server-side sorting. Selection and updates follow the shared data layer.",
    task: "Sort Z to A, try compact cards, then open and rename a colleague." },
  { id: "tabs", navigationLabel: "Tabs", title: "A place for every open device", category: "Tabs", file: "tabs.html", action: "Explore tabs", ref: "class:Tabs",
    description: "Open data-driven tabs with lazy panels, retained drafts and optional close actions. A scrolling strip works on touch screens and narrow windows.",
    task: "Write a note, switch tabs, then try closing your unsaved device." },
] as const;

export type ExampleId = typeof examples[number]["id"];

/** The standalone editor is also available from each component example. */
export const standaloneExamples: readonly (readonly [string, string])[] = [
  ...examples.slice(0, 2).map(example => [example.file, example.navigationLabel] as const),
  ["composition.html", "Composition"],
  ...examples.slice(2).map(example => [example.file, example.navigationLabel] as const),
];
