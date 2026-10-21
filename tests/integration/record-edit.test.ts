// M6: a record edited with the collections it owns, as one change set, one
// validation and one save; replayed as a diff; kept as a draft across a reload.
import { beforeEach, expect, test } from "bun:test";
import { DataContext, RecordEdit, type ChangeSet, type Entity, type ODataRequest } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";
import { modelData } from "../../fixtures/aster/model.ts";

let mock: MockService;
let ctx: DataContext;
let sent: ODataRequest[];
const model = modelData();
const clientType = model.Fields.find((f) => f.name === "clientType")!;

beforeEach(async () => {
  mock = await createMockService({ metadata, data: { ...data, ...model }, now: () => "2026-10-07T15:20:00Z" });
  sent = [];
  ctx = await DataContext.connect(async (r: ODataRequest) => {
    sent.push(r);
    return mock.transport(r);
  });
});

async function open(id: number): Promise<RecordEdit> {
  await ctx.collection({ set: "Fields", filter: { op: "eq", field: "id", value: id } }).ensure(0, 1);
  const r = new RecordEdit(ctx, "Fields", `[${id}]`, { owned: { answers: { positionField: "position" } } });
  await r.ready;
  return r;
}
const rows = async (set: string, field: string, id: number) =>
  JSON.parse((await mock.transport({ method: "GET", url: `${set}?$filter=${field} eq ${id}&$orderby=id`, headers: {} })).body).value as Entity[];

test("the owned collections come from metadata, each pointing at the record", async () => {
  const r = await open(clientType.id);
  expect(Object.keys(r.owned)).toEqual(["answers", "clauses"]);
  expect(r.owned.answers!.rows.value.map((x) => x.edit.values.value.key)).toEqual(["individual", "company", "trust", "partnership", "charity"]);
  const added = r.owned.answers!.add({ key: "club", label: "Club" });
  expect(added.edit.values.value).toMatchObject({ fieldId: clientType.id, position: 6 });
});

test("one change set across the record and its lists: field changes, adds, updates, removals, by key", async () => {
  const r = await open(clientType.id);
  const answers = r.owned.answers!;
  r.edit.set("label", "Type of client");
  const [individual, company] = answers.rows.value;
  company!.edit.set("label", "Limited company");
  answers.remove(individual!.id);
  answers.add({ key: "club", label: "Club" });
  const change = r.changes()!;
  expect(change.kind).toBe("update");
  if (change.kind !== "update") return;
  expect(change.changes).toEqual({ label: { from: "Client type", to: "Type of client" } });
  expect(change.owned!.answers!.map((c) => c.kind)).toEqual(["delete", "update", "create"]);
  expect(change.owned!.clauses).toBeUndefined();
  // Changed back by hand, a field drops out.
  r.edit.set("label", "Client type");
  expect((r.changes() as Extract<ChangeSet, { kind: "update" }>).changes).toEqual({});
});

test("saving is one deep update: the record and its lists' changes in one request, all or nothing", async () => {
  const r = await open(clientType.id);
  const answers = r.owned.answers!;
  r.edit.set("help", "What the client is, legally.");
  answers.remove(answers.rows.value[0]!.id);
  answers.add({ key: "club", label: "Club" });
  const before = r.snapshot();
  const result = (await r.save())!;
  expect(result.ok).toBe(true);
  expect(result.before).toEqual(before);
  const owned = (result.change as Extract<ChangeSet, { kind: "update" }>).owned!.answers!;
  expect(owned.map((c) => c.kind)).toEqual(["delete", "create"]);
  const keys = (await rows("Answers", "fieldId", clientType.id)).map((a) => a.key);
  expect(keys).toEqual(["company", "trust", "partnership", "charity", "club"]);
  const writes = sent.filter((q) => q.method !== "GET");
  expect(writes.map((q) => q.method)).toEqual(["PATCH"]);
  expect(writes[0]!.headers?.["if-match"]).toBeDefined();
  const body = JSON.parse(writes[0]!.body!);
  expect(body.help).toBe("What the client is, legally.");
  expect(body["answers@delta"].map((e: Record<string, unknown>) => ("@removed" in e ? "removed" : "id" in e ? "update" : "insert"))).toEqual(["removed", "insert"]);
  expect(r.dirty.value).toBe(false);
});

