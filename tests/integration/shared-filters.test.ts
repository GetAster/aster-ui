// The shared filter channel (design/page-rules.md, "Sharing filters between
// components"): named contributions that collections opt in to; matching by
// field name with compatible types, scoping to sets, one foreign-key hop,
// replacement by contributor, mismatches skipped per collection, and the
// rules that stop a component feeding on itself.
import { beforeEach, describe, expect, test } from "bun:test";
import { signal } from "@preact/signals-core";
import {
  compatible,
  DataContext,
  filtersPublication,
  PageScope,
  parseCsdl,
  Selection,
  selectionShare,
  SharedFilters,
  type ODataRequest,
  type Query,
} from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";
import { timeEntries } from "../../fixtures/aster/time.ts";

const TIME = timeEntries(3000, data.People, data.Projects, "2026-10-07");
const BEHIND = new Set(data.Projects.filter((p) => p.health === "behind").map((p) => p.id));

let mock: MockService;
let ctx: DataContext;
let urls: string[];
let now = Date.UTC(2026, 9, 7, 9);
let filters: SharedFilters;

beforeEach(async () => {
  mock = await createMockService({ metadata, data: { ...data, TimeEntries: TIME }, now: () => "2026-10-07T09:00:00Z" });
  urls = [];
  now = Date.UTC(2026, 9, 7, 9);
  ctx = await DataContext.connect(
    async (r: ODataRequest) => {
      urls.push(decodeURIComponent(r.url));
      return mock.transport(r);
    },
    { now: () => now },
  );
  filters = new SharedFilters(ctx.schema);
});

