import "@getaster/elements";
import { html, render } from "lit-html";

const toaster = document.querySelector("#toaster");
const dialog = document.querySelector("#modal");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const button = (label, run) => html`<button type="button" class="aster-button" @click=${run}>${label}</button>`;

render(html`
  ${button("Info", () => toaster.show("Draft saved"))}
  ${button("Success", () => toaster.show("Invoice sent", { variant: "success" }))}
  ${button("Warning", () => toaster.show("Storage is nearly full", { variant: "warning" }))}
  ${button("Error", () => toaster.show("Could not reach the server", { variant: "error" }))}
  ${button("With Undo", () => toaster.show("Moved to Archive", { label: "Undo", run: () => toaster.show("Move undone") }))}
`, document.querySelector("#variants"));

// An export reports records read; the total is known here, so the bar is determinate.
async function exportRows() {
  const total = 1204;
  const id = toaster.show("Exporting…", { variant: "loading", progress: 0 });
  for (let read = 0; read < total; read += 301) {
    await wait(350);
    toaster.update(id, { progress: Math.min(read + 301, total) / total });
  }
  toaster.update(id, { message: `Exported ${total.toLocaleString("en-GB")} rows`, variant: "success", progress: null });
}
render(html`
  ${button("Export 1,204 rows", exportRows)}
  ${button("Save (slow)", () => void toaster.promise(wait(1200).then(() => 7), { loading: "Saving…", success: n => `Saved ${n} changes`, error: "Could not save" }))}
  ${button("Save (fast)", () => void toaster.promise(Promise.resolve(3), { loading: "Saving…", success: n => `Saved ${n} changes`, error: "Could not save" }))}
  ${button("Save (fails)", () => void toaster.promise(wait(500).then(() => { throw new Error("Network down"); }), { loading: "Saving…", success: "Saved", error: e => `Could not save: ${e.message}` }).catch(() => {}))}
`, document.querySelector("#work"));

dialog.content = html`<div class="dialog-body"><h2 id="modal-title">A modal dialog</h2>
  <p>Toast timers stop while this is open.</p>
  ${button("Show a toast", () => toaster.show("Raised from the dialog"))}
  ${button("Close", () => dialog.close())}</div>`;
dialog.labelledBy = "modal-title";
render(html`
  ${button("Show five", () => { for (let i = 1; i <= 5; i++) toaster.show(`Message ${i}`); })}
  ${button("Same message twice", () => { toaster.show("Offline", { dedupe: true }); toaster.show("Offline", { dedupe: true }); })}
  ${button("Open modal dialog", e => dialog.show(e.currentTarget))}
  ${button("Pause", () => toaster.pause())}
  ${button("Resume", () => toaster.resume())}
  ${button("Dismiss all", () => toaster.dismissAll())}
`, document.querySelector("#stack"));
window.toasterDemo = { toaster, dialog };
document.body.dataset.ready = "true";
