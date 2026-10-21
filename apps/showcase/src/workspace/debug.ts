import { signal } from "@preact/signals-core";
import { keyFromText, keyText, type EditModel, type Entity, type Explanation } from "@getaster/data";
import type { Toaster, Window } from "@getaster/elements";
import { html, nothing } from "lit-html";
import type { AppSetup } from "./setup.ts";

interface Why {
  readonly label: string;
  readonly rules: readonly Explanation[];
}

/** The field focused last, and the rules behind its state. */
const why = signal<Why | undefined>(undefined);
let watching = false;

function watchFocus(): void {
  if (watching) return;
  watching = true;
  document.addEventListener("focusin", (e) => {
    const host = (e.target as Element).closest<HTMLElement & { model?: EditModel; field?: string; label?: string }>(
      "aster-field, aster-select, aster-picker, aster-check, aster-date",
    );
    const model = host?.model;
    if (!host || !model || !host.field) return;
    why.value = { label: host.label || model.type.field(host.field)?.title || host.field, rules: model.explain(host.field) };
  });
}

function explain({ effect, rule, reason, holds, reads, cases, matched, value, overridden, current, error }: Explanation) {
  const read = Object.entries(reads)
    .map(([path, value]) => `${path} = ${JSON.stringify(value) ?? "undefined"}`)
    .join(", ");
  if (effect === "derived") return html`<li><b>derived</b> ${cases === undefined ? "Computed in code" : matched === undefined ? "No case decided" : `Case ${matched + 1}`}: ${JSON.stringify(value) ?? "undefined"}
    <span>${read}</span>${overridden ? html`<i>Kept your value: ${JSON.stringify(current)}</i>` : nothing}${error ? html`<i>${error}</i>` : nothing}</li>`;
  return html`<li><b>${effect}</b> ${holds ? "applies" : "doesn’t apply"}: ${typeof rule === "string" ? rule : JSON.stringify(rule)}
    <span>${read}</span>${reason ? html`<i>${reason}</i>` : nothing}</li>`;
}

/**
 * Controls for exercising sync (shown with `?debug`), in a window beside
 * the page: another user's edits arrive through the mock's realtime
 * stand-in, and faults make the next save fail or every write slow. "Why"
 * shows the page rules behind the focused field's state, following focus.
 */
export function debugPanel(setup: AppSetup, toaster: () => Toaster | null) {
  const { mock, model, ctx } = setup;
  const target = (): { id: number; entity: Entity } | undefined => {
    const route = model.route.peek();
    const key = route.page === "project" && route.id !== undefined ? keyText([route.id]) : model.selection.key.peek();
    const entity = key === undefined ? undefined : ctx.store.get("Projects", key)?.entity;
    return key === undefined || !entity ? undefined : { id: Number(keyFromText(key)[0]), entity };
  };
  const external = async (method: "PATCH" | "POST", url: string, body: object) => {
    const res = await mock.external({
      method,
      url,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status >= 300) toaster()?.show(`The simulated change failed (${res.status}).`);
  };
  const actions: [string, () => Promise<void> | void][] = [
    [
      "Rename it",
      async () => {
        const t = target();
        if (t) await external("PATCH", `Projects(${t.id})`, { name: `${String(t.entity.name)} (revised)` });
      },
    ],
    [
      "Pause or resume it",
      async () => {
        const t = target();
        if (t) await external("PATCH", `Projects(${t.id})`, { state: t.entity.state === "active" ? "paused" : "active" });
      },
    ],
    [
      "Add a task to it",
      async () => {
        const t = target();
        if (!t) return;
        const due = new Date(Date.parse(`${model.today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        await external("POST", "Tasks", { projectId: t.id, title: "Check the new figures", due, assigneeId: 2, done: false });
      },
    ],
    [
      "Fail the next save",
      () => mock.faults.failNext(503, { code: "ServiceUnavailable", message: "The server is busy. Try again in a moment." }),
    ],
    [
      "Slow writes",
      () => {
        mock.faults.writeLatencyMs = mock.faults.writeLatencyMs ? 0 : 1200;
        toaster()?.show(mock.faults.writeLatencyMs ? "Writes now take 1.2 s" : "Writes are fast again");
      },
    ],
    [
      "Reset data",
      async () => {
        await mock.reset();
        location.reload();
      },
    ],
  ];
  watchFocus();
  const w = why.value;
  const body = html`<div class="debug-body">
    <p>As another user, on the selected project:</p>
    ${actions.map(([label, run]) => html`<button type="button" @click=${() => void run()}>${label}</button>`)}
    <p>Why: ${w ? w.label : "focus a field to see its rules."}</p>
    ${w ? (w.rules.length ? html`<ul class="why">${w.rules.map(explain)}</ul>` : html`<p class="why-none">No page rules; its state comes from metadata.</p>`) : nothing}
  </div>`;
  return html`<button type="button" class="debug" aria-haspopup="dialog"
      @click=${(e: MouseEvent) => document.querySelector<Window>("aster-window.debug-window")?.toggle(e.currentTarget as HTMLElement)}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3"/></svg>Simulate</button>
    <aster-window class="debug-window" .heading=${"Simulate"} .content=${body}></aster-window>`;
}
