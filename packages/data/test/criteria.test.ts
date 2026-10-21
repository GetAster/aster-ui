import { describe, expect, test } from "bun:test";
import type { Criteria, SortKey } from "../src/criteria/ast.ts";
import {
  CriteriaError,
  formatLiteral,
  toFilter,
  toOrderBy,
  toQueryString,
} from "../src/criteria/compile.ts";
import { compareValues, matches, sortComparator } from "../src/criteria/evaluate.ts";
import { relatedOf, resolveRelative } from "../src/criteria/relative.ts";
import { parseCsdl } from "../src/schema/csdl.ts";
import type { Entity, Value } from "../src/schema/model.ts";
import { ALL_TYPES_CSDL, cmp, eq, not, rows } from "./truth-table.ts";

const schema = parseCsdl(await Bun.file(new URL("../../../fixtures/aster/metadata.json", import.meta.url)).json());
const project = schema.set("Projects").type;

const all = parseCsdl(ALL_TYPES_CSDL);
const R = all.set("Rs").type;
const E = (o: Record<string, Value>): Entity => ({ id: 1, ...o });

describe("toFilter", () => {
  const golden: [string, Criteria, string][] = [
    ["string, quote doubled", { op: "eq", field: "name", value: "O'Brien" }, "name eq 'O''Brien'"],
    ["ne null", { op: "ne", field: "archivedAt", value: null }, "archivedAt ne null"],
    ["int", { op: "gt", field: "behindDays", value: 3 }, "behindDays gt 3"],
    ["decimal exact", { op: "le", field: "budget", value: "10.50" }, "budget le 10.50"],
    ["boolean", { op: "eq", field: "pinned", value: true }, "pinned eq true"],
    ["datetimeoffset bare", { op: "ge", field: "createdAt", value: "2026-01-02T03:04:05.123456789+01:00" }, "createdAt ge 2026-01-02T03:04:05.123456789+01:00"],
    ["in", { op: "in", field: "state", values: ["active", "paused"] }, "state in ('active','paused')"],
    ["in with null", { op: "in", field: "state", values: ["active", null] }, "state in ('active',null)"],
    ["empty in", { op: "in", field: "state", values: [] }, "false"],
    ["contains", { op: "contains", field: "name", value: "ab" }, "contains(name,'ab')"],
    ["case-insensitive startswith", { op: "startswith", field: "name", value: "AbC" }, "startswith(tolower(name),'abc')"],
    ["not wraps", { op: "not", arg: { op: "eq", field: "pinned", value: true } }, "not (pinned eq true)"],
    [
      "or inside and is parenthesised",
      {
        op: "and",
        args: [
          { op: "or", args: [{ op: "eq", field: "state", value: "a" }, { op: "eq", field: "state", value: "b" }] },
          { op: "gt", field: "hue", value: 1 },
        ],
      },
      "(state eq 'a' or state eq 'b') and hue gt 1",
    ],
    [
      "and inside or is parenthesised too",
      {
        op: "or",
        args: [
          { op: "and", args: [{ op: "eq", field: "hue", value: 1 }, { op: "eq", field: "hue", value: 2 }] },
          { op: "eq", field: "hue", value: 3 },
        ],
      },
      "(hue eq 1 and hue eq 2) or hue eq 3",
    ],
    ["empty and/or", { op: "and", args: [] }, "true"],
    ["single arg", { op: "or", args: [{ op: "eq", field: "hue", value: 1 }] }, "hue eq 1"],
    ["not over or", { op: "not", arg: { op: "or", args: [{ op: "eq", field: "hue", value: 1 }, { op: "eq", field: "hue", value: 2 }] } }, "not (hue eq 1 or hue eq 2)"],
  ];
  for (const [name, c, expected] of golden) {
    test(name, () => {
      const crit = name.startsWith("case-insensitive") ? { ...(c as any), caseInsensitive: true } : c;
      expect(toFilter(crit, project)).toBe(expected);
    });
  }

  test("literals by Edm type", () => {
    const lit = (n: string, v: Value) => formatLiteral(v, R.field(n)!);
    expect(lit("l", "9007199254740993")).toBe("9007199254740993");
    expect(lit("f", 1.5)).toBe("1.5");
    expect(lit("f", 1e21)).toBe("1e+21");
    expect(lit("f", Infinity)).toBe("INF");
    expect(lit("f", -Infinity)).toBe("-INF");
    expect(lit("f", NaN)).toBe("NaN");
    expect(lit("date", "2026-10-15")).toBe("2026-10-15");
    expect(lit("time", "10:20:30.5")).toBe("10:20:30.5");
    expect(lit("dur", "P1DT2H")).toBe("duration'P1DT2H'");
    expect(lit("g", "00000000-0000-0000-0000-000000000001")).toBe("00000000-0000-0000-0000-000000000001");
    expect(lit("s", null)).toBe("null");
  });

  test("errors", () => {
    const bad = (c: Criteria) => () => toFilter(c, R);
    expect(bad({ op: "eq", field: "zzz", value: 1 })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "i", value: "1" })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "i", value: 1.5 })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "i", value: 2 ** 31 })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "l", value: 5 })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "l", value: "1.5" })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "d", value: "abc" })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "s", value: 1 })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "b", value: "true" })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "date", value: "2026-1-1" })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "ts", value: "2026-01-01T00:00:00" })).toThrow(CriteriaError);
    expect(bad({ op: "eq", field: "bin", value: "AA" })).toThrow(CriteriaError);
    expect(bad({ op: "gt", field: "i", value: null })).toThrow(CriteriaError);
    expect(bad({ op: "contains", field: "i", value: "1" })).toThrow(CriteriaError);
    expect(bad({ op: "in", field: "i", values: [1, "x"] })).toThrow(CriteriaError);
  });

  test("non-filterable fields need the set", () => {
    const j = {
      $Version: "4.01",
      $EntityContainer: "T.C",
      T: {
        R: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, x: {} },
        C: {
          $Kind: "EntityContainer",
          Rs: { $Collection: true, $Type: "T.R", "@Capabilities.FilterRestrictions": { NonFilterableProperties: ["x"] } },
        },
      },
    };
    const set = parseCsdl(j).set("Rs");
    const c: Criteria = { op: "eq", field: "x", value: "a" };
    expect(toFilter(c, set.type)).toBe("x eq 'a'");
    expect(() => toFilter(c, set.type, set)).toThrow(CriteriaError);
  });
});

