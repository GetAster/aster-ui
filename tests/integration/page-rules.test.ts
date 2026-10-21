import { beforeEach, describe, expect, test } from "bun:test";
import { computed, signal } from "@preact/signals-core";
import {
  DataContext,
  EditModel,
  ListEdit,
  PageScope,
  Selection,
  editPublication,
  keyFromText,
  keyText,
  selectionPublication,
  valuesPublication,
  type Collection,
  type Entity,
  type Query,
} from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

let mock: MockService;
let ctx: DataContext;

beforeEach(async () => {
  mock = await createMockService({ metadata, data, now: () => "2026-10-07T15:20:00Z" });
  ctx = await DataContext.connect(mock.transport);
});

const people = () => ctx.collection({ set: "People", orderBy: [{ field: "name" }] });

async function waitFor(done: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

describe("selection", () => {
  test("falls back to the first row, and follows the collection", async () => {
    const list = people();
    const sel = new Selection(ctx.store, list);
    expect(sel.any.value).toBe(false);
    await list.loadAll();
    expect(sel.selected.value?.name).toBe("Ada Lovelace");
    sel.select(list.keys.value[2]!);
    expect(sel.selected.value?.name).toBe("Barbara Liskov");
    await ctx.remove("People", list.keys.value[2]!);
    expect(sel.selected.value?.name).toBe("Ada Lovelace");
  });

  test("the selected record is live: an edit shows without reselecting", async () => {
    const list = people();
    await list.loadAll();
    const sel = new Selection(ctx.store, list);
    await ctx.update("People", sel.key.value!, { email: "ada@example.org" });
    expect(sel.selected.value?.email).toBe("ada@example.org");
  });

  test("multiple selection counts, and has no fallback", async () => {
    const list = people();
    await list.loadAll();
    const sel = new Selection(ctx.store, list, { multiple: true });
    expect(sel.count.value).toBe(0);
    sel.toggle(list.keys.value[0]!);
    sel.toggle(list.keys.value[1]!);
    expect([sel.count.value, sel.many.value]).toEqual([2, true]);
    sel.toggle(list.keys.value[0]!);
    expect(sel.selected.value?.name).toBe(list.items.value[1]?.name);
  });

  test("ordered picks deduplicate, reorder, compact after removal and enforce an atomic limit", async () => {
    const list = people();
    await list.loadAll();
    const [a, b, c] = list.keys.value as readonly [string, string, string];
    const sel = new Selection(ctx.store, list, { multiple: true, ordered: true, maxOrdered: 2 });
    expect(sel.toggle(b!)).toBe(true);
    expect(sel.toggle(a!)).toBe(true);
    expect(sel.keys.value).toEqual([b, a]);
    expect(sel.toggle(c!)).toBe(false);
    expect(sel.selectAll([a!, b!, c!])).toBe(false);
    expect(sel.keys.value).toEqual([b, a]);
    expect(sel.move(a!, 0)).toBe(true);
    expect(sel.keys.value).toEqual([a, b]);
    expect(sel.move(c!, 0)).toBe(false);
    expect(sel.move(a!, 2)).toBe(false);
    expect(sel.move(a!, .5)).toBe(false);
    sel.toggle(a!);
    sel.toggle(c!);
    expect(sel.keys.value).toEqual([b, c]);
    expect(sel.selectAll([a!, a!, b!])).toBe(true);
    expect(sel.keys.value).toEqual([a, b]);
    await ctx.remove("People", a!);
    expect(sel.keys.value).toEqual([b]);
    sel.clear();
    expect(sel.keys.value).toEqual([]);
  });

  test("ordered capability and limit are optional, validated independently of ordinary multi selection", async () => {
    const list = people();
    await list.loadAll();
    expect(() => new Selection(ctx.store, list, { ordered: true })).toThrow("multiple");
    for (const maxOrdered of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => new Selection(ctx.store, list, { multiple: true, ordered: true, maxOrdered })).toThrow("positive safe integer");
    }
    expect(() => new Selection(ctx.store, list, { multiple: true, maxOrdered: 2 })).toThrow("ordered");
    const plain = new Selection(ctx.store, list, { multiple: true });
    expect(plain.ordered).toBe(false);
    expect(plain.move(list.keys.value[0]!, 0)).toBe(false);
    expect(plain.selectAll(list.keys.value as readonly string[])).toBe(true);
    expect(plain.count.value).toBe(list.count.value!);
    const ordered = new Selection(ctx.store, list, { multiple: true, ordered: true });
    expect(ordered.selectAll(list.keys.value as readonly string[])).toBe(true);
    expect(ordered.count.value).toBe(list.count.value!);
  });

});

