import { beforeEach, expect, test } from "bun:test";
import { signal } from "@preact/signals-core";
import { DataContext, type Query, type Grouping, type GroupingHeader, type ODataRequest } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";

const metadata = { $Version: "4.01", $EntityContainer: "Groups.Container", Groups: {
  Item: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, region: { $Nullable: true }, state: {}, team: {}, cost: { $Type: "Edm.Decimal", $Scale: 2, $Nullable: true } },
  Container: { $Kind: "EntityContainer", Items: { $Collection: true, $Type: "Groups.Item" } },
} };
const data = { Items: [
  { id: 1, region: "A", state: "on", team: "x", cost: "9007199254740993.10" },
  { id: 2, region: "A", state: "on", team: "y", cost: "0.20" },
  { id: 3, region: "A", state: "off", team: "x", cost: "5.00" },
  { id: 4, region: "B", state: "on", team: "x", cost: "10.00" },
  { id: 5, region: "B", state: "off", team: "y", cost: null },
  { id: 6, region: null, state: "on", team: "x", cost: "2.00" },
] };
const aggregates = [{ field: "cost", method: "sum" as const, as: "cost" }, { field: "team", method: "countdistinct" as const, as: "teams" }];
const wait = async (done: () => boolean) => { for (let i = 0; i < 400; i++) { if (done()) return; await Bun.sleep(5); } throw new Error("timed out"); };
const headers = (g: Grouping) => g.rows.value.filter((r): r is GroupingHeader => r.kind === "group");
const header = (g: Grouping, path: readonly unknown[]) => headers(g).find((r) => JSON.stringify(r.path) === JSON.stringify(path))!;
const ready = async (g: Grouping) => { await wait(() => g.root.status.value === "idle" && headers(g).every((h) => !h.loading)); };
let mock: MockService;
let ctx: DataContext;
let requests: ODataRequest[];
beforeEach(async () => {
  mock = await createMockService({ metadata, data });
  requests = [];
  ctx = await DataContext.connect((r) => { requests.push(r); return mock.transport(r); });
});

test("three levels load lazily; every prefix has its own exact totals and identity", async () => {
  const g = ctx.grouping({ set: "Items" }, ["region", "state", "team"], aggregates, { pageSize: 1, keepPages: 1 });
  try {
    await ready(g);
    expect(g.total.value).toBe(6);
    expect(headers(g).length).toBe(3);
    expect(header(g, ["A"]).group.totals).toEqual({ cost: "9007199254740998.30", teams: "2" });
    await g.expand(header(g, ["A"]).id);
    await ready(g);
    expect(header(g, ["A", "on"]).group.totals).toEqual({ cost: "9007199254740993.30", teams: "2" });
    expect(requests.filter((r) => r.url.startsWith("Items?") && !r.url.includes("$apply"))).toHaveLength(0);
    await g.expand(header(g, ["A", "on"]).id);
    await ready(g);
    expect(header(g, ["A", "on", "x"]).level).toBe(3);
    expect(header(g, ["A", "on", "x"]).parent).toBe(header(g, ["A", "on"]).id);
    await g.expand(header(g, ["A", "on", "x"]).id);
    const record = g.rows.value.find((r) => r.kind === "row");
    expect(record?.kind === "row" && [record.key, record.level, record.position, record.siblings]).toEqual(["[1]", 4, 1, 1]);
    expect(ctx.store.get("Items", "[2]")).toBeUndefined();
    await g.expand(header(g, [null]).id);
    await ready(g);
    expect(header(g, [null, "on"]).group.count).toBe(1);
    expect(new Set(headers(g).map((h) => h.id)).size).toBe(headers(g).length);
  } finally { g.dispose(); }
});

test("leaf pages are bounded and collapse releases descendants while preserving other open branches", async () => {
  const g = ctx.grouping({ set: "Items", orderBy: [{ field: "id" }] }, ["region", "state"], aggregates, { pageSize: 1, keepPages: 1 });
  try {
    await ready(g);
    const a = header(g, ["A"]).id;
    const b = header(g, ["B"]).id;
    await g.expand(a); await g.expand(b); await ready(g);
    await g.expand(header(g, ["A", "on"]).id);
    let records = g.rows.value.filter((r) => r.kind === "row");
    expect(records.map((r) => r.key)).toEqual(["[1]", undefined]);
    const leaf = records[0]!.collection;
    await leaf.view(1, 2);
    expect(leaf.keys.value.filter((k) => k !== undefined)).toHaveLength(1);
    expect(g.rows.value.filter((r) => r.kind === "row").map((r) => r.key)).toEqual([undefined, "[2]"]);
    g.collapse(a);
    expect([...g.open.value]).toEqual([b]);
    expect(g.rows.value.filter((r) => r.kind === "row")).toHaveLength(0);
    const keys = leaf.keys.value;
    await ctx.update("Items", "[2]", { state: "off" });
    expect(leaf.keys.value).toBe(keys);
    await ready(g);
  } finally { g.dispose(); }
});

