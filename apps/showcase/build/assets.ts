import { resolve } from "node:path";

/** Public filenames are stable, independent of the feature folder layout. */
export const exampleAssets: Readonly<Record<string, string>> = {
  "composition-registry.js": "src/examples/composition/composition-registry.js",
  "composition-mock.js": "src/examples/composition/composition-mock.js",
  "mail-mock.js": "src/examples/mail/mail-mock.js",
  "composition.js": "src/examples/composition/composition.js",
  "composition.html": "src/examples/composition/composition.html",
  "composition.ui.yaml": "src/examples/composition/composition.ui.yaml",
  "composition-model.js": "src/examples/composition/composition-model.js",
  "composition-details.js": "src/examples/composition/composition-details.js",
  "composition-status.js": "src/examples/composition/composition-status.js",
  "mail.js": "src/examples/mail/mail.js",
  "mail.html": "src/examples/mail/mail.html",
  "mail.ui.yaml": "src/examples/mail/mail.ui.yaml",
  "mail-model.js": "src/examples/mail/mail-model.js",
  "mail.css": "src/examples/mail/mail.css",
  "control-states.html": "src/examples/foundations/control-states.html",
  "control-states.js": "src/examples/foundations/control-states.js",
  "foundations.js": "src/examples/foundations/foundations.js",
  "foundations.html": "src/examples/foundations/foundations.html",
  "folder-picker.js": "src/examples/foundations/folder-picker.js",
  "folder-picker.css": "src/examples/foundations/folder-picker.css",
  "collection-demo.js": "src/examples/collections/collection-demo.js",
  "collection-demo.html": "src/examples/collections/collection-demo.html",
  "collection-demo.css": "src/examples/collections/collection-demo.css",
  "tiles.js": "src/examples/tiles/tiles.js",
  "tiles.html": "src/examples/tiles/tiles.html",
  "tiles-paged.js": "src/examples/tiles/tiles-paged.js",
  "tabs.js": "src/examples/tabs/tabs.js",
  "tabs.html": "src/examples/tabs/tabs.html",
  "windows.js": "src/examples/windows/windows.js",
  "windows.html": "src/examples/windows/windows.html",
  "dashboard.js": "src/examples/dashboard/dashboard.js",
  "dashboard.html": "src/examples/dashboard/dashboard.html",
  "components.js": "src/examples/charts/components.js",
  "components.html": "src/examples/charts/components.html",
  "filtering.js": "src/examples/filtering/filtering.js",
  "filtering.html": "src/examples/filtering/filtering.html",
  "reporting.js": "src/examples/reporting/reporting.js",
  "reporting.html": "src/examples/reporting/reporting.html",
  "dataview.js": "src/examples/dataview/dataview.js",
  "dataview.html": "src/examples/dataview/dataview.html",
  "conversations.js": "src/examples/conversations/conversations.js",
  "conversations.html": "src/examples/conversations/conversations.html",
  "conversations.css": "src/examples/conversations/conversations.css",
  "first-grid.js": "src/examples/first-grid/first-grid.js",
  "first-grid.html": "src/examples/first-grid/first-grid.html",
  "examples.js": "src/examples/sandbox/examples.js",
  "index.html": "src/examples/sandbox/index.html",
  "showcase-nav.js": "src/shared/navigation/showcase-nav.js",
  "showcase.css": "src/shared/navigation/showcase.css"
};

export function exampleSource(root: string, file: string): string {
  const source = exampleAssets[file];
  if (!source) throw new Error(`Unknown example asset: ${file}`);
  return resolve(root, "apps/showcase", source);
}
