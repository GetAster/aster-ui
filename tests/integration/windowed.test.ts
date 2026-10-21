// M4: a collection shown through `view` loads a page ahead, keeps a bounded
// window of pages, and refreshes only what's in view.
import { effect } from "@preact/signals-core";
import { beforeEach, expect, test } from "bun:test";
import { DataContext, Selection, type Collection, type ODataRequest } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

let mock: MockService;
let ctx: DataContext;
let skips: number[];

beforeEach(async () => {
  mock = await createMockService({ metadata, data, now: () => "2026-10-07T15:20:00Z" });
  skips = [];
  ctx = await DataContext.connect(async (r: ODataRequest) => {
    const skip = /\$skip=(\d+)/.exec(r.url)?.[1];
    if (r.url.includes("Tasks?")) skips.push(Number(skip ?? 0));
    return mock.transport(r);
  });
});

const tasks = () => ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 100, keepPages: 3 });
const loadedPages = (keys: readonly unknown[]) =>
  [...new Set(keys.flatMap((k, i) => (k === undefined ? [] : [Math.floor(i / 100)])))].sort((a, b) => a - b);
/** Until the collection's requests, the page ahead's too, have answered and been applied. */
const settle = async (c: Collection) => {
  while (c.status.peek() === "loading") await Bun.sleep(5);
};

test("a full protected page budget does not prefetch pages it must immediately evict", async () => {
  const c = ctx.collection({ set: "Tasks", orderBy: [{ field: "id" }] }, { pageSize: 100, keepPages: 2 });
  await c.view(0, 150);
  await settle(c);
  expect(loadedPages(c.keys.value)).toEqual([0, 1]);
  skips = [];
  await c.view(0, 150);
  await settle(c);
  expect(skips).toEqual([]);
  await c.view(200, 220, [0]);
  await settle(c);
  expect(loadedPages(c.keys.value)).toEqual([0, 2]);
  skips = [];
  await c.view(200, 220, [0]);
  await settle(c);
  expect(skips).toEqual([]);
  ctx.release(c);
  const wide = ctx.collection({ set: "Tasks" }, { pageSize: 100, keepPages: 1 });
  await wide.view(0, 150);
  const keys = wide.keys.value;
  await wide.view(0, 150);
  expect(wide.keys.value).toBe(keys);
  ctx.release(wide);
});

test("viewing loads the range and the next page in the direction of travel", async () => {
  const c = tasks();
  await c.view(0, 40);
  await settle(c);
  expect(loadedPages(c.keys.value)).toEqual([0, 1]);
  await c.view(950, 990);
  await settle(c);
  // Kept to three pages: the view's, the one ahead, and the nearest other.
  expect(loadedPages(c.keys.value)).toEqual([1, 9, 10]);
  // Scrolling back up prefetches the page above.
  skips = [];
  await c.view(520, 560);
  await settle(c);
  expect(skips).toEqual([500, 400]);
});

test("a bounded window: pages farthest from view are forgotten, the count stays", async () => {
  const c = tasks();
  const count = data.Tasks.length;
  for (const start of [0, 300, 600, 900, 1200]) {
    await c.view(start, start + 40);
    await settle(c);
  }
  expect(c.count.value).toBe(count);
  expect(c.keys.value.length).toBe(count);
  expect(loadedPages(c.keys.value)).toEqual([10, 12, 13]);
  // A forgotten range loads again when it's shown.
  await c.view(0, 40);
  await settle(c);
  expect(c.keys.value[0]).toBeDefined();
});

test("refresh reloads only the pages in view, and forgets the rest", async () => {
  const c = tasks();
  await c.view(0, 40);
  await c.view(1210, 1290);
  await settle(c);
  skips = [];
  await c.refresh();
  expect(skips).toEqual([1200]);
  expect(loadedPages(c.keys.value)).toEqual([12]);
});

test("a collection never viewed refreshes everything it loaded, as before", async () => {
  const c = tasks();
  await c.ensure(0, 250);
  skips = [];
  await c.refresh();
  // The three loaded pages are adjacent, so they come back in one request.
  expect(skips).toEqual([0]);
  expect(c.keys.value.slice(0, 250).every((k) => k !== undefined)).toBe(true);
});

