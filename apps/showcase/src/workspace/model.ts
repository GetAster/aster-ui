import { computed, signal } from "@preact/signals-core";
import {
  countBy,
  countWhere,
  PageScope,
  Selection,
  subtractExact,
  sum,
  type Collection,
  type Criteria,
  type DataContext,
  type Value,
} from "@getaster/data";
import type { Clock } from "./clock.ts";

export const STATES = ["active", "paused", "archived"] as const;
export type State = (typeof STATES)[number];

export const PAGES = ["home", "projects", "project", "people", "tasks", "model", "time", "reports", "showcase"] as const;
export type Page = (typeof PAGES)[number];

export interface Route {
  readonly page: Page;
  readonly tab: State;
  /** The project on `project`, the person on `people`, the task revealed on `tasks`, the field on `model`. */
  readonly id?: number;
  /** After the id: the tab of the task's or field's editor (`#tasks/7/subtasks`, `#model/12/answers`). */
  readonly detail?: string;
}

/** The signed-in user. */
export const ME = 1;

const eq = (field: string, value: Value): Criteria => ({ op: "eq", field, value });

/**
 * Everything the Projects screen shows, as collections and values derived
 * from them. Nothing here is copied: the nav badge and the ledger figure are
 * the same signal, and every figure follows the store through its collection.
 */
export function createModel(ctx: DataContext, clock: Clock) {
  const today = new Date(clock.now()).toISOString().slice(0, 10);
  const weekStart = startOfWeek(clock.now());
  const weekEnd = new Date(Date.parse(weekStart) + 6 * 86_400_000).toISOString().slice(0, 10);

  const projects = Object.fromEntries(
    STATES.map((state) => [
      state,
      ctx.collection(
        { set: "Projects", filter: eq("state", state), orderBy: [{ field: "updatedAt", descending: true }] },
        { pageSize: 250 },
      ),
    ]),
  ) as Record<State, Collection>;
  const active = projects.active;

  // The figures count top-level tasks; subtasks are steps within them.
  const topLevel = eq("parentId", null);
  const openTasks = ctx.collection({ set: "Tasks", filter: { op: "and", args: [eq("done", false), topLevel] } }, { pageSize: 1000 });
  const dueThisWeek = ctx.collection(
    {
      set: "Tasks",
      filter: {
        op: "and",
        args: [eq("done", false), topLevel, { op: "ge", field: "due", value: today }, { op: "le", field: "due", value: weekEnd }],
      },
      orderBy: [{ field: "due" }],
    },
    { pageSize: 50 },
  );
  const pinned = ctx.collection({
    set: "Projects",
    filter: eq("pinned", true),
    orderBy: [{ field: "updatedAt", descending: true }],
  });
  const people = ctx.collection({ set: "People", orderBy: [{ field: "name" }] });
  const members = ctx.collection({ set: "Members" });
  const notes = ctx.collection({ set: "Notes", filter: eq("pinned", true), orderBy: [{ field: "createdAt", descending: true }] });

  const route = signal<Route>({ page: "projects", tab: "active" });
  const activeCount = active.count;
  const onTrack = countWhere(active, eq("health", "onTrack"));
  const behind = countWhere(active, eq("health", "behind"));
  const createdThisWeek = countWhere(active, { op: "ge", field: "createdAt", value: weekStart });
  const archivedThisWeek = countWhere(projects.archived, { op: "ge", field: "archivedAt", value: weekStart });
  const budget = sum(active, "budget");
  const spent = sum(active, "spent");

  return {
    today,
    weekStart,
    projects,
    openTasks,
    dueThisWeek,
    pinned,
    people,
    members,
    notes,
    /** Open tasks per project id. */
    openByProject: countBy(openTasks, "projectId"),
    activeCount,
    /** Active projects added this week, less those archived this week. */
    activeChange: computed(() => {
      const added = createdThisWeek.value;
      const removed = archivedThisWeek.value;
      return added === undefined || removed === undefined ? undefined : added - removed;
    }),
    onSchedule: computed(() => {
      const n = activeCount.value;
      const ok = onTrack.value;
      return n === undefined || ok === undefined ? undefined : n === 0 ? 100 : Math.round((ok / n) * 100);
    }),
    behind,
    budgetLeft: computed(() =>
      budget.value === undefined || spent.value === undefined ? undefined : subtractExact(budget.value, spent.value),
    ),
    budget,
    route,
    /** The selected project in the current tab, shared by the list, the pinned shortcuts and the debug panel. */
    selection: new Selection(ctx.store, computed(() => projects[route.value.tab])),
    /** The app's page scope; each page publishes into a child of it. Paths follow related records through `ctx`. */
    scope: new PageScope(undefined, { ctx }),
    /** Loads what the screen needs; collections stay live afterwards. */
    load(): Promise<unknown> {
      return Promise.all([
        ...STATES.map((s) => projects[s].loadAll()),
        openTasks.loadAll(),
        dueThisWeek.loadAll(),
        pinned.loadAll(),
        people.loadAll(),
        members.loadAll(),
        notes.ensure(0, 1),
      ]);
    },
  };
}

export type Model = ReturnType<typeof createModel>;

/** Midnight UTC on the Monday of `t`'s week. */
function startOfWeek(t: number): string {
  const d = new Date(t);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return new Date(monday).toISOString().replace(".000Z", "Z");
}

export function isState(v: string | undefined): v is State {
  return (STATES as readonly string[]).includes(v ?? "");
}

export function isPage(v: string | undefined): v is Page {
  return (PAGES as readonly string[]).includes(v ?? "");
}
