import { describe, expect, test } from "bun:test";
import { formatFigure } from "../src/format.ts";
import {
  meterBounds, meterFill, meterState, resolveThreshold, toMeterNumber, validateMeterChrome, validateMeterLabels, validateMeterThreshold,
} from "../src/meter/config.ts";
import {
  decimalsOf, fractionOf, keyTarget, moveThumb, nearestThumb, rangeCriteria, snap, thumbBounds, tickLabelKeep, tickLabelStride, tickValues, validateSliderChrome, validateSliderTicks, valueAt,
} from "../src/slider/config.ts";

describe("meter bounds and state (the HTML meter algorithm)", () => {
  test("defaults and clamping follow the browser: low is min, high is max, optimum is the middle", () => {
    expect(meterBounds({ min: 0, max: 10 })).toEqual({ min: 0, max: 10, low: 0, high: 10, optimum: 5 });
    expect(meterBounds({ min: 0, max: 10, low: -5, high: 50, optimum: 99 })).toEqual({ min: 0, max: 10, low: 0, high: 10, optimum: 10 });
    expect(meterBounds({ min: 0, max: 10, low: 8, high: 2 })).toMatchObject({ low: 8, high: 8 });
    expect(meterBounds({ min: 5, max: 1 })).toMatchObject({ min: 5, max: 5 });
  });

  test("an optimum between the boundaries makes the middle good and both ends suboptimal", () => {
    const b = meterBounds({ min: 0, max: 100, low: 25, high: 75, optimum: 50 });
    expect([0, 24, 25, 50, 75, 76, 100].map((v) => meterState(v, b))).toEqual(["suboptimum", "suboptimum", "optimum", "optimum", "optimum", "suboptimum", "suboptimum"]);
  });

  test("an optimum in the low region makes low good, the middle suboptimal and high poor", () => {
    const b = meterBounds({ min: 0, max: 100, low: 25, high: 75, optimum: 0 });
    expect([0, 24, 25, 75, 76, 100].map((v) => meterState(v, b))).toEqual(["optimum", "optimum", "suboptimum", "suboptimum", "poor", "poor"]);
  });

  test("an optimum in the high region reverses that", () => {
    const b = meterBounds({ min: 0, max: 100, low: 25, high: 75, optimum: 100 });
    expect([0, 24, 25, 75, 76, 100].map((v) => meterState(v, b))).toEqual(["poor", "poor", "suboptimum", "suboptimum", "optimum", "optimum"]);
  });

  test("an optimum on a boundary counts as between them", () => {
    expect(meterState(50, meterBounds({ min: 0, max: 100, low: 25, high: 75, optimum: 25 }))).toBe("optimum");
    expect(meterState(10, meterBounds({ min: 0, max: 100, low: 25, high: 75, optimum: 75 }))).toBe("suboptimum");
  });

  test("a value past either end counts as at that end, and the fill is clamped", () => {
    const b = meterBounds({ min: 0, max: 100, low: 60, high: 90, optimum: 0 });
    expect(meterState(140, b)).toBe("poor");
    expect(meterFill(140, b)).toBe(1);
    expect(meterFill(-4, b)).toBe(0);
    expect(meterFill(25, b)).toBe(0.25);
    expect(meterFill(5, meterBounds({ min: 3, max: 3 }))).toBe(0);
  });

  test("spent against a budget: thresholds as shares of a limit that moves", () => {
    const state = (spent: number, budget: number) => {
      const b = meterBounds({ min: 0, max: budget, low: resolveThreshold("60%", 0, budget), high: resolveThreshold("90%", 0, budget), optimum: resolveThreshold(0, 0, budget) });
      return meterState(spent, b);
    };
    expect(state(5_000, 10_000)).toBe("optimum");
    expect(state(7_500, 10_000)).toBe("suboptimum");
    expect(state(9_500, 10_000)).toBe("poor");
    expect(state(9_500, 20_000)).toBe("optimum");
    expect(state(13_000, 20_000)).toBe("suboptimum");
    expect(state(12_400, 10_000)).toBe("poor");
  });
});

