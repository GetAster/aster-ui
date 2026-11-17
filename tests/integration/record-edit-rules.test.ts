// A rule over a record and its owned rows, as the edit sees it: judged live over the working state, never
// changing `dirty`, refusing a save before any request, and shown where the server's refusal also lands.
import { beforeEach, expect, test } from "bun:test";
import { DataContext, ODataError, RecordEdit, type ODataRequest } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";

const key = { $Type: "Edm.Int32", "@Org.OData.Core.V1.Computed": true };
const money = { $Type: "Edm.Decimal", $Precision: 14, $Scale: 2 };
const sum = (name: string) => ({ $Apply: [{ $NavigationPropertyPath: "lines" }, { $PropertyPath: name }], $Function: "Aster.Data.V1.Sum" });
const draftOr = (rest: unknown) => ({ $Or: [{ $Ne: [{ $Path: "status" }, "posted"] }, rest] });
const metadata = {
  $Version: "4.01",
  $EntityContainer: "T.Container",
  $Reference: {
    "https://example/Core.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] },
    "https://example/Validation.json": { $Include: [{ $Namespace: "Org.OData.Validation.V1", $Alias: "Validation" }] },
    "https://example/Aster.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
  },
  T: {
    Entry: {
      $Kind: "EntityType", $Key: ["id"], id: key, status: {},
      lines: { $Kind: "NavigationProperty", $Type: "T.Line", $Collection: true, $Partner: "entry", "@Aster.Data.V1.Owned": true },
      "@Org.OData.Validation.V1.Constraint#EntryBalances": {
        Condition: draftOr({ $And: [{ $Ge: [{ $Path: "lines/$count" }, 2] }, { $Eq: [sum("debit"), sum("credit")] }] }),
        FailureMessage: "An entry needs two lines and equal debits and credits to be posted.",
      },
      // The client doesn't judge division; the server does.
      "@Org.OData.Validation.V1.Constraint#ServerOnly": {
        Condition: draftOr({ $Le: [{ $Div: [sum("debit"), 1] }, 50] }),
        FailureMessage: "Debits over 50.00 need the server's approval.",
      },
    },
    Line: {
      $Kind: "EntityType", $Key: ["id"], id: key, entryId: { $Type: "Edm.Int32" },
      entry: { $Kind: "NavigationProperty", $Type: "T.Entry", $Partner: "lines", $ReferentialConstraint: { entryId: "id" } },
      debit: money, credit: money,
    },
    Container: {
      $Kind: "EntityContainer",
      Entries: { $Collection: true, $Type: "T.Entry", $NavigationPropertyBinding: { lines: "Lines" } },
      Lines: { $Collection: true, $Type: "T.Line", $NavigationPropertyBinding: { entry: "Entries" } },
    },
  },
};
const data = {
  Entries: [{ id: 1, status: "posted" }, { id: 2, status: "draft" }, { id: 3, status: "draft" }],
  Lines: [
    { id: 1, entryId: 1, debit: "100.00", credit: "0.00" },
    { id: 2, entryId: 1, debit: "0.00", credit: "100.00" },
    { id: 3, entryId: 2, debit: "40.00", credit: "0.00" },
    { id: 4, entryId: 3, debit: "10.00", credit: "0.00" },
    { id: 5, entryId: 3, debit: "0.00", credit: "10.00" },
  ],
};

let mock: MockService;
let ctx: DataContext;
let sent: ODataRequest[];

beforeEach(async () => {
  mock = await createMockService({ metadata, data });
  sent = [];
  ctx = await DataContext.connect(async (r: ODataRequest) => {
    sent.push(r);
    return mock.transport(r);
  });
});

async function open(id: number): Promise<RecordEdit> {
  await ctx.collection({ set: "Entries", filter: { op: "eq", field: "id", value: id } }).ensure(0, 1);
  const record = new RecordEdit(ctx, "Entries", `[${id}]`);
  await record.ready;
  return record;
}
const states = (r: RecordEdit) => Object.fromEntries(r.rules.value.map((x) => [x.id, x.state]));
const writes = () => sent.filter((q) => q.method !== "GET");

test("rules are judged over the working rows: new rows and unsaved edits count, a row marked for removal does not", async () => {
  const r = await open(3);
  r.edit.set("status", "posted");
  expect(states(r)).toEqual({ EntryBalances: "pass", ServerOnly: "deferred" });
  const lines = r.owned.lines!;
  const [debit, credit] = lines.rows.value;
  // A new row counts.
  const added = lines.add({ debit: "5.00", credit: "0.00" });
  expect(states(r).EntryBalances).toBe("fail");
  // An unsaved edit counts.
  added.edit.set("credit", "5.00");
  expect(states(r).EntryBalances).toBe("pass");
  // A row marked for removal does not: what is left is 10.00 against 5.00.
  lines.remove(credit!.id);
  expect(states(r).EntryBalances).toBe("fail");
  lines.restore(credit!.id);
  expect(states(r).EntryBalances).toBe("pass");
  // Fewer than two lines, though debits equal credits.
  lines.remove(added.id);
  lines.remove(debit!.id);
  expect(states(r).EntryBalances).toBe("fail");
});