test("filters prune absent paths, sorting preserves open groups, and saved membership moves recount every level", async () => {
  const q = signal<Query>({ set: "Items" });
  const g = ctx.grouping(q, ["region", "state"], aggregates);
  try {
    await ready(g);
    const a = header(g, ["A"]).id;
    await g.expand(a); await ready(g);
    await g.expand(header(g, ["A", "on"]).id);
    q.value = { set: "Items", orderBy: [{ field: "region", descending: true }, { field: "state", descending: true }] };
    await ready(g);
    expect(header(g, ["A"]).expanded).toBe(true);
    expect(header(g, ["A", "on"]).expanded).toBe(true);
    await ctx.update("Items", "[1]", { state: "off" });
    await ready(g);
    expect(header(g, ["A", "on"]).group.count).toBe(1);
    expect(header(g, ["A", "off"]).group.count).toBe(2);
    expect(header(g, ["A"]).group.count).toBe(3);
    q.value = { set: "Items", filter: { op: "eq", field: "region", value: "B" } };
    await ready(g);
    expect(g.total.value).toBe(2);
    expect([...g.open.value]).toEqual([]);
  } finally { g.dispose(); }
});

test("aggregate changes keep open paths and leaf collection identity", async () => {
  const g = ctx.grouping({ set: "Items" }, ["region", "state"]);
  try {
    await ready(g); await g.expand(header(g, ["A"]).id); await ready(g);
    await g.expand(header(g, ["A", "on"]).id);
    const before = g.rows.value.find((r) => r.kind === "row");
    const open = [...g.open.value];
    g.setAggregates(aggregates);
    await ready(g);
    expect([...g.open.value]).toEqual(open);
    const after = g.rows.value.find((r) => r.kind === "row");
    expect(before?.kind === "row" && after?.kind === "row" && before.collection === after.collection).toBe(true);
    expect(header(g, ["A", "on"]).group.totals.teams).toBe("2");
  } finally { g.dispose(); }
});

test("root and child failures are retryable; closed or disposed branches ignore late answers", async () => {
  mock.faults.failNext(503);
  const g = ctx.grouping({ set: "Items" }, ["region", "state"]);
  await wait(() => g.root.status.value === "error");
  await g.retry(); await ready(g);
  const a = header(g, ["A"]).id;
  mock.faults.failNext(503);
  await g.expand(a);
  await wait(() => header(g, ["A"]).error !== undefined);
  await g.retry(a); await ready(g);
  expect(header(g, ["A", "on"]).group.count).toBe(2);
  mock.faults.latencyMs = 40;
  const pending = g.retry(a);
  g.collapse(a);
  await pending;
  expect(headers(g).some((h) => h.level > 1)).toBe(false);
  const late = g.retry();
  g.dispose();
  await late;
  const count = requests.length;
  await g.retry(); await g.expand(a);
  expect(requests.length).toBe(count);
});

test("invalid fields and aliases fail before starting subscriptions or requests", () => {
  for (const fields of [[], ["region", "region"], ["missing"], [""]]) expect(() => ctx.grouping({ set: "Items" }, fields)).toThrow();
  expect(() => ctx.grouping({ set: "Items" }, ["region"], [{ field: "cost", method: "sum", as: "region" }])).toThrow();
});

test("grouped next links are followed before exposing sibling counts", async () => {
  const other = await DataContext.connect(async (r) => {
    if (r.url === "Items?group-page=2") return { status: 200, headers: {}, body: JSON.stringify({ value: [{ region: "B", count: 2 }] }) };
    const result = await mock.transport(r);
    if (!r.url.includes("$apply")) return result;
    return { ...result, body: JSON.stringify({ value: [{ region: "A", count: 3 }], "@odata.nextLink": "http://localhost/odata/Items?group-page=2" }) };
  });
  const g = other.grouping({ set: "Items" }, ["region"]);
  try {
    await ready(g);
    expect(g.total.value).toBe(5);
    expect(headers(g).map((h) => h.siblings)).toEqual([2, 2]);
  } finally { g.dispose(); }
});
