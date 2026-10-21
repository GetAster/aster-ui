import { beforeEach, expect, test } from "bun:test";
import { computed, signal } from "@preact/signals-core";
import { DataContext, exportCsv, type Query, type ODataRequest, type Aggregate } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";

const metadata = { $Version: "4.01", $EntityContainer: "Reports.Container", Reports: {
  Item: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: {}, category: {}, amount: { $Type: "Edm.Decimal", $Scale: 2, $Nullable: true } },
  Container: { $Kind: "EntityContainer", Items: { $Collection: true, $Type: "Reports.Item" } },
} };
const data = { Items: [
  { id: 1, name: "First, \"quoted\"\nline", category: "A", amount: "9007199254740993.10" },
  { id: 2, name: "=HYPERLINK(\"bad\")", category: "A", amount: "0.20" },
  { id: 3, name: "Last", category: "B", amount: null },
] };
const sum: Aggregate[] = [{ field: "amount", method: "sum", as: "total" }];
const wait = async (done: () => boolean) => { for (let i = 0; i < 400; i++) { if (done()) return; await Bun.sleep(5); } throw new Error("timed out"); };
let mock: MockService;
let ctx: DataContext;
let requests: ODataRequest[];
beforeEach(async () => {
  mock = await createMockService({ metadata, data });
  requests = [];
  ctx = await DataContext.connect((r) => { requests.push(r); return mock.transport(r); });
});

test("server summaries are exact with unloaded pages, and filter changes clear the previous result", async () => {
  const c = ctx.collection({ set: "Items" }, { pageSize: 1 });
  await c.ensure(0, 1);
  const summary = ctx.summary(computed(() => c.query), sum);
  try {
    await wait(() => summary.status.value === "idle");
    expect(summary.values.value).toEqual({ count: 3, total: "9007199254740993.30" });
    expect(c.complete.value).toBe(false);
    c.setQuery({ set: "Items", filter: { op: "eq", field: "category", value: "B" } });
    expect(summary.values.value).toBeUndefined();
    await wait(() => summary.status.value === "idle");
    expect(summary.values.value?.count).toBe(1);
    c.setQuery({ set: "Items", filter: { op: "eq", field: "id", value: 99 } });
    await wait(() => summary.status.value === "idle");
    expect(summary.values.value?.count).toBe(0);
  } finally { summary.dispose(); ctx.release(c); }
});

test("summaries follow saved changes, coalesce writes and ignore sort and projection changes", async () => {
  const query = signal<Query>({ set: "Items" });
  const summary = ctx.summary(query, sum);
  try {
    await wait(() => summary.status.value === "idle");
    const initial = requests.length;
    query.value = { set: "Items", orderBy: [{ field: "id", descending: true }], select: ["id"] };
    expect(requests.length).toBe(initial);
    await ctx.reload("Items", "[2]");
    await ctx.update("Items", "[2]", { amount: "1.20" });
    expect(summary.values.value).toBeUndefined();
    await wait(() => summary.status.value === "idle");
    expect(summary.values.value?.total).toBe("9007199254740994.30");
    expect(requests.filter((r) => r.url.includes("$apply")).length).toBe(2);
  } finally { summary.dispose(); }
});

test("a failed summary is retryable and disposal suppresses late responses and subsequent requests", async () => {
  mock.faults.failNext(503);
  const summary = ctx.summary({ set: "Items" }, sum);
  await wait(() => summary.status.value === "error");
  expect(summary.values.value).toBeUndefined();
  await summary.refresh();
  expect(summary.status.value).toBe("idle");
  mock.faults.latencyMs = 50;
  const running = summary.refresh();
  summary.dispose();
  await running;
  expect(summary.values.value).toBeUndefined();
  const before = requests.length;
  await summary.refresh();
  expect(requests.length).toBe(before);
});

test("a superseded summary response never replaces the latest query result", async () => {
  const q = signal<Query>({ set: "Items", filter: { op: "eq", field: "category", value: "A" } });
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let first = true;
  const other = await DataContext.connect(async (r) => {
    const response = await mock.transport(r);
    if (r.url.includes("$apply") && first) { first = false; await held; }
    return response;
  });
  const summary = other.summary(q, sum);
  try {
    await wait(() => !first);
    q.value = { set: "Items", filter: { op: "eq", field: "category", value: "B" } };
    await wait(() => summary.status.value === "idle");
    release();
    await Bun.sleep(10);
    expect(summary.values.value?.count).toBe(1);
  } finally { release(); summary.dispose(); }
});

test("aggregate aliases and numeric methods are validated before a request", () => {
  for (const as of ["count", "bad/alias", "x)" ]) expect(() => ctx.summary({ set: "Items" }, [{ ...sum[0]!, as }])).toThrow();
  expect(() => ctx.summary({ set: "Items" }, [sum[0]!, sum[0]!])).toThrow();
  expect(() => ctx.summary({ set: "Items" }, [{ field: "name", method: "sum", as: "total" }])).toThrow("numeric");
});

test("CSV quotes multiline text, protects formulas and preserves exact decimals without populating the store", async () => {
  const csv = await exportCsv(ctx, { set: "Items", orderBy: [{ field: "id" }] }, [{ field: "name", title: "Name" }, { field: "amount" }], { pageSize: 1 });
  expect(csv).toBe("\uFEFF\"Name\",\"amount\"\r\n\"First, \"\"quoted\"\"\nline\",\"9007199254740993.10\"\r\n\"\u0027=HYPERLINK(\"\"bad\"\")\",\"0.20\"\r\n\"Last\",\"\"\r\n");
  expect(ctx.store.get("Items", "[1]")).toBeUndefined();
  expect(requests.filter((r) => r.url.includes("Items?")).length).toBe(4);
});

