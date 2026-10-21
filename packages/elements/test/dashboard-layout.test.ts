import { describe, expect, test } from "bun:test";
import { copyLayout, type DashboardWidget } from "../src/dashboard/layout.ts";

const widget: DashboardWidget = { id: "fleet", type: "summary", title: "Fleet", width: 1, height: 2, config: { metric: "count", options: [true, null, 5, { label: "Devices" }] } };

describe("dashboard persisted configuration", () => {
  test("copies and freezes configuration without retaining caller-owned objects", () => {
    const layout = copyLayout([widget]);
    expect(layout).toEqual([widget]);
    expect(layout[0]).not.toBe(widget);
    expect(layout[0]!.config).not.toBe(widget.config);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout[0]!.config!.options)).toBe(true);
    expect(JSON.parse(JSON.stringify({ version: 1, widgets: layout }))).toEqual({ version: 1, widgets: [widget] });
  });

  test("duplicate IDs and malformed geometry are rejected before restore", () => {
    expect(() => copyLayout([widget, widget])).toThrow("unique");
    expect(() => copyLayout(new Array(2))).toThrow();
    for (const patch of [{ id: "" }, { title: " " }, { type: "" }, { width: 0 }, { height: 4 }, { height: 1.5 }]) {
      expect(() => copyLayout([{ ...widget, ...patch } as DashboardWidget])).toThrow();
    }
  });

  test("only lossless finite JSON values are accepted", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const config of [{ value: NaN }, { value: Infinity }, { value: undefined }, { value: () => {} }, { value: new Date() }, { value: new Array(2) }, { [Symbol("hidden")]: 1 }, null, cyclic, [1, 2]]) {
      expect(() => copyLayout([{ ...widget, config } as unknown as DashboardWidget])).toThrow();
    }
  });

  test("shared references are copied independently; unknown type names remain plain data", () => {
    const part = { x: 3 };
    const layout = copyLayout([{ ...widget, type: "not-installed", config: { first: part, second: part } }]);
    expect(layout[0]!.type).toBe("not-installed");
    expect(layout[0]!.config!.first).toEqual(part);
    expect(layout[0]!.config!.first).not.toBe(layout[0]!.config!.second);
  });
});
