// Criteria through a single related record (`via`): compiled to a navigation
// path, evaluated locally only with the related record, answered by the
// server as by the client.
import { beforeEach, describe, expect, test } from "bun:test";
import { DataContext, matches, toFilter, type Query } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";
import { timeEntries } from "../../fixtures/aster/time.ts";

const TIME = timeEntries(3000, data.People, data.Projects, "2026-10-07");
const BEHIND = new Set(data.Projects.filter((p) => p.health === "behind").map((p) => p.id));
const entries: Query = { set: "TimeEntries", orderBy: [{ field: "id" }] };

let ctx: DataContext;

beforeEach(async () => {
  const mock = await createMockService({ metadata, data: { ...data, TimeEntries: TIME }, now: () => "2026-10-07T09:00:00Z" });
  ctx = await DataContext.connect(mock.transport);
});

async function waitFor(done: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

describe("via: a single related record's fields", () => {
  test("compiles to a path, bracketed where needed, inside a lambda too", () => {
    const tasks = ctx.schema.set("Tasks");
    const behindOrPaused = { op: "or", args: [{ op: "eq", field: "health", value: "behind" }, { op: "eq", field: "state", value: "paused" }] } as const;
    expect(toFilter({ op: "via", field: "project", where: behindOrPaused }, tasks.type, tasks, ctx.schema)).toBe("project/health eq 'behind' or project/state eq 'paused'");
    expect(
      toFilter({ op: "and", args: [{ op: "eq", field: "done", value: false }, { op: "via", field: "project", where: behindOrPaused }] }, tasks.type, tasks, ctx.schema),
    ).toBe("done eq false and (project/health eq 'behind' or project/state eq 'paused')");
    const projects = ctx.schema.set("Projects");
    expect(
      toFilter({ op: "any", field: "tasks", where: { op: "via", field: "assignee", where: { op: "eq", field: "name", value: "Ada" } } }, projects.type, projects, ctx.schema),
    ).toBe("tasks/any(x0:x0/assignee/name eq 'Ada')");
    expect(() => toFilter({ op: "via", field: "tasks", where: { op: "eq", field: "done", value: true } }, projects.type, projects, ctx.schema)).toThrow("is a collection");
  });

  test("evaluates locally only with the related record; none means its fields are null", () => {
    const type = ctx.schema.set("Tasks").type;
    const related = (_: unknown, nav: string) => (nav === "project" ? ctx.schema.set("Projects").type : undefined);
    const behind = { op: "via", field: "project", where: { op: "eq", field: "health", value: "behind" } } as const;
    expect(matches(behind, { id: 1, project: { id: 2, health: "behind" } } as never, type, related)).toBe(true);
    expect(matches(behind, { id: 1, project: null } as never, type, related)).toBe(false);
    expect(matches({ op: "via", field: "project", where: { op: "eq", field: "health", value: null } }, { id: 1, project: null } as never, type, related)).toBe(true);
    expect(() => matches(behind, { id: 1 }, type, related)).toThrow("isn't loaded as a record");
  });

  test("the server answers it as the client would", async () => {
    const c = ctx.collection({ ...entries, filter: { op: "via", field: "project", where: { op: "eq", field: "health", value: "behind" } } }, { pageSize: 50 });
    await c.ensure(0, 1);
    expect(c.count.value).toBe(TIME.filter((t) => BEHIND.has(t.projectId)).length);
  });

  test("a collection filtered through a navigation refreshes when the related set changes", async () => {
    const c = ctx.collection({ ...entries, filter: { op: "via", field: "project", where: { op: "eq", field: "health", value: "behind" } } }, { pageSize: 50 });
    await c.ensure(0, 1);
    const before = c.count.value!;
    const project = data.Projects.find((p) => p.health !== "behind")!;
    await ctx.reload("Projects", `[${project.id}]`);
    await ctx.update("Projects", `[${project.id}]`, { health: "behind" });
    const added = TIME.filter((t) => t.projectId === project.id).length;
    await waitFor(() => c.count.value === before + added);
  });

  test("grouped counts take it", async () => {
    const groups = ctx.groups({ ...entries, filter: { op: "via", field: "project", where: { op: "eq", field: "health", value: "behind" } } }, "status");
    await waitFor(() => groups.rows.value !== undefined);
    const expected = TIME.filter((t) => BEHIND.has(t.projectId));
    expect(groups.rows.value!.reduce((n, r) => n + r.count, 0)).toBe(expected.length);
    expect(groups.rows.value!.find((r) => r.value === "draft")?.count).toBe(expected.filter((t) => t.status === "draft").length);
    groups.dispose();
  });
});