test("selection CSV preserves supplied key order, captures keys and never exports excluded projection fields", async () => {
  const keys = ["[3]", "[1]"];
  const progress: number[] = [];
  const result = exportCsv(ctx, { set: "Items", select: ["id"] }, [{ field: "id" }, { field: "name" }], { keys, onProgress: (n) => progress.push(n) });
  keys.reverse();
  expect(await result).toBe("\uFEFF\"id\",\"name\"\r\n\"3\",\"\"\r\n\"1\",\"\"\r\n");
  expect(progress).toEqual([1, 2]);
  expect(await exportCsv(ctx, { set: "Items" }, [{ field: "id" }], { keys: [] })).toBe("\uFEFF\"id\"\r\n");
});

test("CSV omits hidden values even when a transport accidentally includes their original text", async () => {
  const other = await DataContext.connect(async (r) => {
    const response = await mock.transport(r);
    if (!r.url.startsWith("Items")) return response;
    const body = JSON.parse(response.body);
    for (const row of body.value ?? [body]) row["@AsterData.Hidden"] = ["name"];
    return { ...response, body: JSON.stringify(body) };
  });
  const csv = await exportCsv(other, { set: "Items" }, [{ field: "name" }]);
  expect(csv).toBe("\uFEFF\"name\"\r\n\"\"\r\n\"\"\r\n\"\"\r\n");
});

test("export snapshots filter, sort and columns, and does not depend on a server count", async () => {
  const other = await DataContext.connect(async (r) => {
    const response = await mock.transport(r);
    if (!r.url.startsWith("Items?")) return response;
    const body = JSON.parse(response.body);
    body["@odata.count"] = 1;
    body["@AsterData.CountEstimated"] = true;
    return { ...response, body: JSON.stringify(body) };
  });
  const q = { set: "Items", filter: { op: "eq" as const, field: "category", value: "A" }, orderBy: [{ field: "id", descending: true }] };
  const columns = [{ field: "id" }];
  const pending = exportCsv(other, q, columns, { pageSize: 1 });
  q.filter.value = "B";
  columns[0]!.field = "name";
  expect(await pending).toBe("\uFEFF\"id\"\r\n\"2\"\r\n\"1\"\r\n");
});

test("CSV rejects overflow, invalid configuration, server errors and aborted requests without returning partial output", async () => {
  await expect(exportCsv(ctx, { set: "Items" }, [{ field: "id" }], { maxRows: 2, pageSize: 1 })).rejects.toThrow("exceeds");
  await expect(exportCsv(ctx, { set: "Items" }, [{ field: "id" }], { keys: ["[1]"], maxRows: 0 })).rejects.toThrow("exceeds");
  await expect(exportCsv(ctx, { set: "Items" }, [{ field: "id" }], { pageSize: 0 })).rejects.toThrow("pageSize");
  await expect(exportCsv(ctx, { set: "Items" }, [], {})).rejects.toThrow("column");
  mock.faults.failNext(503);
  await expect(exportCsv(ctx, { set: "Items" }, [{ field: "id" }])).rejects.toThrow();
  const abort = new AbortController();
  let count = 0;
  await expect(exportCsv(ctx, { set: "Items" }, [{ field: "id" }], { pageSize: 1, signal: abort.signal, onProgress: (n) => { count = n; abort.abort(); } })).rejects.toThrow();
  expect(count).toBe(1);
  abort.abort();
  const before = requests.length;
  await expect(exportCsv(ctx, { set: "Items" }, [{ field: "id" }], { signal: abort.signal })).rejects.toThrow();
  expect(requests.length).toBe(before);
});


test("relative dates stay symbolic across summaries, grouping and CSV, resolving against the context clock", async () => {
  const metadata = { $Version: "4.01", $EntityContainer: "R.C", R: {
    Item: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, day: { $Type: "Edm.Date" }, category: {}, amount: { $Type: "Edm.Decimal" } },
    C: { $Kind: "EntityContainer", Items: { $Collection: true, $Type: "R.Item" } },
  } };
  const service = await createMockService({ metadata, data: { Items: [
    { id: 1, day: "2026-10-18", category: "A", amount: "10.10" },
    { id: 2, day: "2026-10-19", category: "B", amount: "20.20" },
  ] } });
  let now = Date.parse("2026-10-19T12:00:00Z");
  const context = await DataContext.connect(service.transport, { now: () => now });
  const query: Query = { set: "Items", filter: { op: "ge", field: "day", value: { relative: "today" } } };
  const summary = context.summary(query, [{ field: "amount", method: "sum", as: "total" }]);
  const grouping = context.grouping(query, ["category"], [{ field: "amount", method: "sum", as: "total" }]);
  try {
    await wait(() => summary.status.value === "idle" && grouping.root.status.value === "idle");
    expect(summary.values.value).toEqual({ count: 1, total: "20.20" });
    expect(grouping.total.value).toBe(1);
    expect((await exportCsv(context, query, [{ field: "id" }, { field: "amount" }])).trim().split("\r\n")).toHaveLength(2);
    now = Date.parse("2026-10-18T12:00:00Z");
    await summary.refresh();
    expect(summary.values.value?.count).toBe(2);
    expect(query.filter).toEqual({ op: "ge", field: "day", value: { relative: "today" } });
  } finally { summary.dispose(); grouping.dispose(); }
});
