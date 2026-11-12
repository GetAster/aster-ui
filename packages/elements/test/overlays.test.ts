import { describe, expect, test } from "bun:test";
import { html } from "lit-html";
import { anchorWindow, centerWindow, clampWindow, parseWindowPlacement, resolveWindowChrome, snapEdges } from "../src/window/config.ts";
import { dialogCloseShown, dialogHeaderShown } from "../src/dialog/config.ts";
import { ariaKeyshortcuts, hasMenuIcons } from "../src/menu/config.ts";
import { closeShown, reorderIds, visibilityModeFromMultiple } from "../src/section/policy.ts";

describe("window chrome defaults", () => {
  test("an omitted chrome keeps the header, title, close button and resizer, and adds no footer or status", () => {
    expect(resolveWindowChrome({}, false)).toEqual({
      header: true, title: true, close: true, minimize: false, maximize: false, resizer: true, fold: false, footer: false, statusBar: false,
    });
  });

  test("minimize and maximize follow the managed window unless the host overrides them", () => {
    expect(resolveWindowChrome({}, true)).toMatchObject({ minimize: true, maximize: true });
    expect(resolveWindowChrome({ minimize: false, maximize: true }, true)).toMatchObject({ minimize: false, maximize: true });
    expect(resolveWindowChrome({ minimize: true, maximize: false }, false)).toMatchObject({ minimize: true, maximize: false });
  });

  test("every chrome switch accepts an explicit value", () => {
    const chrome = { header: false, title: false, close: false, minimize: false, maximize: false, resizer: false, fold: true, footer: true, statusBar: true } as const;
    expect(resolveWindowChrome(chrome, true)).toEqual({ ...chrome });
  });
});

describe("window placement", () => {
  test("a placement is copied, validated and defaults restoreMaximized and folded", () => {
    expect(parseWindowPlacement({ state: "normal", bounds: { x: 10, y: 20, width: 300, height: 400 } })).toEqual({
      state: "normal", bounds: { x: 10, y: 20, width: 300, height: 400 }, restoreMaximized: false, folded: false,
    });
    expect(parseWindowPlacement({ state: "maximized" })).toEqual({ state: "maximized", restoreMaximized: false, folded: false });
    expect(parseWindowPlacement({ state: "normal", folded: true })).toMatchObject({ folded: true });
  });

  test("invalid states and bounds are refused", () => {
    expect(() => parseWindowPlacement(undefined)).toThrow("Invalid window state");
    expect(() => parseWindowPlacement({ state: "docked" })).toThrow("Invalid window state");
    expect(() => parseWindowPlacement({ state: "normal", bounds: { x: 0, y: 0, width: 0, height: 100 } })).toThrow("Invalid window bounds");
    expect(() => parseWindowPlacement({ state: "normal", bounds: { x: Number.NaN, y: 0, width: 1, height: 1 } })).toThrow("Invalid window bounds");
  });

  test("clamping keeps the window inside the viewport, and centring splits the spare space", () => {
    const limits = { left: 8, top: 8, right: 1008, bottom: 808 };
    expect(clampWindow({ x: -50, y: 900 }, { width: 300, height: 200 }, limits)).toEqual({ x: 8, y: 608 });
    expect(clampWindow({ x: 400, y: 300 }, { width: 300, height: 200 }, limits)).toEqual({ x: 400, y: 300 });
    expect(centerWindow({ width: 300, height: 200 }, limits)).toEqual({ x: 358, y: 308 });
  });

  test("an anchor is copied with only the axes it names, and an empty one is dropped", () => {
    expect(parseWindowPlacement({ state: "normal", anchor: { x: "end", y: "start" } }).anchor).toEqual({ x: "end", y: "start" });
    expect(parseWindowPlacement({ state: "normal", anchor: { y: "end" } }).anchor).toEqual({ y: "end" });
    expect(parseWindowPlacement({ state: "normal", anchor: {} })).not.toHaveProperty("anchor");
    expect(() => parseWindowPlacement({ state: "normal", anchor: { x: "right" } as never })).toThrow("Invalid window anchor");
    expect(() => parseWindowPlacement({ state: "normal", anchor: null as never })).toThrow("Invalid window anchor");
  });

  test("anchoring puts the named axes flush against their edges and leaves the others", () => {
    const limits = { left: 8, top: 8, right: 1008, bottom: 808 };
    const size = { width: 300, height: 200 };
    expect(anchorWindow({ x: 400, y: 300 }, size, limits, { x: "high", y: "low" })).toEqual({ x: 708, y: 8 });
    expect(anchorWindow({ x: 400, y: 300 }, size, limits, { y: "high" })).toEqual({ x: 400, y: 608 });
  });

  test("snapping finds the edges within reach, nearest first, and only those a move heads toward", () => {
    const limits = { left: 8, top: 8, right: 1008, bottom: 808 };
    const size = { width: 300, height: 200 };
    expect(snapEdges({ x: 700, y: 20 }, size, limits, 16)).toEqual({ x: "high", y: "low" });
    expect(snapEdges({ x: 400, y: 300 }, size, limits, 16)).toEqual({});
    expect(snapEdges({ x: 12, y: 300 }, { width: 990, height: 200 }, limits, 16)).toEqual({ x: "low" });
    expect(snapEdges({ x: 700, y: 20 }, size, limits, 16, { x: -1, y: 0 })).toEqual({});
    expect(snapEdges({ x: 700, y: 20 }, size, limits, 16, { x: 1, y: -1 })).toEqual({ x: "high", y: "low" });
  });
});

