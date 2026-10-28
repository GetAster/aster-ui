// Service marker compatibility end to end through the mock's engine: estimated
// counts (`@AsterData.CountEstimated`, `AsterData.CountThreshold`) and
// fields hidden per record (`AsterData.ViewableWhen`, `@AsterData.Hidden`).
// Estimates exercise mock simulation; current Web Data returns exact counts.
import { describe, expect, test } from "bun:test";
import { DataContext, EditModel, PageScope, editPublication, keyText, selectionPublication, Selection, type ODataRequest } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

let mock: MockService;
let sent: ODataRequest[];

/** `edit` changes the service's `$metadata`; the client reads the same. */
async function connect(edit: (m: any) => void = () => {}, countEstimate?: number): Promise<DataContext> {
  const meta = structuredClone(metadata) as any;
  edit(meta);
  mock = await createMockService({ metadata: meta, data, now: () => "2026-10-07T15:20:00Z", ...(countEstimate ? { countEstimate } : {}) });
  sent = [];
  return DataContext.connect(async (r) => {
    sent.push(r);
    return mock.transport(r);
  });
}

const people = data.People.length;

describe("estimated counts", () => {
  test("an estimate sizes a collection, marked, until a short page shows the end", async () => {
    const ctx = await connect(() => {}, 1.5);
    const c = ctx.collection({ set: "People", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await c.ensure(0, 5);
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([Math.ceil(people * 1.5), false, true]);
    await c.loadAll();
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([people, true, false]);
  });

  test("exactCount gets the exact count", async () => {
    const ctx = await connect(() => {}, 1.5);
    const c = ctx.collection({ set: "People" }, { pageSize: 5, exactCount: true });
    await c.ensure(0, 5);
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([people, true, false]);
    expect(sent.at(-1)?.headers?.prefer).toBe("aster.count=exact");
  });

  test("a set's CountThreshold is read; below it the count is exact, at or above it it's left out", async () => {
    const ctx = await connect((m) => {
      m.AsterDemo.Container.People["@AsterData.CountThreshold"] = 100;
      m.AsterDemo.Container.Tasks["@AsterData.CountThreshold"] = 1000;
    }, 1.5);
    expect(ctx.schema.set("People").countThreshold).toBe(100);
    expect(ctx.schema.set("Projects").countThreshold).toBeUndefined();
    const small = ctx.collection({ set: "People" }, { pageSize: 5 });
    await small.ensure(0, 5);
    expect([small.count.value, small.counted.value, small.estimated.value]).toEqual([people, true, false]);
    const big = ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 100 });
    await big.ensure(0, 100);
    expect([big.count.value, big.counted.value, big.estimated.value]).toEqual([200, false, false]);
  });

  test("a deletion leaves an estimated count one lower, still an estimate", async () => {
    const ctx = await connect(() => {}, 2);
    const c = ctx.collection({ set: "People", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await c.ensure(0, 5);
    const first = c.keys.value[0]!;
    await ctx.remove("People", first);
    expect([c.count.value, c.estimated.value, c.keys.value.includes(first)]).toEqual([people * 2 - 1, true, false]);
  });
});

/** Projects' budget is hidden on paused projects. */
const hideBudget = (m: any) => {
  m.AsterDemo.Project.budget["@AsterData.ViewableWhen#BudgetUnlessPaused"] = { $Ne: [{ $Path: "state" }, "paused"] };
};
const paused = data.Projects.find((p) => p.state === "paused")!;
const active = data.Projects.find((p) => p.state === "active")!;

describe("hidden fields", () => {
  test("a hidden field is stored as unknown, with the record's other fields known", async () => {
    const ctx = await connect(hideBudget);
    const c = ctx.collection({ set: "Projects", filter: { op: "eq", field: "id", value: paused.id } });
    await c.ensure(0, 10);
    const stored = ctx.store.get("Projects", keyText([paused.id]))!;
    expect([...stored.hidden!]).toEqual(["budget"]);
    expect(stored.entity.budget).toBeNull();
    expect(stored.known?.has("budget")).toBe(false);
    expect(stored.known?.has("name")).toBe(true);
    await ctx.reload("Projects", keyText([active.id]));
    expect(ctx.store.get("Projects", keyText([active.id]))!.hidden).toBeUndefined();
  });

  test("a list filtered or sorted by a hidden field refetches rather than guess where the record goes", async () => {
    const ctx = await connect(hideBudget);
    const filtered = ctx.collection({ set: "Projects", filter: { op: "eq", field: "budget", value: null }, orderBy: [{ field: "id" }] });
    const sorted = ctx.collection({ set: "Projects", orderBy: [{ field: "budget" }, { field: "id" }] });
    const byName = ctx.collection({ set: "Projects", orderBy: [{ field: "name" }, { field: "id" }] });
    await Promise.all([filtered.loadAll(), sorted.loadAll(), byName.loadAll()]);
    const before = sent.length;
    const key = keyText([paused.id]);
    const res = await mock.external({ method: "PATCH", headers: { "content-type": "application/json" }, url: `Projects(${paused.id})`, body: JSON.stringify({ name: "Paused, renamed" }) });
    expect(res.status).toBeLessThan(300);
    await ctx.reload("Projects", key, "external");
    // `budget eq null` would hold for the hidden null; the record isn't placed by it.
    expect(filtered.stale.value).toBe(true);
    expect(sorted.stale.value).toBe(true);
    // A list that doesn't read the field places it locally.
    expect(byName.stale.value).toBe(false);
    for (let i = 0; i < 100 && (filtered.stale.value || sorted.stale.value); i++) await Bun.sleep(5);
    expect([filtered.stale.value, sorted.stale.value]).toEqual([false, false]);
    const refetched = sent.slice(before).filter((r) => r.method === "GET" && r.url.startsWith("Projects?"));
    expect(refetched.length).toBeGreaterThanOrEqual(2);
  });

  test("an edit never offers, marks or sends a hidden field", async () => {
    const ctx = await connect(hideBudget);
    const key = keyText([paused.id]);
    await ctx.reload("Projects", key);
    const edit = new EditModel(ctx, "Projects", key);
    expect(edit.hidden.value.has("budget")).toBe(true);
    const state = edit.state("budget").value;
    expect([state.readOnly, state.reasons.readOnly]).toEqual([true, "You can't see Budget on this record."]);
    edit.set("budget", "10.00");
    expect(edit.values.value.budget).toBeNull();
    edit.forcePending("budget", true);
    expect(edit.pending("budget").value).toBe(false);
    expect(edit.dirty.value).toBe(false);
    // Required by metadata, hidden: no error for the null.
    expect(edit.validate()).toBe(true);
    edit.set("name", "Billing, paused");
    const saved = await edit.save();
    expect(saved).toBeDefined();
    const patch = sent.findLast((r) => r.method === "PATCH")!;
    expect(JSON.parse(patch.body!)).toEqual({ name: "Billing, paused" });
    // The write's answer keeps it hidden, and the stored budget is untouched.
    expect(edit.hidden.value.has("budget")).toBe(true);
    await mock.external({ method: "PATCH", headers: { "content-type": "application/json" }, url: `Projects(${paused.id})`, body: JSON.stringify({ state: "active" }) });
    await ctx.reload("Projects", key, "external");
    expect(ctx.store.get("Projects", key)!.entity.budget).toBe(paused.budget);
  });

  test("a field that becomes hidden while edited is a conflict, not a change sent", async () => {
    const ctx = await connect(hideBudget);
    const key = keyText([active.id]);
    await ctx.reload("Projects", key);
    const edit = new EditModel(ctx, "Projects", key);
    edit.set("budget", "123.00");
    await mock.external({ method: "PATCH", headers: { "content-type": "application/json" }, url: `Projects(${active.id})`, body: JSON.stringify({ state: "paused" }) });
    await ctx.reload("Projects", key, "external");
    expect(edit.conflict.value?.fields).toContain("budget");
    edit.rebase();
    expect(edit.hidden.value.has("budget")).toBe(true);
    expect(edit.changes()).toBeUndefined();
  });

  test("a page rule reads a hidden field as unknown, not null", async () => {
    const ctx = await connect(hideBudget);
    const key = keyText([paused.id]);
    await ctx.reload("Projects", key);
    const edit = new EditModel(ctx, "Projects", key);
    const scope = new PageScope();
    scope.publish("form", editPublication(edit));
    const noBudget = scope.when({ op: "eq", field: "form.record.budget", value: null });
    const someBudget = scope.when({ op: "not", arg: { op: "eq", field: "form.record.budget", value: null } });
    expect([noBudget.value, someBudget.value]).toEqual([false, false]);
    const state = scope.state("form.spent", { readOnly: { op: "eq", field: "form.values.budget", value: null } });
    expect(state.value.readOnly).toBe(false);
    expect(scope.explain("form.spent")[0]?.unknown).toEqual(["form.values.budget"]);
    // A selected record publishes its hidden fields too.
    const list = ctx.collection({ set: "Projects", filter: { op: "eq", field: "id", value: paused.id } });
    await list.ensure(0, 1);
    scope.publish("projects", selectionPublication(new Selection(ctx.store, list)));
    expect(scope.when({ op: "eq", field: "projects.selected.budget", value: null }).value).toBe(false);
    expect(scope.when({ op: "eq", field: "projects.selected.state", value: "paused" }).value).toBe(true);
  });

  test("undoing the delete of a record with a hidden field doesn't write the null back", async () => {
    const ctx = await connect(hideBudget);
    const key = keyText([paused.id]);
    await ctx.reload("Projects", key);
    const removed = await ctx.remove("Projects", key);
    expect(removed.kind === "delete" && "budget" in removed.values).toBe(false);
  });
});