test("moving a row renumbers the position field; the list shows the new order", async () => {
  const r = await open(clientType.id);
  const answers = r.owned.answers!;
  answers.move(answers.rows.value[4]!.id, 0);
  expect(answers.rows.value.map((x) => x.edit.values.value.key)).toEqual(["charity", "individual", "company", "trust", "partnership"]);
  expect(answers.rows.value.map((x) => x.edit.values.value.position)).toEqual([1, 2, 3, 4, 5]);
});

test("a new row linked to another new row is inserted inside it, and takes its key", async () => {
  const pep = model.Fields.find((f) => f.name === "pepRole")!;
  const r = await open(pep.id);
  const clauses = r.owned.clauses!;
  const group = clauses.add({ category: "visibility", op: "or", position: 2, parentClauseId: model.Clauses.find((c) => c.fieldId === pep.id)!.id });
  clauses.add({ category: "visibility", op: "eq", fieldRef: clientType.id, value: "trust", position: 1, parentClauseId: null }, { parentClauseId: group.id });
  expect((await r.save())!.ok).toBe(true);
  const saved = await rows("Clauses", "fieldId", pep.id);
  const g = saved.find((c) => c.op === "or")!;
  expect(saved.find((c) => c.value === "trust")!.parentClauseId).toBe(g.id);
});

test("a saved change replays over the old values: pending marks exactly what it did", async () => {
  const r = await open(clientType.id);
  const answers = r.owned.answers!;
  r.edit.set("label", "Type of client");
  answers.rows.value[1]!.edit.set("label", "Limited company");
  answers.remove(answers.rows.value[0]!.id);
  answers.add({ key: "club", label: "Club" });
  const result = (await r.save())!;
  const stored = JSON.parse(JSON.stringify({ before: result.before, change: result.change }));
  const replay = RecordEdit.replay(ctx, stored.before, stored.change);
  expect(replay.edit.pending("label").value).toBe(true);
  expect(replay.edit.pending("kind").value).toBe(false);
  expect(replay.edit.state("label").value.readOnly).toBe(true);
  const shown = replay.owned.answers!.rows.value;
  expect(shown.map((x) => [x.edit.values.value.key, x.removing, x.isNew])).toEqual([
    ["individual", true, false],
    ["company", false, false],
    ["trust", false, false],
    ["partnership", false, false],
    ["charity", false, false],
    ["club", false, true],
  ]);
  expect(shown[1]!.edit.pending("label").value).toBe(true);
  expect(shown[1]!.edit.pending("key").value).toBe(false);
  expect(shown[5]!.edit.pending("key").value).toBe(true);
  expect(replay.owned.clauses!.rows.value.some((x) => x.edit.dirty.value || x.removing || x.isNew)).toBe(false);
  expect(await replay.save()).toBeUndefined();
});

test("a draft survives a reload as data, and an external change on resume rebases or conflicts", async () => {
  const r = await open(clientType.id);
  r.edit.set("label", "Type of client");
  r.owned.answers!.add({ key: "club", label: "Club" });
  r.owned.answers!.remove(r.owned.answers!.rows.value[0]!.id);
  const draft = JSON.parse(JSON.stringify(r.draft()));
  const changes = r.changes();
  r.dispose();

  // Someone else edits a field this draft didn't touch.
  const etag = ctx.store.get("Fields", `[${clientType.id}]`)!.etag!;
  await mock.transport({ method: "PATCH", url: `Fields(${clientType.id})`, headers: { "if-match": etag, "content-type": "application/json" }, body: JSON.stringify({ help: "Theirs" }) });
  const fresh = new DataContext(ctx.source);
  await fresh.collection({ set: "Fields", filter: { op: "eq", field: "id", value: clientType.id } }).ensure(0, 1);
  const again = new RecordEdit(fresh, "Fields", `[${clientType.id}]`, { owned: { answers: { positionField: "position" } } });
  await again.resume(draft);
  expect(again.changes()).toEqual(changes);
  expect(again.edit.conflict.value).toBeUndefined();
  expect(again.edit.values.value.help).toBe("Theirs");
  expect(again.edit.values.value.label).toBe("Type of client");

  // And one that did.
  const etag2 = fresh.store.get("Fields", `[${clientType.id}]`)!.etag!;
  await mock.transport({ method: "PATCH", url: `Fields(${clientType.id})`, headers: { "if-match": etag2, "content-type": "application/json" }, body: JSON.stringify({ label: "Their label" }) });
  const third = new DataContext(ctx.source);
  await third.collection({ set: "Fields", filter: { op: "eq", field: "id", value: clientType.id } }).ensure(0, 1);
  const conflicted = new RecordEdit(third, "Fields", `[${clientType.id}]`, { owned: { answers: { positionField: "position" } } });
  await conflicted.resume(draft);
  expect(conflicted.edit.conflict.value?.fields).toEqual(["label"]);
});

