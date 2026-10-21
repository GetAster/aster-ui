// M5: the tree model over a self-referencing set (tasks and subtasks),
// against the mock: levels on demand, child counts, filtering with ancestors
// kept, revealing a deep node, moves, and sync across trees.
import { beforeEach, expect, test } from "bun:test";
import { computed, signal } from "@preact/signals-core";
import { DataContext, keyText, Tree, type Criteria, type TreeOptions } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import { eventually } from "./eventually.ts";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

let mock: MockService;
let ctx: DataContext;
/** Requests sent and not yet answered. */
let inflight = 0;

beforeEach(async () => {
  mock = await createMockService({ metadata, data, now: () => "2026-10-07T15:20:00Z" });
  inflight = 0;
  ctx = await DataContext.connect(async (r) => {
    inflight++;
    try {
      return await mock.transport(r);
    } finally {
      inflight--;
    }
  });
});

type Task = { id: number; projectId: number; parentId: number | null; title: string; done: boolean };
const tasks = data.Tasks as Task[];
const k = (id: number) => keyText([id]);
/**
 * Waits `ms`, then until no request is in flight: what a tree does on its
 * own (child counts, the levels it opens) has answered and been applied,
 * however fast the server is.
 */
const settle = async (ms = 60) => {
  await Bun.sleep(ms);
  for (let quiet = 0; quiet < 2; quiet = inflight === 0 ? quiet + 1 : 0) await Bun.sleep(10);
};
const backlog = (filter?: ReturnType<typeof signal<Criteria | undefined>>, more: Partial<TreeOptions> = {}) =>
  new Tree(ctx, {
    set: "Tasks",
    parentField: "parentId",
    base: computed(() => ({ op: "eq", field: "projectId", value: 4 }) as Criteria),
    orderBy: computed(() => [{ field: "id" }]),
    ...(filter ? { filter } : {}),
    ...more,
  });
const rows = (t: Tree) => t.rows.value.map((r) => [r.key === undefined ? "…" : Number(JSON.parse(r.key)[0]), r.level] as const);

const top = tasks.filter((t) => t.projectId === 4 && t.parentId === null).map((t) => t.id);
const childrenOf = (id: number) => tasks.filter((t) => t.parentId === id).map((t) => t.id);
const chain: number[] = [top[0]!];
while (childrenOf(chain.at(-1)!).length) chain.push(childrenOf(chain.at(-1)!).find((c) => tasks.find((t) => t.id === c)!.title.startsWith("Level"))!);

test("the top level loads, and child counts say which nodes are folders", async () => {
  const tree = backlog();
  await tree.level(undefined).ensure(0, 100);
  // Child counts arrive in a request of their own.
  await eventually(() => {
    expect(rows(tree)).toEqual(top.map((id) => [id, 1]));
    for (const r of tree.rows.value) {
      const id = Number(JSON.parse(r.key!)[0]);
      expect([id, r.folder]).toEqual([id, childrenOf(id).length > 0]);
    }
  });
  expect(tree.rows.value[0]).toMatchObject({ position: 1, siblings: top.length });
});

test("expanding loads a level under its parent; collapsing hides it, reopening keeps it", async () => {
  const tree = backlog();
  await tree.level(undefined).ensure(0, 100);
  await tree.expand(k(chain[0]!));
  await settle();
  const r = rows(tree);
  const at = r.findIndex(([id]) => id === chain[0]);
  expect(r[at + 1]).toEqual([childrenOf(chain[0]!)[0]!, 2]);
  expect(tree.rows.value[at]!.open).toBe(true);
  tree.collapse(k(chain[0]!));
  expect(rows(tree)).toEqual(top.map((id) => [id, 1]));
  await tree.toggle(k(chain[0]!));
  expect(rows(tree)[at + 1]).toEqual([childrenOf(chain[0]!)[0]!, 2]);
});

test("a wide level loads by page: 3,000 siblings, placeholders past the first page", async () => {
  const tree = backlog();
  await tree.level(undefined).ensure(0, 100);
  const wide = top[1]!;
  await tree.expand(k(wide));
  const under = tree.rows.value.filter((r) => r.parent === k(wide));
  expect(under.length).toBe(3000);
  expect(under[0]).toMatchObject({ level: 2, siblings: 3000 });
  expect(under.filter((r) => r.key !== undefined).length).toBeLessThanOrEqual(200);
  expect(under.at(-1)!.key).toBeUndefined();
});

