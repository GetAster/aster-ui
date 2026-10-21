import { Workspace } from "@getaster/elements";
import { html, render } from "lit-html";
import { signal, effect } from "@preact/signals-core";

const workspace = new Workspace();
const device = document.querySelector("#device");
const notes = document.querySelector("#notes");
const confirm = document.querySelector("#confirm");
const status = document.querySelector("#workspace-status");
const dirty = signal(false);
const saved = signal("");
let resolveClose;
let decision = false;
const storageKey = "aster-showcase-workspace-v1";
const say = text => { status.textContent = text; };

for (const [id, window, heading] of [["device", device, "Device details"], ["notes", notes, "Notes"]]) {
  window.heading = heading;
  window.managed = true;
  window.preserveContent = true;
  workspace.register(id, window);
  window.addEventListener("closeerror", () => say("Could not close the window. Your content is still open."));
}
device.setPlacement({ state: "normal", bounds: { x: 64, y: 460, width: 390, height: 340 } });
notes.setPlacement({ state: "normal", bounds: { x: 490, y: 460, width: 390, height: 340 } });
device.content = html`<p>A device inspector stays mounted while you work elsewhere.</p>
  <dl class="device-detail"><dt>Device</dt><dd>Engineering workstation</dd><dt>Platform</dt><dd>Linux</dd><dt>Connection</dt><dd>Online</dd></dl>
  <aster-choice .label=${"Device action"} .value=${"inspect"} .options=${[{ value: "inspect", label: "Inspect device" }, { value: "logs", label: "View logs" }, { value: "restart", label: "Schedule restart" }]}></aster-choice>
  <p>Try the dropdown while another window overlaps this one. Its popup stays above the active window.</p>`;
function saveNotes() {
  saved.value = notes.querySelector("textarea")?.value ?? saved.peek();
  dirty.value = false;
  say("Notes saved for this visit.");
}
notes.content = html`<label for="note-text">Workspace notes</label><textarea id="note-text" placeholder="Write a note, then minimize this window…"
  @input=${() => { dirty.value = true; }}></textarea>
  <footer><button type="button" class="aster-button" @click=${saveNotes}>Save notes</button><span role="status" id="notes-status">Saved</span></footer>`;
effect(() => {
  const changed = dirty.value;
  queueMicrotask(() => { const label = notes.querySelector("#notes-status"); if (label) label.textContent = changed ? "Unsaved changes" : "Saved"; });
});
notes.beforeClose = () => {
  if (!dirty.peek()) return true;
  return new Promise(resolve => {
    resolveClose = resolve;
    decision = false;
    confirm.labelledBy = "confirm-title";
    confirm.content = html`<h2 id="confirm-title">Close unsaved notes?</h2><p>Your changes will be discarded.</p>
      <div class="bar"><button type="button" class="aster-button" @click=${() => confirm.close()}>Keep editing</button>
      <button type="button" class="aster-button" @click=${() => {
        decision = true;
        const input = notes.querySelector("textarea");
        if (input) input.value = saved.peek();
        dirty.value = false;
        confirm.close();
      }}>Discard changes</button></div>`;
    queueMicrotask(() => confirm.show(document.activeElement));
  });
};
confirm.addEventListener("close", () => { resolveClose?.(decision); resolveClose = undefined; });
for (const id of ["device", "notes"]) document.querySelector(`#open-${id}`).addEventListener("click", event => workspace.show(id, event.currentTarget));
effect(() => {
  const active = workspace.active.value;
  const entries = workspace.entries.filter(entry => entry.window.open);
  const buttons = entries.map(entry => ({ id: entry.id, heading: entry.window.heading, state: entry.window.state }));
  render(html`${buttons.map(entry => html`<button type="button" class="aster-button" aria-pressed=${String(active === entry.id)}
    @click=${event => workspace.show(entry.id, event.currentTarget)}>${entry.heading}${entry.state === "minimized" ? " — minimized" : ""}</button>`)}`, document.querySelector("#tasks"));
});
document.addEventListener("keydown", event => {
  if (event.key !== "F6" || document.querySelector("dialog:modal")) return;
  event.preventDefault(); workspace.cycle(event.shiftKey);
});
document.querySelector("#save-layout").addEventListener("click", () => {
  try { localStorage.setItem(storageKey, JSON.stringify(workspace.snapshot())); say("Layout saved on this browser."); }
  catch { say("Layout could not be saved on this browser."); }
});
document.querySelector("#restore-layout").addEventListener("click", () => {
  try {
    const json = localStorage.getItem(storageKey);
    if (!json) return say("Save a layout first.");
    workspace.restore(JSON.parse(json)); say("Saved layout restored. Notes remain unchanged.");
  } catch { say("The saved layout could not be restored."); }
});
window.addEventListener("pagehide", () => workspace.dispose(), { once: true });