test("problems name the record's fields and each list's failing rows, built or not", async () => {
  const r = await open(clientType.id);
  r.edit.set("name", "9 bad");
  const added = r.owned.answers!.add({ key: "", label: "" });
  expect(await r.save()).toBeUndefined();
  const p = r.problems();
  expect(p.record).toEqual(["name"]);
  expect(p.owned.answers).toEqual([{ id: added.id, fields: ["key", "label"] }]);
});

test("one refused child saves nothing; the rest stays pending", async () => {
  const r = await open(clientType.id);
  const answers = r.owned.answers!;
  r.edit.set("label", "Type of client");
  answers.rows.value[1]!.edit.set("label", "Limited company");
  answers.remove(answers.rows.value[2]!.id);
  // Someone else deletes that answer first, so removing it fails on the server.
  const gone = await mock.transport({ method: "DELETE", url: `Answers(${String(answers.rows.value[2]!.edit.values.value.id)})`, headers: { "if-match": "*" } });
  expect(gone.status).toBe(204);
  const result = (await r.save())!;
  expect(result.ok).toBe(false);
  expect((await rows("Fields", "id", clientType.id))[0]!.label).toBe("Client type");
  expect((await rows("Answers", "fieldId", clientType.id)).find((a) => a.id === 2)!.label).toBe("Company");
  expect(r.dirty.value).toBe(true);
  expect(r.failure.value).toBeDefined();
});

test("a new row after a removal goes after the last position, not onto it", async () => {
  const r = await open(clientType.id);
  const answers = r.owned.answers!;
  answers.remove(answers.rows.value[1]!.id);
  const added = answers.add({ key: "club", label: "Club" });
  expect(added.edit.values.value.position).toBe(6);
});

test("a 412 with no overlap takes in the newer record and sends once more", async () => {
  const r = await open(clientType.id);
  r.edit.set("label", "Type of client");
  // Someone else changes another field; the store doesn't know yet.
  await mock.transport({ method: "PATCH", url: `Fields(${clientType.id})`, headers: { "if-match": "*", "content-type": "application/json" }, body: JSON.stringify({ help: "Theirs" }) });
  const result = (await r.save())!;
  expect(result.ok).toBe(true);
  expect(sent.filter((q) => q.method === "PATCH").length).toBe(2);
  const f = (await rows("Fields", "id", clientType.id))[0]!;
  expect([f.label, f.help]).toEqual(["Type of client", "Theirs"]);
});

test("a second save while one is running does nothing", async () => {
  const r = await open(clientType.id);
  r.edit.set("label", "Type of client");
  const [a, b] = await Promise.all([r.save(), r.save()]);
  expect([a?.ok, b]).toEqual([true, undefined]);
  expect(sent.filter((q) => q.method === "PATCH").length).toBe(1);
});

test("an error on a nested insert lands on that row, not in a message", async () => {
  const pep = model.Fields.find((f) => f.name === "pepRole")!;
  const root = model.Clauses.find((c) => c.fieldId === pep.id && c.parentClauseId === null)!;
  // The server refuses the nested condition's value.
  const refusing = async (q: ODataRequest) =>
    q.method === "PATCH"
      ? { status: 400, headers: {}, body: JSON.stringify({ error: { code: "ValidationFailed", message: "1 value was refused", details: [{ code: "Pattern", target: "clauses[0]/children[0]/value", message: "Not a known answer." }] } }) }
      : mock.transport(q);
  const refused = await DataContext.connect(refusing);
  await refused.collection({ set: "Fields", filter: { op: "eq", field: "id", value: pep.id } }).ensure(0, 1);
  const r = new RecordEdit(refused, "Fields", `[${pep.id}]`, { owned: { answers: { positionField: "position" } } });
  await r.ready;
  const group = r.owned.clauses!.add({ category: "visibility", op: "or", position: 9, parentClauseId: root.id });
  const leaf = r.owned.clauses!.add({ category: "visibility", op: "eq", fieldRef: clientType.id, value: "trust", position: 1, parentClauseId: null }, { parentClauseId: group.id });
  const result = (await r.save())!;
  expect(result.ok).toBe(false);
  expect(leaf.edit.errors.value.value).toEqual(["Not a known answer."]);
  expect(r.failure.value).toBeUndefined();
});
