// A published `Validation.Constraint` over a record and its owned rows: what the data core reads from
// `$metadata`, what it judges live, and what it leaves to the server.
import { expect, test } from "bun:test";
import { parseCsdl, type Entity, type RecordRule, type RuleOutcome } from "@getaster/data";

const money = { $Type: "Edm.Decimal", $Precision: 14, $Scale: 2, $Nullable: true };
const path = (p: string) => ({ $Path: p });
const fn = (name: string, ...args: unknown[]) => ({ $Apply: args, $Function: `Aster.Data.V1.${name}` });
const lines = { $NavigationPropertyPath: "lines" };
const field = (name: string) => ({ $PropertyPath: name });
const sum = (name: string) => fn("Sum", lines, field(name));

function typeWith(condition: unknown, extra: Record<string, unknown> = {}) {
  const schema = parseCsdl({
    $Version: "4.01",
    $EntityContainer: "T.Container",
    $Reference: {
      "https://example/Validation.json": { $Include: [{ $Namespace: "Org.OData.Validation.V1", $Alias: "Validation" }] },
      "https://example/Aster.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
    },
    T: {
      Entry: {
        $Kind: "EntityType", $Key: ["id"],
        id: { $Type: "Edm.Int32" }, status: {}, limit: { $Type: "Edm.Int32", $Nullable: true }, cap: money, note: { $Nullable: true },
        lines: { $Kind: "NavigationProperty", $Type: "T.Line", $Collection: true, $Partner: "entry", "@AsterData.Owned": true },
        notes: { $Kind: "NavigationProperty", $Type: "T.Note", $Collection: true, $Partner: "entry", "@AsterData.Owned": true },
        other: { $Kind: "NavigationProperty", $Type: "T.Line", $Collection: true },
        "@Org.OData.Validation.V1.Constraint#Rule": { Condition: condition, FailureMessage: "The rule failed.", ...extra },
      },
      Line: {
        $Kind: "EntityType", $Key: ["id"],
        id: { $Type: "Edm.Int32" }, entryId: { $Type: "Edm.Int32" }, debit: money, credit: money, kind: { $Nullable: true }, day: { $Type: "Edm.Date", $Nullable: true }, qty: { $Type: "Edm.Int32", $Nullable: true },
        entry: { $Kind: "NavigationProperty", $Type: "T.Entry", $Partner: "lines", $ReferentialConstraint: { entryId: "id" } },
      },
      Note: {
        $Kind: "EntityType", $Key: ["id"],
        id: { $Type: "Edm.Int32" }, entryId: { $Type: "Edm.Int32" },
        entry: { $Kind: "NavigationProperty", $Type: "T.Entry", $Partner: "notes", $ReferentialConstraint: { entryId: "id" } },
      },
      Container: {
        $Kind: "EntityContainer",
        Entries: { $Collection: true, $Type: "T.Entry", $NavigationPropertyBinding: { lines: "Lines", notes: "Notes", other: "Lines" } },
        Lines: { $Collection: true, $Type: "T.Line", $NavigationPropertyBinding: { entry: "Entries" } },
        Notes: { $Collection: true, $Type: "T.Note", $NavigationPropertyBinding: { entry: "Entries" } },
      },
    },
  });
  return schema.set("Entries").type;
}

const rule = (condition: unknown): RecordRule => typeWith(condition).rules[0]!;
const line = (debit: string | null, credit: string | null, more: Entity = {}): Entity => ({ debit, credit, kind: null, day: null, qty: null, ...more });
const judge = (condition: unknown, rows: readonly Entity[] = [], record: Entity = { status: "draft", limit: null, cap: "0.00" }): RuleOutcome =>
  rule(condition).evaluate({ record, rows: { lines: rows } });

test("an entity type carries its constraints, with their id and message", () => {
  const type = typeWith(path("status"));
  expect(type.rules.map((r) => [r.id, r.message])).toEqual([["Rule", "The rule failed."]]);
  expect(typeWith(path("status"), {}).navigation("lines")!.owned).toBe(true);
  // A constraint with no FailureMessage still has words to show.
  const bare = parseCsdl({ T: { E: { $Kind: "EntityType", $Key: ["id"], id: {}, "@Validation.Constraint#R": { Condition: true } }, Container: { $Kind: "EntityContainer", Es: { $Collection: true, $Type: "T.E" } } }, $EntityContainer: "T.Container", $Reference: { x: { $Include: [{ $Namespace: "Org.OData.Validation.V1", $Alias: "Validation" }] } } });
  expect(bare.set("Es").type.rules[0]!.message).not.toBe("");
});

