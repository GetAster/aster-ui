// The synthetic all-types schema and the evaluator truth table, shared by the
// unit tests and the differential test against the WebAssembly engine.
import type { Criteria } from "../src/criteria/ast.ts";
import type { Value } from "../src/schema/model.ts";

/** CSDL JSON for `T.R`, one nullable property per Edm type, in set `Rs`. */
export const ALL_TYPES_CSDL = {
  $Version: "4.01",
  $EntityContainer: "T.C",
  T: {
    R: {
      $Kind: "EntityType",
      $Key: ["id"],
      id: { $Type: "Edm.Int32" },
      s: { $Nullable: true },
      b: { $Type: "Edm.Boolean", $Nullable: true },
      i: { $Type: "Edm.Int32", $Nullable: true },
      l: { $Type: "Edm.Int64", $Nullable: true },
      d: { $Type: "Edm.Decimal", $Nullable: true },
      f: { $Type: "Edm.Double", $Nullable: true },
      date: { $Type: "Edm.Date", $Nullable: true },
      time: { $Type: "Edm.TimeOfDay", $Nullable: true },
      ts: { $Type: "Edm.DateTimeOffset", $Nullable: true },
      dur: { $Type: "Edm.Duration", $Nullable: true },
      g: { $Type: "Edm.Guid", $Nullable: true },
      bin: { $Type: "Edm.Binary", $Nullable: true },
      s2: { $Nullable: true },
      i2: { $Type: "Edm.Int32", $Nullable: true },
      d2: { $Type: "Edm.Decimal", $Nullable: true },
      date2: { $Type: "Edm.Date", $Nullable: true },
      ts2: { $Type: "Edm.DateTimeOffset", $Nullable: true },
    },
    C: { $Kind: "EntityContainer", Rs: { $Collection: true, $Type: "T.R" } },
  },
};

export type Row = [description: string, criteria: Criteria, entity: Record<string, Value>, expected: boolean];

export const eq = (field: string, value: Value): Criteria => ({ op: "eq", field, value });
export const ne = (field: string, value: Value): Criteria => ({ op: "ne", field, value });
export const cmp = (op: "gt" | "ge" | "lt" | "le", field: string, value: Value): Criteria => ({ op, field, value });
export const fn = (op: "contains" | "startswith" | "endswith", field: string, value: string, caseInsensitive?: boolean): Criteria =>
  caseInsensitive ? { op, field, value, caseInsensitive } : { op, field, value };
export const not = (arg: Criteria): Criteria => ({ op: "not", arg });
export const vs = (op: "eq" | "ne" | "gt" | "ge" | "lt" | "le", field: string, other: string): Criteria => ({ op, field, other });

