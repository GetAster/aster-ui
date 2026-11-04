import { describe, expect, test } from "bun:test";
import { permits, policyPermits, type GridPolicy } from "../src/grid/policy.ts";

describe("grid policy", () => {
  test("an absent entry takes the capability's default", () => {
    expect(permits(undefined, "hours", true)).toBe(true);
    expect(permits(undefined, "hours", false)).toBe(false);
  });

  test("a boolean, an allowlist and a predicate each answer for one field", () => {
    expect(permits(false, "hours", true)).toBe(false);
    expect(permits(true, "hours", false)).toBe(true);
    expect(permits(["hours", "note"], "hours", false)).toBe(true);
    expect(permits(["hours", "note"], "date", true)).toBe(false);
    expect(permits((field) => field.startsWith("h"), "hours", false)).toBe(true);
    expect(permits((field) => field.startsWith("h"), "date", true)).toBe(false);
  });

  test("a field entry narrows the global entry and never widens it", () => {
    const policy: GridPolicy = {
      sortable: true,
      filterable: false,
      fields: {
        hours: { sortable: false, filterable: true },
        note: { sortable: ["note"] },
      },
    };
    expect(policyPermits(policy, "sortable", "hours", true)).toBe(false);
    expect(policyPermits(policy, "sortable", "date", true)).toBe(true);
    expect(policyPermits(policy, "sortable", "note", true)).toBe(true);
    expect(policyPermits(policy, "sortable", "other", true)).toBe(true);
    expect(policyPermits({ sortable: true, fields: { hours: { sortable: ["note"] } } }, "sortable", "hours", true)).toBe(false);
    // A per-field true cannot grant what the global entry refuses.
    expect(policyPermits(policy, "filterable", "hours", true)).toBe(false);
    expect(policyPermits(policy, "editable", "note", false)).toBe(false);
    expect(policyPermits({ editable: true, fields: { note: { editable: false } } }, "editable", "note", false)).toBe(false);
    expect(policyPermits({ editable: ["note"] }, "editable", "date", false)).toBe(false);
    expect(policyPermits({ editable: (field) => field === "note" }, "editable", "note", false)).toBe(true);
  });

  test("column capabilities use the same forms and the same narrow-only rule", () => {
    const policy: GridPolicy = {
      groupable: ["status", "note"],
      resizable: false,
      movable: (field) => field !== "date",
      hideable: true,
      freezable: ["date", "personId"],
      fields: {
        status: { groupable: false, resizable: true },
        note: { freezable: false, movable: false },
      },
    };
    expect(policyPermits(policy, "groupable", "status", true)).toBe(false);
    expect(policyPermits(policy, "groupable", "note", true)).toBe(true);
    expect(policyPermits(policy, "groupable", "hours", true)).toBe(false);
    expect(policyPermits(policy, "resizable", "status", true)).toBe(false);
    expect(policyPermits(policy, "movable", "date", true)).toBe(false);
    expect(policyPermits(policy, "movable", "note", true)).toBe(false);
    expect(policyPermits(policy, "movable", "hours", true)).toBe(true);
    expect(policyPermits(policy, "hideable", "hours", true)).toBe(true);
    expect(policyPermits(policy, "freezable", "date", true)).toBe(true);
    expect(policyPermits(policy, "freezable", "note", true)).toBe(false);
    expect(policyPermits(policy, "freezable", "hours", true)).toBe(false);
  });
});