test("Sum: exact decimals over the rows, null over no rows and for all-null values", () => {
  const balanced = { $Eq: [sum("debit"), sum("credit")] };
  expect(judge(balanced, [line("0.10", "0.00"), line("0.20", "0.00"), line("0.00", "0.30")])).toBe("pass");
  expect(judge(balanced, [line("0.10", "0.00"), line("0.00", "0.30")])).toBe("fail");
  // No rows: both sums are null, and null eq null holds, which is why a rule asks for a count too.
  expect(judge(balanced, [])).toBe("pass");
  expect(judge({ $Eq: [sum("debit"), null] }, [line(null, "1.00")])).toBe("pass");
  expect(judge({ $Gt: [sum("debit"), 0] }, [])).toBe("fail");
});

test("Min, Max, Average and Count", () => {
  const rows = [line("2.00", null), line("4.00", null), line(null, null)];
  const agg = (name: string, f?: string) => ({ $Eq: [fn(name, lines, ...(f ? [field(f)] : [])), 0] });
  const is = (name: string, value: unknown, f?: string, over = rows) => judge({ $Eq: [fn(name, lines, ...(f ? [field(f)] : [])), value] }, over);
  expect(is("Min", 2, "debit")).toBe("pass");
  expect(is("Max", "4.00", "debit")).toBe("pass");
  expect(is("Average", 3, "debit")).toBe("pass");
  expect(is("Count", 2, "debit")).toBe("pass");
  expect(is("Count", 3)).toBe("pass");
  expect(is("Min", null, "debit", [])).toBe("pass");
  expect(is("Count", 0, undefined, [])).toBe("pass");
  expect(judge(agg("Count"), rows)).toBe("fail");
  // Minimum and maximum of dates compare as dates.
  const days = [line(null, null, { day: "2026-03-01" }), line(null, null, { day: "2026-01-15" })];
  expect(judge({ $Eq: [fn("Min", lines, field("day")), "2026-01-15"] }, days)).toBe("pass");
  expect(judge({ $Eq: [fn("Max", lines, field("day")), "2026-03-01"] }, days)).toBe("pass");
});

test("an average with no finite decimal form is left to the server, one with it is judged", () => {
  const three = [line("1.00", null), line("1.00", null), line("2.00", null)];
  const avg = fn("Average", lines, field("debit"));
  expect(judge({ $Le: [avg, "1.33"] }, three)).toBe("deferred");
  expect(judge({ $Eq: [avg, 1.5] }, [line("1.00", null), line("2.00", null)])).toBe("pass");
});

test("lines/$count counts the rows given, and an aggregate may filter them", () => {
  const two = [line("1.00", "0.00", { kind: "tax" }), line("0.00", "1.00")];
  expect(judge({ $Ge: [path("lines/$count"), 2] }, two)).toBe("pass");
  expect(judge({ $Ge: [path("lines/$count"), 3] }, two)).toBe("fail");
  const taxOnly = fn("Sum", lines, field("debit"), { $Eq: [path("kind"), "tax"] });
  expect(judge({ $Eq: [taxOnly, 1], }, two)).toBe("pass");
  expect(judge({ $Eq: [fn("Count", lines, { $Ne: [path("kind"), "tax"] }), 1] }, two)).toBe("pass");
});

test("conditions: and, or, not, comparison, the record's own fields and arithmetic", () => {
  const record = { status: "posted", limit: 5, cap: "10.00" };
  const rows = [line("4.00", "0.00"), line("3.00", "0.00")];
  const all = (c: unknown) => judge(c, rows, record);
  expect(all({ $And: [{ $Eq: [path("status"), "posted"] }, { $Le: [sum("debit"), path("cap")] }] })).toBe("pass");
  expect(all({ $Or: [{ $Eq: [path("status"), "draft"] }, { $Gt: [sum("debit"), path("cap")] }] })).toBe("fail");
  expect(all({ $Not: { $Eq: [path("status"), "draft"] } })).toBe("pass");
  expect(all({ $Ge: [{ $Add: [sum("debit"), 3] }, path("cap")] })).toBe("pass");
  expect(all({ $Eq: [{ $Sub: [path("cap"), sum("debit")] }, 3] })).toBe("pass");
  expect(all({ $Eq: [{ $Mul: [path("limit"), 2] }, 10] })).toBe("pass");
  expect(all({ $Ne: [path("status"), "posted"] })).toBe("fail");
});

