import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

interface Excerpt { title: string; explanation: string; file: string; from?: string; to?: string; }
const collection = "scripts/site/playground/collection-demo.js";
const tabs = "scripts/site/playground/tabs.js";
const windows = "scripts/site/playground/windows.js";
const dashboard = "scripts/site/playground/dashboard.js";
const excerpts: Record<string, readonly Excerpt[]> = {
  composition: [
    { title: "Bind two presentations to one model", explanation: "The YAML names the children and connects their collection, selection and renderer properties. It is configuration over the same runtime used by JavaScript definitions.", file: "scripts/site/playground/composition.ui.yaml", from: "  table:\n    type: Grid", to: "  details:\n    type: DeviceDetails" },
    { title: "Connect actions and their PageRules", explanation: "Command names resolve to exports from the registered model. The Save rule reads published editor state; the executable save function stays in JavaScript.", file: "scripts/site/playground/composition.ui.yaml", from: "commands:\n  table:", to: "children:\n  status:" },
    { title: "Implement queries, commands and cleanup in JavaScript", explanation: "This is the running model and its save function. The lifetime releases the collection and editor. A single editor survives table/tile switching, and saving updates their shared store.", file: "scripts/site/playground/composition-model.js", from: "async function saveDevice", to: "export const deviceWorkspaceType" },
    { title: "Register a lazy child through ordinary module loading", explanation: "The registry allowlists the component and supplies its dynamic import. YAML activates the named child; it cannot invent executable code or arbitrary module URLs.", file: "scripts/site/playground/composition.js", from: "let detailsModule;", to: "const authoring =" },
  ],
  foundations: [
    { title: "Choose sources while browsing folders", explanation: "The host owns selected IDs, lazy folder loading, cancellation, history and return positions. Row selection and opening a folder are separate actions. The shared hierarchy supplies retained ancestor content and accessible focus transitions.", file: "scripts/site/playground/folder-picker.js", from: "  function content(id) {", to: "  function paint(opener) {" },
    { title: "Load folders without losing confirmed content", explanation: "Only a successful, current request changes location and history. A superseding request aborts its predecessor; failure retains the visible folder and choices for retry.", file: "scripts/site/playground/folder-picker.js", from: "  async function navigate(", to: "  function choose(" },
    { title: "Keep model fields together without merging their values", explanation: "The group borrows the project editor. Each numeric child keeps its own metadata, validation and pending state; group revert acts on budget and spend only.", file: "scripts/site/playground/foundations.js", from: '  render(html`<aster-field .model=${model}', to: '  effect(() => { byId("group-output")' },
    { title: "Configure exact numeric input", explanation: "Canonical numeric strings preserve every digit. An explicit step controls exact increments without binary floating-point conversion.", file: "scripts/site/playground/foundations.js", from: 'Object.assign(exact,', to: 'render(html`<aster-composite-field' },
    { title: "Retain settings after lazy creation", explanation: "Panel IDs own template identity. The Notes factory runs on first expansion; ordinary toggling retains its textarea.", file: "scripts/site/playground/foundations.js", from: 'accordion.items = [', to: 'const path = byId' },
    { title: "Own the contextual navigation path", explanation: "Breadcrumb actions, child buttons and Back call the same showLocation action. It updates the hierarchy and breadcrumb trail together. The host retains folder notes across ancestor jumps; browser history is unchanged.", file: "scripts/site/playground/foundations.js", from: 'const path = byId', to: 'const rail = byId' },
  ],
  mail: [
    { title: "Provide the sign-in interaction", explanation: "This complete application handler offers simulated passkey, email and SSO flows. It settles or cancels the shared recovery and releases its dialog listeners when aborted.", file: "scripts/site/playground/mail.js", from: "function recover", to: "const auth =" },
    { title: "Coordinate challenges and replay in the data layer", explanation: "This is the framework implementation executed by the demo. It shows request parking, shared recovery, fresh credentials, generation checks, cancellation, deadlines and identity checks.", file: "packages/data/src/authentication.ts", from: "export class Authentication {" },
    { title: "Retain a draft until sending succeeds", explanation: "The model keeps the same draft while authentication is pending or fails. Only a successful send removes it; the mock rejects expired requests before applying writes.", file: "scripts/site/playground/mail-model.js", from: "    send: own(", to: "  return { values:" },
  ],
  grid: [
    { title: "Create paged collections and their views", explanation: "ctx is the existing DataContext. Collections own loaded pages; the table and tiles are presentation controls.", file: collection, from: "  const collections = {", to: "  const active = signal" },
    { title: "Bind the same collection to both presentations", explanation: "The existing selection is detached before changing datasets, then a new selection is bound. Column widths are pixels; an omitted width shares remaining space.", file: collection, from: "    table.selection = tiles.selection = undefined;", to: "    tiles.toggleAttribute" },
    { title: "Keep picked keys outside the rendered rows", explanation: "Both controls use the same Selection. Changing its policy starts a new selection in this demo.", file: collection, from: "  function bindSelection()", to: "  function bindDataset()" },
  ],
  "tile-grid": [
    { title: "Provide accessible text and custom tile templates", explanation: "presentTile describes each record for accessibility; renderTile supplies the folder or device presentation. The same outer tile shell handles focus and selection.", file: collection, from: "    tiles.toggleAttribute", to: "    query(); bindSelection(); show();" },
    { title: "Control tile size through CSS variables", explanation: "The size control writes sizing intent. The component owns responsive packing and virtualization.", file: collection, from: "  const size = () =>", to: "  const show = () =>" },
    { title: "Share selection with the table view", explanation: "Selection is attached to the collection rather than to individual rendered tiles.", file: collection, from: "  function bindSelection()", to: "  function bindDataset()" },
  ],
  tabs: [
    { title: "Drive descriptors and lazy panels from records", explanation: "records and selected are application signals. The renderer returns panel templates; visited panels remain mounted while the owner retains their descriptors.", file: tabs, from: 'tabs.label = "Open devices";', to: "function remove(id)" },
    { title: "Handle the close request in the application", explanation: "The owner decides whether a dirty record may close. A refused close leaves the panel and its draft intact.", file: tabs, from: "function requestClose(id)", to: 'document.querySelector("#add")' },
  ],
  windows: [
    { title: "Register managed windows with durable content", explanation: "workspace is a Workspace instance; device and notes are existing aster-window elements. Stable registration IDs let the task list reopen the same content.", file: windows, from: "for (const [id, window, heading]", to: "device.content =" },
    { title: "Guard unsaved notes before closing", explanation: "The content owner supplies a boolean or asynchronous close decision. Here a dialog settles that decision; the workspace does not discard drafts on its own.", file: windows, from: "notes.beforeClose =", to: "for (const id of [\"device\", \"notes\"])" },
    { title: "Save and restore window placement", explanation: "The snapshot is placement data. Note contents have a separate lifetime and are not serialized here.", file: windows, from: 'document.querySelector("#save-layout")', to: 'window.addEventListener("pagehide"' },
  ],
  dashboard: [
    { title: "Register a live widget factory and its disposer", explanation: "ctx and filters are shared page models. This factory owns its exact summary and releases it when disposed. track is demo lifecycle instrumentation around the returned session.", file: dashboard, from: 'dashboard.registerType("summary"', to: "let vendor;" },
    { title: "Restore a layout with stable widget IDs", explanation: "Each descriptor names a registered type. Configuration belongs to the widget; the dashboard owns placement and order.", file: dashboard, from: "const defaults = [", to: 'const picker=document.querySelector' },
    { title: "Create a notes widget with a removal guard", explanation: "The widget owns its input and dirty signal. beforeRemove asks the application to settle a destructive removal; moving the widget keeps its session.", file: dashboard, from: 'dashboard.registerType("notes"', to: "const defaults = [" },
  ],
  charts: [
    { title: "Mount, update, resize and dispose the ECharts instance", explanation: "This is the actual echartsAdapter implementation used by the preview. It shows runtime.init, setOption, resize, click listener registration/removal and disposal. options is supplied by the application; environment is supplied by ComponentHost.", file: "packages/elements/src/component/echarts.ts", from: "export function echartsAdapter" },
    { title: "Bundle the optional ECharts runtime", explanation: "This vendor entry imports ECharts itself. The site build emits the module as playground/vendor/echarts.js; the application loads it lazily. The integration guide includes installation and the standalone bundle command.", file: "scripts/site/vendors/echarts.ts" },
    { title: "Turn live data signals into chart options and actions", explanation: "groups is a grouped query over the shared context. Reading its signals in option makes updates reactive. The click callback translates a vendor event into a shared platform filter.", file: "scripts/site/playground/components.js", from: "platforms.adapter=echartsAdapter", to: "costs.label=" },
  ],
};
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function excerpt(root: string, entry: Excerpt): string {
  const text = readFileSync(join(root, entry.file), "utf8");
  const start = entry.from ? text.indexOf(entry.from) : 0;
  const end = entry.to ? text.indexOf(entry.to, start + 1) : text.length;
  if (start < 0 || end < 0 || end <= start) throw new Error(`Example excerpt no longer matches ${entry.file}: ${entry.title}`);
  if (entry.file.endsWith(".yaml")) {
    const lines = text.slice(start, end).trimEnd().split("\n");
    const indent = Math.min(...lines.filter(line => line.trim()).map(line => /^\s*/.exec(line)![0].length));
    return lines.map(line => line.slice(indent)).join("\n");
  }
  const source = ts.createSourceFile(entry.file, text.slice(start, end).trim(), ts.ScriptTarget.Latest, true, entry.file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const multiline = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) ts.setEmitFlags(node, ts.EmitFlags.MultiLine);
    ts.forEachChild(node, multiline);
  };
  multiline(source);
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(source);
}

/** Focus on the advertised capability before offering complete application files. */
export function featureCode(root: string, id: string): string {
  const entries = excerpts[id];
  if (!entries) throw new Error(`No feature code for example ${id}`);
  return `<section class="example-feature-code" aria-labelledby="feature-code"><h2 id="feature-code">Code for this example</h2><p>These excerpts come from the code running above, formatted for reading. They focus on the component behaviour; imports, fixtures and page setup are available in Full application source below.</p>${entries.map(entry => `<section data-feature-code><h3>${entry.title}</h3><p>${entry.explanation}</p><p class="example-source-name">From <code>${entry.file}</code></p><pre><code class="language-${entry.file.endsWith(".yaml") ? "yaml" : entry.file.endsWith(".ts") ? "typescript" : "javascript"}">${escape(excerpt(root, entry))}</code></pre></section>`).join("")}</section>`;
}
