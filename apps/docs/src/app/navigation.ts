export interface NavigationGroup {
  readonly label: string;
  readonly links: readonly { readonly href: string; readonly label: string }[];
}

export const navigationGroups: readonly NavigationGroup[] = [
  { label: "Start here", links: [
    { href: "../guide/why-aster.html", label: "Why Aster UI?" },
    { href: "../guide/evaluating-aster-ui.html", label: "Is Aster UI a fit?" },
    { href: "../guide/getting-started.html", label: "Get started" },
    { href: "../guide/library.html", label: "Installation & distribution" },
    { href: "../guide/data-model.html", label: "The shared data model" },
    { href: "../guide/themes.html", label: "Theming" },
  ] },
  { label: "Component explorer", links: [
    { href: "../examples/", label: "All examples" },
    { href: "../examples/grid.html", label: "Grid examples" },
    { href: "../examples/tile-grid.html", label: "TileGrid examples" },
    { href: "../examples/composition.html", label: "JS & YAML workspace" },
    { href: "../examples/mail.html", label: "Mail & session recovery" },
    { href: "../examples/tabs.html", label: "Tabs workspace" },
    { href: "../examples/windows.html", label: "Windows workspace" },
    { href: "../examples/dashboard.html", label: "Live dashboard" },
    { href: "../examples/charts.html", label: "Connected charts" },
    { href: "../examples/foundations.html", label: "Fields, layouts & folder selection" },
  ] },
  { label: "Build with Aster", links: [
    { href: "../guide/fields-and-layouts.html", label: "Compose fields & layouts" },
    { href: "../guide/connected-views.html", label: "Connect a grid and form" },
    { href: "../guide/declarative-workspace.html", label: "Compose a workspace" },
    { href: "../guide/application-structure.html", label: "Organize an application" },
    { href: "../guide/workspace-patterns.html", label: "Customize workspaces" },
    { href: "../guide/workspace-tooling.html", label: "Registry & editor tooling" },
    { href: "../guide/composition-controls.html", label: "Built-in controls & navigation" },
    { href: "../guide/keyed-sessions.html", label: "Retained views & background activity" },
    { href: "../guide/authentication.html", label: "Authentication & session recovery" },
    { href: "../guide/filter-group-export.html", label: "Filter, group & export" },
    { href: "../guide/formatted-values.html", label: "Value formatting & server sorting" },
    { href: "../guide/progress-status.html", label: "Progress & loading feedback" },
    { href: "../reference/#class:Grid", label: "Grid" },
    { href: "../reference/#class:TileGrid", label: "TileGrid & DataView" },
    { href: "../reference/#class:Tabs", label: "Tabs" },
    { href: "../reference/#class:Dashboard", label: "Dashboards" },
    { href: "../#showcase", label: "Component showcase ↗" },
  ] },
  { label: "Experimental components", links: [
    { href: "../guide/conversation-preview.html", label: "Conversation reader preview" },
  ] },
  { label: "Advanced", links: [
    { href: "../guide/data.html", label: "Data core internals" },
    { href: "../guide/elements.html", label: "Element internals" },
  ] },
];
