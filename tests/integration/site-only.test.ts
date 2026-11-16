import { describe, expect, test } from "bun:test";
import { PACKAGE_PATHS, siteOnlyRelease, type Repository } from "../../scripts/site-only.ts";

const released = "a".repeat(40);
const head = "b".repeat(40);
const repository = (changes: string[] = [], ancestor = true): Repository => ({
  isAncestor: (from, to) => ancestor && from === released && to === head,
  changedPaths: (from, to, paths) => {
    expect([from, to, paths]).toEqual([released, head, PACKAGE_PATHS]);
    return changes;
  },
});
const onNpm = (version: string) => version === "0.4.47";

describe("website-only release guard", () => {
  test("allows a docs change on a branch from the released commit, keeping the released version", () => {
    expect(siteOnlyRelease({ version: "0.4.47", revision: released }, head, repository(), onNpm))
      .toEqual({ version: "0.4.47", packageRevision: released });
  });

  test("follows packageRevision after an earlier website-only update", () => {
    const receipt = { version: "0.4.47", revision: "c".repeat(40), packageRevision: released };
    expect(siteOnlyRelease(receipt, head, repository(), onNpm).packageRevision).toBe(released);
  });

  test("refuses a branch that changed package sources", () => {
    expect(() => siteOnlyRelease({ version: "0.4.47", revision: released }, head, repository(["packages/elements/src/list-edit/list-edit.ts"]), onNpm))
      .toThrow("Package sources changed since 0.4.47");
  });

  test("refuses a commit that does not descend from the release", () => {
    expect(() => siteOnlyRelease({ version: "0.4.47", revision: released }, head, repository([], false), onNpm))
      .toThrow("does not descend from the released commit");
  });

  test("refuses a version that is not on npm, or a receipt without a release", () => {
    expect(() => siteOnlyRelease({ version: "0.4.48", revision: released }, head, repository(), onNpm)).toThrow("is not on npm");
    expect(() => siteOnlyRelease({ version: "development", revision: "working-tree" }, head, repository(), onNpm)).toThrow("no release version");
  });
});
