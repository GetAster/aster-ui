// Page-rule contract: contextual queries, derived state and guarded operations.
import { signal } from "@preact/signals-core";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  criteriaRule,
  DataContext,
  EditModel,
  inputPublication,
  ListEdit,
  listPublication,
  PageScope,
  parseTemplate,
  TemplateError,
  toFilter,
  valuesPublication,
  type ODataRequest,
} from "@getaster/data";
import { eventually } from "./eventually.ts";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";
import { modelData } from "../../fixtures/aster/model.ts";

let mock: MockService;
let ctx: DataContext;
let urls: string[];
let now = Date.UTC(2026, 9, 7, 15, 15);
const model = modelData();

beforeEach(async () => {
  mock = await createMockService({ metadata, data: { ...data, ...model }, now: () => "2026-10-07T15:20:00Z" });
  urls = [];
  now = Date.UTC(2026, 9, 7, 15, 15);
  ctx = await DataContext.connect(
    async (r: ODataRequest) => {
      urls.push(decodeURIComponent(r.url));
      return mock.transport(r);
    },
    { now: () => now },
  );
});

describe("any and all over a to-many navigation", () => {
  test("compile to OData lambdas, nested ones with their own variable", () => {
    const fields = ctx.schema.set("Fields");
    expect(toFilter({ op: "any", field: "answers", where: { op: "eq", field: "key", value: "other" } }, fields.type, fields, ctx.schema)).toBe(
      "answers/any(x0:x0/key eq 'other')",
    );
    expect(
      toFilter(
        { op: "all", field: "children", where: { op: "any", field: "answers", where: { op: "startswith", field: "label", value: "Y" } } },
        fields.type,
        fields,
        ctx.schema,
      ),
    ).toBe("children/all(x0:x0/answers/any(x1:startswith(x1/label,'Y')))");
  });

  test("the server answers them as the client would: choice fields offering 'other'", async () => {
    const c = ctx.collection({ set: "Fields", filter: { op: "any", field: "answers", where: { op: "eq", field: "key", value: "other" } }, orderBy: [{ field: "id" }] });
    await c.loadAll();
    const expected = model.Fields.filter((f) => model.Answers.some((a) => a.fieldId === f.id && a.key === "other")).map((f) => f.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(c.items.value.map((f) => f!.id)).toEqual(expected);
    const none = ctx.collection({ set: "Fields", filter: { op: "all", field: "answers", where: { op: "startswith", field: "label", value: "Z" } }, orderBy: [{ field: "id" }] });
    await none.loadAll();
    // `all` of no answers holds, so it's the fields without any.
    expect(none.items.value.map((f) => f!.id)).toEqual(model.Fields.filter((f) => !model.Answers.some((a) => a.fieldId === f.id)).map((f) => f.id));
  });

  test("a rule ranges over a repeating group's rows, following edits", async () => {
    const field = model.Fields.find((f) => f.name === "clientType")!;
    const rows = ctx.collection({ set: "Answers", filter: { op: "eq", field: "fieldId", value: field.id }, orderBy: [{ field: "position" }] });
    await rows.loadAll();
    const list = new ListEdit(ctx, rows);
    const scope = new PageScope();
    scope.publish("answers", listPublication(list));
    const hasOther = scope.when({ op: "any", field: "answers.rows", where: { op: "eq", field: "key", value: "other" } });
    const allLabelled = scope.when({ op: "all", field: "answers.rows", where: { op: "ne", field: "label", value: "" } });
    expect([hasOther.value, allLabelled.value]).toEqual([false, true]);
    const added = list.add({ fieldId: field.id, key: "other", label: "", position: 6 });
    expect([hasOther.value, allLabelled.value]).toEqual([true, false]);
    list.remove(added.id);
    expect(hasOther.value).toBe(false);
    expect(scope.check("answers.rows")).toBeUndefined();
  });
});

describe("relative dates", () => {
  const thisWeek = {
    op: "and",
    args: [
      { op: "ge", field: "due", value: { relative: "today", startOf: "week" } },
      { op: "le", field: "due", value: { relative: "today", startOf: "week", days: 6 } },
    ],
  } as const;

  test("a query keeps them symbolic and resolves them at each fetch", async () => {
    const c = ctx.collection({ set: "Tasks", filter: thisWeek, orderBy: [{ field: "id" }] }, { pageSize: 500 });
    await c.loadAll();
    expect(urls.at(-1)).toContain("due ge 2026-10-05 and due le 2026-10-11");
    expect(c.items.value.every((t) => String(t!.due) >= "2026-10-05" && String(t!.due) <= "2026-10-11")).toBe(true);
    // A week on, the same query means next week.
    now += 7 * 86_400_000;
    await c.refresh();
    expect(urls.at(-1)).toContain("due ge 2026-10-12 and due le 2026-10-18");
    expect(c.query.filter).toEqual(thisWeek);
  });

  test("on a DateTimeOffset field they're instants; months and month starts", async () => {
    const c = ctx.collection({ set: "Projects", filter: { op: "ge", field: "updatedAt", value: { relative: "now", months: -1, startOf: "month" } } });
    await c.ensure(0, 1);
    expect(urls.at(-1)).toContain("updatedAt ge 2026-09-01T00:00:00Z");
  });

  test("a page rule resolves them when it's evaluated", () => {
    const scope = new PageScope(undefined, { now: () => now });
    const due = signal<string | null>("2026-10-06");
    scope.publish("task", valuesPublication({ due }));
    // Untyped text can't be ordered, so the rule says the type through a typed publication.
    const tasks = ctx.schema.set("Tasks").type;
    const typed = new PageScope(undefined, { now: () => now });
    typed.publish("task", { values: { values: signal({ due: "2026-10-06" }) }, types: { values: tasks } });
    const overdue = typed.when({ op: "lt", field: "task.values.due", value: { relative: "today" } });
    expect(overdue.value).toBe(true);
    expect(scope.check("task.due")).toBeUndefined();
  });
});

describe("criteria validators", () => {
  test("pass when and fail when, on the field itself or reading the record", async () => {
    const tasks = ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 1 });
    await tasks.ensure(0, 1);
    const type = ctx.schema.set("Tasks").type;
    const edit = new EditModel(ctx, "Tasks", tasks.keys.value[0]!, {}, {
      rules: [
        criteriaRule(type, "title", { failWhen: { op: "startswith", value: "TODO" }, message: "Give it a real title." }),
        criteriaRule(type, "due", { passWhen: { op: "ge", value: { relative: "today", days: -365 } }, message: "Due dates go back a year at most." }, () => now),
        criteriaRule(type, "assigneeId", { failWhen: { op: "and", args: [{ op: "eq", field: "done", value: true }, { op: "eq", value: 12 }] }, message: "Ken can't hold done tasks." }),
      ],
    });
    edit.set("title", "TODO later");
    edit.set("due", "2024-01-01");
    edit.set("done", true);
    edit.set("assigneeId", 12);
    expect(edit.validate()).toBe(false);
    expect(edit.errors.value).toMatchObject({
      title: ["Give it a real title."],
      due: ["Due dates go back a year at most."],
      assigneeId: ["Ken can't hold done tasks."],
    });
    edit.set("title", "Real");
    edit.set("due", null);
    edit.set("done", false);
    expect(edit.validate()).toBe(true);
  });
});

