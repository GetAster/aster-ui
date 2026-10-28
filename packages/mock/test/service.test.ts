import { expect, test } from "bun:test";
import { createMockService, type ChangeEvent, type Dump, type MockStorage } from "../src/index.ts";
import { get, json, metadata, send, seed, service } from "./helpers.ts";

test("failNext fails one transport request and leaves state alone", async () => {
  const s = await service();
  s.faults.failNext(503, { code: "Unavailable", message: "Try later." });
  const failed = await send(s, "PATCH", "Projects(1)", { name: "x" }, { "If-Match": "*" });
  expect(failed.status).toBe(503);
  expect(json(failed).error).toEqual({ code: "Unavailable", message: "Try later." });
  expect(json(await get(s, "Projects(1)")).name).toBe("Spring launch");
  expect((await get(s, "Projects(1)")).status).toBe(200);
});

test("latency delays the transport but not external writes", async () => {
  const s = await service();
  // Wide apart, so a loaded machine can't blur them.
  s.faults.latencyMs = 600;
  const t0 = performance.now();
  await get(s, "People?$top=1");
  expect(performance.now() - t0).toBeGreaterThanOrEqual(590);
  const t1 = performance.now();
  await s.external({ method: "PATCH", url: "People(1)", body: JSON.stringify({ hue: 5 }) });
  expect(performance.now() - t1).toBeLessThan(400);
});

test("external writes change the ETag, bypass faults and notify", async () => {
  const s = await service();
  const changes: ChangeEvent[] = [];
  const off = s.onChange((c) => changes.push(c));
  const before = (await get(s, "Projects(3)")).headers.etag!;
  s.faults.failNext(500);
  const r = await s.external({
    method: "PATCH",
    url: "Projects(3)",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: "Billing v3" }),
  });
  expect(r.status).toBe(204);
  expect(r.headers.etag).not.toBe(before);
  // The pending fault is still queued for the transport.
  expect((await get(s, "Projects(3)")).status).toBe(500);

  const stale = await send(s, "PATCH", "Projects(3)", { name: "mine" }, { "If-Match": before });
  expect(stale.status).toBe(412);

  await send(s, "POST", "Notes", { body: "hi", authorId: 1, pinned: false });
  await send(s, "DELETE", "Notes(2)", undefined, { "If-Match": "*" });
  await get(s, "Notes");
  off();
  await send(s, "PATCH", "Notes(1)", { pinned: false }, { "If-Match": "*" });
  expect(changes).toEqual([
    { set: "Projects", key: "3", kind: "update", external: true },
    { set: "Notes", key: "2", kind: "create", external: false },
    { set: "Notes", key: "2", kind: "delete", external: false },
  ]);
});

test("failed writes don't notify", async () => {
  const s = await service();
  let n = 0;
  s.onChange(() => n++);
  await send(s, "PATCH", "Projects(1)", { name: "x" });
  await send(s, "POST", "People", { name: "" });
  expect(n).toBe(0);
});

test("dump and reset", async () => {
  const s = await service();
  await send(s, "PATCH", "Projects(1)", { name: "Changed" }, { "If-Match": "*" });
  const dump = s.dump();
  expect(dump.data.Projects).toHaveLength(200);
  expect((dump.data.Projects![0] as { name: string }).name).toBe("Changed");
  expect(dump.data.Tasks).toHaveLength(seed.Tasks!.length);

  const s0 = await service();
  await s.reset();
  const r = await get(s, "Projects(1)");
  expect(json(r).name).toBe("Spring launch");
  expect(r.headers.etag).toBe((await get(s0, "Projects(1)")).headers.etag!);
});

test("storage replaces the seed; writes close together share one save", async () => {
  let saved: Dump | undefined;
  let saves = 0;
  const storage: MockStorage = {
    load: async () => saved,
    save: async (d) => {
      saved = d;
      saves++;
    },
  };
  const a = await service({ storage, saveDelayMs: 5 });
  expect(saves).toBe(0);
  await send(a, "PATCH", "Projects(1)", { name: "Persisted" }, { "If-Match": "*" });
  await send(a, "PATCH", "Projects(2)", { name: "Also persisted" }, { "If-Match": "*" });
  await a.flush();
  expect(saves).toBe(1);

  const etag = (await get(a, "Projects(1)")).headers.etag;
  const b = await createMockService({ metadata, data: seed, storage });
  const r = await get(b, "Projects(1)");
  expect(json(r).name).toBe("Persisted");
  expect(r.headers.etag).toBe(etag!);
  await b.reset();
  expect(saves).toBe(2);
  expect(json(await get(b, "Projects(1)")).name).toBe("Spring launch");
});

test("a failed save fails that flush only; the next write saves everything", async () => {
  let saved: Dump | undefined;
  let fail = true;
  const storage: MockStorage = {
    load: async () => undefined,
    save: async (d) => {
      if (fail) throw new Error("disk full");
      saved = d;
    },
  };
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const a = await service({ storage, saveDelayMs: 5 });
    await send(a, "PATCH", "Projects(1)", { name: "Lost for now" }, { "If-Match": "*" });
    // Nothing waits for this save; its rejection must not go unhandled.
    await Bun.sleep(30);
    await expect(a.flush()).rejects.toThrow("disk full");
    fail = false;
    await send(a, "PATCH", "Projects(2)", { name: "Then saved" }, { "If-Match": "*" });
    await a.flush();
    const names = (saved!.data.Projects as { id: number; name: string }[]).filter((p) => p.id <= 2).map((p) => p.name);
    expect(names).toEqual(["Lost for now", "Then saved"]);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("restored revisions reject pre-save ETags and old data-only dumps still load", async () => {
  const a = await service();
  const stale = (await get(a, "Projects(1)")).headers.etag!;
  await send(a, "PATCH", "Projects(1)", { name: 'Persisted revision' }, { "If-Match": stale });
  const saved = a.dump();
  expect(JSON.stringify(saved.data)).not.toContain('__aster_mock_revision');
  const storage: MockStorage = { load: async () => saved, save: async () => {} };
  const b = await service({ storage });
  expect((await send(b, "PATCH", "Projects(1)", { name: 'Stale write' }, { "If-Match": stale })).status).toBe(412);
  const oldStorage: MockStorage = { load: async () => ({ data: saved.data }), save: async () => {} };
  const c = await service({ storage: oldStorage });
  expect(json(await get(c, "Projects(1)")).name).toBe('Persisted revision');
});

test("count thresholds do not affect exact engine counts without explicit simulation", async () => {
  const schema = structuredClone(metadata) as any;
  schema.AsterDemo.Container.People['@AsterData.CountThreshold'] = 1;
  const s = await createMockService({ metadata: schema, data: seed });
  const result = json(await get(s, 'People?$count=true&$top=1'));
  expect(result['@odata.count']).toBe(seed.People!.length);
  expect(result['@AsterData.CountEstimated']).toBeUndefined();
});

test("simulation accepts underestimates and rejects invalid factors", async () => {
  const s = await service({ countEstimate: 0.5 });
  const result = json(await get(s, 'People?$count=true&$top=1'));
  expect(result['@odata.count']).toBe(Math.ceil(seed.People!.length / 2));
  expect(result['@AsterData.CountEstimated']).toBe(true);
  for (const factor of [0, -1, NaN, Infinity]) {
    await expect(service({ countEstimate: factor })).rejects.toThrow('positive finite');
  }
});