describe("page scope", () => {
  test("publishing, reading by path, and withdrawing", () => {
    const scope = new PageScope();
    const name = signal("Ada");
    const value = scope.value("app.name");
    expect(value.value).toBeUndefined();
    const withdraw = scope.publish("app", valuesPublication({ name }));
    expect(value.value).toBe("Ada");
    name.value = "Grace";
    expect(value.value).toBe("Grace");
    expect(() => scope.publish("app", valuesPublication({}))).toThrow("already published");
    withdraw();
    expect(value.value).toBeUndefined();
  });

  test("a child scope shadows its parent's keys and falls through for the rest", () => {
    const page = new PageScope();
    page.publish("user", valuesPublication({ role: signal("viewer") }));
    page.publish("mode", valuesPublication({ editing: signal(false) }));
    const dialog = page.child();
    dialog.publish("mode", valuesPublication({ editing: signal(true) }));
    expect(dialog.value("user.role").value).toBe("viewer");
    expect(dialog.value("mode.editing").value).toBe(true);
    expect(page.value("mode.editing").value).toBe(false);
  });

  test("rules: a bare path, typed paths, two paths, and unpublished keys", async () => {
    const list = ctx.collection({ set: "Projects", orderBy: [{ field: "id" }] });
    await list.ensure(0, 10);
    const scope = new PageScope();
    const anyOn = scope.when("projects.any");
    const overBudget = scope.when({ op: "gt", field: "projects.selected.spent", other: "projects.selected.budget" });
    const big = scope.when({ op: "ge", field: "projects.selected.budget", value: "100000.0" });
    expect([anyOn.value, overBudget.value, big.value]).toEqual([false, false, false]);

    const sel = new Selection(ctx.store, list);
    scope.publish("projects", selectionPublication(sel));
    expect(anyOn.value).toBe(true);
    const first = sel.selected.value!;
    expect(big.value).toBe(Number(first.budget) >= 100000);
    await ctx.update("Projects", sel.key.value!, { spent: "999999999.00" });
    expect(overBudget.value).toBe(true);
  });

  test("typed paths: an unknown property is an error; untyped text can't be ordered", async () => {
    const list = people();
    await list.loadAll();
    const scope = new PageScope();
    scope.publish("people", selectionPublication(new Selection(ctx.store, list)));
    scope.publish("app", valuesPublication({ day: signal("2026-10-07"), count: signal(3) }));
    expect(() => scope.when({ op: "eq", field: "people.selected.nmae", value: "Ada" }).value).toThrow("has no field 'nmae'");
    expect(() => scope.when({ op: "gt", field: "app.day", value: "2026-10-01" }).value).toThrow("can't be ordered");
    expect(scope.when({ op: "gt", field: "app.count", value: 2 }).value).toBe(true);
    expect(scope.when({ op: "eq", field: "app.day", value: "2026-10-07" }).value).toBe(true);
  });

  test("state carries reasons; explain says which rule decided and what it read", () => {
    const scope = new PageScope();
    const state = signal("active");
    scope.publish("project", valuesPublication({ state }));
    const form = scope.state("form", {
      readOnly: { when: { op: "eq", field: "project.state", value: "archived" }, reason: "Archived projects can't be edited." },
    });
    expect(form.value.readOnly).toBe(false);
    state.value = "archived";
    expect(form.value).toMatchObject({ readOnly: true, reasons: { readOnly: "Archived projects can't be edited." } });
    expect(scope.explain("form")).toEqual([
      {
        effect: "readOnly",
        rule: { op: "eq", field: "project.state", value: "archived" },
        reason: "Archived projects can't be edited.",
        holds: true,
        reads: { "project.state": "archived" },
      },
    ]);
    expect(scope.readers("project")).toEqual([{ target: "form", effect: "readOnly" }]);
  });
});