test("revealing a node nine levels down opens each level and finds its row", async () => {
  const tree = backlog();
  const deepest = chain.at(-1)!;
  expect(chain.length).toBe(9);
  const index = await tree.reveal(k(deepest));
  expect(index).toBeGreaterThan(0);
  expect(tree.rows.value[index]).toMatchObject({ key: k(deepest), level: 9 });
  expect(await tree.ancestors(k(deepest))).toEqual(chain.slice(0, -1).map(k));
});

test("keep-ancestors filtering shows each match with its path, opened; strict hides it", async () => {
  const filter = signal<Criteria | undefined>(undefined);
  const tree = backlog(filter);
  // Watched, as a view watches it: open levels load when they're shown.
  const stop = tree.rows.subscribe(() => {});
  await tree.level(undefined).ensure(0, 100);
  filter.value = { op: "startswith", field: "title", value: "Level 9" };
  // The opened levels load themselves, one after another down the path.
  await eventually(() => expect(rows(tree)).toEqual(chain.map((id, i) => [id, i + 1])));

  const strict = backlog(signal<Criteria | undefined>({ op: "startswith", field: "title", value: "Level 9" }), { filterMode: "strict" });
  await strict.level(undefined).ensure(0, 100);
  expect(rows(strict)).toEqual([]);

  // Clearing the filter brings the whole top level back; the opened path stays open.
  filter.value = undefined;
  await settle(200);
  await tree.level(undefined).ensure(0, 100);
  expect(rows(tree).filter(([, level]) => level === 1).map(([id]) => id)).toEqual(top);
  expect(tree.isOpen(k(chain[0]!))).toBe(true);
  stop();
});

test("a failed search for the matches' paths is kept as the tree's error, not thrown", async () => {
  const filter = signal<Criteria | undefined>(undefined);
  const tree = backlog(filter);
  await tree.level(undefined).ensure(0, 100);
  mock.faults.failNext(503, { code: "ServiceUnavailable", message: "The server is busy." });
  filter.value = { op: "startswith", field: "title", value: "Level 9" };
  await settle(200);
  expect(tree.error.value).toBeDefined();
  expect(tree.searching.value).toBe(false);
  filter.value = { op: "startswith", field: "title", value: "Level 8" };
  await settle(200);
  expect(tree.error.value).toBeUndefined();
});

test("a filter matching more than the limit gives up and says so", async () => {
  const filter = signal<Criteria | undefined>(undefined);
  const tree = backlog(filter, { matchLimit: 500 });
  filter.value = { op: "startswith", field: "title", value: "Item" };
  await settle(300);
  expect(tree.tooBroad.value).toBe(true);
  filter.value = { op: "startswith", field: "title", value: "Item 2999" };
  await settle(300);
  expect(tree.tooBroad.value).toBe(false);
});

test("moving a node takes it out of one level and into another; a move into its own subtree is refused", async () => {
  const tree = backlog();
  await tree.level(undefined).ensure(0, 100);
  const [a, b] = [chain[0]!, top[2]!];
  await tree.expand(k(a));
  await tree.expand(k(b));
  const moving = childrenOf(a)[0]!;
  await tree.move(k(moving), k(b));
  await settle(100);
  expect(tree.level(k(a)).keys.value).not.toContain(k(moving));
  expect(tree.level(k(b)).keys.value).toContain(k(moving));
  expect(tree.rows.value.find((r) => r.key === k(moving))).toMatchObject({ parent: k(b), level: 2 });
  await expect(tree.move(k(b), k(moving))).rejects.toThrow("its own subtree");
  await expect(tree.move(k(b), k(b))).rejects.toThrow("into itself");
  // To the top level.
  await tree.move(k(moving), undefined);
  await settle(100);
  expect(tree.rows.value.find((r) => r.key === k(moving))).toMatchObject({ level: 1 });
});

test("two trees over the same data both follow an insert, an update and a delete; their open state is their own", async () => {
  const [one, two] = [backlog(), backlog()];
  for (const t of [one, two]) {
    await t.level(undefined).ensure(0, 100);
    await t.expand(k(top[2]!));
  }
  one.collapse(k(top[2]!));
  expect([one.isOpen(k(top[2]!)), two.isOpen(k(top[2]!))]).toEqual([false, true]);
  const saved = await ctx.create("Tasks", { projectId: 4, parentId: top[2]!, title: "A new step", due: null, assigneeId: null, done: false });
  await settle(100);
  expect(two.level(k(top[2]!)).keys.value).toContain(saved.key);
  expect(one.level(k(top[2]!)).keys.value).toContain(saved.key);
  await ctx.update("Tasks", saved.key, { title: "A renamed step" });
  expect(ctx.store.get("Tasks", saved.key)!.entity.title).toBe("A renamed step");
  await ctx.remove("Tasks", saved.key);
  await settle(100);
  for (const t of [one, two]) expect(t.level(k(top[2]!)).keys.value).not.toContain(saved.key);
});

