// aster-odata's decisions of 2026-10-16 (D1, D2, D4, D7): no count above a set's
// threshold, If-Match whenever an ETag is held, creates send only what differs
// from what the server would store.
import { beforeEach, expect, test } from "bun:test";
import { DataContext, EditModel, type ODataRequest } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

let mock: MockService;
let sent: ODataRequest[];

/** `seen` is the $metadata the client reads, where it differs from the service's. */
async function connect(options: { count?: boolean; meta?: unknown; seen?: unknown } = {}): Promise<DataContext> {
  mock = await createMockService({ metadata: (options.meta ?? metadata) as typeof metadata, data, now: () => "2026-10-07T15:20:00Z" });
  sent = [];
  return DataContext.connect(async (r: ODataRequest) => {
    sent.push(r);
    const res = await mock.transport(r);
    if (options.seen && r.url.startsWith("$metadata")) return { ...res, body: JSON.stringify(options.seen) };
    if (options.count !== false || !r.url.includes("$count=true")) return res;
    const { "@odata.count": _, ...body } = JSON.parse(res.body) as Record<string, unknown>;
    return { ...res, body: JSON.stringify(body) };
  });
}

beforeEach(() => (sent = []));

const total = data.Tasks.length;

test("without a count, a collection lays out a page ahead until a short page ends it", async () => {
  const ctx = await connect({ count: false });
  const c = ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 100 });
  await c.ensure(0, 100);
  expect(c.counted.value).toBe(false);
  expect(c.count.value).toBe(200);
  await c.view(150, 190);
  expect(c.count.value).toBe(300);
  await c.loadAll();
  expect(c.counted.value).toBe(true);
  expect(c.count.value).toBe(total);
  expect(c.complete.value).toBe(true);
  expect(c.keys.value.every((k) => k !== undefined)).toBe(true);
  await c.refresh();
  expect(c.count.value).toBe(total);
});

test("without a count, a small result is counted from its one short page", async () => {
  const ctx = await connect({ count: false });
  const c = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "id", value: 1 } }, { pageSize: 100 });
  await c.ensure(0, 100);
  expect([c.count.value, c.counted.value]).toEqual([1, true]);
});

test("If-Match goes with a held ETag even where $metadata declares no concurrency", async () => {
  // The service has ETags (a set without the annotation has none, D2); the client isn't told.
  const seen = structuredClone(metadata) as Record<string, any>;
  for (const set of Object.values(seen.AsterDemo.Container) as Record<string, unknown>[]) {
    if (typeof set === "object") delete set["@Core.OptimisticConcurrency"];
  }
  const ctx = await connect({ seen });
  const c = ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 5 });
  await c.ensure(0, 5);
  const key = c.keys.value[0]!;
  const etag = ctx.store.get("Tasks", key)?.etag;
  expect(etag).toBeDefined();
  sent = [];
  await ctx.update("Tasks", key, { title: "Renamed" });
  expect(sent.find((r) => r.method === "PATCH")?.headers?.["if-match"]).toBe(etag);
});

test("a create leaves out values the server would store anyway", async () => {
  const ctx = await connect();
  sent = [];
  await ctx.create("Tasks", { projectId: 1, parentId: null, title: "New", due: null, assigneeId: null, done: false });
  const body = JSON.parse(sent.find((r) => r.method === "POST")!.body!);
  expect(body).toEqual({ projectId: 1, title: "New", done: false });
});

test("empty text is null on a field marked EmptyAsNull, and only there (D4)", async () => {
  const meta = structuredClone(metadata) as Record<string, any>;
  meta.AsterDemo.Task.title["@AsterData.EmptyAsNull"] = true;
  const ctx = await connect({ meta });
  const edit = new EditModel(ctx, "Tasks");
  edit.set("title", "");
  expect(edit.get("title")).toBe(null);
  const plain = new EditModel(await connect(), "Tasks");
  plain.set("title", "");
  expect(plain.get("title")).toBe("");
});
