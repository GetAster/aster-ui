import { computed, effect, type ReadonlySignal } from "@preact/signals-core";
import {
  filtersPublication,
  SharedFilters,
  type Collection,
  type Consumed,
  type Contribution,
  type Entity,
  type Groups,
  type PageScope,
  type Query,
  type RelativeDate,
} from "@getaster/data";
import { AsterElement, define, each, formatDate, provideScope, type GridView, type Lookup, type View } from "@getaster/elements";
import { html, nothing } from "lit-html";
import type { AppSetup } from "../../setup.ts";

const ENTRIES: Query = { set: "TimeEntries", orderBy: [{ field: "date", descending: true }] };
const OPEN_TASKS: Query = {
  set: "Tasks",
  filter: { op: "and", args: [{ op: "eq", field: "done", value: false }, { op: "ne", field: "due", value: null }] },
  orderBy: [{ field: "due" }, { field: "id" }],
};

const PERIODS: readonly { readonly label: string; readonly from: RelativeDate }[] = [
  { label: "This week", from: { relative: "today", startOf: "week" } },
  { label: "Last 30 days", from: { relative: "today", days: -29 } },
  { label: "Last 90 days", from: { relative: "today", days: -89 } },
];

const VIEW: GridView = {
  columns: [{ field: "date", width: 130 }, { field: "personId", width: 150 }, { field: "projectId" }, { field: "hours" }, { field: "billable" }, { field: "status" }],
  sort: [{ field: "date", descending: true }],
  filters: {},
  frozen: 1,
};

const LOOKUPS: Readonly<Record<string, Lookup>> = {
  personId: { set: "People", display: "name" },
  projectId: { set: "Projects", display: "name" },
};

interface Report {
  readonly scope: PageScope;
  readonly filters: SharedFilters;
  /** Hours by status, for the chart; it doesn't follow its own pick. */
  readonly byStatus: Groups;
  /** Hours by billable, for the figures. */
  readonly totals: Groups;
  readonly time: ReadonlySignal<Consumed>;
  readonly tasks: ReadonlySignal<Consumed>;
  readonly openTasks: Collection;
  readonly dispose: () => void;
}

/**
 * Time across every project, sliced by period and project health, with a
 * chart of hours by status that filters the rest when a bar is pressed. All
 * of it goes through the page's shared filter (`filters` in the scope): the
 * chips show what's applied, and each list says what it follows.
 */
export class ReportsPage extends AsterElement {
  #setup!: AppSetup;
  readonly #report = this.prop<Report | undefined>(undefined);

  set setup(v: AppSetup) {
    this.#setup = v;
  }

