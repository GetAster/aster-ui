import { expect, test } from "bun:test";
import { DataContext, ODataSource, Summary, queryType, toQueryString, type ComputeColumn, parseCsdl, type ODataRequest } from "../src/index.ts";
import { navigatorSchema, response } from "./fixtures/navigator-transport.ts";

const compute = (expression: string): readonly ComputeColumn[] => [{ alias: "Total", expression, type: "Edm.Decimal" }];

test("computed views isolate aliases and preserve exact values, types and canonical flags", async () => {
  const requests: ODataRequest[] = [];
  const context = new DataContext(new ODataSource(navigatorSchema, async (r) => {
    requests.push(r);
    const c = new URLSearchParams(r.url.split("?")[1]).get("$compute");
    return response({ value: [{ id: "one", name: "Ada", secret: null, Total: c?.startsWith("1 ") ? "9007199254740993.01" : null, "Total@odata.type": "#Decimal", "@odata.etag": 'W/"1"', "@AsterData.Hidden": ["secret"] }], "@odata.count": 30 });
  }));
  const a = context.collection({ set: "People", compute: compute("1"), select: ["id", "name", "secret", "Total"] }, { pageSize: 1 });
  const b = context.collection({ set: "People", compute: compute("2"), select: ["id", "name", "secret", "Total"] }, { pageSize: 1 });
  await Promise.all([a.ensure(0, 1), b.ensure(0, 1)]);
  expect(a.items.value[0]?.Total).toBe("9007199254740993.01");
  expect(b.recordAt(0)?.entity.Total).toBeNull();
  expect(a.recordAt(0)?.types).toEqual({ Total: "#Decimal" });
  expect(a.recordAt(0)?.hidden?.has("secret")).toBe(true);
  expect(context.store.get("People", '["one"]')?.entity).toEqual({ id: "one", name: "Ada", secret: null });
  expect(context.schema.set("People").type.field("Total")).toBeUndefined();
  expect(a.type.field("Total")?.computed).toBe(true);
  expect(a.count.value).toBe(30);
  a.dispose(); b.dispose();
});

test("typed aliases compile and reject shadowing", () => {
  const query = { set: "People", compute: compute("1"), select: ["Total"], filter: { op: "gt" as const, field: "Total", value: "20.01" }, orderBy: [{ field: "Total", descending: true }] };
  const params = new URLSearchParams(toQueryString(query, navigatorSchema));
  expect(params.get("$compute")).toBe("1 as Total");
  expect(params.get("$filter")).toBe("Total gt 20.01");
  expect(params.get("$orderby")).toBe("Total desc,id");
  expect(() => toQueryString({ set: "People", compute: [{ alias: "name", expression: "1", type: "Edm.Decimal" }] }, navigatorSchema)).toThrow("shadowing");

});

test("response type disagreement fails before canonical writes", async () => {
  const context = new DataContext(new ODataSource(navigatorSchema, async () => response({ value: [{ id: "one", Total: "3", "Total@odata.type": "#Duration" }] })));
  const c = context.collection({ set: "People", compute: compute("1") });
  await expect(c.ensure(0, 1)).rejects.toThrow("type mismatch");
  expect(context.store.retainedRecords).toBe(0);
  c.dispose();
});

test("late computed pages cannot repopulate replaced or disposed results", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const context = new DataContext(new ODataSource(navigatorSchema, async () => { await gate; return response({ value: [{ id: "one", Total: "3", "Total@odata.type": "#Decimal" }] }); }));
  const c = context.collection({ set: "People", compute: compute("1") });
  const loading = c.ensure(0, 1); c.dispose(); finish(); await loading;
  expect(c.items.value).toEqual([]);
  expect(context.store.retainedRecords).toBe(0);
});

test("summary computes and filters before aggregating the entire matching set", async () => {
  let url = "";
  const source = new ODataSource(navigatorSchema, async (r) => { url = r.url; return response({ value: [{ count: 300, total: "9007199254740993.99" }] }); });
  const context = new DataContext(source);
  const summary = new Summary(context.store, source, { set: "People", compute: compute("1"), filter: { op: "gt", field: "Total", value: "20" } }, [{ field: "Total", method: "sum", as: "total" }]);
  await summary.refresh();
  expect(new URLSearchParams(url.split("?")[1]).get("$apply")).toBe("compute(1 as Total)/filter(Total gt 20)/aggregate($count as count,Total with sum as total)");
  expect(summary.values.value).toEqual({ count: 300, total: "9007199254740993.99" });
  summary.dispose();
});

