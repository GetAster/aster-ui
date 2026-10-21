import type { Entity, FieldRules, KeyText, Saved } from "@getaster/data";
import type { GridView, Lookup, MenuItem, Toaster } from "@getaster/elements";
import { AsterElement, define, type View } from "@getaster/elements";
import { html } from "lit-html";
import type { AppSetup } from "../setup.ts";

const VIEW: GridView = {
  columns: [
    { field: "date", width: 140 },
    { field: "personId", width: 150 },
    { field: "projectId" },
    { field: "hours" },
    { field: "billable" },
    { field: "status" },
    { field: "note" },
  ],
  sort: [{ field: "date", descending: true }],
  filters: {},
  frozen: 2,
};

const LOOKUPS: Readonly<Record<string, Lookup>> = {
  personId: { set: "People", display: "name" },
  projectId: { set: "Projects", display: "name" },
};

const APPROVED = { op: "eq", field: "row.record.status", value: "approved" } as const;

/**
 * Approved time is fixed; a manager reopens it by changing the status.
 * Moving an entry to another project suggests whether it's billable: time
 * on a project with a client is, unless you say otherwise.
 */
const RULES: Readonly<Record<string, FieldRules>> = {
  hours: { readOnly: { when: APPROVED, reason: "Approved time can't be changed. Set the status back to Submitted first." } },
  date: { readOnly: { when: APPROVED, reason: "Approved time can't be changed. Set the status back to Submitted first." } },
  billable: { derived: [{ when: { op: "eq", field: "row.values.project.clientId", value: null }, value: false }, { value: true }] },
};

/** Everyone's time entries: 100,000 rows in one grid. */
export class TimePage extends AsterElement {
  #setup!: AppSetup;

  set setup(v: AppSetup) {
    this.#setup = v;
  }

  /** Moving an entry through draft, submitted and approved, or deleting it; each with Undo. */
  #rowMenu = (entity: Entity, key: KeyText): MenuItem[] => {
    const { ctx } = this.#setup;
    const toaster = () => document.querySelector<Toaster>("aster-toaster");
    const status = (to: string, verb: string): MenuItem => ({
      label: verb,
      run: async () => {
        const saved: Saved = await ctx.update("TimeEntries", key, { status: to });
        toaster()?.show(`${verb}: ${entity.hours} hours on ${entity.date}`, { label: "Undo", run: () => void ctx.undo(saved) });
      },
    });
    return [
      ...(entity.status === "draft" ? [status("submitted", "Submit")] : []),
      ...(entity.status === "submitted" ? [status("approved", "Approve"), status("draft", "Back to draft")] : []),
      ...(entity.status === "approved" ? [status("submitted", "Reopen")] : []),
      {
        label: "Delete entry",
        run: async () => {
          const change = await ctx.remove("TimeEntries", key);
          toaster()?.show(`Deleted ${entity.hours} hours on ${entity.date}`, { label: "Undo", run: () => void ctx.undo(change) });
        },
      },
    ];
  };

  protected render(): View {
    return html`<div class="head"><h1>Time</h1></div><div></div>
      <aster-grid class="time-grid" .ctx=${this.#setup.ctx} .set=${"TimeEntries"} .view=${VIEW} .lookups=${LOOKUPS}
        .label=${"Time entries"} .publish=${"time"} .persist=${"time"} .editable=${true} .rules=${RULES} .rowMenu=${this.#rowMenu} .empty=${"No time entries match."}></aster-grid>`;
  }
}

define("aster-time-page", TimePage);