test("an unbalanced posted entry fails the rule and refuses the save with no request; dirty and the pending marks are untouched", async () => {
  const r = await open(2);
  r.edit.set("status", "posted");
  const dirty = r.dirty.value;
  const pending = r.edit.pending("status").value;
  expect(states(r).EntryBalances).toBe("fail");
  expect(r.valid.value).toBe(false);
  // Nothing is shown until a save or validation shows it.
  expect(r.edit.recordErrors.value).toEqual([]);
  expect(r.owned.lines!.errors.value).toEqual([]);
  expect(await r.save()).toBeUndefined();
  expect(writes()).toEqual([]);
  expect(r.edit.recordErrors.value.map((e) => e.id)).toEqual(["EntryBalances"]);
  expect(r.edit.recordErrors.value[0]!.list).toBe(r.owned.lines!);
  expect(r.owned.lines!.errors.value).toEqual(["An entry needs two lines and equal debits and credits to be posted."]);
  expect(r.dirty.value).toBe(dirty);
  expect(r.edit.pending("status").value).toBe(pending);
  // The rule doesn't hold the record: balancing the entry lets the same record save.
  r.owned.lines!.add({ debit: "0.00", credit: "40.00" });
  r.owned.lines!.add({ debit: "0.00", credit: "0.00" });
  expect(states(r).EntryBalances).toBe("pass");
  expect(r.edit.recordErrors.value).toEqual([]);
  expect(r.owned.lines!.errors.value).toEqual([]);
  expect((await r.save())?.ok).toBe(true);
});

test("a shown failure follows the working state, goes when the condition holds, and is quiet again after a revert", async () => {
  const r = await open(2);
  r.edit.set("status", "posted");
  r.problems();
  expect(r.edit.recordErrors.value).toHaveLength(1);
  const credit = r.owned.lines!.add({ debit: "0.00", credit: "10.00" });
  expect(r.edit.recordErrors.value).toHaveLength(1);
  credit.edit.set("credit", "40.00");
  expect(r.edit.recordErrors.value).toEqual([]);
  credit.edit.set("credit", "41.00");
  expect(r.edit.recordErrors.value).toHaveLength(1);
  r.revert();
  expect(r.edit.recordErrors.value).toEqual([]);
  r.edit.set("status", "posted");
  expect(states(r).EntryBalances).toBe("fail");
  expect(r.edit.recordErrors.value).toEqual([]);
});

test("explain says why a state change would fail, from the working rows, and changes nothing", async () => {
  const r = await open(2);
  const dirty = r.dirty.value;
  expect(r.explain({ status: "posted" }).map((x) => x.id)).toEqual(["EntryBalances"]);
  expect(r.explain({ status: "draft" })).toEqual([]);
  expect(r.dirty.value).toBe(dirty);
  expect(r.edit.values.value.status).toBe("draft");
  expect(r.edit.recordErrors.value).toEqual([]);
  expect(writes()).toEqual([]);
  r.owned.lines!.add({ debit: "0.00", credit: "40.00" });
  r.owned.lines!.add({ debit: "0.00", credit: "0.00" });
  expect(r.explain({ status: "posted" })).toEqual([]);
});

test("a rule the client can't judge never refuses a save; the server's refusal by rule id shows as a failing rule until the next change", async () => {
  const r = await open(3);
  r.edit.set("status", "posted");
  r.owned.lines!.add({ debit: "60.00", credit: "60.00" });
  expect(states(r)).toEqual({ EntryBalances: "pass", ServerOnly: "deferred" });
  const result = await r.save();
  expect(result?.ok).toBe(false);
  expect(writes()).toHaveLength(1);
  expect(states(r).ServerOnly).toBe("fail");
  expect(r.failure.value).toBeUndefined();
  expect(r.edit.recordErrors.value.map((e) => [e.id, e.message])).toEqual([["ServerOnly", "Debits over 50.00 need the server's approval."]]);
  expect(r.owned.lines!.errors.value).toEqual(["Debits over 50.00 need the server's approval."]);
  // The next change to the rows takes the refusal away.
  r.owned.lines!.rows.value.at(-1)!.edit.set("debit", "61.00");
  expect(states(r).ServerOnly).toBe("deferred");
  expect(r.edit.recordErrors.value).toEqual([]);
  expect(r.owned.lines!.errors.value).toEqual([]);
});

test("the server refuses an unbalanced post that gets past the client, by the rule's id and message", async () => {
  await open(2);
  const error = await ctx.update("Entries", "[2]", { status: "posted" }).catch((e) => e);
  expect(error).toBeInstanceOf(ODataError);
  expect((error as ODataError).status).toBe(400);
  expect((error as ODataError).details.map((d) => [d.code, d.message])).toContainEqual(["EntryBalances", "An entry needs two lines and equal debits and credits to be posted."]);
  const stored = JSON.parse((await mock.transport({ method: "GET", url: "Entries(2)", headers: {} })).body);
  expect(stored.status).toBe("draft");
});
