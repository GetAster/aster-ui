import { beforeEach, expect, test } from "bun:test";
import { effect } from "@preact/signals-core";
import { DataContext, Selection } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";

const metadata = { $Version: "4.01", $EntityContainer: "Stable.Container", Stable: {
  Item: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, title: {}, category: {}, cost: { $Type: "Edm.Int32" } },
  Container: { $Kind: "EntityContainer", Items: { $Collection: true, $Type: "Stable.Item" } },
} };
let mock: MockService;
let ctx: DataContext;
let hold: boolean;
let pending: (() => void)[];
const wait = async (done: () => boolean) => {
  for (let i = 0; i < 1000; i++) { if (done()) return; await Bun.sleep(1); }
  throw new Error("timed out");
};
const drain = async (task: Promise<unknown>) => {
  let done = false;
  const completed = task.finally(() => { done = true; });
  await wait(() => { pending.splice(0).forEach(release => release()); return done; });
  await completed;
};
beforeEach(async () => {
  hold = false; pending = [];
  mock = await createMockService({ metadata, data: { Items: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, title: String(i + 1).padStart(3, "0"), category: i % 2 ? "B" : "A", cost: 10 })) } });
  ctx = await DataContext.connect(async request => {
    const response = await mock.transport(request);
    if (hold && request.method === "GET" && request.url.startsWith("Items?")) await new Promise<void>(resolve => pending.push(resolve));
    return response;
  });
});

test("unchanged membership preserves the key signal's identity across writes and refresh", async () => {
  const c = ctx.collection({ set: "Items", orderBy: [{ field: "id" }] });
  await c.loadAll();
  const keys = c.keys.value;
  await ctx.update("Items", "[1]", { cost: 20 });
  expect(c.keys.value).toBe(keys);
  expect(c.items.value[0]?.cost).toBe(20);
  await c.refresh();
  expect(c.keys.value).toBe(keys);
  ctx.release(c);
});

test("an uncertain move keeps confirmed positions and selection until a complete refresh commits", async () => {
  const c = ctx.collection({ set: "Items", orderBy: [{ field: "title" }] }, { pageSize: 4, keepPages: 1 });
  await c.view(0, 2);
  const keys = c.keys.value;
  const selection = new Selection(ctx.store, c, { fallback: false }); selection.select("[1]");
  hold = true;
  await ctx.update("Items", "[1]", { title: "ZZZ" });
  expect(c.stale.value).toBe(true);
  expect(c.keys.value).toBe(keys);
  expect(c.count.value).toBe(40);
  expect(selection.key.value).toBe("[1]");
  await wait(() => pending.length > 0);
  pending.splice(0).forEach(release => release());
  await wait(() => !c.stale.value);
  expect(c.keys.value.slice(0, 4)).toEqual(["[2]", "[3]", "[4]", "[5]"]);
  expect(selection.key.value).toBe("[1]");
  ctx.release(c);
});

test("a count change in a later page never blanks the confirmed visible window", async () => {
  const c = ctx.collection({ set: "Items", orderBy: [{ field: "id" }] }, { pageSize: 4, keepPages: 1 });
  await c.view(0, 2);
  const snapshots: { count: number | undefined; keys: readonly (string | undefined)[] }[] = [];
  const stop = effect(() => { snapshots.push({ count: c.count.value, keys: c.keys.value }); });
  await mock.external({ method: "POST", url: "Items", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 41, title: "041", category: "B", cost: 10 }) });
  hold = true;
  const loading = c.ensure(8, 12);
  await wait(() => pending.length > 0); pending.shift()!();
  await wait(() => pending.length > 0);
  expect(c.stale.value).toBe(true);
  expect(c.keys.value.slice(0, 4)).toEqual(["[1]", "[2]", "[3]", "[4]"]);
  await drain(loading);
  expect(c.count.value).toBe(41);
  expect(c.keys.value.slice(8, 12)).toEqual(["[9]", "[10]", "[11]", "[12]"]);
  for (const snapshot of snapshots) {
    expect(snapshot.keys.length).toBe(snapshot.count!);
    expect(snapshot.keys.slice(0, 4)).toEqual(["[1]", "[2]", "[3]", "[4]"]);
  }
  stop(); ctx.release(c);
});

test("query replacement clears old results and rejects late same-query refresh results", async () => {
  const c = ctx.collection({ set: "Items", orderBy: [{ field: "id" }] }, { pageSize: 4 });
  await c.view(0, 2);
  hold = true;
  const refreshing = c.refresh();
  await wait(() => pending.length > 0);
  c.setQuery({ set: "Items", filter: { op: "ge", field: "id", value: 30 } });
  expect(c.keys.value).toEqual([]);
  expect(c.count.value).toBeUndefined();
  await drain(refreshing);
  await drain(c.ensure(0, 2));
  expect(c.items.value[0]?.id).toBe(30);
  ctx.release(c);
});

test("a failed refresh retains confirmed rows while known deletions still leave immediately", async () => {
  const c = ctx.collection({ set: "Items", orderBy: [{ field: "title" }] }, { pageSize: 4, keepPages: 1 });
  await c.view(0, 2);
  const keys = c.keys.value;
  const changed = { ...ctx.store.get("Items", "[1]")!.entity, title: "ZZZ" };
  await mock.external({ method: "PATCH", url: "Items(1)", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "ZZZ" }) });
  mock.faults.failNext(503);
  ctx.store.put("Items", { entity: changed }, { kind: "external" });
  await wait(() => c.status.value === "error");
  expect(c.stale.value).toBe(true); expect(c.keys.value).toBe(keys);
  expect(c.error.value).toBeDefined();
  await ctx.remove("Items", "[2]");
  expect(c.keys.value).not.toContain("[2]");
  expect(c.count.value).toBe(39);
  await c.refresh();
  expect(c.status.value).toBe("idle"); expect(c.stale.value).toBe(false);
  expect(c.items.value[0]?.id).toBe(3);
  ctx.release(c);
});

test("group refreshes preserve unchanged rows, retain errors and replace only changed group values", async () => {
  const groups = ctx.groups({ set: "Items" }, "category");
  await wait(() => groups.status.value === "idle");
  const rows = groups.rows.value!;
  await groups.refresh(); expect(groups.rows.value).toBe(rows);
  mock.faults.failNext(503);
  await groups.refresh();
  expect(groups.status.value).toBe("error"); expect(groups.rows.value).toBe(rows);
  await groups.refresh(); expect(groups.rows.value).toBe(rows);
  await ctx.create("Items", { id: 41, title: "041", category: "A", cost: 10 });
  await wait(() => groups.status.value === "idle");
  expect(groups.rows.value![0]).not.toBe(rows[0]);
  expect(groups.rows.value![0]!.count).toBe(21);
  expect(groups.rows.value![1]).toBe(rows[1]);
  groups.dispose();
});