test("a view straddling two pages loads both in one request", async () => {
  const c = tasks();
  await c.ensure(0, 1);
  skips = [];
  await c.ensure(4_190, 4_215);
  expect(skips).toEqual([4_100]);
  expect(c.keys.value.slice(4_100, 4_300).every((k) => k !== undefined)).toBe(true);
});

test("a selected row stays selected when its page is unloaded, and drops under a new query", async () => {
  const c = tasks();
  const selection = new Selection(ctx.store, c);
  await c.view(0, 40);
  await settle(c);
  const chosen = c.keys.value[5]!;
  selection.select(chosen);
  expect(selection.key.value).toBe(chosen);
  for (const start of [300, 600, 900, 1200]) {
    await c.view(start, start + 40);
    await settle(c);
  }
  expect(c.keys.value[5]).toBeUndefined();
  expect(selection.key.value).toBe(chosen);
  // The new query's first page doesn't hold it: the fallback picks that page's first row.
  c.setQuery({ set: "Tasks", filter: { op: "gt", field: "id", value: 1000 }, orderBy: [{ field: "id", descending: true }] });
  await c.view(0, 40);
  await settle(c);
  expect(selection.key.value).toBe(c.keys.value[0]);
});


test("a retained navigation page survives eviction and refresh with ordered picks intact", async () => {
  const c = tasks();
  const sel = new Selection(ctx.store, c, { multiple: true, ordered: true, maxOrdered: 3 });
  await c.view(0, 40);
  await settle(c);
  const first = c.keys.value[5]!;
  sel.toggle(first);
  expect(sel.keys.value).toEqual([first]);
  await c.view(1210, 1250, [5]);
  await settle(c);
  const second = c.keys.value[1215]!;
  sel.toggle(second);
  expect(sel.keys.value).toEqual([first, second]);
  expect(c.keys.value[5]).toBe(first);
  expect(loadedPages(c.keys.value).length).toBeLessThanOrEqual(3);
  skips = [];
  await c.refresh();
  expect(skips).toEqual([0, 1200]);
  expect(sel.keys.value).toEqual([first, second]);
  await c.view(2510, 2550);
  await settle(c);
  expect(c.keys.value[5]).toBeUndefined();
  expect(sel.keys.value).toEqual([first, second]);
});


test("query reads react after reset and ordered picks survive sorting and projection changes", async () => {
  const c = tasks();
  await c.view(0, 40);
  await settle(c);
  const first = c.keys.value[5]!;
  const second = c.keys.value[7]!;
  const selection = new Selection(ctx.store, c, { multiple: true, ordered: true, maxOrdered: 3 });
  selection.selectAll([second, first]);
  expect(selection.keys.value).toEqual([second, first]);
  const observations: { descending: boolean | undefined; count: number | undefined; length: number }[] = [];
  const stop = effect(() => {
    observations.push({ descending: c.query.orderBy?.[0]?.descending, count: c.count.value, length: c.keys.value.length });
  });
  c.setQuery({ set: "Tasks", orderBy: [{ field: "id", descending: true }], select: ["id", "title"] });
  expect(observations.at(-1)).toEqual({ descending: true, count: undefined, length: 0 });
  await c.view(0, 40);
  await settle(c);
  expect(c.keys.value.includes(first)).toBe(false);
  expect(selection.keys.value).toEqual([second, first]);
  c.setQuery({ set: "Tasks", filter: { op: "gt", field: "id", value: 1000 } });
  await c.view(0, 40);
  expect(selection.keys.value).toEqual([]);
  stop();
});


test("a selected record that leaves a paged filter drops even when its page is evicted", async () => {
  const c = ctx.collection({ set: "Tasks", filter: { op: "eq", field: "done", value: false }, orderBy: [{ field: "id" }] }, { pageSize: 40, keepPages: 2 });
  await c.view(0, 20);
  await settle(c);
  const key = c.keys.value[0]!;
  const sel = new Selection(ctx.store, c, { multiple: true, ordered: true });
  sel.toggle(key);
  expect(sel.keys.value).toEqual([key]);
  await c.view(600, 620);
  await settle(c);
  expect(c.keys.value.includes(key)).toBe(false);
  expect(c.has(key)).toBe(true);
  await ctx.update("Tasks", key, { done: true });
  expect(c.has(key)).toBe(false);
  expect(sel.keys.value).toEqual([]);
});
