import { expect, test } from "bun:test";
import type { ChangeEvent } from "../src/index.ts";
import { get, json, NOW, send, service } from "./helpers.ts";

const project = {
  name: "Mock project",
  leadId: 1,
  state: "active",
  health: "notStarted",
  budget: "100.00",
  spent: "0",
  pinned: false,
  hue: 10,
};

const ETAG = /^W\/"[0-9a-f]{16}"$/;

test("create, patch, put and delete with ETags", async () => {
  const s = await service();
  const created = await send(s, "POST", "Projects", project);
  expect(created.status).toBe(201);
  expect(created.headers.location).toBe("http://localhost/odata/Projects(201)");
  const etag = created.headers.etag!;
  expect(etag).toMatch(ETAG);
  expect(json(created)["@odata.etag"]).toBe(etag);
  expect(json(created).createdAt).toBe(NOW);

  const patched = await send(s, "PATCH", "Projects(201)", { name: "Renamed" }, { "If-Match": etag });
  expect(patched.status).toBe(204);
  expect(patched.headers.etag).toMatch(ETAG);
  expect(patched.headers.etag).not.toBe(etag);
  const read = await get(s, "Projects(201)");
  expect(json(read).name).toBe("Renamed");
  expect(read.headers.etag).toBe(patched.headers.etag!);

  const put = await send(s, "PUT", "Projects(201)", project, { "If-Match": "*" });
  expect(put.status).toBe(204);
  expect(json(await get(s, "Projects(201)")).name).toBe("Mock project");

  expect((await send(s, "DELETE", "Projects(201)", undefined, { "If-Match": "*" })).status).toBe(204);
  expect((await get(s, "Projects(201)")).status).toBe(404);
});

test("428 without If-Match, 412 with a stale one", async () => {
  const s = await service();
  const current = (await get(s, "Projects(1)")).headers.etag;
  const none = await send(s, "PATCH", "Projects(1)", { name: "x" });
  expect(none.status).toBe(428);
  expect(json(none).error.code).toBe("PreconditionRequired");
  const stale = await send(s, "PATCH", "Projects(1)", { name: "x" }, { "If-Match": 'W/"9"' });
  expect(stale.status).toBe(412);
  expect(stale.headers.etag).toBe(current!);
  expect(json(await get(s, "Projects(1)")).name).toBe("Spring launch");
});

test("validation failures list every detail", async () => {
  const s = await service();
  const r = await send(s, "POST", "People", { name: "", email: "bad", hue: 400 });
  expect(r.status).toBe(400);
  const error = json(r).error;
  expect(error.code).toBe("ValidationFailed");
  const codes = error.details.map((d: { code: string; target: string }) => `${d.target}:${d.code}`);
  expect(codes).toEqual(["name:TooShort", "email:Pattern", "hue:Range"]);
  expect(error.details[0].params).toEqual({ min: 1 });
  expect(error.details[2].params).toEqual({ min: 0, max: 359 });
  // Messages name the field by its label (D5: shown as the server says them).
  expect(error.details.map((d: { message: string }) => d.message)).toEqual([
    "Name must be at least 1 character",
    "Email does not match the required pattern",
    "Colour must be between 0 and 359",
  ]);

  const state = await send(s, "PATCH", "Projects(1)", { state: "gone" }, { "If-Match": "*" });
  expect(json(state).error.details[0]).toMatchObject({ code: "NotAllowed", target: "state" });
});

test("a computed or immutable value is refused unless it's unchanged (D7)", async () => {
  const s = await service();
  const r = await send(s, "PATCH", "Projects(1)", { createdAt: "2000-01-01T00:00:00Z" }, { "If-Match": "*" });
  expect(json(r).error.details).toMatchObject([{ code: "ReadOnly", target: "createdAt" }]);
  const same = json(await get(s, "Projects(1)")).createdAt;
  expect((await send(s, "PATCH", "Projects(1)", { createdAt: same, pinned: true }, { "If-Match": "*" })).status).toBe(204);
});

test("a patch bumps the concurrency timestamp", async () => {
  const s = await service({ now: () => "2026-10-16T08:30:00Z" });
  await send(s, "PATCH", "Projects(2)", { pinned: true }, { "If-Match": "*" });
  expect(json(await get(s, "Projects(2)")).updatedAt).toBe("2026-10-16T08:30:00Z");
});

test("deep insert and deep update through an owned navigation", async () => {
  const s = await service();
  const changes: ChangeEvent[] = [];
  s.onChange((c) => changes.push(c));
  const field = { name: "colour", label: "Colour", kind: "choice", required: false, position: 1 };
  const created = await send(s, "POST", "Fields?$expand=answers", {
    ...field,
    answers: [
      { key: "red", label: "Red", position: 1 },
      { key: "blue", label: "Blue", position: 2 },
    ],
  });
  expect(created.status).toBe(201);
  const id = json(created).id as number;
  const [red, blue] = json(created).answers as { id: number }[];
  expect(changes.map((c) => `${c.set}(${c.key}) ${c.kind}`)).toEqual([
    `Fields(${id}) create`,
    `Answers(${red!.id}) create`,
    `Answers(${blue!.id}) create`,
  ]);

  changes.length = 0;
  const patched = await send(
    s,
    "PATCH",
    `Fields(${id})`,
    {
      "answers@delta": [
        { id: red!.id, label: "Rouge" },
        { key: "green", label: "Green", position: 3 },
        { "@removed": { reason: "deleted" }, "@id": `Answers(${blue!.id})` },
      ],
    },
    { "If-Match": created.headers.etag! },
  );
  expect(patched.status).toBe(204);
  const labels = json(await get(s, `Answers?$filter=fieldId eq ${id}&$orderby=position`)).value.map((a: { label: string }) => a.label);
  expect(labels).toEqual(["Rouge", "Green"]);
  expect(changes.map((c) => `${c.set} ${c.kind}`)).toEqual(["Answers update", "Answers create", "Answers delete"]);

  // Nested writes need an owned navigation.
  expect((await send(s, "POST", "Projects", { ...project, tasks: [{ title: "t" }] })).status).toBe(501);
});

test("$batch runs an atomicity group as one transaction", async () => {
  const s = await service();
  const changes: ChangeEvent[] = [];
  s.onChange((c) => changes.push(c));
  const batch = (requests: unknown[]) => send(s, "POST", "$batch", { requests }, { "content-type": "application/json" });
  const failed = await batch([
    { id: "1", atomicityGroup: "g", method: "PATCH", url: "Projects(1)", headers: { "if-match": "*" }, body: { name: "Grouped" } },
    { id: "2", atomicityGroup: "g", method: "POST", url: "People", body: { name: "", hue: 1 } },
  ]);
  expect(failed.status).toBe(200);
  expect(json(failed).responses.map((r: { status: number }) => r.status)).toEqual([424, 400]);
  expect(json(await get(s, "Projects(1)")).name).toBe("Spring launch");
  expect(changes).toEqual([]);

  const ok = await batch([
    { id: "1", atomicityGroup: "g", method: "PATCH", url: "Projects(1)", headers: { "if-match": "*" }, body: { name: "Grouped" } },
    { id: "2", atomicityGroup: "g", method: "DELETE", url: "Notes(1)", headers: { "if-match": "*" } },
  ]);
  expect(json(ok).responses.map((r: { status: number }) => r.status)).toEqual([204, 204]);
  expect(json(await get(s, "Projects(1)")).name).toBe("Grouped");
  expect(changes).toEqual([
    { set: "Projects", key: "1", kind: "update", external: false },
    { set: "Notes", key: "1", kind: "delete", external: false },
  ]);
});
