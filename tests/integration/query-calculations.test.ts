import { afterEach, beforeEach, expect, test } from "bun:test";
import { signal } from "@preact/signals-core";
import { DataContext, EditModel, type Collection, type ComputeColumn, type Query, type Summary } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import metadata from "../../fixtures/calculations/metadata.json";
import data from "../../fixtures/calculations/data.json";
import { eventually } from "./eventually.ts";

const total: ComputeColumn = { alias: "LineTotal", expression: "Quantity mul UnitPrice", type: "Edm.Decimal" };
const aggregates = [{ field: "LineTotal", method: "sum" as const, as: "Total" }];
let ctx: DataContext;
let collections: Collection[];
let summaries: Summary[];
beforeEach(async () => {
  const mock = await createMockService({ metadata, data });
  ctx = await DataContext.connect(mock.transport);
  collections = []; summaries = [];
});
afterEach(() => { for (const c of collections) ctx.release(c); for (const s of summaries) s.dispose(); });
function collection(q: Query) { const c = ctx.collection(q, { pageSize: 1, exactCount: true }); collections.push(c); return c; }
function summary(q: Query) { const s = ctx.summary(q, aggregates); summaries.push(s); return s; }
async function ready(s: Summary) { await eventually(() => { expect(s.error.value).toBeUndefined(); expect(s.status.value).toBe("idle"); }); }
const parent = (tenant: string): Query => ({ set: "Lines", relationship: { set: "Orders", key: [tenant, 1], navigation: "Lines" }, compute: [total] });

test("computed filter, order, count and totals include unloaded rows", async () => {
  const q: Query = { set: "Lines", compute: [total], filter: { op: "gt", field: "LineTotal", value: "20" }, orderBy: [{ field: "LineTotal", descending: true }] };
  const c = collection(q); const s = summary(q);
  await c.view(0, 1); await ready(s);
  expect(c.count.value).toBe(3);
  expect(c.recordAt(0)?.entity).toMatchObject({ ID: 3, LineTotal: "100.0000" });
  expect(c.recordAt(0)?.types?.LineTotal).toBe("#Decimal");
  expect(s.values.value).toEqual({ count: 3, Total: "162.5000" });
  expect(ctx.store.get("Lines", "[1]")).toBeUndefined();
  expect(ctx.store.get("Lines", "[2]")).toBeUndefined();
});

test("parallel alias meanings stay occurrence-local and never enter writable records", async () => {
  const a = collection({ set: "Lines", compute: [total], orderBy: [{ field: "ID" }] });
  const b = collection({ set: "Lines", compute: [{ ...total, expression: "UnitPrice mul 2" }], orderBy: [{ field: "ID" }] });
  await a.view(1, 2); await b.view(1, 2);
  expect(a.recordAt(1)?.entity.LineTotal).toBe("37.5000");
  expect(b.recordAt(1)?.entity.LineTotal).toBe("25.00");
  expect(ctx.store.get("Lines", "[2]")?.entity).not.toHaveProperty("LineTotal");
  expect(ctx.schema.set("Lines").type.field("LineTotal")).toBeUndefined();
  const edit = new EditModel(ctx, "Lines", "[2]");
  expect(() => edit.set("LineTotal", "999")).toThrow("has no field");
  edit.dispose();
  await a.refresh();
  expect(b.recordAt(1)?.entity.LineTotal).toBe("25.00");
});

test("elapsed hours use the inferred Decimal type and null values remain renderable", async () => {
  const hours = collection({ set: "TimeEntries", compute: [{ alias: "Hours", expression: "totalseconds(Ended sub Started) div 3600", type: "Edm.Decimal" }] });
  await hours.view(0, 1);
  expect(hours.recordAt(0)?.entity.Hours).toBe("2.50");
  expect(hours.recordAt(0)?.types?.Hours).toBe("#Decimal");
  const lines = collection({ set: "Lines", compute: [total], orderBy: [{ field: "ID" }] });
  await lines.view(4, 5);
  expect(lines.recordAt(4)?.entity.LineTotal).toBeNull();
});

test("saved unloaded rows crossing a calculated boundary refresh counts, pages and totals", async () => {
  const q: Query = { set: "Lines", compute: [total], filter: { op: "gt", field: "LineTotal", value: "30" }, orderBy: [{ field: "LineTotal", descending: true }] };
  const c = collection(q); const s = summary(q);
  await c.view(0, 1); await ready(s);
  expect(c.count.value).toBe(2);
  expect(ctx.store.get("Lines", "[1]")).toBeUndefined();
  const editable = ctx.lookup("Lines", "[1]");
  await eventually(() => expect(editable.value?.ID).toBe(1));
  expect(c.keys.value).not.toContain("[1]");
  await ctx.update("Lines", "[1]", { Quantity: "20.00" });
  await eventually(() => {
    expect(c.error.value).toBeUndefined();
    expect(c.count.value).toBe(3);
    expect(c.recordAt(0)?.entity).toMatchObject({ ID: 1, LineTotal: "250.0000" });
    expect(s.values.value).toEqual({ count: 3, Total: "387.5000" });
  });
});

