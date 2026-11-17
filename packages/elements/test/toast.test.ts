import { describe, expect, test } from "bun:test";
import {
  resolveToaster, timesOut, toastDuration, validateToasterChrome, validateToasterFeatures, validateToasterPolicy,
  DEFAULT_ACTION_DURATION, DEFAULT_DURATION, type ToastDismissReason, type ToasterChrome, type ToasterFeature, type ToasterPolicy,
} from "../src/toast/config.ts";
import { ToastQueue, type ToastChange } from "../src/toast/queue.ts";

/** A clock the test advances; timers fire in order as time passes. */
function harness(policy: ToasterPolicy = {}, features: readonly ToasterFeature[] = [], chrome: ToasterChrome = {}) {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  let settings = resolveToaster(policy, features, chrome);
  const log: { change: ToastChange; id: string; reason?: ToastDismissReason }[] = [];
  const queue = new ToastQueue({
    clock: {
      now: () => now,
      set: (run, ms) => { timers.set(++next, { at: now + ms, run }); return next; },
      clear: (h) => void timers.delete(h as number),
    },
    settings: () => settings,
    defaults: () => ({ duration: DEFAULT_DURATION, actionDuration: DEFAULT_ACTION_DURATION }),
    changed: () => {},
    notify: (change, item, reason) => void log.push({ change, id: item.id, ...(reason ? { reason } : {}) }),
  });
  const tick = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = end;
  };
  const configure = (p: ToasterPolicy, f: readonly ToasterFeature[] = []) => { settings = resolveToaster(p, f, chrome); queue.reconfigure(); };
  return { queue, tick, log, configure, timers: () => timers.size };
}

describe("toast variants and duration", () => {
  const settings = resolveToaster({}, [], {});
  const defaults = { duration: DEFAULT_DURATION, actionDuration: DEFAULT_ACTION_DURATION };

  test("errors and loading stay until dismissed; the others time out", () => {
    expect(["info", "success", "warning", "error", "loading"].map((v) => timesOut(v as never))).toEqual([true, true, true, false, false]);
    expect(toastDuration("error", false, undefined, settings, defaults)).toBeNull();
    expect(toastDuration("loading", false, undefined, settings, defaults)).toBeNull();
  });

  test("the defaults are long enough to read, and longer with an action", () => {
    expect(toastDuration("info", false, undefined, settings, defaults)).toBe(6000);
    expect(toastDuration("success", true, undefined, settings, defaults)).toBe(10000);
  });

  test("an explicit duration wins, and null means until dismissed", () => {
    expect(toastDuration("info", false, 900, settings, defaults)).toBe(900);
    expect(toastDuration("info", false, null, settings, defaults)).toBeNull();
    expect(toastDuration("error", false, 900, settings, defaults)).toBe(900);
  });

  test("policy can only restrict: autoDismiss off keeps every toast, whatever it asks for", () => {
    const off = resolveToaster({ autoDismiss: false }, [], {});
    expect(toastDuration("info", false, 900, off, defaults)).toBeNull();
  });
});

describe("toaster configuration", () => {
  test("defaults", () => {
    const s = resolveToaster({}, [], {});
    expect(s).toMatchObject({ autoDismiss: true, dismissOnEscape: true, max: 3, block: "end", inline: "center", icon: true, dismissButton: false });
    expect([...s.hold].sort()).toEqual(["api", "focus", "hover", "modal"]);
  });

  test("features and chrome set the stack, the holds and the position; the host's own pause always holds", () => {
    const s = resolveToaster({}, [{ kind: "stack", max: 1 }, { kind: "hold", while: ["focus"] }], { position: { block: "start", inline: "end" } });
    expect(s).toMatchObject({ max: 1, block: "start", inline: "end" });
    expect([...s.hold].sort()).toEqual(["api", "focus"]);
  });

  test("unknown keys, kinds and values are refused", () => {
    expect(() => validateToasterPolicy({ autoDismis: true })).toThrow("Unknown policy key 'autoDismis'");
    expect(() => validateToasterPolicy({ autoDismiss: "no" })).toThrow("boolean");
    expect(() => validateToasterFeatures([{ kind: "sticky" }])).toThrow("Unknown toaster feature 'sticky'");
    expect(() => validateToasterFeatures([{ kind: "stack", max: 0 }])).toThrow("positive integer");
    expect(() => validateToasterFeatures([{ kind: "stack" }, { kind: "stack" }])).toThrow("once each");
    expect(() => validateToasterFeatures([{ kind: "hold", while: ["touch"] }])).toThrow("hover");
    expect(() => validateToasterChrome({ position: { block: "top" } })).toThrow('"start", "end"');
    expect(() => validateToasterChrome({ position: { inline: "left" } })).toThrow("center");
    expect(() => validateToasterChrome({ dock: true })).toThrow("Unknown chrome key");
  });
});