  override connectedCallback(): void {
    // First, so a setup given before the element was defined has arrived.
    super.connectedCallback();
    const { ctx, model } = this.#setup;
    const scope = model.scope.child();
    const filters = new SharedFilters(ctx.schema);
    try {
      const saved = localStorage.getItem("aster-screen:reports:filters");
      if (saved) filters.restore(JSON.parse(saved));
    } catch {
      // A screen still opens when storage is unavailable or no longer matches its schema.
    }
    const stopSaving = effect(() => {
      filters.contributions.value;
      try {
        localStorage.setItem("aster-screen:reports:filters", JSON.stringify(filters.snapshot()));
      } catch {
        // The current slices still apply when storage is unavailable.
      }
    });
    const withdraw = scope.publish("filters", filtersPublication(filters));
    provideScope(this, scope);
    const hours = [{ field: "hours", method: "sum", as: "hours" }] as const;
    const byStatus = ctx.groups(filters.query(ENTRIES, { self: "status" }), "status", hours);
    const totals = ctx.groups(filters.query(ENTRIES), "billable", hours);
    const openTasks = ctx.collection(filters.query(OPEN_TASKS), { pageSize: 8 });
    void openTasks.ensure(0, 8).catch(() => {});
    this.#report.value = {
      scope,
      filters,
      byStatus,
      totals,
      time: filters.consume("TimeEntries"),
      tasks: filters.consume("Tasks"),
      openTasks,
      dispose: () => {
        stopSaving();
        byStatus.dispose();
        totals.dispose();
        ctx.release(openTasks);
        withdraw();
      },
    };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#report.peek()?.dispose();
    this.#report.value = undefined;
  }

  protected render(): View {
    const r = this.#report.value;
    if (!r) return nothing;
    return html`<div class="head"><h1>Reports</h1></div>
      <div class="report-bar">
        <aster-slicer .filters=${r.filters} .label=${"Filtered by"} .empty=${"Nothing. Showing all time."}></aster-slicer>
        ${this.#toggles(r, "period", "Period", PERIODS.map((p) => ({
          label: p.label,
          contribution: { by: "period", label: p.label, set: "TimeEntries", criteria: { op: "ge", field: "date", value: p.from } },
        })))}
        ${this.#toggles(r, "health", "Project health", this.#healths().map((h) => ({
          label: h.label,
          contribution: { by: "health", label: `Project health: ${h.label}`, set: "Projects", criteria: { op: "eq", field: "health", value: h.value } },
        })))}
      </div>
      <div class="content report">
        ${this.#figures(r)}
        <div class="split">
          ${this.#chart(r)}
          ${this.#tasks(r)}
        </div>
        <section aria-labelledby="report-time-title">
          <h2 class="section-title" id="report-time-title">Time entries</h2>
          ${this.#follows(r.time.value)}
          <aster-grid class="report-grid" .ctx=${this.#setup.ctx} .set=${"TimeEntries"} .view=${VIEW} .lookups=${LOOKUPS}
            .base=${r.time.value.criteria} .label=${"Time entries in this report"} .empty=${"No time entries match these filters."}></aster-grid>
        </section>
      </div>`;
  }

  #healths(): { value: string; label: string }[] {
    const field = this.#setup.ctx.schema.set("Projects").type.field("health");
    return (field?.allowedValues ?? []).map((a) => ({ value: String(a.value), label: a.label ?? String(a.value) }));
  }

  /** Buttons that each set one contribution under `by`; pressing the pressed one withdraws it. */
  #toggles(r: Report, by: string, label: string, options: readonly { label: string; contribution: Contribution }[]): View {
    const current = r.filters.contributions.value.find((c) => c.by === by);
    const id = `report-${by}`;
    return html`<div class="report-toggles" role="group" aria-labelledby=${id}>
      <span class="report-toggles-label" id=${id}>${label}</span>
      ${options.map((o) => {
        const pressed = current?.label === o.contribution.label;
        return html`<button type="button" class="report-toggle" aria-pressed=${pressed ? "true" : "false"}
          @click=${() => (pressed ? r.filters.remove(by) : r.filters.set(o.contribution))}>${o.label}</button>`;
      })}
    </div>`;
  }

  #figures(r: Report): View {
    const rows = r.totals.rows.value;
    const total = rows?.reduce((n, g) => n + Number(g.totals.hours ?? 0), 0);
    const billable = rows?.filter((g) => g.value === true).reduce((n, g) => n + Number(g.totals.hours ?? 0), 0);
    const entries = rows?.reduce((n, g) => n + g.count, 0);
    const figure = (label: string, value: string) =>
      html`<div class="aster-figure"><dt>${label}</dt><dd><span class="aster-big" data-figure=${label}>${value}</span></dd></div>`;
    return html`<dl class="aster-ledger ledger report-ledger" aria-busy=${rows === undefined ? "true" : "false"}>
      ${figure("Hours", total === undefined ? "–" : fmt(Math.round(total)))}
      ${figure("Billable", total === undefined || billable === undefined ? "–" : total === 0 ? "–" : `${Math.round((billable / total) * 100)}%`)}
      ${figure("Entries", entries === undefined ? "–" : fmt(entries))}
    </dl>`;
  }

  /** Hours by status as bars; each bar is a button that filters the rest of the page by its status. */
  #chart(r: Report): View {
    const statuses = this.#setup.ctx.schema.set("TimeEntries").type.field("status")?.allowedValues ?? [];
    const rows = r.byStatus.rows.value;
    const hours = (v: unknown) => Number(rows?.find((g) => g.value === v)?.totals.hours ?? 0);
    const total = statuses.reduce((n, s) => n + hours(s.value), 0);
    const picked = r.filters.contributions.value.find((c) => c.by === "status");
    return html`<section aria-labelledby="report-status-title">
      <h2 class="section-title" id="report-status-title">Hours by status</h2>
      <p class="report-hint" id="report-status-hint">Press a bar to show only that status in the figures, the tasks and the entries.</p>
      <div class="report-bars" role="group" aria-labelledby="report-status-title" aria-describedby="report-status-hint" aria-busy=${rows === undefined ? "true" : "false"}>
        ${each(
          statuses.map((s) => ({ value: String(s.value), label: s.label ?? String(s.value) })),
          (s) => s.value,
          (s) => {
            const h = hours(s.value);
            const share = total === 0 ? 0 : h / total;
            const label = `Status: ${s.label}`;
            const pressed = picked?.label === label;
            const contribution: Contribution = { by: "status", label, set: "TimeEntries", kind: "value", criteria: { op: "eq", field: "status", value: s.value } };
            return html`<button type="button" class="report-bar-row" aria-pressed=${pressed ? "true" : "false"}
              aria-label=${`${s.label}: ${fmt(Math.round(h))} hours, ${Math.round(share * 100)}%`}
              @click=${() => (pressed ? r.filters.remove("status") : r.filters.set(contribution))}>
              <span class="report-bar-label">${s.label}</span>
              <span class="report-bar-track" aria-hidden="true"><span class="report-bar-fill" style=${`--share:${share}`}></span></span>
              <span class="report-bar-value">${hoursText(h)}</span>
            </button>`;
          },
        )}
      </div>
    </section>`;
  }

  #tasks(r: Report): View {
    const tasks = r.openTasks.items.value.filter((t): t is Entity => t !== undefined);
    const count = r.openTasks.count.value;
    const { ctx } = this.#setup;
    return html`<section aria-labelledby="report-tasks-title">
      <h2 class="section-title" id="report-tasks-title">Open tasks${count === undefined ? "" : ` ${fmt(count)}`}</h2>
      ${this.#follows(r.tasks.value)}
      ${count === 0 ? html`<p class="quiet">No open tasks on these projects.</p>` : nothing}
      <ul class="report-tasks">
        ${each(tasks, (t) => String(t.id), (t) => {
          const project = ctx.lookup("Projects", `[${t.projectId}]`).value;
          return html`<li><span>${t.title}</span><span class="quiet-text">${project?.name ?? ""} · due ${formatDate(String(t.due))}</span></li>`;
        })}
      </ul>
    </section>`;
  }

  /** What a list follows and what it doesn't, in words. */
  #follows(c: Consumed): View {
    if (c.applied.length === 0 && c.skipped.length === 0) return nothing;
    const list = (xs: readonly { label: string }[]) => xs.map((x) => x.label).join(", ");
    return html`<p class="report-follows">
      ${c.applied.length ? html`<span>Follows ${list(c.applied)}.</span>` : nothing}
      ${c.skipped.length ? html`<span>Doesn’t follow ${list(c.skipped)}: they’re about other records.</span>` : nothing}
    </p>`;
  }
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

function hoursText(h: number): string {
  return `${fmt(Math.round(h))} h`;
}

define("aster-reports-page", ReportsPage);