describe("rules in the edit model", () => {
  async function editProject(id: number) {
    const key = keyText([id]);
    await ctx.reload("Projects", key);
    const scope = new PageScope();
    const edit = new EditModel(ctx, "Projects", key);
    scope.publish("project", editPublication(edit));
    return { scope, edit };
  }

  test("required and visible follow another field; hidden fields aren't checked", async () => {
    const { scope, edit } = await editProject(1);
    edit.applyRules(scope, "project", {
      behindDays: {
        visible: { op: "eq", field: "project.values.health", value: "behind" },
        required: { op: "eq", field: "project.values.health", value: "behind" },
      },
    });
    edit.set("behindDays", null);
    expect(edit.state("behindDays").value.visible).toBe(false);
    expect(edit.validate()).toBe(true);
    edit.set("health", "behind");
    expect(edit.state("behindDays").value).toMatchObject({ visible: true, required: true });
    expect(edit.validate()).toBe(false);
    expect(edit.errors.value.behindDays).toEqual(["Days behind is required."]);
    edit.set("behindDays", 4);
    expect(edit.errors.value.behindDays).toBeUndefined();
    expect(edit.valid.value).toBe(true);
  });

  test("read-only blocks edits with its reason, but keeps a change made before (decision 2)", async () => {
    const { scope, edit } = await editProject(2);
    edit.applyRules(scope, "project", {
      name: { readOnly: { when: { op: "eq", field: "project.values.state", value: "archived" }, reason: "Archived projects can't be edited." } },
    });
    edit.set("name", "Brand refresh 2027");
    edit.set("state", "archived");
    edit.set("name", "Something else");
    expect(edit.values.value.name).toBe("Brand refresh 2027");
    expect(edit.errors.value.name).toEqual(["Archived projects can't be edited."]);
    expect(edit.pending("name").value).toBe(true);
    const saved = await edit.save();
    expect(saved?.record.entity).toMatchObject({ name: "Brand refresh 2027", state: "archived" });
  });

  test("a hidden field's change is sent, unless it clears when hidden (decision 1)", async () => {
    const { scope, edit } = await editProject(3);
    edit.applyRules(scope, "project", {
      behindDays: { visible: { op: "eq", field: "project.values.health", value: "behind" }, clearWhenHidden: true },
      hue: { visible: { op: "ne", field: "project.values.health", value: "behind" } },
    });
    edit.set("health", "behind");
    edit.set("behindDays", 6);
    edit.set("hue", 200);
    edit.set("health", "onTrack");
    expect(edit.values.value.behindDays).toBeNull();
    edit.set("health", "behind");
    const saved = await edit.save();
    expect(saved?.record.entity).toMatchObject({ health: "behind", behindDays: null, hue: 200 });
  });

  test("a field that starts hidden keeps its value, even if the rule's key is published late", async () => {
    const key = keyText([2]);
    await ctx.reload("Projects", key);
    const scope = new PageScope();
    const edit = new EditModel(ctx, "Projects", key);
    const days = edit.values.value.behindDays;
    edit.applyRules(scope, "project", {
      behindDays: { visible: { op: "eq", field: "project.values.health", value: "behind" }, clearWhenHidden: true },
    });
    scope.publish("project", editPublication(edit));
    expect(edit.values.value.behindDays).toBe(days);
    expect(edit.dirty.value).toBe(false);
  });

  test("immutable and computed fields are read-only with a reason", async () => {
    const { edit } = await editProject(1);
    expect(edit.state("id").value).toMatchObject({ readOnly: true, reasons: { readOnly: "id is set by the server." } });
    expect(edit.state("name").value.required).toBe(true);
  });
});

describe("queries that follow the page", () => {
  test("a detail list follows the selection, never showing the last person's rows", async () => {
    const list = people();
    await list.loadAll();
    const sel = new Selection(ctx.store, list);
    const scope = new PageScope();
    scope.publish("people", selectionPublication(sel));
    const leadId = scope.value("people.selected.id");
    const query = computed<Query>(() => ({
      set: "Projects",
      filter: { op: "eq", field: "leadId", value: (leadId.value as number | undefined) ?? -1 },
      orderBy: [{ field: "name" }],
    }));
    const led: Collection = ctx.collection(query);
    await led.loadAll();
    const leads = (c: Collection) => new Set(c.items.value.map((p) => p?.leadId));
    expect(leads(led)).toEqual(new Set([sel.selected.value!.id]));

    sel.select(list.keys.value[1]!);
    expect(led.items.value).toEqual([]);
    await waitFor(() => led.count.value !== undefined);
    await led.loadAll();
    expect(leads(led)).toEqual(new Set([sel.selected.value!.id]));
  });
});