test("null follows the engine: eq and ne see it, an ordering with it is false, arithmetic with it is null", () => {
  const nulls = { status: "draft", limit: null, cap: null };
  expect(judge({ $Eq: [path("limit"), null] }, [], nulls)).toBe("pass");
  expect(judge({ $Ne: [path("limit"), 5] }, [], nulls)).toBe("pass");
  expect(judge({ $Lt: [path("limit"), 5] }, [], nulls)).toBe("fail");
  expect(judge({ $Not: { $Lt: [path("limit"), 5] } }, [], nulls)).toBe("pass");
  // A condition that is null is not true: the record fails.
  expect(judge({ $Eq: [{ $Add: [path("limit"), 1] }, 1] }, [], nulls)).toBe("fail");
  expect(judge({ $Eq: [{ $Add: [path("limit"), 1] }, null] }, [], nulls)).toBe("pass");
  // and/or with a null: false and null is false, true or null is true.
  expect(judge({ $And: [false, { $Eq: [path("limit"), null] }] }, [], nulls)).toBe("fail");
  expect(judge({ $Or: [{ $Gt: [{ $Add: [path("limit"), 1] }, 0] }, true] }, [], nulls)).toBe("pass");
});

test("the working state decides: new rows, edited values and a row marked for removal are what the caller passes", () => {
  const balanced = { $And: [{ $Ge: [path("lines/$count"), 2] }, { $Eq: [sum("debit"), sum("credit")] }] };
  const saved = [line("5.00", "0.00"), line("0.00", "5.00")];
  expect(judge(balanced, saved)).toBe("pass");
  // A new row, unbalanced: fails. An edit to a value: judged on the edit. Removing the new row: passes again.
  expect(judge(balanced, [...saved, line("1.00", "0.00")])).toBe("fail");
  expect(judge(balanced, [saved[0]!, line("0.00", "4.00")])).toBe("fail");
  expect(judge(balanced, [saved[0]!, line("0.00", "5.00")])).toBe("pass");
  expect(judge(balanced, [saved[0]!])).toBe("fail");
  // A navigation whose rows haven't loaded can't be judged.
  expect(rule(balanced).evaluate({ record: { status: "draft" }, rows: {} })).toBe("deferred");
});

test("a part the client can't judge is deferred unless the rest already decides", () => {
  const unknown = { $Apply: [path("lines")], $Function: "Aster.Data.V1.Stored" };
  const elsewhere = { $Eq: [path("other/$count"), 1] };
  const posted = { status: "posted" };
  expect(judge(unknown, [], posted)).toBe("deferred");
  expect(judge({ $Or: [{ $Ne: [path("status"), "posted"] }, unknown] }, [], { status: "draft" })).toBe("pass");
  expect(judge({ $Or: [{ $Ne: [path("status"), "posted"] }, unknown] }, [], posted)).toBe("deferred");
  expect(judge({ $And: [{ $Eq: [path("status"), "draft"] }, elsewhere] }, [], posted)).toBe("fail");
  expect(judge({ $And: [{ $Eq: [path("status"), "posted"] }, elsewhere] }, [], posted)).toBe("deferred");
  // Operators outside the subset, and a function the client doesn't know.
  expect(judge({ $Eq: [{ $Div: [sum("debit"), 2] }, 1] }, [line("2.00", null)])).toBe("deferred");
  expect(judge({ $In: [path("status"), ["a"]] }, [])).toBe("deferred");
  expect(judge({ $Apply: [lines, field("debit")], $Function: "Other.V1.Sum" }, [])).toBe("deferred");
  expect(rule(unknown).evaluable).toBe(false);
  expect(rule({ $Eq: [sum("debit"), sum("credit")] }).evaluable).toBe(true);
});

test("a condition that reads exactly one owned navigation names it, otherwise the rule is the record's alone", () => {
  expect(rule({ $Eq: [sum("debit"), sum("credit")] }).list).toBe("lines");
  expect(rule({ $Ge: [path("lines/$count"), 2] }).reads).toEqual(["lines"]);
  expect(rule({ $Eq: [path("status"), "posted"] }).list).toBeUndefined();
  expect(rule({ $And: [{ $Ge: [path("lines/$count"), 1] }, { $Ge: [path("notes/$count"), 1] }] }).list).toBeUndefined();
  // Reading a navigation the client can't judge still counts as a read.
  expect(rule({ $And: [{ $Ge: [path("lines/$count"), 1] }, { $Eq: [path("other/$count"), 1] }] }).list).toBeUndefined();
  expect(rule({ $And: [{ $Ge: [path("lines/$count"), 1] }, { $Eq: [path("other/$count"), 1] }] }).reads).toEqual(["lines", "other"]);
  expect(rule({ $Ge: [path("lines/$count"), 1] }).list).toBe("lines");
});