test("child pages and summaries use complete parent keys, including parent changes", async () => {
  const a = collection(parent("A")); const b = collection(parent("B"));
  const q = signal<Query>(parent("A")); const s = ctx.summary(q, aggregates); summaries.push(s);
  await a.view(0, 1); await b.view(0, 1); await ready(s);
  expect(a.count.value).toBe(4); expect(b.count.value).toBe(1);
  expect(a.recordAt(0)?.entity.Tenant).toBe("A"); expect(b.recordAt(0)?.entity.Tenant).toBe("B");
  expect(s.values.value).toEqual({ count: 4, Total: "162.5000" });
  q.value = parent("B"); await ready(s);
  expect(s.values.value).toEqual({ count: 1, Total: "7.0000" });
});


test("Decimal calculations preserve digits beyond JavaScript integer precision", async () => {
  const mock = await createMockService({ metadata, data: { ...data, Lines: [{ ...data.Lines[0]!, Quantity: "1.00", UnitPrice: "9007199254740993.10" }] } });
  ctx = await DataContext.connect(mock.transport);
  const c = collection({ set: "Lines", compute: [total] }); const s = summary({ set: "Lines", compute: [total] });
  await c.view(0, 1); await ready(s);
  expect(c.recordAt(0)?.entity.LineTotal).toBe("9007199254740993.1000");
  expect(s.values.value?.Total).toBe("9007199254740993.1000");
});

test("a late real-engine result cannot restore an obsolete formula or populate its records", async () => {
  const mock = await createMockService({ metadata, data });
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let hold = true;
  ctx = await DataContext.connect(async (request) => {
    const response = await mock.transport(request);
    if (hold && request.url.startsWith("Lines?")) { hold = false; entered(); await gate; }
    return response;
  });
  const c = collection({ set: "Lines", compute: [total], filter: { op: "eq", field: "ID", value: 1 } });
  const old = c.view(0, 1); await started;
  c.setQuery({ set: "Lines", compute: [{ ...total, expression: "UnitPrice mul 2" }], filter: { op: "eq", field: "ID", value: 2 } });
  try {
    await c.view(0, 1);
    expect(c.recordAt(0)?.entity).toMatchObject({ ID: 2, LineTotal: "25.00" });
  } finally { release(); await old; }
  expect(c.recordAt(0)?.entity).toMatchObject({ ID: 2, LineTotal: "25.00" });
  expect(ctx.store.get("Lines", "[1]")).toBeUndefined();
});


test("dynamic Int64, Duration and DateTimeOffset keep exact values and annotations", async () => {
  const c = collection({ set: "TimeEntries", compute: [
    { alias: "Exact", expression: "9007199254740993", type: "Edm.Int64" },
    { alias: "Elapsed", expression: "Ended sub Started", type: "Edm.Duration" },
    { alias: "Instant", expression: "Started", type: "Edm.DateTimeOffset" },
  ] });
  await c.view(0, 1);
  expect(c.recordAt(0)?.entity).toMatchObject({ Exact: "9007199254740993", Elapsed: "PT2H30M", Instant: "2026-11-16T00:00:00Z" });
  expect(c.recordAt(0)?.types).toMatchObject({ Exact: "#Int64", Elapsed: "#Duration", Instant: "#DateTimeOffset" });
  const canonical = ctx.store.get("TimeEntries", "[1]")!;
  for (const alias of ["Exact", "Elapsed", "Instant"]) expect(canonical.entity).not.toHaveProperty(alias);
});

test("extra server aliases introduced by expression text never become canonical properties", async () => {
  const c = collection({ set: "Lines", compute: [{ ...total, expression: "Quantity as Extra,Quantity mul UnitPrice" }], orderBy: [{ field: "ID" }] });
  await c.view(0, 1);
  expect(c.recordAt(0)?.entity.LineTotal).toBe("25.0000");
  const stored = ctx.store.get("Lines", "[1]")!;
  expect(stored.entity).not.toHaveProperty("Extra");
  expect(stored.entity).not.toHaveProperty("LineTotal");
  expect(stored.known?.has("Extra")).not.toBe(true);
});