describe("list edit", () => {
  async function tasksOf(projectId: number) {
    const tasks = ctx.collection({
      set: "Tasks",
      filter: { op: "eq", field: "projectId", value: projectId },
      orderBy: [{ field: "id" }],
    });
    await tasks.loadAll();
    return new ListEdit(ctx, tasks, {
      defaults: (): Entity => ({ projectId, title: "", due: null, assigneeId: null, done: false }),
    });
  }

  test("a new row is pending in full; removing an existing row only marks it", async () => {
    const list = await tasksOf(4);
    const [first, second] = list.rows.value;
    const added = list.add({ title: "Write the release notes" });
    expect(added.edit.pending("title").value && added.edit.pending("done").value).toBe(true);
    list.remove(first!.id);
    expect(list.rows.value.find((r) => r.id === first!.id)?.removing).toBe(true);
    list.restore(first!.id);
    list.remove(first!.id);
    second!.edit.set("done", true);
    expect(list.changes().map((c) => c.kind)).toEqual(["delete", "update", "create"]);
    expect(list.dirty.value).toBe(true);
  });

  test("a deletion that fails stays marked, with its error on the row", async () => {
    const list = await tasksOf(4);
    const [first] = list.rows.value;
    list.remove(first!.id);
    mock.faults.failNext(503, { code: "ServiceUnavailable", message: "The server is busy." });
    const result = await list.save();
    expect(result.failed).toEqual([first!.id]);
    const row = list.rows.value.find((r) => r.id === first!.id)!;
    expect([row.removing, row.removeError]).toEqual([true, "Couldn’t delete it: The server is busy."]);
    list.restore(first!.id);
    expect(list.rows.value.find((r) => r.id === first!.id)?.removeError).toBeUndefined();
  });

  test("save applies deletions, updates and creations; a failure stays pending", async () => {
    const list = await tasksOf(4);
    const count = list.collection!.count.value!;
    // A task with subtasks can't be deleted alone where the hierarchy is declared (aster-server: 409).
    const parents = new Set(data.Tasks.map((t) => t.parentId));
    const [first, second] = list.rows.value.filter((r) => !parents.has(keyFromText(r.id)[0] as number));
    list.remove(first!.id);
    second!.edit.set("title", "Renamed");
    const bad = list.add({ title: "" });
    list.add({ title: "Check the copy" });
    const result = await list.save();
    expect(result.saved.map((c) => c.kind)).toEqual(["delete", "update", "create"]);
    expect(result.failed).toEqual([bad.id]);
    expect(list.collection!.count.value).toBe(count);
    expect(list.rows.value.filter((r) => r.isNew).map((r) => r.id)).toEqual([bad.id]);
    expect(bad.edit.errors.value.title).toBeDefined();
    expect(list.rows.value.some((r) => r.edit.values.value.title === "Check the copy" && !r.isNew)).toBe(true);
  });
});

describe("saving while typing", () => {
  test("changes made while a save is in flight survive its answer, still pending", async () => {
    const key = keyText([3]);
    await ctx.reload("Projects", key);
    const edit = new EditModel(ctx, "Projects", key);
    edit.set("name", "Billing v3");
    mock.faults.writeLatencyMs = 30;
    const saving = edit.save();
    await Bun.sleep(5);
    edit.set("behindDays", 9);
    const saved = await saving;
    expect(saved?.record.entity.name).toBe("Billing v3");
    expect(edit.values.value).toMatchObject({ name: "Billing v3", behindDays: 9 });
    expect(edit.pending("behindDays").value).toBe(true);
    expect(edit.pending("name").value).toBe(false);
  });
});

describe("following a query after loading deep", () => {
  test("a new query loads its first page only, however much the old one had loaded", async () => {
    const requests: string[] = [];
    const transport = mock.transport;
    const counting = await DataContext.connect(async (r) => (requests.push(r.url), transport(r)));
    const order = signal<"asc" | "desc">("asc");
    const tasks = counting.collection(
      computed<Query>(() => ({ set: "Tasks", orderBy: [{ field: "id", ...(order.value === "desc" ? { descending: true } : {}) }] })),
      { pageSize: 20 },
    );
    await tasks.ensure(0, 20);
    await tasks.ensure(1000, 1100);
    requests.length = 0;
    order.value = "desc";
    await waitFor(() => tasks.count.value !== undefined);
    expect(requests.filter((u) => u.startsWith("Tasks?")).length).toBe(1);
  });
});

test("a query rebuilt equal doesn't reload the collection", async () => {
  const requests: string[] = [];
  const transport = mock.transport;
  const counting = await DataContext.connect(async (r) => (requests.push(r.url), transport(r)));
  const width = signal(100);
  const tasks = counting.collection(
    computed<Query>(() => (width.value, { set: "Tasks", orderBy: [{ field: "id" }] })),
    { pageSize: 20 },
  );
  await tasks.ensure(0, 20);
  requests.length = 0;
  width.value = 140;
  await Bun.sleep(10);
  expect([requests.length, tasks.count.value !== undefined]).toEqual([0, true]);
});