describe("toOrderBy / toQueryString", () => {
  test("key tie-breaker appended, skipped when present", () => {
    expect(toOrderBy([], project)).toBe("id");
    expect(toOrderBy([{ field: "name" }], project)).toBe("name,id");
    expect(toOrderBy([{ field: "name", descending: true }, { field: "id", descending: true }], project)).toBe("name desc,id desc");
    expect(toOrderBy([{ field: "pinned", descending: true }], project)).toBe("pinned desc,id");
  });
  test("a path through single-valued navigations sorts by the related field", () => {
    const time = schema.set("TimeEntries").type;
    expect(toOrderBy([{ field: "person/name", descending: true }], time, schema)).toBe("person/name desc,id");
    expect(toOrderBy([{ field: "project/lead/name" }], time, schema)).toBe("project/lead/name,id");
    expect(() => toOrderBy([{ field: "person/name" }], time)).toThrow("needs the schema");
    expect(() => toOrderBy([{ field: "person/zzz" }], time, schema)).toThrow("unknown field 'zzz' on Person");
    expect(() => toOrderBy([{ field: "tasks/title" }], project, schema)).toThrow("is a collection");
  });
  test("errors", () => {
    expect(() => toOrderBy([{ field: "zzz" }], project)).toThrow(CriteriaError);
    expect(() => toOrderBy([{ field: "bin" }], R)).toThrow(CriteriaError);
  });
  test("query string", () => {
    expect(toQueryString({ set: "Projects" }, schema)).toBe("$orderby=id");
    const qs = toQueryString(
      {
        set: "Projects",
        filter: { op: "eq", field: "name", value: "a&b c" },
        orderBy: [{ field: "name", descending: true }],
        select: ["id", "name"],
      },
      schema,
    );
    expect(qs).toBe("$filter=name%20eq%20'a%26b%20c'&$orderby=name%20desc%2Cid&$select=id%2Cname");
    expect(() => toQueryString({ set: "Projects", select: ["zzz"] }, schema)).toThrow(CriteriaError);
    expect(() => toQueryString({ set: "Nope" }, schema)).toThrow();
  });
});

describe("matches", () => {
  for (const [name, c, entity, expected] of rows) {
    test(name, () => expect(matches(c, E(entity), R)).toBe(expected));
  }
  test("unknown field throws", () => {
    expect(() => matches(eq("zzz", 1), E({}), R)).toThrow(CriteriaError);
  });
  test("literal of the wrong type throws", () => {
    expect(() => matches(eq("i", "x"), E({ i: 1 }), R)).toThrow(CriteriaError);
  });
  test("a malformed stored value throws", () => {
    expect(() => matches(eq("ts", "2026-01-01T00:00:00Z"), E({ ts: "garbage" }), R)).toThrow(CriteriaError);
  });
});