export const rows: Row[] = [
  // null rules (P2 5.1.1.1.1-3)
  ["null eq null", eq("i", null), { i: null }, true],
  ["value eq null", eq("i", null), { i: 1 }, false],
  ["null eq value", eq("i", 1), { i: null }, false],
  ["null ne value", ne("i", 1), { i: null }, true],
  ["null ne null", ne("i", null), { i: null }, false],
  ["value ne null", ne("i", null), { i: 1 }, true],
  ["null gt", cmp("gt", "i", 1), { i: null }, false],
  ["null ge", cmp("ge", "i", 1), { i: null }, false],
  ["null lt", cmp("lt", "i", 1), { i: null }, false],
  ["null le", cmp("le", "i", 1), { i: null }, false],
  ["not (null gt) is true: two-valued comparisons", not(cmp("gt", "i", 1)), { i: null }, true],
  ["not (null eq 1) is true", not(eq("i", 1)), { i: null }, true],
  ["missing property is null", eq("i", null), {}, true],
  // functions over null are unknown, so `not` keeps the row out
  ["contains over null", fn("contains", "s", "a"), { s: null }, false],
  ["not contains over null stays excluded", not(fn("contains", "s", "a")), { s: null }, false],
  ["not startswith over a string", not(fn("startswith", "s", "a")), { s: "bcd" }, true],
  ["unknown or true is true", { op: "or", args: [fn("contains", "s", "a"), eq("i", 1)] }, { s: null, i: 1 }, true],
  ["unknown or false is unknown", { op: "or", args: [fn("contains", "s", "a"), eq("i", 1)] }, { s: null, i: 2 }, false],
  ["not (unknown or false) is unknown", not({ op: "or", args: [fn("contains", "s", "a"), eq("i", 1)] }), { s: null, i: 2 }, false],
  ["unknown and false is false, so not is true", not({ op: "and", args: [fn("contains", "s", "a"), eq("i", 1)] }), { s: null, i: 2 }, true],
  ["unknown and true is unknown", { op: "and", args: [fn("contains", "s", "a"), eq("i", 1)] }, { s: null, i: 1 }, false],
  ["empty and", { op: "and", args: [] }, {}, true],
  ["empty or", { op: "or", args: [] }, {}, false],
  // in
  ["in hit", { op: "in", field: "s", values: ["a", "b"] }, { s: "b" }, true],
  ["in miss", { op: "in", field: "s", values: ["a", "b"] }, { s: "c" }, false],
  ["null in list without null", { op: "in", field: "s", values: ["a"] }, { s: null }, false],
  ["not (null in list) is true", not({ op: "in", field: "s", values: ["a"] }), { s: null }, true],
  ["null in list with null", { op: "in", field: "s", values: ["a", null] }, { s: null }, true],
  ["in empty", { op: "in", field: "s", values: [] }, { s: "a" }, false],
  // strings: code point, case sensitive
  ["case sensitive eq", eq("s", "apple"), { s: "Apple" }, false],
  ["capitals before lower case", cmp("lt", "s", "a"), { s: "Z" }, true],
  ["supplementary above U+FFFD", cmp("gt", "s", "�"), { s: "\u{1F600}" }, true],
  ["supplementary below U+FFFD is false", cmp("lt", "s", "�"), { s: "\u{1F600}" }, false],
  ["contains empty needle", fn("contains", "s", ""), { s: "x" }, true],
  ["contains", fn("contains", "s", "ea"), { s: "Tea" }, true],
  ["contains is case sensitive", fn("contains", "s", "EA"), { s: "Tea" }, false],
  ["contains ci", fn("contains", "s", "EA", true), { s: "Tea" }, true],
  ["startswith", fn("startswith", "s", "Te"), { s: "Tea" }, true],
  ["startswith ci", fn("startswith", "s", "te", true), { s: "Tea" }, true],
  ["endswith", fn("endswith", "s", "ea"), { s: "Tea" }, true],
  ["endswith miss", fn("endswith", "s", "Te"), { s: "Tea" }, false],
  ["tolower non-ASCII", fn("contains", "s", "ÉCOLE", true), { s: "école" }, true],
  ["tolower full mapping (U+0130)", fn("contains", "s", "i̇", true), { s: "İ" }, true],
  ["tolower final sigma", fn("endswith", "s", "ς", true), { s: "ΟΔΟΣ" }, true],
  // booleans
  ["false < true", cmp("lt", "b", true), { b: false }, true],
  // Int64 and Decimal exact
  ["decimal 10.50 eq 10.5", eq("d", "10.5"), { d: "10.50" }, true],
  ["decimal trailing zeros gt", cmp("gt", "d", "10.5"), { d: "10.50" }, false],
  ["decimal 0.1 + tiny", cmp("gt", "d", "0.1"), { d: "0.10000000000000000000000001" }, true],
  ["decimal negative", cmp("lt", "d", "-1.5"), { d: "-1.50001" }, true],
  ["decimal vs integer number", eq("d", "5"), { d: 5 }, true],
  ["int64 beyond 2^53 gt", cmp("gt", "l", "9007199254740992"), { l: "9007199254740993" }, true],
  ["int64 beyond 2^53 eq", eq("l", "9007199254740992"), { l: "9007199254740993" }, false],
  ["int64 min and max", cmp("lt", "l", "9223372036854775807"), { l: "-9223372036854775808" }, true],
  ["int64 vs number entity value", eq("l", "42"), { l: 42 }, true],
  // doubles
  ["double eq", eq("f", 0.5), { f: 0.5 }, true],
  ["NaN eq NaN is false", eq("f", NaN), { f: NaN }, false],
  ["NaN ne NaN is true", ne("f", NaN), { f: NaN }, true],
  ["NaN gt", cmp("gt", "f", 1), { f: NaN }, false],
  ["INF gt", cmp("gt", "f", 1e308), { f: Infinity }, true],
  ["-0 eq 0", eq("f", 0), { f: -0 }, true],
  // Date, TimeOfDay
  ["date lt", cmp("lt", "date", "2026-10-15"), { date: "2026-10-14" }, true],
  ["date eq", eq("date", "2026-10-15"), { date: "2026-10-15" }, true],
  ["date across year 9999 to 10000", cmp("lt", "date", "10000-01-01"), { date: "9999-12-31" }, true],
  ["time fraction padded", eq("time", "10:20:30.5"), { time: "10:20:30.500" }, true],
  ["time without seconds", eq("time", "10:20"), { time: "10:20:00" }, true],
  ["time gt", cmp("gt", "time", "10:20:30"), { time: "10:20:30.000000001" }, true],
  // DateTimeOffset by instant
  ["same instant, other offset", eq("ts", "2026-01-01T12:00:00Z"), { ts: "2026-01-01T13:00:00+01:00" }, true],
  ["offset crosses the date", eq("ts", "2026-01-01T00:30:00Z"), { ts: "2025-12-31T19:30:00-05:00" }, true],
  ["later by the offset", cmp("gt", "ts", "2026-01-01T12:00:00Z"), { ts: "2026-01-01T12:00:00-01:00" }, true],
  ["nanosecond fraction gt", cmp("gt", "ts", "2026-01-01T12:00:00.123456788Z"), { ts: "2026-01-01T12:00:00.123456789Z" }, true],
  ["fraction beyond ms differs", eq("ts", "2026-01-01T12:00:00.1234Z"), { ts: "2026-01-01T12:00:00.1235Z" }, false],
  ["trailing zero fraction equal", eq("ts", "2026-01-01T12:00:00Z"), { ts: "2026-01-01T12:00:00.000Z" }, true],
  ["lowercase t and z", eq("ts", "2026-01-01T12:00:00Z"), { ts: "2026-01-01t12:00:00z" }, true],
  ["no seconds", eq("ts", "2026-01-01T12:00:00Z"), { ts: "2026-01-01T12:00Z" }, true],
  // Guid, Duration
  ["guid case-insensitive", eq("g", "ABCDEF00-0000-0000-0000-000000000001"), { g: "abcdef00-0000-0000-0000-000000000001" }, true],
  ["guid order", cmp("lt", "g", "00000000-0000-0000-0000-00000000000A"), { g: "00000000-0000-0000-0000-000000000009" }, true],
  ["duration by length", eq("dur", "PT90M"), { dur: "PT1H30M" }, true],
  ["duration day vs hours", eq("dur", "P1D"), { dur: "PT24H" }, true],
  ["duration negative", cmp("lt", "dur", "PT0S"), { dur: "-PT1S" }, true],
  ["duration fraction", cmp("gt", "dur", "PT1S"), { dur: "PT1.000000001S" }, true],
  // comparison operators
  ["ge", cmp("ge", "i", 2), { i: 2 }, true],
  ["le", cmp("le", "i", 2), { i: 3 }, false],
  ["ne", ne("i", 2), { i: 3 }, true],
  // property against property (P2 5.1.1.1)
  ["i lt i2", vs("lt", "i", "i2"), { i: 1, i2: 2 }, true],
  ["i ge i2, equal", vs("ge", "i", "i2"), { i: 2, i2: 2 }, true],
  ["i eq i2, both null", vs("eq", "i", "i2"), { i: null, i2: null }, true],
  ["i ne i2, one null", vs("ne", "i", "i2"), { i: 1, i2: null }, true],
  ["i gt i2, one null", vs("gt", "i", "i2"), { i: 3, i2: null }, false],
  ["not (i gt i2), one null", not(vs("gt", "i", "i2")), { i: 3, i2: null }, true],
  ["d eq d2 across scales", vs("eq", "d", "d2"), { d: "1.50", d2: "1.5" }, true],
  ["d gt d2 exactly", vs("gt", "d", "d2"), { d: "0.30000000000000000001", d2: "0.3" }, true],
  ["s lt s2 by code point", vs("lt", "s", "s2"), { s: "Zebra", s2: "apple" }, true],
  ["date le date2", vs("le", "date", "date2"), { date: "2026-10-07", date2: "2026-10-08" }, true],
  ["ts eq ts2 across offsets", vs("eq", "ts", "ts2"), { ts: "2026-10-07T15:15:00Z", ts2: "2026-10-07T16:15:00+01:00" }, true],
];