describe("dialog chrome", () => {
  test("a header follows the title unless it is set explicitly", () => {
    expect(dialogHeaderShown(undefined, undefined)).toBe(false);
    expect(dialogHeaderShown("Invite", undefined)).toBe(true);
    expect(dialogHeaderShown("Invite", false)).toBe(false);
    expect(dialogHeaderShown(undefined, true)).toBe(true);
  });

  test("the close control is off by default and needs a header", () => {
    expect(dialogCloseShown(true, undefined)).toBe(false);
    expect(dialogCloseShown(true, false)).toBe(false);
    expect(dialogCloseShown(false, true)).toBe(false);
    expect(dialogCloseShown(true, true)).toBe(true);
  });
});

describe("menu configuration", () => {
  test("shortcut hints become aria-keyshortcuts values when the attribute can carry them", () => {
    expect(ariaKeyshortcuts("Ctrl+S")).toBe("Control+S");
    expect(ariaKeyshortcuts("⌘K")).toBe("Meta+K");
    expect(ariaKeyshortcuts("Ctrl+Shift+Enter")).toBe("Control+Shift+Enter");
    expect(ariaKeyshortcuts("Alt+ArrowDown")).toBe("Alt+ArrowDown");
    expect(ariaKeyshortcuts("F2")).toBe("F2");
    expect(ariaKeyshortcuts("Hyper+X")).toBeUndefined();
    expect(ariaKeyshortcuts("Ctrl+")).toBeUndefined();
    expect(ariaKeyshortcuts("")).toBeUndefined();
  });

  test("an icon column appears only when an item in the level has an icon", () => {
    expect(hasMenuIcons([{ label: "Open" }, { label: "Close" }])).toBe(false);
    expect(hasMenuIcons([{ label: "Open" }, { label: "Close", icon: html`<svg></svg>` }])).toBe(true);
  });
});

describe("section policy", () => {
  test("the multiple shorthand normalises into visibilityMode", () => {
    expect(visibilityModeFromMultiple(true)).toBe("multiple");
    expect(visibilityModeFromMultiple(false)).toBe("mutex");
  });

  test("a close control needs both the capability and chrome", () => {
    expect(closeShown(true, true)).toBe(true);
    expect(closeShown(true, false)).toBe(false);
    expect(closeShown(false, true)).toBe(false);
  });

  test("a reorder request moves one ID and rejects out-of-range indexes", () => {
    expect(reorderIds(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderIds(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(() => reorderIds(["a"], 0, 1)).toThrow(RangeError);
  });
});