describe("evaluator agrees with the compiled filter on the demo's type", () => {
  test("not (budget gt 100) on a row", () => {
    const c: Criteria = not(cmp("gt", "budget", "100"));
    expect(toFilter(c, project)).toBe("not (budget gt 100)");
    expect(matches(c, { id: 1, budget: "99.99" } as Entity, project)).toBe(true);
  });
});

describe("compareValues", () => {
  const f = (n: string) => R.field(n)!;
  test("null first, equal to itself", () => {
    expect(compareValues(null, 1, f("i"))).toBe(-1);
    expect(compareValues(1, null, f("i"))).toBe(1);
    expect(compareValues(null, null, f("i"))).toBe(0);
  });
  test("NaN sorts after everything, equal to itself", () => {
    expect(compareValues(NaN, Infinity, f("f"))).toBe(1);
    expect(compareValues(1, NaN, f("f"))).toBe(-1);
    expect(compareValues(NaN, NaN, f("f"))).toBe(0);
  });
  test("exact decimals and int64", () => {
    expect(compareValues("10.50", "10.5", f("d"))).toBe(0);
    expect(compareValues("9007199254740993", "9007199254740992", f("l"))).toBe(1);
  });
  test("code points", () => {
    expect(compareValues("\u{1F600}", "�", f("s"))).toBe(1);
    expect(compareValues("Z", "a", f("s"))).toBe(-1);
    expect(compareValues("ab", "abc", f("s"))).toBe(-1);
  });
});

describe("sortComparator", () => {
  const ids = (sort: SortKey[], data: Entity[]) =>
    [...data].sort(sortComparator(sort, R)).map((e) => e["id"]);
  const data: Entity[] = [
    { id: 1, i: 4 }, { id: 2, i: null }, { id: 3, i: 5 }, { id: 4, i: 4 }, { id: 5, i: 2 }, { id: 6, i: null },
  ];
  test("nulls first ascending, ties by key", () => {
    expect(ids([{ field: "i" }], data)).toEqual([2, 6, 5, 1, 4, 3]);
  });
  test("nulls last descending, ties by key ascending", () => {
    expect(ids([{ field: "i", descending: true }], data)).toEqual([3, 1, 4, 5, 2, 6]);
  });
  test("a descending key sort is not overridden by the tie-breaker", () => {
    expect(ids([{ field: "i", descending: true }, { field: "id", descending: true }], data)).toEqual([3, 4, 1, 5, 6, 2]);
  });
  test("strings by code point", () => {
    const s: Entity[] = [{ id: 1, s: "apple" }, { id: 2, s: "Zucchini" }, { id: 3, s: "Apple" }, { id: 4, s: null }];
    expect(ids([{ field: "s" }], s)).toEqual([4, 3, 2, 1]);
    expect(ids([{ field: "s", descending: true }], s)).toEqual([1, 2, 3, 4]);
  });
  test("instants across offsets", () => {
    const t: Entity[] = [
      { id: 1, ts: "2026-01-01T12:00:00+05:00" },
      { id: 2, ts: "2026-01-01T08:00:00Z" },
      { id: 3, ts: "2026-01-01T07:30:00Z" },
    ];
    expect(ids([{ field: "ts" }], t)).toEqual([1, 3, 2]);
  });
  test("unknown or binary field throws", () => {
    expect(() => sortComparator([{ field: "zzz" }], R)).toThrow(CriteriaError);
    expect(() => sortComparator([{ field: "bin" }], R)).toThrow(CriteriaError);
  });
});

describe("resolveRelative", () => {
  test("a relative date two lambdas deep is typed by the innermost type", () => {
    const due: Criteria = { op: "le", field: "due", value: { relative: "today", days: 7 } };
    const nested: Criteria = { op: "any", field: "tasks", where: { op: "any", field: "subtasks", where: due } };
    const now = Date.UTC(2026, 9, 15, 12);
    expect(resolveRelative(nested, project, now, relatedOf(schema, project))).toEqual({
      op: "any",
      field: "tasks",
      where: { op: "any", field: "subtasks", where: { op: "le", field: "due", value: "2026-10-22" } },
    });
  });
});