async function waitFor(done: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

const entries: Query = { set: "TimeEntries", orderBy: [{ field: "id" }] };

async function count(query: Query): Promise<number> {
  const c = ctx.collection(query, { pageSize: 50 });
  await c.ensure(0, 1);
  const n = c.count.value!;
  ctx.release(c);
  return n;
}

describe("contributions", () => {
  test("a contributor replaces only its own entry, in place; contributions AND together; remove withdraws", () => {
    filters.set({ by: "status", label: "Status is approved", set: "TimeEntries", criteria: { op: "eq", field: "status", value: "approved" } });
    filters.set({ by: "billable", label: "Billable", set: "TimeEntries", criteria: { op: "eq", field: "billable", value: true } });
    filters.set({ by: "status", label: "Status is draft", set: "TimeEntries", criteria: { op: "eq", field: "status", value: "draft" } });
    expect(filters.contributions.value.map((c) => c.label)).toEqual(["Status is draft", "Billable"]);
    expect(filters.consume("TimeEntries").value.criteria).toEqual({
      op: "and",
      args: [
        { op: "eq", field: "status", value: "draft" },
        { op: "eq", field: "billable", value: true },
      ],
    });
    filters.remove("status");
    expect(filters.consume("TimeEntries").value.criteria).toEqual({ op: "eq", field: "billable", value: true });
    filters.clear();
    expect(filters.consume("TimeEntries").value).toEqual({ criteria: undefined, applied: [], skipped: [] });
  });

  test("criteria on a set are checked when they're contributed", () => {
    expect(() => filters.set({ by: "x", label: "x", set: "TimeEntries", criteria: { op: "eq", field: "colour", value: "red" } })).toThrow("unknown field 'colour'");
    expect(filters.contributions.value).toEqual([]);
  });

  test("a collection opts in; one that doesn't is untouched", async () => {
    filters.set({ by: "status", label: "Status is draft", set: "TimeEntries", criteria: { op: "eq", field: "status", value: "draft" } });
    const all = ctx.collection(entries, { pageSize: 50 });
    const following = ctx.collection(filters.query(entries), { pageSize: 50 });
    await Promise.all([all.ensure(0, 1), following.ensure(0, 1)]);
    expect(all.count.value).toBe(TIME.length);
    expect(following.count.value).toBe(TIME.filter((t) => t.status === "draft").length);
    filters.remove("status");
    await waitFor(() => following.count.value === TIME.length);
  });

  test("the user's own filter and the shared part stay apart: the query ANDs them", () => {
    filters.set({ by: "status", label: "Status is draft", set: "TimeEntries", criteria: { op: "eq", field: "status", value: "draft" } });
    const own = signal<Query>({ ...entries, filter: { op: "ge", field: "hours", value: "4" } });
    const q = filters.query(own);
    expect(q.value.filter).toEqual({ op: "and", args: [own.value.filter!, { op: "eq", field: "status", value: "draft" }] });
    own.value = entries;
    expect(q.value.filter).toEqual({ op: "eq", field: "status", value: "draft" });
  });

  test("the publication lets rules and labels read the shared filter", () => {
    const scope = new PageScope();
    scope.publish("filters", filtersPublication(filters));
    const any = scope.when("filters.any");
    expect(any.value).toBe(false);
    filters.set({ by: "billable", label: "Billable", set: "TimeEntries", criteria: { op: "eq", field: "billable", value: true } });
    expect(any.value).toBe(true);
    expect(scope.value("filters.labels").value).toEqual(["Billable"]);
    expect(scope.when({ op: "eq", field: "filters.count", value: 1 }).value).toBe(true);
  });
});

describe("matching", () => {
  test("by field name, without a set: where the fields exist; elsewhere skipped with the reason", async () => {
    filters.set({ by: "billable", label: "Billable", criteria: { op: "eq", field: "billable", value: true } });
    const time = filters.consume("TimeEntries").value;
    expect(time.criteria).toEqual({ op: "eq", field: "billable", value: true });
    const tasks = filters.consume("Tasks").value;
    expect(tasks.criteria).toBeUndefined();
    expect(tasks.skipped).toEqual([{ by: "billable", label: "Billable", reason: "Tasks has no field 'billable'" }]);
    expect(await count(filters.query(entries).value)).toBe(TIME.filter((t) => t.billable).length);
  });

  test("an integer filters a decimal field, in the decimal's JSON form", async () => {
    filters.set({ by: "long", label: "4 hours or more", criteria: { op: "ge", field: "hours", value: 4 } });
    expect(filters.consume("TimeEntries").value.criteria).toEqual({ op: "ge", field: "hours", value: "4" });
    expect(await count(filters.query(entries).value)).toBe(TIME.filter((t) => Number(t.hours) >= 4).length);
  });

  test("type compatibility: the same type, integers into any number, relative dates into dates and timestamps", () => {
    expect(compatible("Edm.String", "Edm.String")).toBe(true);
    expect(compatible("Edm.Int32", "Edm.Decimal")).toBe(true);
    expect(compatible("Edm.Int16", "Edm.Int64")).toBe(true);
    expect(compatible("Edm.Decimal", "Edm.Int32")).toBe(false);
    expect(compatible("Edm.String", "Edm.Date")).toBe(false);
    expect(compatible("Edm.Date", "Edm.DateTimeOffset")).toBe(false);
    expect(compatible("relative", "Edm.Date")).toBe(true);
    expect(compatible("relative", "Edm.DateTimeOffset")).toBe(true);
    expect(compatible("relative", "Edm.String")).toBe(false);
  });

  test("a type mismatch skips that contribution for that collection only", () => {
    // People gain a numeric `status`, so a text status fits time entries and not people.
    const m = structuredClone(metadata) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    m.AsterDemo!.Person!.status = { $Type: "Edm.Int32", $Nullable: true };
    const shared = new SharedFilters(parseCsdl(m));
    shared.set({ by: "status", label: "Status is approved", criteria: { op: "eq", field: "status", value: "approved" } });
    shared.set({ by: "named", label: "Name starts with A", criteria: { op: "startswith", field: "name", value: "A" } });
    expect(shared.consume("TimeEntries").value.applied.map((a) => a.by)).toEqual(["status"]);
    const people = shared.consume("People").value;
    expect(people.applied.map((a) => a.by)).toEqual(["named"]);
    expect(people.skipped).toEqual([{ by: "status", label: "Status is approved", reason: "People.status is Edm.Int32, not Edm.String" }]);
    // Declared types win over the literal's: a date given as text is a date.
    shared.set({ by: "day", label: "On 1 October", fields: { date: "Edm.Date" }, criteria: { op: "eq", field: "date", value: "2026-10-01" } });
    expect(shared.consume("TimeEntries").value.applied.map((a) => a.by)).toEqual(["status", "day"]);
    shared.set({ by: "day", label: "On 1 October", criteria: { op: "eq", field: "date", value: "2026-10-01" } });
    expect(shared.consume("TimeEntries").value.skipped.map((s) => s.reason)).toEqual(["TimeEntries has no field 'name'", "TimeEntries.date is Edm.Date, not Edm.String"]);
  });

  test("scoped to sets with `only`", () => {
    filters.set({ by: "named", label: "Name starts with A", only: ["People"], criteria: { op: "startswith", field: "name", value: "A" } });
    expect(filters.consume("People").value.applied.length).toBe(1);
    expect(filters.consume("Projects").value).toEqual({ criteria: undefined, applied: [], skipped: [] });
  });

  test("one foreign-key hop: a filter on projects narrows time entries and tasks through `project`", async () => {
    filters.set({ by: "health", label: "Health is behind", set: "Projects", criteria: { op: "eq", field: "health", value: "behind" } });
    const time = filters.consume("TimeEntries").value;
    expect(time.applied).toEqual([{ by: "health", label: "Health is behind", via: "project", criteria: { op: "via", field: "project", where: { op: "eq", field: "health", value: "behind" } } }]);
    expect(filters.consume("Tasks").value.applied[0]?.via).toBe("project");
    urls = [];
    expect(await count(filters.query(entries).value)).toBe(TIME.filter((t) => BEHIND.has(t.projectId)).length);
    expect(urls.some((u) => u.includes("$filter=project/health eq 'behind'"))).toBe(true);
    // The projects list itself takes it as is.
    expect(filters.consume("Projects").value.criteria).toEqual({ op: "eq", field: "health", value: "behind" });
  });

  test("hops aren't followed backwards or when the contribution says not to", () => {
    filters.set({ by: "mine", label: "Assigned to Ada", set: "Tasks", criteria: { op: "eq", field: "assigneeId", value: 1 } });
    expect(filters.consume("Projects").value.skipped.map((s) => s.reason)).toEqual(["Projects has no foreign key to Tasks"]);
    filters.clear();
    filters.set({ by: "industry", label: "Industry is retail", set: "Clients", criteria: { op: "eq", field: "industry", value: "Retail" } });
    expect(filters.consume("Projects").value.applied.length).toBe(1);
    expect(filters.consume("TimeEntries").value.applied[0]?.via).toBe("project.client");
    filters.set({ by: "industry", label: "Industry is retail", set: "Clients", related: false, criteria: { op: "eq", field: "industry", value: "Retail" } });
    expect(filters.consume("Projects").value.skipped.map((s) => s.reason)).toEqual(["Industry is retail applies to Clients only"]);
  });

  test("two foreign keys to the same set: neither is guessed", () => {
    const m = structuredClone(metadata) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    m.AsterDemo!.Task!.reviewerId = { $Type: "Edm.Int32", $Nullable: true };
    m.AsterDemo!.Task!.reviewer = { $Kind: "NavigationProperty", $Type: "AsterDemo.Person", $Nullable: true, $ReferentialConstraint: { reviewerId: "id" } };
    const shared = new SharedFilters(parseCsdl(m));
    shared.set({ by: "named", label: "Name starts with A", set: "People", criteria: { op: "startswith", field: "name", value: "A" } });
    expect(shared.consume("Tasks").value.skipped.map((s) => s.reason)).toEqual([
      "Tasks reaches People through assignee and reviewer; it's not clear which to follow",
    ]);
  });

  test("a key-only selection on the related set becomes the foreign key, which collections place locally", async () => {
    filters.set({ by: "projects", label: "2 projects", set: "Projects", kind: "selection", criteria: { op: "in", field: "id", values: [1, 2] } });
    expect(filters.consume("TimeEntries").value.criteria).toEqual({ op: "in", field: "projectId", values: [1, 2] });
    const c = ctx.collection(filters.query(entries), { pageSize: 50 });
    await c.ensure(0, 50);
    expect(c.count.value).toBe(TIME.filter((t) => t.projectId === 1 || t.projectId === 2).length);
    const before = c.count.value!;
    const key = c.keys.value[0]!;
    await ctx.update("TimeEntries", key, { projectId: 3 });
    // Placed from the record alone: it leaves without a refetch.
    expect(c.count.value).toBe(before - 1);
    expect(c.stale.value).toBe(false);
  });

  test("a filter through a navigation refreshes when the related set changes", async () => {
    filters.set({ by: "health", label: "Health is behind", set: "Projects", criteria: { op: "eq", field: "health", value: "behind" } });
    const c = ctx.collection(filters.query(entries), { pageSize: 50 });
    await c.ensure(0, 1);
    const before = c.count.value!;
    const project = data.Projects.find((p) => p.health !== "behind")!;
    await ctx.reload("Projects", `[${project.id}]`);
    await ctx.update("Projects", `[${project.id}]`, { health: "behind" });
    const added = TIME.filter((t) => t.projectId === project.id).length;
    await waitFor(() => c.count.value === before + added);
  });

  test("grouped counts take a filter through a navigation", async () => {
    filters.set({ by: "health", label: "Health is behind", set: "Projects", criteria: { op: "eq", field: "health", value: "behind" } });
    const groups = ctx.groups(filters.query(entries), "status");
    await waitFor(() => groups.rows.value !== undefined);
    const expected = TIME.filter((t) => BEHIND.has(t.projectId));
    expect(groups.rows.value!.reduce((n, r) => n + r.count, 0)).toBe(expected.length);
    expect(groups.rows.value!.find((r) => r.value === "draft")?.count).toBe(expected.filter((t) => t.status === "draft").length);
    groups.dispose();
  });
});

describe("relative dates", () => {
  test("stay symbolic in the channel and resolve at each fetch, through a hop too", async () => {
    filters.set({ by: "week", label: "This week", set: "TimeEntries", criteria: { op: "ge", field: "date", value: { relative: "today", startOf: "week" } } });
    filters.set({ by: "recent", label: "Projects created this year", set: "Projects", criteria: { op: "ge", field: "createdAt", value: { relative: "today", startOf: "month", months: -9 } } });
    expect(filters.contributions.value[0]!.criteria).toEqual({ op: "ge", field: "date", value: { relative: "today", startOf: "week" } });
    const c = ctx.collection(filters.query(entries), { pageSize: 50 });
    await c.ensure(0, 1);
    expect(urls.at(-1)).toContain("date ge 2026-10-05 and project/createdAt ge 2026-01-01T00:00:00Z");
    now = Date.UTC(2026, 9, 13, 9);
    await c.refresh();
    expect(urls.at(-1)).toContain("date ge 2026-10-12");
  });
});

describe("loops", () => {
  test("a component that publishes and consumes never takes its own contribution", async () => {
    const list = ctx.collection(filters.query(entries, { self: "time" }), { pageSize: 50 });
    const selection = new Selection(ctx.store, list, { multiple: true });
    await list.ensure(0, 50);
    const stop = filters.share("time", selectionShare(selection, (n) => `${n} time entries`));
    selection.select(list.keys.value[0]!);
    expect(filters.contributions.value.map((c) => c.label)).toEqual(["1 time entries"]);
    // The list still has every row, so its selection doesn't feed back into it.
    expect(list.query.filter).toBeUndefined();
    expect(list.count.value).toBe(TIME.length);
    stop();
    expect(filters.contributions.value).toEqual([]);
  });

  test("a peer list on the same set ignores an identity selection; a KPI takes it; a related list narrows", async () => {
    const projects = ctx.collection({ set: "Projects", orderBy: [{ field: "id" }] }, { pageSize: 50 });
    const selection = new Selection(ctx.store, projects, { multiple: true });
    await projects.ensure(0, 50);
    filters.share("projects", selectionShare(selection, (n) => `${n} projects`));
    selection.select(`[4]`);
    expect(filters.consume("Projects").value.criteria).toBeUndefined();
    expect(filters.consume("Projects", { sameSetSelections: true }).value.criteria).toEqual({ op: "in", field: "id", values: [4] });
    expect(filters.consume("TimeEntries").value.criteria).toEqual({ op: "in", field: "projectId", values: [4] });
  });

  test("a value picked from data narrows a list on the same set (it isn't identity)", () => {
    filters.set({ by: "chart", label: "Status is approved", set: "TimeEntries", kind: "value", criteria: { op: "eq", field: "status", value: "approved" } });
    expect(filters.consume("TimeEntries").value.criteria).toEqual({ op: "eq", field: "status", value: "approved" });
  });

  test("a consumer can choose its selection sources; with none, filters still apply", () => {
    filters.set({ by: "chart", label: "Status is approved", set: "TimeEntries", kind: "value", criteria: { op: "eq", field: "status", value: "approved" } });
    filters.set({ by: "billable", label: "Billable", set: "TimeEntries", criteria: { op: "eq", field: "billable", value: true } });
    expect(filters.consume("TimeEntries", { from: [] }).value.applied.map((a) => a.by)).toEqual(["billable"]);
    expect(filters.consume("TimeEntries", { from: ["chart"] }).value.applied.map((a) => a.by)).toEqual(["chart", "billable"]);
  });

  test("a slice that removes the selected row withdraws the selection with it", async () => {
    const projects = ctx.collection(filters.query({ set: "Projects", orderBy: [{ field: "id" }] }, { self: "projects" }), { pageSize: 50 });
    const selection = new Selection(ctx.store, projects, { multiple: true });
    await projects.ensure(0, 50);
    filters.share("projects", selectionShare(selection, (n) => `${n} projects`));
    const behind = data.Projects.find((p) => p.health === "behind")!;
    const onTrack = data.Projects.find((p) => p.health !== "behind")!;
    selection.select(`[${onTrack.id}]`);
    expect(filters.contributions.value.map((c) => c.by)).toEqual(["projects"]);
    filters.set({ by: "health", label: "Health is behind", set: "Projects", criteria: { op: "eq", field: "health", value: "behind" } });
    await waitFor(() => projects.count.value !== undefined && projects.keys.value.includes(`[${behind.id}]`));
    expect(filters.contributions.value.map((c) => c.by)).toEqual(["health"]);
  });

  test("a name has one follower, and a followed name can't be set by hand", () => {
    const source = signal(undefined);
    filters.share("chart", source);
    expect(() => filters.share("chart", source)).toThrow("'chart' is already shared");
    expect(() => filters.set({ by: "chart", label: "x", criteria: { op: "eq", field: "status", value: "x" } })).toThrow("follows a signal");
  });

  test("removing a followed contribution asks its contributor to clear, so the two agree", async () => {
    const projects = ctx.collection({ set: "Projects", orderBy: [{ field: "id" }] }, { pageSize: 50 });
    const selection = new Selection(ctx.store, projects, { multiple: true });
    await projects.ensure(0, 50);
    filters.share("projects", selectionShare(selection, (n) => `${n} projects`), () => selection.clear());
    const fixed = signal({ label: "Billable", set: "TimeEntries", criteria: { op: "eq", field: "billable", value: true } } as const);
    filters.share("fixed", fixed);
    selection.select("[4]");
    expect(filters.removable("projects")).toBe(true);
    expect(filters.removable("fixed")).toBe(false);
    filters.remove("projects");
    expect(selection.keys.value).toEqual([]);
    expect(filters.contributions.value.map((c) => c.by)).toEqual(["fixed"]);
    expect(() => filters.remove("fixed")).toThrow("gave no way to clear it");
    filters.clear();
    expect(filters.contributions.value.map((c) => c.by)).toEqual(["fixed"]);
  });
});


describe("saved slices and longer paths", () => {
  test("a two-hop filter runs on the server and keeps relative dates symbolic in snapshots", async () => {
    filters.set({ by: "retail", label: "Retail clients", set: "Clients", criteria: { op: "eq", field: "industry", value: "Retail" } });
    const client = await ctx.create("Clients", { name: "Retail client", city: "London", country: "UK", industry: "Retail" });
    await ctx.reload("Projects", "[1]");
    await ctx.update("Projects", "[1]", { clientId: client.record.entity.id! });
    expect(await count(filters.query(entries).value)).toBe(TIME.filter((t) => t.projectId === 1).length);
    expect(urls.some((u) => u.includes("project/client/industry eq 'Retail'"))).toBe(true);
    const list = ctx.collection(filters.query(entries));
    await list.ensure(0, 1);
    const groups = ctx.groups(filters.query(entries), "status");
    await waitFor(() => groups.rows.value !== undefined);
    expect(groups.rows.value!.reduce((n, g) => n + g.count, 0)).toBe(TIME.filter((t) => t.projectId === 1).length);
    await ctx.update("Clients", client.key, { industry: "Finance" });
    await waitFor(() => groups.rows.value?.length === 0 && list.count.value === 0);
    groups.dispose();
    ctx.release(list);
    filters.set({ by: "period", label: "This week", set: "TimeEntries", criteria: { op: "ge", field: "date", value: { relative: "today", startOf: "week" } } });
    const snapshot = JSON.parse(JSON.stringify(filters.snapshot()));
    const restored = new SharedFilters(ctx.schema);
    restored.restore(snapshot);
    expect(restored.contributions.value).toEqual(filters.contributions.value);
    expect(snapshot.contributions[1].criteria.value).toEqual({ relative: "today", startOf: "week" });
    snapshot.contributions[0].label = "mutated";
    expect(restored.contributions.value[0]?.label).toBe("Retail clients");
  });

  test("restore is atomic and never overwrites live contributors or saves identity selections", () => {
    filters.set({ by: "period", label: "Recent", set: "TimeEntries", criteria: { op: "ge", field: "date", value: { relative: "today", days: -7 } } });
    filters.set({ by: "picked", label: "Picked", set: "Projects", kind: "selection", criteria: { op: "eq", field: "id", value: 1 } });
    const source = signal({ label: "Live", set: "Projects", criteria: { op: "eq" as const, field: "id", value: 2 } });
    const stop = filters.share("live", source);
    const saved = filters.snapshot();
    expect(saved.contributions.map((c) => c.by)).toEqual(["period"]);
    const before = filters.contributions.peek();
    expect(() => filters.restore({ version: 1, contributions: [...saved.contributions, { by: "bad", label: "Bad", set: "Projects", criteria: { op: "eq", field: "missing", value: 1 } }] })).toThrow();
    expect(filters.contributions.peek()).toBe(before);
    expect(() => filters.restore({ version: 1, contributions: [{ ...source.value, by: "live" }] })).toThrow("follows a signal");
    filters.restore({ version: 1, contributions: [] });
    expect(filters.contributions.value.map((c) => c.by)).toEqual(["picked", "live"]);
    stop();
  });

  test("equally short multi-hop paths are ambiguous; cycles don't make a path", () => {
    const m = structuredClone(metadata) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    m.AsterDemo!.Task!.otherProjectId = { $Type: "Edm.Int32", $Nullable: true };
    m.AsterDemo!.Task!.otherProject = { $Kind: "NavigationProperty", $Type: "AsterDemo.Project", $Nullable: true, $ReferentialConstraint: { otherProjectId: "id" } };
    const channel = new SharedFilters(parseCsdl(m));
    channel.set({ by: "clients", label: "Retail", set: "Clients", criteria: { op: "eq", field: "industry", value: "Retail" } });
    expect(channel.consume("Tasks").value.skipped[0]?.reason).toContain("project.client and otherProject.client");
  });
});
