// aster-odata's two markers on the wire: `@AsterData.CountEstimated` beside
// `@odata.count`, and `@AsterData.Hidden` on a record. A stub transport
// answers with canned bodies, so each case is exactly what the server sends.
import { describe, expect, test } from "bun:test";
import { matches } from "../src/criteria/evaluate.ts";
import { Collection } from "../src/collection/collection.ts";
import { ODataSource } from "../src/odata/source.ts";
import { parseCsdl } from "../src/schema/csdl.ts";
import { keyText } from "../src/store/keys.ts";
import { RecordStore } from "../src/store/store.ts";
import type { ODataRequest, ODataResponse } from "../src/transport.ts";

const demo = await Bun.file(new URL("../../../fixtures/aster/metadata.json", import.meta.url)).json();
const schema = parseCsdl(demo);
const people = schema.set("People").type;

const json = (body: unknown, headers: Record<string, string> = {}): ODataResponse => ({
  status: 200,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const person = (id: number) => ({ id, name: `Person ${id}`, email: `p${id}@example.com`, hue: id });

/**
 * A People service of `total` rows whose `$count=true` answers `count(n)`
 * for the n-th request, marked as an estimate; the requests are kept.
 */
function people$(total: number, count: (n: number) => number | undefined, estimated = true) {
  const sent: ODataRequest[] = [];
  const transport = async (r: ODataRequest): Promise<ODataResponse> => {
    sent.push(r);
    const q = new URLSearchParams(r.url.split("?")[1] ?? "");
    const skip = Number(q.get("$skip") ?? 0);
    const top = Number(q.get("$top") ?? total);
    const rows = Array.from({ length: Math.max(0, Math.min(top, total - skip)) }, (_, i) => person(skip + i + 1));
    const c = count(sent.length);
    return json({ ...(c === undefined ? {} : { "@odata.count": c, ...(estimated ? { "@AsterData.CountEstimated": true } : {}) }), value: rows });
  };
  const source = new ODataSource(schema, transport);
  const store = new RecordStore(schema);
  return { sent, source, store, transport, collection: (options = {}) => new Collection(store, source, { set: "People", orderBy: [{ field: "id" }] }, { pageSize: 5, ...options }) };
}

describe("an estimated count", () => {
  test("is read with its marker, and exactCount asks for an exact one", async () => {
    const s = people$(12, () => 30);
    const page = await s.source.query({ set: "People" }, { count: true });
    expect([page.count, page.estimated]).toEqual([30, true]);
    const c = s.collection({ exactCount: true });
    await c.ensure(0, 5);
    expect(s.sent.at(-1)?.headers?.prefer).toBe("aster.count=exact");
    // Without counting, there's nothing to ask for.
    await s.source.query({ set: "People" }, { exact: true });
    expect(s.sent.at(-1)?.headers?.prefer).toBeUndefined();
  });

  test("sizes the collection as an estimate until a short page shows the end", async () => {
    const s = people$(12, () => 30);
    const c = s.collection();
    await c.ensure(0, 5);
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([30, false, true]);
    await c.ensure(10, 15);
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([12, true, false]);
    expect(c.keys.value.filter(Boolean)).toHaveLength(7);
  });

  test("that drifts between pages is never compared, so loaded rows stay", async () => {
    const s = people$(40, (n) => 100 + n * 7);
    const c = s.collection();
    await c.ensure(0, 5);
    const first = c.keys.value.slice(0, 5);
    await c.ensure(20, 25);
    expect(c.count.value).toBe(107);
    expect(c.estimated.value).toBe(true);
    expect(c.keys.value.slice(0, 5)).toEqual(first);
    // A changed exact count refetches the confirmed window before committing new offsets.
    const exact = people$(40, (n) => (n === 1 ? 40 : 41), false);
    const e = exact.collection();
    await e.ensure(0, 5);
    await e.ensure(20, 25);
    expect(e.count.value).toBe(41);
    expect(e.keys.value.slice(0, 5)).toEqual(first);
    expect(e.keys.value.slice(20, 25).every((k) => k !== undefined)).toBe(true);
  });

  test("too low turns into progressive loading once pages run past it", async () => {
    const s = people$(12, () => 6);
    const c = s.collection();
    await c.ensure(0, 5);
    expect([c.count.value, c.estimated.value]).toEqual([6, true]);
    await c.ensure(5, 6);
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([15, false, false]);
    await c.loadAll();
    expect([c.count.value, c.counted.value]).toEqual([12, true]);
  });

  test("changing exact counts settle the requested pages in one bounded window refresh", async () => {
    const s = people$(40, n => {
      if (n > 4) throw new Error("refresh must not chase a moving count indefinitely");
      return 40 + n;
    }, false);
    const c = s.collection();
    await c.ensure(0, 5);
    const first = c.keys.value.slice(0, 5);
    await c.ensure(20, 25);
    expect(s.sent).toHaveLength(4);
    expect(c.keys.value.slice(0, 5)).toEqual(first);
    expect(c.keys.value.slice(20, 25).every(key => key !== undefined)).toBe(true);
    expect(c.keys.value.length).toBe(c.count.value!);
  });

  test("too high shrinks to what's loaded when a page far past the end comes back empty", async () => {
    const s = people$(12, () => 400);
    const c = s.collection();
    await c.ensure(0, 5);
    await c.ensure(300, 305);
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([10, false, false]);
    await c.loadAll();
    expect([c.count.value, c.counted.value, c.complete.value]).toEqual([12, true, true]);
  });

  test("an exact count after an estimate replaces it", async () => {
    const s = people$(40, (n) => (n === 1 ? 55 : 40));
    const exactAfterFirst = new ODataSource(schema, async (r) => {
      const res = await s.transport(r);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      if (s.sent.length > 1) delete body["@AsterData.CountEstimated"];
      return json(body);
    });
    const c = new Collection(new RecordStore(schema), exactAfterFirst, { set: "People", orderBy: [{ field: "id" }] }, { pageSize: 5 });
    await c.ensure(0, 5);
    expect([c.count.value, c.estimated.value]).toEqual([55, true]);
    await c.ensure(10, 15);
    expect([c.count.value, c.counted.value, c.estimated.value]).toEqual([40, true, false]);
  });
});

describe("a hidden field", () => {
  const hiddenEmail = { ...person(3), email: null, "@AsterData.Hidden": ["email"] };

  test("is read from a collection, an entity and a write's answer", async () => {
    const answers: Record<string, unknown> = {
      People: { value: [person(1), hiddenEmail] },
      "People(3)": hiddenEmail,
    };
    const source = new ODataSource(schema, async (r) => json(r.method === "GET" ? answers[r.url.split("?")[0]!] : hiddenEmail));
    const page = await source.query({ set: "People" });
    expect(page.records[0]?.hidden).toBeUndefined();
    expect([...page.records[1]!.hidden!]).toEqual(["email"]);
    expect(page.records[1]!.entity.email).toBeNull();
    expect([...(await source.get("People", [3])).hidden!]).toEqual(["email"]);
    expect([...(await source.update("People", [3], { name: "Renamed" }, undefined)).hidden!]).toEqual(["email"]);
  });

  test("is stored as unknown, never as a known null", () => {
    const store = new RecordStore(schema);
    const key = store.put("People", { entity: { ...person(3), email: null }, hidden: new Set(["email"]) }, { kind: "fetch" });
    const stored = store.get("People", key)!;
    expect([...stored.hidden!]).toEqual(["email"]);
    expect(stored.known?.has("email")).toBe(false);
    expect(stored.known?.has("name")).toBe(true);
    // A $select that doesn't read it keeps it hidden; one that reads it decides again.
    store.put("People", { entity: { id: 3, name: "Three" } }, { kind: "fetch" }, ["id", "name"]);
    expect(store.get("People", key)!.hidden?.has("email")).toBe(true);
    expect(store.get("People", key)!.known?.has("email")).toBe(false);
    store.put("People", { entity: { id: 3, email: "three@example.com" } }, { kind: "fetch" }, ["id", "email"]);
    expect(store.get("People", key)!.hidden).toBeUndefined();
    expect(store.get("People", key)!.known?.has("email")).toBe(true);
  });

  test("holds null even where the server sent a value or an older version had one", () => {
    const store = new RecordStore(schema);
    const key = store.put("People", { entity: person(3) }, { kind: "fetch" });
    store.put("People", { entity: { id: 3, name: "Three" }, hidden: new Set(["email"]) }, { kind: "fetch" }, ["id", "name", "email"]);
    expect(store.get("People", key)!.entity.email).toBeNull();
    expect(keyText([3])).toBe(key);
  });

  test("is unknown to a local filter: neither null nor its negation holds", () => {
    const unknown = new Set(["email"]);
    const e = { ...person(3), email: null };
    expect(matches({ op: "eq", field: "email", value: null }, e, people)).toBe(true);
    expect(matches({ op: "eq", field: "email", value: null }, e, people, undefined, unknown)).toBe(false);
    expect(matches({ op: "not", arg: { op: "eq", field: "email", value: null } }, e, people, undefined, unknown)).toBe(false);
    expect(matches({ op: "contains", field: "email", value: "x" }, e, people, undefined, unknown)).toBe(false);
    expect(matches({ op: "in", field: "email", values: [null] }, e, people, undefined, unknown)).toBe(false);
    // Unknown decides nothing, so a known part still can.
    expect(matches({ op: "or", args: [{ op: "eq", field: "email", value: null }, { op: "eq", field: "id", value: 3 }] }, e, people, undefined, unknown)).toBe(true);
    expect(matches({ op: "and", args: [{ op: "eq", field: "email", value: null }, { op: "eq", field: "id", value: 3 }] }, e, people, undefined, unknown)).toBe(false);
  });
});