test("a leaf that gains a child becomes a folder", async () => {
  const tree = backlog();
  await tree.level(undefined).ensure(0, 100);
  await settle();
  const leaf = top.find((id) => childrenOf(id).length === 0)!;
  expect(tree.rows.value.find((r) => r.key === k(leaf))!.folder).toBe(false);
  await ctx.create("Tasks", { projectId: 4, parentId: leaf, title: "First step", due: null, assigneeId: null, done: false });
  await settle(400);
  expect(tree.rows.value.find((r) => r.key === k(leaf))!.folder).toBe(true);
});

test("revealing the last of 3,000 siblings counts its place and loads only around it", async () => {
  const tree = backlog();
  const wide = top[1]!;
  const last = childrenOf(wide).at(-1)!;
  const index = await tree.reveal(k(last));
  expect(tree.rows.value[index]).toMatchObject({ key: k(last), level: 2, position: 3000, siblings: 3000 });
  const loaded = tree.level(k(wide)).keys.value.filter((x) => x !== undefined).length;
  expect(loaded).toBeLessThanOrEqual(200);
});

test("descendants lists a whole subtree, nearest first", async () => {
  const tree = backlog();
  const under = await tree.descendants(k(chain[0]!));
  const expected: number[] = [];
  let level = [chain[0]!];
  while (level.length) {
    level = level.flatMap(childrenOf);
    expected.push(...level);
  }
  expect(under.map((e) => e.id as number)).toEqual(expected);
});

test("T8: a refresh reloads what's shown and keeps the open folders open", async () => {
  const tree = backlog();
  const stop = tree.rows.subscribe(() => {});
  await tree.level(undefined).ensure(0, 100);
  await tree.expand(k(chain[0]!));
  await tree.expand(k(chain[1]!));
  await mock.external({ method: "PATCH", url: `Tasks(${chain[1]})`, headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Renamed elsewhere" }) });
  await tree.refresh();
  await settle(100);
  expect([tree.isOpen(k(chain[0]!)), tree.isOpen(k(chain[1]!))]).toEqual([true, true]);
  expect(ctx.store.get("Tasks", k(chain[1]!))!.entity.title).toBe("Renamed elsewhere");
  expect(rows(tree).map(([id]) => id)).toContain(chain[2]!);
  stop();
});

test("T21: long runs of random creates, moves and deletes keep the tree as the server says it is", async () => {
  const tree = backlog();
  const stop = tree.rows.subscribe(() => {});
  await tree.level(undefined).ensure(0, 100);
  // Open every top-level folder that isn't the 3,000-wide one, and their children's levels.
  for (const id of top.filter((id) => id !== top[1])) await tree.expand(k(id));
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const server = async () => ((await mock.dump()).data.Tasks as Task[]).filter((t) => t.projectId === 4);
  for (let step = 0; step < 30; step++) {
    const nodes = (await server()).filter((t) => t.parentId === null || tasks.find((x) => x.id === t.parentId)?.id !== top[1]);
    const pick = nodes[Math.floor(rand() * nodes.length)]!;
    const op = rand();
    if (op < 0.4) {
      await ctx.create("Tasks", { projectId: 4, parentId: rand() < 0.5 ? null : pick.id, title: `Random ${step}`, due: null, assigneeId: null, done: false });
    } else if (op < 0.75) {
      const to = nodes[Math.floor(rand() * nodes.length)]!;
      await tree.move(k(pick.id), rand() < 0.3 ? undefined : k(to.id)).catch(() => {});
    } else if (!nodes.some((n) => n.parentId === pick.id) && pick.parentId !== top[1]) {
      await ctx.reload("Tasks", k(pick.id));
      await ctx.remove("Tasks", k(pick.id));
    }
  }
  await settle(400);
  // Every open level that the tree shows holds exactly the server's children of that parent, in id order.
  const data = await server();
  const open = tree.open.value;
  for (const parent of [undefined, ...open]) {
    const level = tree.level(parent);
    await level.loadAll();
    const want = data.filter((t) => (parent === undefined ? t.parentId === null : t.parentId === JSON.parse(parent)[0])).map((t) => k(t.id)).sort((a, b) => JSON.parse(a)[0] - JSON.parse(b)[0]);
    if (parent !== undefined && JSON.parse(parent)[0] === top[1]) continue;
    expect([parent, level.keys.value]).toEqual([parent, want]);
  }
  stop();
});