describe("meter configuration", () => {
  test("a threshold is a number or a share", () => {
    expect(validateMeterThreshold("80%", "high")).toBe("80%");
    expect(validateMeterThreshold(12.5, "high")).toBe(12.5);
    expect(validateMeterThreshold(undefined, "high")).toBeUndefined();
    expect(() => validateMeterThreshold("80", "high")).toThrow("percentage");
    expect(() => validateMeterThreshold(Number.NaN, "high")).toThrow("percentage");
    expect(resolveThreshold("25%", 10, 30)).toBe(15);
    expect(resolveThreshold(7, 10, 30)).toBe(7);
  });

  test("chrome and labels are refused when they name something unknown", () => {
    expect(validateMeterChrome({ value: "ratio", state: false })).toEqual({ value: "ratio", state: false });
    expect(validateMeterChrome({ value: false })).toEqual({ value: false });
    expect(() => validateMeterChrome({ value: "words" })).toThrow('"value", "ratio", "percent" or false');
    expect(() => validateMeterChrome({ legend: true })).toThrow("Unknown chrome key 'legend'");
    expect(() => validateMeterLabels({ good: "Fine" })).toThrow("Unknown label 'good'");
    expect(validateMeterLabels({ poor: "Over budget" })).toEqual({ poor: "Over budget" });
  });

  test("model values become numbers only when they are numeric", () => {
    expect([toMeterNumber(5), toMeterNumber("12.50"), toMeterNumber(null), toMeterNumber(""), toMeterNumber("x"), toMeterNumber(true)]).toEqual([5, 12.5, undefined, undefined, undefined, undefined]);
  });
});

describe("value labels", () => {
  test("a meter or slider says a value in a range with the shared formatter", () => {
    const range = { min: 0, max: 100 };
    expect(formatFigure(6200, undefined)).toBe("6,200");
    expect(formatFigure(6200, { style: "currency" })).toBe("£6,200");
    expect(formatFigure(41_200, { style: "currency", compact: true })).toBe("£41.2k");
    expect(formatFigure(62, { style: "percent" }, { range })).toBe("62%");
    expect(formatFigure(25, { style: "percent" }, { range: { min: 0, max: 200 } })).toBe("13%");
    expect(formatFigure(3, (v, r) => `${v}/${r.max}`, { range: { min: 0, max: 9 } })).toBe("3/9");
  });
});

