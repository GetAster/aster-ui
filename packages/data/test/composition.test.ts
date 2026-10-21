import { expect, test } from "bun:test";
import { signal } from "@preact/signals-core";
import { Lifetime, PageScope, command, valuesPublication } from "../src/index.ts";

test("lifetime releases owned work in reverse order, once, including late resources", () => {
  const owner = new Lifetime(); const released: number[] = [];
  owner.defer(() => { released.push(1); });
  owner.own({ dispose() { released.push(2); } });
  owner.dispose(); owner.dispose();
  owner.defer(() => { released.push(3); });
  expect(owner.signal.aborted).toBe(true);
  expect(released).toEqual([2, 1, 3]);
});

test("failed cleanup does not prevent the remaining owned resources releasing", () => {
  const owner = new Lifetime(); let released = false;
  owner.defer(() => { released = true; }); owner.defer(() => { throw new Error("vendor failed"); });
  expect(() => owner.dispose()).toThrow(AggregateError); expect(released).toBe(true);
  owner.dispose();
});

test("command refuses direct unavailable calls and coalesces concurrent callers", async () => {
  const available = signal(false); let calls = 0; let complete!: (value: number) => void;
  const action = command({ label: "Save", enabled: () => available.value, run: () => { calls++; return new Promise<number>(resolve => { complete = resolve; }); } });
  await expect(action.execute()).rejects.toThrow("unavailable"); expect(calls).toBe(0);
  available.value = true;
  const first = action.execute(); const second = action.execute();
  expect(first).toBe(second); expect(action.busy.value).toBe(true); expect(action.enabled.value).toBe(false);
  await Promise.resolve(); complete(42);
  expect(await first).toBe(42); expect(action.result.value).toBe(42); expect(calls).toBe(1);
  action.dispose(); await expect(action.execute()).rejects.toThrow("closed");
});

test("failed commands keep their error, allow retry and abort owned async work", async () => {
  let fail = true; let aborted = false;
  const action = command({ label: "Save", run: async signal => {
    signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    if (fail) throw new Error("Save failed"); return "saved";
  } });
  await expect(action.execute()).rejects.toThrow("Save failed"); expect(action.error.value).toBeInstanceOf(Error);
  fail = false; expect(await action.execute()).toBe("saved"); expect(action.error.value).toBeUndefined();
  action.dispose(); expect(aborted).toBe(true);
});

test("disposing a pending command aborts its signal and ignores late results", async () => {
  let resolve!: (value: string) => void; let signal!: AbortSignal;
  const action = command({ label: "Load", run: s => { signal = s; return new Promise<string>(r => { resolve = r; }); } });
  const pending = action.execute(); await Promise.resolve(); action.dispose();
  expect(signal.aborted).toBe(true); resolve("too late"); await pending;
  expect(action.result.value).toBeUndefined(); expect(action.enabled.value).toBe(false);
});

test("missing lazy state cannot satisfy a negated availability condition", () => {
  const scope = new PageScope();
  const rule = { op: "not" as const, arg: "details.busy" };
  const available = scope.available(rule);
  const state = scope.state("commands.save", { enabled: rule }, { availability: true });
  expect(available.value).toBe(false);
  expect(state.value.enabled).toBe(false);
  expect(scope.explain("commands.save")[0]?.unknown).toEqual(["details.busy"]);
  const busy = signal<boolean | undefined>(undefined);
  const withdraw = scope.publish("details", valuesPublication({ busy }));
  expect(available.value).toBe(false);
  busy.value = false; expect(available.value).toBe(true);
  busy.value = true; expect(available.value).toBe(false);
  withdraw(); expect(available.value).toBe(false);
});

test("instance scopes isolate editor state, inherit context and diagnose invalid paths", () => {
  const root = new PageScope(); root.publish("user", valuesPublication({ allowed: signal(true) }));
  const first = root.child(); const second = root.child(); const dirty = signal(true);
  first.publish("editor", valuesPublication({ dirty })); second.publish("editor", valuesPublication({ dirty: signal(false) }));
  expect(first.available("editor.dirty").value).toBe(true); expect(second.available("editor.dirty").value).toBe(false);
  expect(first.available("user.allowed").value).toBe(true);
  expect(first.checkRule("editor.typo")[0]).toContain("typo");
});