test("canonical and related changes refetch computed rows without local placement", async () => {
  let calls = 0;
  const context = new DataContext(new ODataSource(navigatorSchema, async () => {
    calls++;
    return response({ value: [{ id: "one", name: "Ada", Total: String(calls), "Total@odata.type": "#Decimal" }], "@odata.count": 1 });
  }));
  const c = context.collection({ set: "People", compute: compute("1") });
  await c.ensure(0, 1);
  context.store.put("People", { entity: { id: "one", name: "Changed" } }, { kind: "external" });
  expect(c.stale.value).toBe(true);
  expect(c.recordAt(0)?.entity.Total).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(c.recordAt(0)?.entity.Total).toBe("2");
  context.store.put("Roots", { entity: { tenant: "a", id: "b" } }, { kind: "external" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(3);
  expect(c.recordAt(0)?.entity.Total).toBe("3");
  c.dispose();
});

test("query replacement clears aliases and rejects an old response", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let calls = 0;
  const context = new DataContext(new ODataSource(navigatorSchema, async () => {
    const old = ++calls === 1;
    if (old) await gate;
    return response({ value: [{ id: "one", Total: old ? "1" : "2", "Total@odata.type": "#Decimal" }], "@odata.count": 1 });
  }));
  const c = context.collection({ set: "People", compute: compute("1") });
  const pending = c.ensure(0, 1);
  c.setQuery({ set: "People", compute: compute("2") });
  await c.ensure(0, 1);
  expect(c.recordAt(0)?.entity.Total).toBe("2");
  finish(); await pending;
  expect(c.recordAt(0)?.entity.Total).toBe("2");
  expect(context.store.get("People", '["one"]')?.entity.Total).toBeUndefined();
  c.dispose();
});

test("two computed collections with identical base values do not alternate refreshes for response metadata", async () => {
  let calls = 0;
  const context = new DataContext(new ODataSource(navigatorSchema, async (r) => {
    calls++;
    if (calls > 10) return response({ error: { message: "request cap exceeded" } }, 500);
    const value = new URLSearchParams(r.url.split("?")[1]).get("$compute")!.startsWith("1 ") ? "1" : "2";
    return response({ value: [{ id: "one", name: "Ada", Total: value, "Total@odata.type": "#Decimal", "@odata.etag": `W/"${value}"` }], "@odata.count": 1 });
  }));
  const a = context.collection({ set: "People", compute: compute("1") });
  const b = context.collection({ set: "People", compute: compute("2") });
  await a.ensure(0, 1); await b.ensure(0, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(calls).toBe(2);
  expect(a.recordAt(0)?.entity.Total).toBe("1");
  expect(b.recordAt(0)?.entity.Total).toBe("2");
  a.dispose(); b.dispose();
});

test("null computed values need no type annotation but supplied conflicting annotations fail", async () => {
  let annotation = false;
  const context = new DataContext(new ODataSource(navigatorSchema, async () => response({ value: [{ id: "one", Total: null, ...(annotation ? { "Total@odata.type": "#Duration" } : {}) }], "@odata.count": 1 })));
  const c = context.collection({ set: "People", compute: compute("1") });
  await c.ensure(0, 1);
  expect(c.recordAt(0)?.entity.Total).toBeNull();
  annotation = true;
  await expect(c.refresh()).rejects.toThrow("type mismatch");
  c.dispose();
});

const summarySchema = parseCsdl({
  $Version: "4.01", $EntityContainer: "Totals.Container",
  Totals: {
    Parent: { $Kind: "EntityType", $Key: ["tenant", "id"], tenant: { $Type: "Edm.String" }, id: { $Type: "Edm.String" }, children: { $Kind: "NavigationProperty", $Type: "Totals.Child", $Collection: true, $Partner: "parent" } },
    Child: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.String" }, parentTenant: { $Type: "Edm.String" }, parentId: { $Type: "Edm.String" }, amount: { $Type: "Edm.Decimal" }, parent: { $Kind: "NavigationProperty", $Type: "Totals.Parent", $Partner: "children", $ReferentialConstraint: { parentTenant: "tenant", parentId: "id" } } },
    Container: { $Kind: "EntityContainer", Parents: { $Collection: true, $Type: "Totals.Parent", $NavigationPropertyBinding: { children: "Children" } }, Children: { $Collection: true, $Type: "Totals.Child", $NavigationPropertyBinding: { parent: "Parents" } } },
  },
});

test("relationship summary correlates every parent key before computed filtering and reacts to parent address changes", async () => {
  const { signal } = await import("@preact/signals-core");
  const requests: string[] = [];
  const source = new ODataSource(summarySchema, async (r) => {
    const apply = new URLSearchParams(r.url.split("?")[1]).get("$apply")!;
    requests.push(apply);
    return response({ value: [{ count: 1, total: apply.includes("parentId eq 'a'") ? "11.25" : "22.50" }] });
  });
  const context = new DataContext(source);
  const query = signal({ set: "Children", relationship: { set: "Parents", key: ["O'Brien", "a"], navigation: "children" }, compute: compute("amount mul 2"), filter: { op: "gt" as const, field: "Total", value: "10" } });
  const summary = new Summary(context.store, source, query, [{ field: "Total", method: "sum", as: "total" }]);
  await summary.refresh();
  expect(requests.at(-1)).toBe("compute(amount mul 2 as Total)/filter((parentTenant eq 'O''Brien' and parentId eq 'a') and Total gt 10)/aggregate($count as count,Total with sum as total)");
  expect(summary.values.value?.total).toBe("11.25");
  query.value = { ...query.value, relationship: { ...query.value.relationship, key: ["O'Brien", "b"] } };
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(summary.values.value?.total).toBe("22.50");
  summary.dispose();
});

test("relationship summary without usable correlation fails explicitly", () => {
  const source = new ODataSource(navigatorSchema, async () => response({ value: [{ count: 99 }] }));
  const context = new DataContext(source);
  expect(() => new Summary(context.store, source, { set: "Children", relationship: { set: "Roots", key: ["tenant", "id"], navigation: "readings" } })).toThrow("correlation");
});

test("unconfigured dynamic values never enter canonical changes or collection results", async () => {
  const context = new DataContext(new ODataSource(navigatorSchema, async () => response({ value: [{ id: "one", name: "Ada", Total: "2", Extra: "1", "Total@odata.type": "#Decimal", "Extra@odata.type": "#Decimal" }], "@odata.count": 1 })));
  const changes: unknown[] = [];
  const stop = context.store.subscribe((change) => changes.push(change.after));
  const c = context.collection({ set: "People", compute: compute("1 as Extra,2") });
  await c.ensure(0, 1);
  expect(context.store.get("People", '["one"]')?.entity).toEqual({ id: "one", name: "Ada" });
  expect(JSON.stringify(changes)).not.toContain("Extra");
  expect(c.recordAt(0)?.entity.Extra).toBeUndefined();
  expect(c.recordAt(0)?.types).toEqual({ Total: "#Decimal" });
  stop(); c.dispose();
});

test("a fetch that changes canonical values refreshes computed results", async () => {
  let calls = 0;
  const context = new DataContext(new ODataSource(navigatorSchema, async () => {
    calls++;
    return response({ value: [{ id: "one", name: calls === 1 ? "Ada" : "Changed", Total: String(calls), "Total@odata.type": "#Decimal" }], "@odata.count": 1 });
  }));
  const c = context.collection({ set: "People", compute: compute("1") });
  await c.ensure(0, 1);
  context.store.put("People", { entity: { id: "one", name: "Changed" } }, { kind: "fetch" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(2);
  expect(c.recordAt(0)?.entity.Total).toBe("2");
  c.dispose();
});

test("relationship summary reads non-key parent constraints and rejects hidden correlation", async () => {
  const urls: string[] = [];
  let hidden = false;
  const source = new ODataSource(summarySchema, async (r) => {
    urls.push(r.url);
    if (r.url.startsWith("Children(")) return response({ id: "line", parentTenant: "tenant", parentId: "order", ...(hidden ? { "@AsterData.Hidden": ["parentId"] } : {}) });
    return response({ value: [{ count: 1 }] });
  });
  const context = new DataContext(source);
  const summary = new Summary(context.store, source, { set: "Parents", relationship: { set: "Children", key: ["line"], navigation: "parent" } });
  await summary.refresh();
  expect(urls.some((url) => url === "Children('line')")).toBe(true);
  expect(new URLSearchParams(urls.at(-1)!.split("?")[1]).get("$apply")).toBe("filter(tenant eq 'tenant' and id eq 'order')/aggregate($count as count)");
  expect(summary.values.value?.count).toBe(1);
  hidden = true;
  await summary.refresh();
  expect(summary.values.value).toBeUndefined();
  expect(summary.status.value).toBe("error");
  expect(String(summary.error.value)).toContain("hidden");
  summary.dispose();
});

test("a disposed summary cannot start an aggregate after its delayed parent read", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const urls: string[] = [];
  const source = new ODataSource(summarySchema, async r => {
    urls.push(r.url);
    if (r.url.startsWith("Children(")) { await gate; return response({ id: "line", parentTenant: "tenant", parentId: "order" }); }
    return response({ value: [{ count: 1 }] });
  });
  const context = new DataContext(source);
  const summary = context.summary({ set: "Parents", relationship: { set: "Children", key: ["line"], navigation: "parent" } });
  summary.dispose(); release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(urls).toEqual(["Children('line')"]);
  expect(summary.values.value).toBeUndefined();
});

test("computed titles stay local metadata and do not change the query sent", () => {
  const titled = [{ ...compute("1")[0]!, title: "Budget remaining" }];
  const type = navigatorSchema.set("People").type;
  expect(queryType(type, titled).field("Total")?.title).toBe("Budget remaining");
  expect(type.field("Total")).toBeUndefined();
  expect(toQueryString({ set: "People", compute: titled }, navigatorSchema)).toBe(toQueryString({ set: "People", compute: compute("1") }, navigatorSchema));
  expect(() => queryType(type, [{ ...titled[0]!, title: 42 as unknown as string }])).toThrow("title");
});
