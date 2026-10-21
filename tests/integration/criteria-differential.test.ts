// The evaluator truth table, run through the WebAssembly engine: client-side
// matching and sorting must agree with the server's $filter and $orderby.
import { describe, expect, test } from "bun:test";
import { matches, parseCsdl, sortComparator, toQueryString, type Criteria, type Entity, type SortKey } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { ALL_TYPES_CSDL, rows } from "../../packages/data/test/truth-table.ts";

const schema = parseCsdl(ALL_TYPES_CSDL);
const R = schema.set("Rs").type;

/** JSON can't carry IEEE specials; OData spells them as strings. */
function toJson(entity: Entity): Entity {
  const f = entity.f;
  if (typeof f !== "number" || Number.isFinite(f)) return entity;
  return { ...entity, f: Number.isNaN(f) ? "NaN" : f > 0 ? "INF" : "-INF" };
}

async function serve(entities: Entity[]) {
  const mock = await createMockService({ metadata: ALL_TYPES_CSDL, data: { Rs: entities.map(toJson) } });
  return async (query: string): Promise<number[]> => {
    const res = await mock.transport({ method: "GET", url: `Rs?${query}`, headers: { accept: "application/json" } });
    if (res.status !== 200) throw new Error(`${res.status} ${res.body}`);
    return (JSON.parse(res.body).value as Entity[]).map((e) => e.id as number);
  };
}

describe("$filter agrees with matches()", async () => {
  const entities = rows.map(([, , entity], i): Entity => ({ ...entity, id: i + 1 }));
  const get = await serve(entities);
  rows.forEach(([name, criteria, , expected], i) => {
    test(name, async () => {
      const id = i + 1;
      const filter: Criteria = { op: "and", args: [criteria, { op: "eq", field: "id", value: id }] };
      const server = (await get(toQueryString({ set: "Rs", filter }, schema))).includes(id);
      expect({ client: matches(criteria, entities[i]!, R), server }).toEqual({ client: expected, server: expected });
    });
  });
});

describe("$orderby agrees with sortComparator()", () => {
  const cases: [string, SortKey[], Entity[]][] = [
    ["nulls first ascending", [{ field: "i" }], [{ id: 1, i: 4 }, { id: 2, i: null }, { id: 3, i: 5 }, { id: 4, i: 4 }, { id: 5, i: 2 }, { id: 6, i: null }]],
    ["nulls last descending", [{ field: "i", descending: true }], [{ id: 1, i: 4 }, { id: 2, i: null }, { id: 3, i: 5 }, { id: 4, i: 4 }]],
    ["descending key", [{ field: "i", descending: true }, { field: "id", descending: true }], [{ id: 1, i: 4 }, { id: 2, i: null }, { id: 4, i: 4 }]],
    ["strings by code point", [{ field: "s" }], [{ id: 1, s: "apple" }, { id: 2, s: "Zucchini" }, { id: 3, s: "Apple" }, { id: 4, s: null }, { id: 5, s: "\u{1F600}" }, { id: 6, s: "�" }]],
    ["instants across offsets", [{ field: "ts" }], [{ id: 1, ts: "2026-01-01T12:00:00+05:00" }, { id: 2, ts: "2026-01-01T08:00:00Z" }, { id: 3, ts: "2026-01-01T07:30:00Z" }]],
    ["exact decimals", [{ field: "d" }], [{ id: 1, d: "10.50" }, { id: 2, d: "10.4999999999999999999" }, { id: 3, d: "-1" }, { id: 4, d: "10.5" }]],
    ["int64 beyond 2^53", [{ field: "l", descending: true }], [{ id: 1, l: "9007199254740993" }, { id: 2, l: "9007199254740992" }, { id: 3, l: "-9223372036854775808" }]],
    ["doubles with specials", [{ field: "f" }], [{ id: 1, f: NaN }, { id: 2, f: Infinity }, { id: 3, f: -Infinity }, { id: 4, f: 0.5 }, { id: 5, f: null }]],
    ["durations by length", [{ field: "dur" }], [{ id: 1, dur: "PT90M" }, { id: 2, dur: "P1D" }, { id: 3, dur: "-PT1S" }, { id: 4, dur: "PT1H" }]],
    ["booleans", [{ field: "b" }], [{ id: 1, b: true }, { id: 2, b: false }, { id: 3, b: null }]],
  ];
  for (const [name, orderBy, entities] of cases) {
    test(name, async () => {
      const get = await serve(entities);
      const client = [...entities].sort(sortComparator(orderBy, R)).map((e) => e.id);
      expect(await get(toQueryString({ set: "Rs", orderBy }, schema))).toEqual(client as number[]);
    });
  }
});
