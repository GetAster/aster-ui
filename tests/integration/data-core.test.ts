import { beforeEach, describe, expect, test } from "bun:test";
import { effect } from "@preact/signals-core";
import {
  countBy,
  countWhere,
  DataContext,
  EditModel,
  keyFromText,
  keyText,
  subtractExact,
  sum,
  type Collection,
  type Entity,
} from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

const NOW = "2026-10-07T15:20:00Z";

let mock: MockService;
let ctx: DataContext;

beforeEach(async () => {
  mock = await createMockService({ metadata, data, now: () => NOW });
  ctx = await DataContext.connect(mock.transport);
});

const names = (c: Collection) => c.items.value.map((e) => e?.name);
const seedProjects = (data as { Projects: Entity[] }).Projects;
const seedCount = (pred: (p: Entity) => boolean) => seedProjects.filter(pred).length;

function projects(state: string, pageSize = 100): Collection {
  return ctx.collection(
    { set: "Projects", filter: { op: "eq", field: "state", value: state }, orderBy: [{ field: "name" }] },
    { pageSize },
  );
}

async function external(method: "PATCH" | "DELETE", url: string, body?: Entity) {
  const current = await mock.transport({ method: "GET", url, headers: { accept: "application/json" } });
  const etag = current.headers.etag ?? (JSON.parse(current.body)["@odata.etag"] as string);
  const res = await mock.external({
    method,
    url,
    headers: { "if-match": etag, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  expect(res.status).toBeLessThan(300);
}

describe("schema and reads", () => {
  test("connects through $metadata", () => {
    expect([...ctx.schema.sets.keys()]).toContain("Projects");
    expect(ctx.schema.set("Projects").etag).toBe(true);
  });

  test("a collection loads pages and knows the server's count", async () => {
    const active = projects("active", 10);
    await active.ensure(0, 25);
    expect(active.count.value).toBe(seedCount((p) => p.state === "active"));
    expect(active.items.value.slice(0, 30).every(Boolean)).toBe(true);
    expect(active.items.value[30]).toBeUndefined();
    const loaded = names(active).slice(0, 30) as string[];
    expect([...loaded].sort()).toEqual(loaded);
  });
});

describe("sync between collections", () => {
  test("a new record joins the collections it belongs to, and undo takes it out", async () => {
    const active = projects("active");
    await active.loadAll();
    const before = active.count.value!;
    const saved = await ctx.create("Projects", project("Untitled project"));
    expect(active.count.value).toBe(before + 1);
    expect(names(active)).toContain("Untitled project");
    const sorted = names(active) as string[];
    expect([...sorted].sort()).toEqual(sorted);

    await ctx.undo(saved);
    expect(active.count.value).toBe(before);
    expect(names(active)).not.toContain("Untitled project");
  });

  test("a state change moves a record between filtered collections", async () => {
    const active = projects("active");
    const paused = projects("paused");
    await Promise.all([active.loadAll(), paused.loadAll()]);
    const [a, p] = [active.count.value!, paused.count.value!];
    const key = keyText([1]);
    const saved = await ctx.update("Projects", key, { state: "paused" });
    expect([active.count.value, paused.count.value]).toEqual([a - 1, p + 1]);
    expect(names(paused)).toContain("Spring launch");

    await ctx.undo(saved);
    expect([active.count.value, paused.count.value]).toEqual([a, p]);
  });

  test("a partly loaded collection places a record only when its position is certain", async () => {
    const active = projects("active", 10);
    await active.ensure(0, 10);
    const count = active.count.value!;

    await ctx.create("Projects", project("!first by code point"));
    expect(active.stale.value).toBe(false);
    expect(active.items.value[0]?.name).toBe("!first by code point");
    expect(active.count.value).toBe(count + 1);

    await ctx.create("Projects", project("Mmm somewhere in the middle"));
    expect(active.stale.value).toBe(true);
    await waitFor(() => !active.stale.value);
    expect(active.count.value).toBe(count + 2);
  });
});

describe("loading alongside other collections", () => {
  test("records another collection fetches don't disturb a collection that is still loading", async () => {
    const open = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "done", value: false } }, { pageSize: 300 });
    const later = ctx.collection({ set: "Tasks", orderBy: [{ field: "id", descending: true }] }, { pageSize: 300 });
    await Promise.all([open.loadAll(), later.ensure(0, 300)]);
    expect(open.stale.value).toBe(false);
    expect(open.complete.value).toBe(true);
    expect(open.count.value).toBe((data as { Tasks: Entity[] }).Tasks.filter((t) => !t.done).length);
  });

  test("loadAll completes even when a refresh interrupts it", async () => {
    const open = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "done", value: false } }, { pageSize: 300 });
    const loading = open.loadAll();
    await Bun.sleep(0);
    void open.refresh();
    await loading;
    expect(open.complete.value).toBe(true);
  });
});