describe("slider scale", () => {
  const scale = { min: 0, max: 100, step: 5 };

  test("values snap to the step grid from the minimum and stay in range", () => {
    expect([snap(12, scale), snap(13, scale), snap(-9, scale), snap(400, scale)]).toEqual([10, 15, 0, 100]);
    expect(snap(7, { min: 3, max: 20, step: 5 })).toBe(8);
    expect(snap(20, { min: 3, max: 20, step: 5 })).toBe(18);
  });

  test("decimal steps do not leak binary noise", () => {
    expect(snap(0.3, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snap(0.1 + 0.2, { min: 0, max: 1, step: 0.05 })).toBe(0.3);
    expect(decimalsOf(0.05)).toBe(2);
    expect(decimalsOf(4)).toBe(0);
    expect(decimalsOf(1e-7)).toBe(7);
  });

  test("a position along the track maps to a snapped value and back", () => {
    expect(fractionOf(25, scale)).toBe(0.25);
    expect(valueAt(0.333, scale)).toBe(35);
    expect(valueAt(2, scale)).toBe(100);
    expect(fractionOf(5, { min: 5, max: 5, step: 1 })).toBe(0);
  });
});

describe("slider keys (WAI-ARIA APG)", () => {
  const scale = { min: 0, max: 100, step: 5 };
  const room = { lower: 0, upper: 100 };
  const press = (key: string, at = 50, rtl = false, bounds = room) => keyTarget(key, at, bounds, scale, 25, rtl);

  test("arrows move by one step, Page keys by the large step, Home and End to the ends", () => {
    expect([press("ArrowRight"), press("ArrowUp"), press("ArrowLeft"), press("ArrowDown")]).toEqual([55, 55, 45, 45]);
    expect([press("PageUp"), press("PageDown"), press("Home"), press("End")]).toEqual([75, 25, 0, 100]);
  });

  test("right-to-left reverses the horizontal arrows only", () => {
    expect([press("ArrowLeft", 50, true), press("ArrowRight", 50, true), press("ArrowUp", 50, true), press("ArrowDown", 50, true)]).toEqual([55, 45, 55, 45]);
  });

  test("a key stops at the thumb's room, and other keys are not the slider's", () => {
    expect(press("ArrowRight", 100)).toBe(100);
    expect(press("PageDown", 10)).toBe(0);
    expect(press("End", 20, false, { lower: 0, upper: 60 })).toBe(60);
    expect(press("Home", 20, false, { lower: 40, upper: 100 })).toBe(40);
    expect(press("a")).toBeUndefined();
    expect(press("Enter")).toBeUndefined();
  });
});

describe("range slider", () => {
  const scale = { min: 0, max: 100, step: 5 };

  test("each thumb's room is bounded by the other, less the gap", () => {
    expect(thumbBounds(0, [20, 80], scale, 10)).toEqual({ lower: 0, upper: 70 });
    expect(thumbBounds(1, [20, 80], scale, 10)).toEqual({ lower: 30, upper: 100 });
    expect(thumbBounds(0, [50], scale, 0)).toEqual({ lower: 0, upper: 100 });
  });

  test("thumbs never cross, whatever is asked", () => {
    expect(moveThumb(0, 95, [20, 80], scale, 0)).toEqual([80, 80]);
    expect(moveThumb(1, 5, [20, 80], scale, 0)).toEqual([20, 20]);
    expect(moveThumb(0, 95, [20, 80], scale, 10)).toEqual([70, 80]);
    expect(moveThumb(1, 15, [20, 80], scale, 10)).toEqual([20, 30]);
    expect(moveThumb(0, 33, [20, 80], scale, 0)).toEqual([35, 80]);
  });

  test("a press moves the nearer thumb; level thumbs go the way of the press", () => {
    expect(nearestThumb(30, [20, 80])).toBe(0);
    expect(nearestThumb(60, [20, 80])).toBe(1);
    expect(nearestThumb(50, [20, 80])).toBe(0);
    expect(nearestThumb(90, [40, 40])).toBe(1);
    expect(nearestThumb(10, [40, 40])).toBe(0);
  });

  test("a range contributes a shared filter only when it narrows the data", () => {
    expect(rangeCriteria("price", [0, 100], scale)).toBeUndefined();
    expect(rangeCriteria("price", [20, 100], scale)).toEqual({ op: "ge", field: "price", value: 20 });
    expect(rangeCriteria("price", [0, 80], scale)).toEqual({ op: "le", field: "price", value: 80 });
    expect(rangeCriteria("price", [20, 80], scale)).toEqual({ op: "and", args: [{ op: "ge", field: "price", value: 20 }, { op: "le", field: "price", value: 80 }] });
    expect(rangeCriteria("price", [200000, 300000], { min: 0, max: 500000, step: 10000 }, true)).toEqual({ op: "and", args: [{ op: "ge", field: "price", value: "200000" }, { op: "le", field: "price", value: "300000" }] });
    // OData carries a decimal as text, and a set's criteria are checked against that.
    expect(rangeCriteria("price", [20, 80.5], { min: 0, max: 100, step: 0.5 }, true)).toEqual({ op: "and", args: [{ op: "ge", field: "price", value: "20" }, { op: "le", field: "price", value: "80.5" }] });
  });
});

describe("ticks and chrome", () => {
  const scale = { min: 0, max: 100, step: 10 };

  test("true is one per step, a number a spacing, a list exact values within the range", () => {
    expect(tickValues(true, scale)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(tickValues(25, scale)).toEqual([0, 25, 50, 75, 100]);
    expect(tickValues([90, 10, 500, -5, 10], scale)).toEqual([10, 90]);
    expect(tickValues(false, scale)).toEqual([]);
  });

  test("too many ticks are thinned rather than drawn as noise", () => {
    expect(tickValues(true, { min: 0, max: 1000, step: 1 }).length).toBeLessThanOrEqual(50);
    expect(tickValues(0.1, { min: 0, max: 1, step: 0.1 })).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  test("invalid ticks and chrome are refused", () => {
    expect(() => validateSliderTicks(0)).toThrow("ticks");
    expect(() => validateSliderTicks(["a"])).toThrow("ticks");
    expect(validateSliderTicks([1, 2])).toEqual([1, 2]);
    expect(validateSliderChrome({ input: true, tickLabels: true })).toEqual({ input: true, tickLabels: true });
    expect(() => validateSliderChrome({ input: "yes" })).toThrow("boolean");
    expect(() => validateSliderChrome({ legend: true })).toThrow("Unknown chrome key 'legend'");
  });
});

describe("tick labels never overlap", () => {
  test("a stride says how many labels apart the drawn ones must be", () => {
    expect(tickLabelStride(11, 30, 440)).toBe(1);
    expect(tickLabelStride(11, 45, 215)).toBe(3);
    expect(tickLabelStride(1, 45, 215)).toBe(1);
    expect(tickLabelStride(11, 45, 0)).toBe(1);
  });

  test("thinned labels keep the first and the last, and never two that touch", () => {
    expect(tickLabelKeep(5, 1)).toEqual([true, true, true, true, true]);
    expect(tickLabelKeep(11, 2)).toEqual([true, false, true, false, true, false, true, false, true, false, true]);
    // 0..10 by 3: the ninth label is within a stride of the last, so it gives way.
    expect(tickLabelKeep(11, 3)).toEqual([true, false, false, true, false, false, true, false, false, false, true]);
    const kept = (n: number, stride: number) => tickLabelKeep(n, stride).flatMap((k, i) => (k ? [i] : []));
    for (let n = 2; n < 40; n++) for (let stride = 1; stride < 12; stride++) {
      const at = kept(n, stride);
      expect(at[0]).toBe(0);
      expect(at.at(-1)).toBe(n - 1);
      for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(Math.min(stride, n - 1));
    }
  });
});
