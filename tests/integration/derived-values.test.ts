// Derived values (design/page-rules.md, "Effects"): `scope.select` cases, a
// read-only field that always takes its derived value, an editable one that
// takes it as a suggestion until the person changes it, loops that fail
// loudly, and paths through a published record's navigations.
import { beforeEach, describe, expect, test } from "bun:test";
import { computed, signal } from "@preact/signals-core";
import { DataContext, EditModel, editPublication, keyText, MAX_HOPS, ODataSource, PageScope, valuesPublication, type Entity } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

let mock: MockService;
let ctx: DataContext;

beforeEach(async () => {
  mock = await createMockService({ metadata, data, now: () => "2026-10-07T15:20:00Z" });
  ctx = await DataContext.connect(mock.transport);
});

async function waitFor(done: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

function newTask(defaults: Entity = {}) {
  const scope = new PageScope(undefined, { ctx });
  const edit = new EditModel(ctx, "Tasks", undefined, { projectId: 1, title: "", done: false, ...defaults });
  scope.publish("task", editPublication(edit));
  return { scope, edit };
}

async function task(id: number) {
  await ctx.reload("Tasks", keyText([id]));
  const scope = new PageScope(undefined, { ctx });
  const edit = new EditModel(ctx, "Tasks", keyText([id]));
  scope.publish("task", editPublication(edit));
  return { scope, edit };
}

describe("scope.select", () => {
  test("the first case whose rule holds; a case without one is the default; literals, paths and templates", () => {
    const scope = new PageScope();
    const health = signal("onTrack");
    const days = signal(0);
    scope.publish("p", valuesPublication({ health, days }));
    const label = scope.select([
      { when: { op: "eq", field: "p.health", value: "behind" }, template: "{p.days == 1 ? 'A day' : p.days} behind" },
      { when: { op: "eq", field: "p.health", value: "atRisk" }, value: "At risk" },
      { path: "p.health" },
    ]);
    expect(label.value).toBe("onTrack");
    health.value = "atRisk";
    expect(label.value).toBe("At risk");
    health.value = "behind";
    days.value = 1;
    expect(label.value).toBe("A day behind");
    days.value = 3;
    expect(label.value).toBe("3 behind");
  });

  test("no case applies: undefined", () => {
    const scope = new PageScope();
    scope.publish("p", valuesPublication({ on: signal(false) }));
    expect(scope.select([{ when: "p.on", value: 1 }]).value).toBeUndefined();
  });

  test("undecided while a rule's path can't be read yet, rather than reading it as null", () => {
    const scope = new PageScope();
    const pick = scope.select([{ when: { op: "eq", field: "late.value", value: null }, value: "none" }, { value: "some" }]);
    expect(pick.value).toBeUndefined();
    const value = signal<number | null>(null);
    scope.publish("late", valuesPublication({ value }));
    expect(pick.value).toBe("none");
    value.value = 3;
    expect(pick.value).toBe("some");
  });
});

describe("in the edit model", () => {
  test("a read-only field always takes its derived value, and follows it", () => {
    const { scope, edit } = newTask();
    scope.publish("page", valuesPublication({ fixed: signal(true) }));
    edit.applyRules(scope, "task", {
      title: {
        readOnly: { when: "page.fixed", reason: "The title follows the project." },
        derived: [{ when: { op: "eq", field: "task.values.done", value: true }, template: "Done in project {task.values.projectId}" }, { template: "Open in project {task.values.projectId}" }],
      },
    });
    expect(edit.values.value.title).toBe("Open in project 1");
    expect(edit.derived("title").value).toBe(true);
    edit.set("done", true);
    expect(edit.values.value.title).toBe("Done in project 1");
    edit.set("title", "Mine");
    expect(edit.values.value.title).toBe("Done in project 1");
    expect(edit.errors.value.title).toEqual(["The title follows the project."]);
    edit.revert();
    // Back to the defaults, and replaced again at once.
    expect(edit.values.value).toMatchObject({ done: false, title: "Open in project 1" });
  });

  test("an existing record's read-only field is replaced on open", async () => {
    const { scope, edit } = await task(1);
    scope.publish("page", valuesPublication({ fixed: signal(true) }));
    edit.applyRules(scope, "task", { title: { readOnly: "page.fixed", derived: [{ template: "Task in {task.values.projectId}" }] } });
    expect(edit.values.value.title).toBe("Task in 1");
    expect(edit.dirty.value).toBe(true);
  });

  test("an editable field on a new record takes the suggestion until the person changes it", () => {
    const { scope, edit } = newTask();
    edit.applyRules(scope, "task", { title: { derived: [{ template: "Follow up on project {task.values.projectId}" }] } });
    expect(edit.values.value.title).toBe("Follow up on project 1");
    edit.set("projectId", 2);
    expect(edit.values.value.title).toBe("Follow up on project 2");
    expect(edit.derived("title").value).toBe(true);
    edit.set("title", "Call the printer");
    expect(edit.derived("title").value).toBe(false);
    edit.set("projectId", 3);
    expect(edit.values.value.title).toBe("Call the printer");
    // Kept across a reload of the draft.
    const draft = edit.draft();
    expect(draft.typed).toEqual(["title"]);
    const again = new EditModel(ctx, "Tasks", undefined, {});
    const scope2 = new PageScope(undefined, { ctx });
    scope2.publish("task", editPublication(again));
    again.resume(draft);
    again.applyRules(scope2, "task", { title: { derived: [{ template: "Follow up on project {task.values.projectId}" }] } });
    again.set("projectId", 4);
    expect(again.values.value.title).toBe("Call the printer");
    // A revert puts the default back; the next change suggests again.
    edit.revert("title");
    expect(edit.values.value.title).toBe("");
    edit.set("projectId", 5);
    expect(edit.values.value.title).toBe("Follow up on project 5");
  });

  test("an editable field on an existing record keeps its stored value until the derived value changes", async () => {
    const { scope, edit } = await task(1);
    edit.applyRules(scope, "task", { title: { derived: [{ template: "Follow up on project {task.values.projectId}" }] } });
    expect(edit.values.value.title).toBe("Launch email, second draft");
    expect(edit.dirty.value).toBe(false);
    expect(edit.derived("title").value).toBe(false);
    edit.set("projectId", 2);
    expect(edit.values.value.title).toBe("Follow up on project 2");
    expect(edit.pending("title").value).toBe(true);
  });

  test("a value computed in code is a derived value too, in the field's JSON form", () => {
    const scope = new PageScope();
    const edit = new EditModel(ctx, "Projects", undefined, { name: "New", budget: "1000", spent: "0" });
    scope.publish("project", editPublication(edit));
    edit.applyRules(scope, "project", { spent: { derived: computed(() => (edit.values.value.budget === "1000" ? "250" : undefined)) } });
    expect(edit.values.value.spent).toBe("250");
    edit.set("budget", "2000");
    // No case applies: the value stays.
    expect(edit.values.value.spent).toBe("250");
  });

  test("a server-set field can't have one", () => {
    const { scope, edit } = newTask();
    expect(() => edit.applyRules(scope, "task", { id: { derived: [{ value: 7 }] } })).toThrow("set by the server");
  });

  test("derived values that feed each other and never settle fail loudly, naming the fields", () => {
    const scope = new PageScope();
    const edit = new EditModel(ctx, "Projects", undefined, { name: "New", hue: 0, behindDays: 0 });
    scope.publish("project", editPublication(edit));
    expect(() =>
      edit.applyRules(scope, "project", {
        behindDays: { derived: computed(() => ((edit.values.value.hue as number) ?? 0) + 1) },
        hue: { derived: computed(() => ((edit.values.value.behindDays as number) ?? 0) + 1) },
      }),
    ).toThrow(/never settle: (project\.behindDays, project\.hue|project\.hue, project\.behindDays)/);
  });

  test("derived values that feed each other and agree settle", () => {
    const scope = new PageScope();
    const edit = new EditModel(ctx, "Projects", undefined, { name: "New", hue: 40, behindDays: 0 });
    scope.publish("project", editPublication(edit));
    edit.applyRules(scope, "project", {
      behindDays: { derived: [{ path: "project.values.hue" }] },
      hue: { derived: [{ path: "project.values.behindDays" }] },
    });
    expect(edit.values.value).toMatchObject({ hue: 40, behindDays: 40 });
  });
});

describe("paths through related records", () => {
  test("a path follows a published record's navigations, from the store, and follows its key", async () => {
    const { scope, edit } = newTask();
    const project = scope.value("task.values.project.name");
    const lead = scope.value("task.values.project.lead.name");
    expect(project.value).toBeUndefined();
    await waitFor(() => project.value !== undefined && lead.value !== undefined);
    expect(project.value).toBe("Spring launch");
    expect(lead.value).toBe("Ada Lovelace");
    edit.set("projectId", 2);
    await waitFor(() => project.value === "Brand refresh");
    await waitFor(() => lead.value === "Grace Hopper");
  });

  test("no foreign key is no related record: null", () => {
    const { scope } = newTask({ parentId: null });
    expect(scope.value("task.values.parent.title").value).toBeNull();
  });

  test("typed at the end, so rules compare it as its field; a rule follows it", async () => {
    const { scope, edit } = newTask();
    expect(scope.field("task.values.project.health")?.type).toBe("Edm.String");
    expect(scope.field("task.values.project.createdAt")?.type).toBe("Edm.DateTimeOffset");
    const behind = scope.when({ op: "eq", field: "task.values.project.health", value: "behind" });
    await waitFor(() => scope.value("task.values.project.health").value !== undefined);
    expect(behind.value).toBe(false);
    edit.set("projectId", 2);
    await waitFor(() => behind.value);
  });

  test("check explains a bad path: an unknown field, a list, a step past a field, too many hops, no data context", () => {
    const { scope } = newTask();
    expect(scope.check("task.values.project.lead.name")).toBeUndefined();
    expect(scope.check("task.values.project.lead.nope")).toBe("Person has no field 'nope'");
    expect(scope.check("task.values.project.tasks.title")).toBe("'tasks' on Project is a list; a path follows single records (task.values.project.tasks.title)");
    expect(scope.check("task.values.project.name.length")).toBe("'task.values.project.name.length' goes past a field");
    expect(MAX_HOPS).toBe(3);
    expect(scope.check("task.values.parent.parent.parent.title")).toBeUndefined();
    expect(scope.check("task.values.parent.parent.parent.parent.title")).toBe("'task.values.parent.parent.parent.parent.title' follows more than 3 navigations");
    const bare = new PageScope();
    bare.publish("task", editPublication(new EditModel(ctx, "Tasks", undefined, {})));
    expect(bare.check("task.values.project.name")).toBe("'task.values.project.name' follows 'project', which needs the scope's data context");
    // A child scope has its parent's.
    expect(scope.child().ctx).toBe(ctx);
  });

  test("a case over a related record waits for it to load", async () => {
    const { scope, edit } = await task(2563);
    const parent = scope.select([{ when: { op: "eq", field: "task.values.parent.parentId", value: null }, value: "top" }, { value: "nested" }]);
    expect(parent.value).toBeUndefined();
    await waitFor(() => parent.value !== undefined);
    expect(parent.value).toBe("top");
    edit.set("parentId", 2563);
    expect(parent.value).toBe("nested");
    // No related record: its fields are null, which a rule can decide on.
    edit.set("parentId", null);
    expect(parent.value).toBe("top");
    edit.set("parentId", 40);
    expect(parent.value).toBeUndefined();
    await waitFor(() => parent.value !== undefined);
  });

  test("a suggestion from a related record waits for it to load", async () => {
    const { scope, edit } = newTask();
    edit.applyRules(scope, "task", { title: { derived: [{ template: "{task.values.project.name}: follow-up" }] } });
    await waitFor(() => edit.values.value.title === "Spring launch: follow-up");
    edit.set("projectId", 3);
    await waitFor(() => edit.values.value.title === "Billing v2: follow-up");
  });
});


describe("related-list aggregates and explanations", () => {
  test("min, max and average cover the whole related list, follow the parent, and recount writes", async () => {
    const { scope, edit } = newTask();
    const rows = data.Tasks.filter((t) => t.projectId === 1);
    const min = scope.select([{ aggregate: "min", path: "task.values.project.tasks", field: "id" }]);
    const max = scope.select([{ aggregate: "max", path: "task.values.project.tasks", field: "id" }]);
    const avg = scope.select([{ aggregate: "average", path: "task.values.project.tasks", field: "id" }]);
    expect(min.value).toBeUndefined();
    await waitFor(() => min.value !== undefined && max.value !== undefined && avg.value !== undefined);
    expect(min.value).toBe(Math.min(...rows.map((r) => r.id)));
    expect(max.value).toBe(Math.max(...rows.map((r) => r.id)));
    expect(Number(avg.value)).toBeCloseTo(rows.reduce((n, r) => n + r.id, 0) / rows.length);
    const added = await ctx.create("Tasks", { title: "New aggregate row", projectId: 1, done: false });
    await waitFor(() => max.value === added.record.entity.id);
    edit.set("projectId", 2);
    expect(max.value).toBeUndefined();
    await waitFor(() => max.value !== undefined);
    expect(max.value).toBe(Math.max(...data.Tasks.filter((t) => t.projectId === 2).map((r) => r.id)));
    min.dispose(); max.dispose(); avg.dispose(); edit.dispose();
  });

  test("empty and absent related lists yield null; bad aggregate paths fail clearly", async () => {
    const { scope, edit } = newTask({ parentId: null });
    const min = scope.select([{ aggregate: "min", path: "task.values.parent.subtasks", field: "id" }]);
    expect(min.value).toBeNull();
    expect(() => scope.select([{ aggregate: "min", path: "task.values.project", field: "id" }])).toThrow("related list");
    expect(() => scope.select([{ aggregate: "average", path: "task.values.project.tasks", field: "title" }])).toThrow("numeric");
    const project = await ctx.create("Projects", { name: "Empty", leadId: 1, state: "active", health: "onTrack", budget: "0", spent: "0", pinned: false, hue: 0, behindDays: 1 });
    edit.set("projectId", project.record.entity.id!);
    const empty = scope.select([{ aggregate: "min", path: "task.values.project.tasks", field: "id" }]);
    await waitFor(() => empty.value !== undefined);
    expect(empty.value).toBeNull();
    min.dispose(); empty.dispose(); edit.dispose();
  });

  test("explain names the selected case, paths, suggested value and a user override; disposal withdraws it", () => {
    const { scope, edit } = newTask();
    edit.applyRules(scope, "task", { title: { derived: [{ when: "task.values.done", value: "Done" }, { template: "Project {task.values.projectId}" }] } });
    expect(edit.explain("title").find((r) => r.effect === "derived")).toMatchObject({ matched: 1, value: "Project 1", overridden: false, current: "Project 1", reads: { "task.values.projectId": 1, "task.values.done": false } });
    edit.set("title", "Mine");
    edit.set("done", true);
    expect(edit.explain("title").find((r) => r.effect === "derived")).toMatchObject({ matched: 0, value: "Done", overridden: true, current: "Mine" });
    edit.dispose();
    expect(scope.explain("task.title")).toEqual([]);
  });
});


test("related min supports dates, ignores nulls, and errors appear in explanations without a partial answer", async () => {
  const { scope, edit } = newTask();
  const earliest = scope.select([{ aggregate: "min", path: "task.values.project.tasks", field: "due" }]);
  await waitFor(() => earliest.value !== undefined);
  const dates = data.Tasks.filter((t) => t.projectId === 1 && t.due !== null).map((t) => t.due!).sort();
  expect(earliest.value).toBe(dates[0] ?? null);
  earliest.dispose();
  edit.dispose();
  const broken = new DataContext(new ODataSource(ctx.schema, async () => { throw new Error("aggregate unavailable"); }));
  const s = new PageScope(undefined, { ctx: broken });
  s.publish("project", { values: { values: signal({ id: 1 }) }, types: { values: ctx.schema.set("Projects").type } });
  const result = s.select([{ aggregate: "min", path: "project.values.tasks", field: "id" }], "minimum");
  await waitFor(() => s.explain("minimum")[0]?.error !== undefined);
  expect(result.value).toBeUndefined();
  expect(s.explain("minimum")[0]?.error).toContain("aggregate unavailable");
  result.dispose();
});


test("late aggregate answers cannot replace a new parent's result or survive disposal", async () => {
  const pending: ((value: number) => void)[] = [];
  const source = new ODataSource(ctx.schema, () => new Promise((resolve) => {
    pending.push((result) => resolve({ status: 200, headers: {}, body: JSON.stringify({ value: [{ result }] }) }));
  }));
  const record = signal({ id: 1 });
  const scope = new PageScope(undefined, { ctx: new DataContext(source) });
  scope.publish("project", { values: { values: record }, types: { values: ctx.schema.set("Projects").type } });
  const min = scope.select([{ aggregate: "min", path: "project.values.tasks", field: "id" }]);
  expect(pending.length).toBe(1);
  record.value = { id: 2 };
  expect(pending.length).toBe(2);
  pending[1]!(20);
  await waitFor(() => min.value === 20);
  pending[0]!(10);
  await Bun.sleep(5);
  expect(min.value).toBe(20);
  record.value = { id: 3 };
  expect(min.value).toBeUndefined();
  min.dispose();
  pending[2]!(30);
  await Bun.sleep(5);
  expect(min.value).toBeUndefined();
  record.value = { id: 4 };
  expect(pending.length).toBe(3);
});