describe("edit model", () => {
  test("validates on save, clears an error once fixed, and saves only changes", async () => {
    await projects("active").loadAll();
    const edit = new EditModel(ctx, "Projects", keyText([1]));
    edit.set("name", "");
    expect(await edit.save()).toBeUndefined();
    expect(edit.errors.value.name?.[0]).toBe("Project can't be blank.");
    edit.set("name", "Spring relaunch");
    expect(edit.errors.value.name).toBeUndefined();
    expect(edit.pending("name").value).toBe(true);
    expect(edit.pending("state").value).toBe(false);
    const saved = await edit.save();
    expect(saved?.change).toMatchObject({ kind: "update", changes: { name: { from: "Spring launch", to: "Spring relaunch" } } });
    expect(edit.dirty.value).toBe(false);
  });

  test("server validation errors land on their fields", async () => {
    const edit = new EditModel(ctx, "Projects", undefined, project("x"));
    edit.set("hue", 400);
    // Bypass client validation to check the server's details reach the field.
    const errors = await ctx.create("Projects", edit.values.value).catch((e) => e.fieldErrors());
    expect(Object.keys(errors)).toContain("hue");
  });

  test("an external change to another field rebases; to the same field it conflicts", async () => {
    await projects("active").loadAll();
    const key = keyText([2]);
    const edit = new EditModel(ctx, "Projects", key);
    edit.set("name", "Brand refresh 2027");

    await external("PATCH", "Projects(2)", { behindDays: 5 });
    await ctx.reload("Projects", key, "external");
    expect(edit.conflict.value).toBeUndefined();
    expect(edit.values.value.behindDays).toBe(5);
    expect(edit.values.value.name).toBe("Brand refresh 2027");

    await external("PATCH", "Projects(2)", { name: "Brand reboot" });
    await ctx.reload("Projects", key, "external");
    expect(edit.conflict.value?.fields).toEqual(["name"]);
    edit.rebase();
    expect(edit.values.value.name).toBe("Brand refresh 2027");
    expect(await edit.save()).toBeDefined();
  });

  test("a save against a stale ETag becomes a conflict, not an overwrite", async () => {
    await projects("active").loadAll();
    const key = keyText([3]);
    const edit = new EditModel(ctx, "Projects", key);
    edit.set("name", "Billing v3");
    await external("PATCH", "Projects(3)", { name: "Billing v2.1" });
    expect(await edit.save()).toBeUndefined();
    expect(edit.conflict.value?.theirs.name).toBe("Billing v2.1");
  });
});

describe("aggregates", () => {
  test("are undefined until the collection is complete, then follow every change", async () => {
    const active = projects("active", 50);
    const onTrack = countWhere(active, { op: "eq", field: "health", value: "onTrack" });
    const budget = sum(active, "budget");
    await active.ensure(0, 50);
    expect(onTrack.value).toBeUndefined();
    await active.loadAll();

    const rows = seedProjects.filter((p) => p.state === "active");
    expect(onTrack.value).toBe(rows.filter((p) => p.health === "onTrack").length);
    const cents = rows.reduce((t, p) => t + Math.round(Number(p.budget) * 100), 0);
    expect(budget.value).toBe((cents / 100).toFixed(2));

    const saved = await ctx.update("Projects", keyText([1]), { health: "behind", behindDays: 2, budget: "100000.01" });
    expect(onTrack.value).toBe(rows.filter((p) => p.health === "onTrack").length - 1);
    const delta = Math.round((100000.01 - Number(seedProjects[0]!.budget)) * 100);
    expect(budget.value).toBe(((cents + delta) / 100).toFixed(2));
    await ctx.undo(saved);
    expect(onTrack.value).toBe(rows.filter((p) => p.health === "onTrack").length);
  });

  test("an aggregate never sees a record that has left the store", async () => {
    const active = projects("active");
    const created = countWhere(active, { op: "ge", field: "createdAt", value: "2026-10-05T00:00:00Z" });
    await active.loadAll();
    const seen: (number | undefined)[] = [];
    const stop = effect(() => void seen.push(created.value));
    const saved = await ctx.create("Projects", project("Short-lived"));
    await ctx.undo(saved);
    stop();
    expect(seen.at(-1)).toBe(seen[0]);
  });

  test("countBy groups a collection", async () => {
    const open = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "done", value: false } }, { pageSize: 500 });
    const byProject = countBy(open, "projectId");
    await open.loadAll();
    const tasks = (data as { Tasks: Entity[] }).Tasks;
    expect(byProject.value?.get(1)).toBe(tasks.filter((t) => t.projectId === 1 && !t.done).length);
  });

  test("exact sums and differences", () => {
    expect(subtractExact("10.5", "0.75")).toBe("9.75");
    expect(subtractExact("1", "1.01")).toBe("-0.01");
    expect(subtractExact("9007199254740993", "1")).toBe("9007199254740992");
  });
});