describe("the scope's schema", () => {
  test("names, record types and CSDL types; check explains a bad path", () => {
    const scope = new PageScope();
    const edit = new EditModel(ctx, "Tasks");
    scope.publish("task", { values: { values: edit.values, dirty: edit.dirty }, types: { values: edit.type } });
    const schema = scope.schema();
    expect(Object.keys(schema.task!)).toEqual(["values", "dirty"]);
    expect(schema.task!.values).toMatchObject({ type: "Task", fields: { title: "Edm.String", due: "Edm.Date", done: "Edm.Boolean" } });
    expect(schema.task!.dirty).toEqual({});
    expect(scope.check("task.values.title")).toBeUndefined();
    expect(scope.check("task.values.titel")).toBe("Task has no field 'titel'");
    expect(scope.check("task.value")).toBe("'task' has no 'value'");
    expect(scope.check("people.selected")).toBe("nothing is published as 'people'");
  });
});

describe("templates", () => {
  const look = (o: Record<string, unknown>) => (p: string) => p.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o);

  test("paths, literals, comparisons, the conditional, escaped braces; null renders as nothing", () => {
    const t = parseTemplate("{project.name}: {count == 1 ? 'one task' : count > 1 ? count : 'no tasks'}{note ? ' – ' : ''}{note} {{x}}");
    expect(t.paths).toEqual(["project.name", "count", "note"]);
    expect(t.render(look({ project: { name: "Atlas" }, count: 1, note: null }))).toBe("Atlas: one task {x}");
    expect(t.render(look({ project: { name: "Atlas" }, count: 4, note: "late" }))).toBe("Atlas: 4 – late {x}");
    expect(t.render(look({ count: 0 }))).toBe(": no tasks {x}");
    expect(parseTemplate("{!done && (owner == \"ada\" || owner == 'grace')}").render(look({ done: false, owner: "ada" }))).toBe("true");
    expect(parseTemplate("{a < b}").render(look({ a: "2", b: 10 }))).toBe("false");
  });

  test("nothing is ever compiled: code is text that fails to parse", () => {
    for (const bad of ["{alert(1)}", "{a + b}", "{x; y}", "{constructor.constructor('x')()}", "{a", "b}", "{'unterminated}"]) {
      expect(() => parseTemplate(bad)).toThrow(TemplateError);
    }
  });
});

describe("page inputs", () => {
  test("an input is a key, so the same address opens the same record anywhere", async () => {
    const scope = new PageScope();
    scope.publish("project", inputPublication(ctx, "Projects", "[15]"));
    const name = scope.value("project.record.name");
    await eventually(() => expect(name.value).toBe(data.Projects.find((p) => p.id === 15)!.name));
    expect(JSON.parse(JSON.stringify(scope.value("project.key").value))).toBe("[15]");
    expect(scope.schema().project!.record!.type).toBe("Project");
  });
});

describe("found writing the guide", () => {
  test("grouped counts take any and all", async () => {
    const g = ctx.groups({ set: "Fields", filter: { op: "any", field: "answers", where: { op: "eq", field: "key", value: "other" } } }, "kind");
    await g.refresh();
    const expected = model.Fields.filter((f) => model.Answers.some((a) => a.fieldId === f.id && a.key === "other")).length;
    expect(g.rows.value!.reduce((n, r) => n + r.count, 0)).toBe(expected);
    g.dispose();
  });

  test("a relative date inside any resolves against the related type", async () => {
    const c = ctx.collection({ set: "Tasks", filter: { op: "any", field: "subtasks", where: { op: "ge", field: "due", value: { relative: "today" } } }, orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await c.ensure(0, 5);
    expect(urls.at(-1)).toContain("subtasks/any(x0:x0/due ge 2026-10-07)");
  });

  test("a month on from the 31st is the next month's last day", async () => {
    const { resolveRelative } = await import("@getaster/data");
    const type = ctx.schema.set("Tasks").type;
    const jan31 = Date.UTC(2027, 0, 31, 12);
    const c = resolveRelative({ op: "eq", field: "due", value: { relative: "today", months: 1 } }, type, jan31);
    expect(c).toMatchObject({ value: "2027-02-28" });
  });
});
