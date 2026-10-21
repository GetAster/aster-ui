import { html, render, nothing } from "lit-html";
import { each } from "@getaster/elements";

// Simulated workspace entries. An application supplies its own authorized directory service.
const entries = [
  { id: "workspace", name: "Workspace", directory: true },
  { id: "projects", parent: "workspace", name: "Projects", directory: true },
  { id: "shared", parent: "workspace", name: "Shared", directory: true },
  { id: "archive", parent: "workspace", name: "Archive", directory: true },
  { id: "welcome", parent: "workspace", name: "Welcome.md", size: "2 KB" },
  { id: "aster", parent: "projects", name: "Aster", directory: true },
  { id: "launch", parent: "projects", name: "Launch notes.md", size: "8 KB" },
  { id: "design", parent: "aster", name: "Design", directory: true },
  { id: "brief", parent: "aster", name: "Project brief.pdf", size: "146 KB" },
  { id: "budget", parent: "aster", name: "Budget.csv", size: "12 KB" },
  { id: "design-notes", parent: "design", name: "Interaction notes.md", size: "6 KB" },
  { id: "reviews", parent: "shared", name: "Reviews", directory: true },
  { id: "handbook", parent: "shared", name: "Team handbook.pdf", size: "320 KB" },
  { id: "installer", parent: "shared", name: "Installer.exe", size: "18 MB", unavailable: "This example accepts Markdown, PDF and CSV files" },
  ...Array.from({ length: 32 }, (_, index) => ({ id: `review-${index + 1}`, parent: "reviews", name: `Review ${String(index + 1).padStart(2, "0")}.md`, size: "4 KB" })),
];
const nodes = new Map(entries.map(entry => [entry.id, entry]));
const ancestorIds = id => { const path = []; for (let node = nodes.get(id); node; node = nodes.get(node.parent)) path.unshift(node.id); return path; };
const pathText = id => ancestorIds(id).map(id => nodes.get(id).name).join(" / ");
const icon = kind => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${kind === "folder" ? "M3 6h7l2 2h9v12H3Z" : kind === "file" ? "M6 3h8l4 4v14H6Zm8 0v5h4" : kind === "close" ? "m6 6 12 12M18 6 6 18" : kind === "back" ? "m14 5-7 7 7 7" : "m10 5 7 7-7 7"}/></svg>`;

/** A host-owned selection/navigation example over the shared hierarchy surface. */
export function createFolderPicker(host) {
  const cache = new Map(), selected = new Map(), positions = new Map();
  let current = ["workspace"], back = [], forward = [];
  let busy = false, error = "", failedRequest, failNext = false, foldersOnly = false, confirmation = "";
  let generation = 0, controller, restoreFrame, disposed = false, delayMs = 220;
  const requests = [];

  // The provider is cancellable; navigation does not replace confirmed content until it succeeds.
  async function children(id, signal) {
    requests.push(id);
    const fail = failNext; failNext = false;
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delayMs);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    if (fail) throw new Error("The folder could not be opened. Your current location and choices are unchanged.");
    return entries.filter(entry => entry.parent === id);
  }

  function remember(opener) {
    const list = host.querySelector(`[data-folder-list="${current.at(-1)}"]`);
    const active = opener ?? document.activeElement;
    positions.set(current.at(-1), { top: list?.scrollTop ?? 0, node: list?.contains(active) ? active.dataset.node : positions.get(current.at(-1))?.node, action: list?.contains(active) ? active.dataset.action : positions.get(current.at(-1))?.action });
  }

  async function navigate(path, mode = "push", opener) {
    if (disposed) return;
    const request = ++generation;
    controller?.abort(); controller = new AbortController();
    remember(opener);
    busy = true; error = ""; confirmation = ""; failedRequest = undefined; paint();
    try {
      const id = path.at(-1);
      const rows = cache.has(id) && !failNext ? cache.get(id) : await children(id, controller.signal);
      if (request !== generation || disposed) return;
      cache.set(id, rows);
      if (current.join("/") !== path.join("/")) {
        switch (mode) {
          case "back": forward.push(current); back.pop(); break;
          case "forward": back.push(current); forward.pop(); break;
          case "push": back.push(current); forward = []; break;
        }
      }
      current = path; busy = false; paint(opener);
      cancelAnimationFrame(restoreFrame);
      restoreFrame = requestAnimationFrame(() => {
        if (request !== generation || disposed) return;
        const memory = positions.get(id), list = host.querySelector(`[data-folder-list="${id}"]`);
        if (memory && list) {
          list.scrollTop = memory.top;
          if (mode !== "push" && memory.node) list.querySelector(`[data-node="${memory.node}"][data-action="${memory.action}"]`)?.focus({ preventScroll: true });
        }
      });
    } catch (failure) {
      if (request !== generation || disposed) return;
      busy = false; error = failure.message; failedRequest = { path, mode }; paint();
    }
  }

  function choose(entry, opener) {
    if (opener) remember(opener);
    if (selected.has(entry.id)) selected.delete(entry.id);
    else selected.set(entry.id, entry);
    confirmation = ""; paint();
  }

  function content(id) {
    const rows = cache.get(id);
    return html`<div class="folder-browser-list" data-folder-list=${id} tabindex="0" role="group" aria-label=${`${nodes.get(id).name} entries`} aria-busy=${busy}>
      ${rows === undefined ? html`<p class="folder-empty">${error ? "Retry to load this folder." : "Loading workspace folders…"}</p>` : rows.length === 0 ? html`<p class="folder-empty">This folder is empty. You can still choose the folder itself.</p>` : each(rows, entry => entry.id, entry => {
        const picked = selected.has(entry.id);
        const reason = !picked && (entry.unavailable || (foldersOnly && !entry.directory ? "Choose a folder in folders-only mode" : ""));
        return html`<div class="folder-browser-row" ?data-selected=${picked}>
          <button type="button" class="folder-choose" data-node=${entry.id} data-action="choose" aria-label=${`Select ${entry.name}`} aria-pressed=${picked ? "true" : "false"}
            ?disabled=${!!reason} title=${reason || pathText(entry.id)} @click=${e => choose(entry, e.currentTarget)}>
            ${icon(entry.directory ? "folder" : "file")}<span>${entry.name}${reason ? html`<small>${reason}</small>` : nothing}</span><small>${picked ? "Selected" : entry.directory ? "Folder" : entry.size}</small>
          </button>
          ${entry.directory ? html`<button type="button" class="folder-open" data-node=${entry.id} data-action="open" aria-label=${`Open ${entry.name}`} title=${`Open ${entry.name}`} @click=${e => navigate(ancestorIds(entry.id), "push", e.currentTarget)}>${icon("forward")}</button>` : nothing}
        </div>`;
      })}
    </div>`;
  }

  function paint(opener) {
    if (disposed) return;
    const invalidSelection = foldersOnly && [...selected.values()].some(entry => !entry.directory);
    render(html`<div class="folder-picker-layout">
      <div class="folder-browser">
        <div class="folder-browser-toolbar" role="group" aria-label="Folder navigation">
          <button type="button" class="folder-history" aria-label="Back in folder history" title="Back" ?disabled=${!back.length} @click=${e => navigate(back.at(-1), "back", e.currentTarget)}>${icon("back")}</button>
          <button type="button" class="folder-history" aria-label="Forward in folder history" title="Forward" ?disabled=${!forward.length} @click=${e => navigate(forward.at(-1), "forward", e.currentTarget)}>${icon("forward")}</button>
          <button type="button" class="folder-home" @click=${e => navigate(["workspace"], "push", e.currentTarget)}>Workspace</button>
          <button type="button" class="folder-current" aria-pressed=${selected.has(current.at(-1)) ? "true" : "false"} @click=${() => choose(nodes.get(current.at(-1)))}>Choose this folder</button>
        </div>
        <aster-breadcrumbs .label=${"Folder location"} .maxVisible=${4} .items=${current.map(id => ({ id, label: nodes.get(id).name, activate: () => navigate(ancestorIds(id)) }))}></aster-breadcrumbs>
        <aster-progress-status .busy=${busy} .reserveSpace=${true} .pendingText=${"Opening folder…"} .completeText=${"Folder opened"}></aster-progress-status>
        ${error ? html`<div class="folder-load-error" role="alert"><p>${error}</p><button type="button" class="aster-button" @click=${() => navigate(failedRequest.path, failedRequest.mode)}>Retry opening folder</button></div>` : nothing}
        <aster-contextual-hierarchy .navigationVisible=${false} .motion=${"slide"}></aster-contextual-hierarchy>
      </div>
      <aside class="folder-selection" aria-labelledby="folder-selection-heading">
        <h3 id="folder-selection-heading">Selected sources <span>${selected.size}</span></h3>
        <div class="folder-selected-list" tabindex="0" aria-label="Selected sources">
          ${selected.size ? html`<ul>${each([...selected.values()], entry => entry.id, entry => html`<li>${icon(entry.directory ? "folder" : "file")}<span title=${pathText(entry.id)}>${entry.name}<small>${pathText(entry.id)}</small></span><button type="button" aria-label=${`Remove ${entry.name}`} title=${`Remove ${entry.name}`} @click=${() => {
            choose(entry);
            queueMicrotask(() => host.querySelector(".folder-selected-list button, .folder-current")?.focus());
          }}>${icon("close")}</button></li>`)}</ul>` : html`<p>Choose a file or folder. Your choices stay here as you browse.</p>`}
        </div>
        <div class="bar"><button type="button" class="aster-button" ?disabled=${!selected.size || invalidSelection} @click=${() => { confirmation = `${selected.size} ${selected.size === 1 ? "source is" : "sources are"} ready to use in this example.`; paint(); }}>Use selected sources</button><button type="button" class="folder-clear" ?disabled=${!selected.size} @click=${() => { selected.clear(); confirmation = ""; paint(); }}>Clear</button></div>
        <p class="folder-confirmation" role="status">${invalidSelection ? "Remove selected files to use folders-only mode." : confirmation}</p>
        <label><input type="checkbox" .checked=${foldersOnly} @change=${e => { foldersOnly = e.target.checked; paint(); }}> Choose folders only</label>
        <p class="folder-simulation">Simulated workspace. This example does not read your computer’s files.</p>
        <button type="button" class="folder-fault" @click=${() => { failNext = true; confirmation = "The next folder request will fail, so you can try recovery."; paint(); }}>Fail next folder request</button>
      </aside>
    </div>`, host);
    const viewer = host.querySelector("aster-contextual-hierarchy");
    viewer.navigate(current.map(id => ({ id, title: nodes.get(id).name, content: content(id) })), opener);
  }

  paint(); void navigate(current, "initial");
  return {
    get selected() { return [...selected.keys()]; }, get path() { return [...current]; }, get requests() { return [...requests]; },
    get delayMs() { return delayMs; }, set delayMs(value) { delayMs = value; },
    dispose() { disposed = true; generation++; controller?.abort(); cancelAnimationFrame(restoreFrame); },
  };
}