describe("lookup", () => {
  test("fetches missing records once, in one request per set", async () => {
    const requests: string[] = [];
    const counted = await DataContext.connect(async (r) => {
      requests.push(r.url);
      return mock.transport(r);
    });
    const ada = counted.lookup("People", keyText([1]));
    const grace = counted.lookup("People", keyText([2]));
    counted.lookup("People", keyText([1]));
    expect(ada.value).toBeUndefined();
    await waitFor(() => grace.value !== undefined);
    expect([ada.value?.name, grace.value?.name]).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(requests.filter((u) => u.startsWith("People"))).toHaveLength(1);
    counted.lookup("People", keyText([2]));
    await Bun.sleep(0);
    expect(requests.filter((u) => u.startsWith("People"))).toHaveLength(1);
  });
});

describe("rules", () => {
  const member = (rules: ConstructorParameters<typeof EditModel>[4]) =>
    new EditModel(ctx, "Members", undefined, { name: "", role: "view" }, rules);

  test("a rule's message wins, follows the value, and clears as soon as it's fixed", async () => {
    const taken = new Set(["ada lovelace"]);
    const edit = member({
      rules: [
        (v) => ({
          name: !String(v.name ?? "").trim()
            ? "Type a name or an email address, then press Invite."
            : taken.has(String(v.name).toLowerCase())
              ? `${v.name} already has access.`
              : undefined,
        }),
      ],
    });
    expect(edit.validate()).toBe(false);
    expect(edit.errors.value.name).toEqual(["Type a name or an email address, then press Invite."]);
    edit.set("name", "Ada Lovelace");
    expect(edit.errors.value.name).toEqual(["Ada Lovelace already has access."]);
    expect(edit.validate()).toBe(false);
    edit.set("name", "Donald Knuth");
    expect(edit.errors.value.name).toBeUndefined();
    expect(await edit.save()).toBeDefined();
  });
});