describe("toast queue", () => {
  test("a toast times out after its duration and says why", () => {
    const h = harness();
    const id = h.queue.show("Saved");
    h.tick(5999);
    expect(h.queue.has(id)).toBe(true);
    h.tick(1);
    expect(h.queue.has(id)).toBe(false);
    expect(h.log.at(-1)).toEqual({ change: "dismissed", id, reason: "timeout" });
  });

  test("an error never times out and goes only when dismissed", () => {
    const h = harness();
    const id = h.queue.show("Could not save", { variant: "error" });
    h.tick(10 * 60_000);
    expect(h.queue.has(id)).toBe(true);
    expect(h.queue.dismiss(id, "button")).toBe(true);
    expect(h.log.at(-1)?.reason).toBe("button");
  });

  test("showing a known id updates that toast and restarts its timer", () => {
    const h = harness();
    const id = h.queue.show("Saving", { id: "save" });
    h.tick(5000);
    expect(h.queue.show("Saved", { id: "save", variant: "success" })).toBe(id);
    h.tick(5000);
    expect(h.queue.items()).toMatchObject([{ id: "save", message: "Saved", variant: "success" }]);
    h.tick(1000);
    expect(h.queue.items()).toEqual([]);
  });

  test("update patches in place; a progress-only patch does not restart the timer", () => {
    const h = harness();
    const id = h.queue.show("Exporting", { progress: 0 });
    h.tick(4000);
    h.queue.update(id, { progress: 0.4 });
    expect(h.queue.items()[0]!.progress).toBe(0.4);
    h.tick(2000);
    expect(h.queue.has(id)).toBe(false);
    const again = h.queue.show("Exporting");
    h.tick(4000);
    h.queue.update(again, { message: "Still exporting" });
    h.tick(4000);
    expect(h.queue.has(again)).toBe(true);
    expect(h.queue.update("missing", { message: "x" })).toBe(false);
  });

  test("a patch can turn a loading toast into a result that times out, and clear its progress", () => {
    const h = harness();
    const id = h.queue.show("Exporting", { variant: "loading", progress: 0.9 });
    h.tick(60_000);
    expect(h.queue.has(id)).toBe(true);
    h.queue.update(id, { message: "Exported 12 rows", variant: "success", progress: null });
    expect(h.queue.items()[0]).toMatchObject({ variant: "success", progress: undefined, duration: 6000 });
    h.tick(6000);
    expect(h.queue.has(id)).toBe(false);
  });

  test("dedupe by message reuses the showing toast and restarts it", () => {
    const h = harness();
    const first = h.queue.show("Offline", { dedupe: true });
    h.tick(5000);
    expect(h.queue.show("Offline", { dedupe: true })).toBe(first);
    expect(h.queue.items()).toHaveLength(1);
    h.tick(5000);
    expect(h.queue.has(first)).toBe(true);
    expect(h.queue.show("Offline", { dedupe: true, variant: "error" })).not.toBe(first);
    expect(h.queue.show("Offline")).not.toBe(first);
  });

  test("only maxVisible toasts show; the rest queue and start their timers when shown", () => {
    const h = harness({}, [{ kind: "stack", max: 2 }]);
    const [a, b, c] = ["A", "B", "C"].map((m) => h.queue.show(m));
    expect(h.queue.items().map((i) => i.shown)).toEqual([true, true, false]);
    h.tick(6000);
    expect(h.queue.has(a!) || h.queue.has(b!)).toBe(false);
    expect(h.queue.items()).toMatchObject([{ id: c, shown: true }]);
    h.tick(5999);
    expect(h.queue.has(c!)).toBe(true);
    h.tick(1);
    expect(h.queue.items()).toEqual([]);
  });

  test("sticky toasts hold their places and keep the queue waiting", () => {
    const h = harness({}, [{ kind: "stack", max: 1 }]);
    const err = h.queue.show("Failed", { variant: "error" });
    const note = h.queue.show("Saved");
    h.tick(60_000);
    expect(h.queue.items().map((i) => [i.id, i.shown])).toEqual([[err, true], [note, false]]);
    h.queue.dismiss(err, "api");
    expect(h.queue.items()[0]).toMatchObject({ id: note, shown: true });
  });

  test("sticky toasts take at most maxVisible - 1 places, so an Undo always finds one", () => {
    const h = harness({}, [{ kind: "stack", max: 3 }]);
    const errors = ["A", "B", "C"].map((m) => h.queue.show(m, { variant: "error" }));
    expect(h.queue.items().map((i) => i.shown)).toEqual([true, true, false]);
    const undo = h.queue.show("Moved", { action: { label: "Undo", run() {} } });
    expect(h.queue.items().find((i) => i.id === undo)?.shown).toBe(true);
    h.tick(10_000);
    expect(h.queue.has(undo)).toBe(false);
    // Dismissing a shown sticky lets the queued one in.
    h.queue.dismiss(errors[0]!, "button");
    expect(h.queue.items().map((i) => i.shown)).toEqual([true, true]);
  });

  test("a loading toast is sticky too: it cannot fill the stack either", () => {
    const h = harness({}, [{ kind: "stack", max: 2 }]);
    h.queue.show("Exporting", { variant: "loading" });
    h.queue.show("Importing", { variant: "loading" });
    const note = h.queue.show("Saved");
    expect(h.queue.items().map((i) => i.shown)).toEqual([true, false, true]);
    h.tick(6000);
    expect(h.queue.has(note)).toBe(false);
    expect(h.queue.items().map((i) => i.shown)).toEqual([true, false]);
  });

  test("with a single place the first toast keeps it, sticky or not", () => {
    const h = harness({}, [{ kind: "stack", max: 1 }]);
    h.queue.show("Failed", { variant: "error" });
    h.queue.show("Saved");
    expect(h.queue.items().map((i) => i.shown)).toEqual([true, false]);
  });

  test("any hold pauses every timer, and a released toast keeps at least two seconds", () => {
    const h = harness();
    const id = h.queue.show("Moved", { action: { label: "Undo", run() {} } });
    h.tick(9000);
    h.queue.hold("hover", true);
    h.tick(60_000);
    expect(h.queue.has(id)).toBe(true);
    h.queue.hold("hover", false);
    h.tick(1999);
    expect(h.queue.has(id)).toBe(true);
    h.tick(1);
    expect(h.queue.has(id)).toBe(false);
  });

  test("holds combine: a timer resumes only when every source has let go", () => {
    const h = harness();
    const id = h.queue.show("Saved");
    h.queue.hold("focus", true);
    h.queue.hold("modal", true);
    h.queue.hold("focus", false);
    h.tick(60_000);
    expect(h.queue.has(id)).toBe(true);
    h.queue.hold("modal", false);
    h.tick(6000);
    expect(h.queue.has(id)).toBe(false);
  });

  test("a hold the host switched off is ignored; the host's own pause is not", () => {
    const h = harness({}, [{ kind: "hold", while: ["focus"] }]);
    const id = h.queue.show("Saved");
    h.queue.hold("hover", true);
    expect(h.queue.held).toBe(false);
    h.tick(6000);
    expect(h.queue.has(id)).toBe(false);
    h.queue.show("Again");
    h.queue.hold("api", true);
    expect(h.queue.held).toBe(true);
  });

  test("turning autoDismiss off stops timers that are running", () => {
    const h = harness();
    const id = h.queue.show("Saved");
    h.tick(1000);
    h.configure({ autoDismiss: false });
    h.tick(60_000);
    expect(h.queue.has(id)).toBe(true);
    expect(h.timers()).toBe(0);
  });

  test("dismissal reasons reach the toast's callback once and the change log", () => {
    const h = harness();
    const seen: ToastDismissReason[] = [];
    const id = h.queue.show("Moved", { onDismiss: (r) => seen.push(r), action: { label: "Undo", run() {} } });
    h.queue.dismiss(id, "action");
    h.queue.dismiss(id, "api");
    expect(seen).toEqual(["action"]);
    expect(h.log.map((e) => e.change)).toEqual(["shown", "dismissed"]);
  });

  test("invalid input is refused", () => {
    const h = harness();
    expect(() => h.queue.show("x", { variant: "loud" as never })).toThrow("variant");
    expect(() => h.queue.show("x", { progress: 1.5 })).toThrow("progress");
    expect(() => h.queue.show("x", { duration: -1 })).toThrow("duration");
    expect(() => h.queue.show("x", { action: { label: "", run() {} } })).toThrow("action");
    expect(() => h.queue.show("x", { id: "" })).toThrow("id");
  });
});
