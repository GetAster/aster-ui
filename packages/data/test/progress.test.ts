import { expect, test } from "bun:test";
import { signal } from "@preact/signals-core";
import { DEFAULT_PROGRESS_POLICY, ProgressState, progressPolicy, type ProgressPolicy } from "../src/index.ts";

const wait = async (done: () => boolean) => {
  for (let i = 0; i < 1000; i++) { if (done()) return; await Bun.sleep(2); }
  throw new Error("progress phase timed out");
};

test("fast work stays silent while actual busy state updates immediately", () => {
  const busy = signal(false);
  const status = new ProgressState(() => ({ busy: busy.value }));
  busy.value = true;
  expect(status.busy.value).toBe(true); expect(status.phase.value).toBe("waiting"); expect(status.visible.value).toBe(false);
  busy.value = false;
  expect(status.busy.value).toBe(false); expect(status.phase.value).toBe("idle");
  status.dispose();
});

test("visible work changes to completion without prolonging the operation", async () => {
  const busy = signal(true);
  const status = new ProgressState(() => ({ busy: busy.value }), { delayMs: 0, minVisibleMs: 80 });
  expect(status.phase.value).toBe("working");
  busy.value = false;
  expect(status.busy.value).toBe(false); expect(status.phase.value).toBe("complete"); expect(status.visible.value).toBe(true);
  await wait(() => status.phase.value === "idle");
  expect(status.visible.value).toBe(false);
  status.dispose();
});

test("overlapping work keeps one visible interval and cancels a pending hide", async () => {
  const busy = signal(true);
  const status = new ProgressState(() => ({ busy: busy.value }), { delayMs: 0, minVisibleMs: 60 });
  busy.value = false; expect(status.phase.value).toBe("complete");
  busy.value = true; expect(status.phase.value).toBe("working");
  await Bun.sleep(80);
  expect(status.phase.value).toBe("working");
  busy.value = false; expect(status.phase.value).toBe("idle");
  status.dispose();
});

test("errors interrupt waiting or minimum visibility immediately and never report success", () => {
  const busy = signal(true); const error = signal<unknown>(undefined);
  const status = new ProgressState(() => ({ busy: busy.value, error: error.value }), { delayMs: 1000, minVisibleMs: 1000 });
  error.value = new Error("Failed");
  expect(status.phase.value).toBe("error"); expect(status.error.value).toBe(error.value);
  busy.value = false; expect(status.phase.value).toBe("error");
  error.value = undefined; expect(status.phase.value).toBe("idle");
  status.dispose();
  const visible = new ProgressState(() => ({ busy: busy.value, error: error.value }), { delayMs: 0, minVisibleMs: 1000 });
  busy.value = true; busy.value = false; expect(visible.phase.value).toBe("complete");
  error.value = "Failed after completion"; expect(visible.phase.value).toBe("error");
  visible.dispose();
});

test("delay timers reveal ongoing work and cancel cleanly on quick completion", async () => {
  const busy = signal(true);
  const status = new ProgressState(() => ({ busy: busy.value }), { delayMs: 10, minVisibleMs: 0 });
  await wait(() => status.phase.value === "working");
  busy.value = false; expect(status.phase.value).toBe("idle");
  busy.value = true; busy.value = false;
  await Bun.sleep(20);
  expect(status.phase.value).toBe("idle"); status.dispose();
});

test("reactive timing changes keep the original start and fixed options are snapshotted", () => {
  const busy = signal(true);
  const policy = signal<ProgressPolicy>({ delayMs: 1000, minVisibleMs: 1000 });
  const status = new ProgressState(() => ({ busy: busy.value }), () => policy.value);
  expect(status.phase.value).toBe("waiting");
  policy.value = { delayMs: 0, minVisibleMs: 0 }; expect(status.phase.value).toBe("working");
  busy.value = false; expect(status.phase.value).toBe("idle"); status.dispose();
  const options = { delayMs: 1000 };
  const fixed = new ProgressState(() => ({ busy: busy.value }), options);
  options.delayMs = 0; busy.value = true;
  expect(fixed.phase.value).toBe("waiting"); fixed.dispose();
});

test("disposal releases subscriptions/timers and leaves source work alone", async () => {
  const busy = signal(true); let reads = 0;
  const status = new ProgressState(() => { reads++; return { busy: busy.value }; }, { delayMs: 10 });
  status.dispose(); status.dispose();
  busy.value = false; busy.value = true;
  await Bun.sleep(20);
  expect(reads).toBe(1); expect(busy.value).toBe(true); expect(status.phase.value).toBe("idle");
});

test("policy defaults are immutable and invalid timing/configuration is rejected", () => {
  expect(progressPolicy()).toEqual({ delayMs: 250, minVisibleMs: 400 });
  expect(Object.isFrozen(DEFAULT_PROGRESS_POLICY)).toBe(true);
  for (const value of [-1, 1.5, NaN, Infinity, 2_147_483_648, undefined]) expect(() => progressPolicy({ delayMs: value } as ProgressPolicy)).toThrow();
  expect(() => progressPolicy({ unknown: 1 } as ProgressPolicy)).toThrow();
  expect(() => progressPolicy([] as ProgressPolicy)).toThrow();
  expect(() => new ProgressState(() => ({ busy: "yes" as unknown as boolean }))).toThrow();
});