describe("M1 review fixes", () => {
  test("a $select collection never blanks fields that other views hold", async () => {
    await projects("active").loadAll();
    const key = keyText([1]);
    const full = ctx.store.get("Projects", key)!.entity;
    await ctx.collection({ set: "Projects", select: ["id", "name"], orderBy: [{ field: "name" }] }).loadAll();
    const after = ctx.store.get("Projects", key)!;
    expect(after.entity).toEqual(full);
    expect(after.known).toBeUndefined();
  });

  test("a newer partial record makes a collection that reads its missing fields refresh", async () => {
    const active = projects("active");
    await active.loadAll();
    const name = ctx.store.get("Projects", keyText([1]))!.entity.name;
    const slim = ctx.collection({ set: "Projects", select: ["id", "name"], orderBy: [{ field: "name" }] });
    await slim.loadAll();
    await external("PATCH", "Projects(1)", { state: "paused" });
    await slim.refresh();
    expect(ctx.store.get("Projects", keyText([1]))!.known?.has("state")).toBe(false);
    await waitFor(() => !active.stale.value && !names(active).includes(name));
  });

  test("undo doesn't overwrite a change someone made since", async () => {
    const key = keyText([4]);
    await ctx.reload("Projects", key);
    const saved = await ctx.update("Projects", key, { name: "Onboarding emails v2" });
    await external("PATCH", "Projects(4)", { name: "Onboarding flows" });
    await ctx.reload("Projects", key, "external");
    await expect(ctx.undo(saved)).rejects.toMatchObject({ status: 412 });
    expect(ctx.store.get("Projects", key)!.entity.name).toBe("Onboarding flows");
  });

  test("a save that meets a change to other fields rebases and goes through", async () => {
    await projects("active").loadAll();
    const key = keyText([5]);
    const edit = new EditModel(ctx, "Projects", key);
    edit.set("name", "Help centre 2");
    await external("PATCH", "Projects(5)", { behindDays: 9 });
    const saved = await edit.save();
    expect(saved?.record.entity).toMatchObject({ name: "Help centre 2", behindDays: 9 });
    expect(edit.formError.value).toBeUndefined();
    expect(edit.dirty.value).toBe(false);
  });

  test("an edit model learns that its record was deleted and refuses to save", async () => {
    const created = await ctx.create("Projects", project("Short-lived"));
    const edit = new EditModel(ctx, "Projects", created.key);
    edit.set("name", "Short-lived, renamed");
    await external("DELETE", `Projects(${keyFromText(created.key)[0]})`);
    await ctx.reload("Projects", created.key, "external");
    expect(edit.deleted.value).toBe(true);
    expect(await edit.save()).toBeUndefined();
    expect(edit.formError.value).toContain("deleted");
  });

  test("a failed refresh leaves the collection stale with an error, and nothing unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const active = projects("active", 10);
      await active.ensure(0, 10);
      mock.faults.failNext(503, { code: "ServiceUnavailable", message: "Busy" });
      ctx.store.put("Projects", { entity: { ...project("Mmm somewhere in the middle"), id: 99_999 } }, { kind: "external" });
      await waitFor(() => active.status.value === "error");
      await Bun.sleep(10);
      expect(active.stale.value).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

function project(name: string): Entity {
  return { name, leadId: 1, state: "active", health: "notStarted", budget: "1000.00", spent: "0.00", pinned: false, hue: 45 };
}

async function waitFor(done: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("groups ($apply)", () => {
  test("counts and totals per group in one request, and recounts after a change", async () => {
    const groups = ctx.groups({ set: "Projects", filter: { op: "ne", field: "state", value: "archived" } }, "health", [
      { field: "budget", method: "sum", as: "budget" },
    ]);
    await waitFor(() => groups.rows.value !== undefined);
    const live = seedProjects.filter((p) => p.state !== "archived");
    const expected = [...new Set(live.map((p) => p.health as string))].sort();
    expect(groups.rows.value!.map((g) => g.value)).toEqual(expected);
    const behind = groups.rows.value!.find((g) => g.value === "behind")!;
    expect(behind.count).toBe(live.filter((p) => p.health === "behind").length);
    expect(String(behind.totals.budget)).toMatch(/^\d+(\.\d+)?$/);

    await projects("active").loadAll();
    const onTrack = live.find((p) => p.health === "onTrack")!;
    await ctx.update("Projects", keyText([onTrack.id!]), { health: "behind", behindDays: 2 });
    await waitFor(() => groups.rows.value!.find((g) => g.value === "behind")!.count === behind.count + 1);
    groups.dispose();
  });
});

describe("collections side by side", () => {
  test("records another query fetches don't make a partly loaded collection refetch", async () => {
    const all = ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 50 });
    await all.ensure(0, 50);
    const requests: string[] = [];
    const transport = mock.transport;
    const counting = await DataContext.connect(async (r) => (requests.push(r.url), transport(r)));
    const big = counting.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 50 });
    await big.ensure(0, 50);
    requests.length = 0;
    const one = counting.collection({ set: "Tasks", filter: { op: "eq", field: "projectId", value: 7 } }, { pageSize: 500 });
    await one.loadAll();
    await Bun.sleep(20);
    expect(requests.filter((u) => !u.includes("projectId"))).toEqual([]);
    expect(big.stale.value).toBe(false);
  });

  test("many uncertain changes at once share one refresh", async () => {
    const requests: string[] = [];
    const transport = mock.transport;
    const counting = await DataContext.connect(async (r) => (requests.push(r.url), transport(r)));
    const partly = counting.collection({ set: "Projects", orderBy: [{ field: "name" }] }, { pageSize: 10 });
    await partly.ensure(0, 10);
    requests.length = 0;
    counting.store.putAll(
      "Projects",
      [1, 2, 3, 4, 5].map((i) => ({ entity: { ...project(`Mmm ${i}`), id: 90_000 + i } })),
      { kind: "external" },
    );
    await waitFor(() => !partly.stale.value);
    expect(requests.filter((u) => u.startsWith("Projects?")).length).toBe(1);
  });
});
