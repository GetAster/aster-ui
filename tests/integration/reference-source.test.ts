import { expect, test } from "bun:test";
import { referencePages } from "../../apps/docs/src/features/reference/render.ts";
import type { Entry } from "../../apps/docs/src/features/reference/types.ts";

test("reference pages link public implementation and identify proprietary implementation", () => {
  const entry = (name: string, pkg: string): Entry => ({ ref: `class:${name}`, kind: "class", name, package: pkg,
    description: "", seeAlso: [], groups: [], source: `packages/${pkg}/src/index.ts:1` });
  const grid = entry("Grid", "elements"), navigator = entry("NestedGrid", "data-navigator");
  const pages = referencePages([grid, navigator], "a".repeat(40));
  expect(pages.entryPage(grid)).toContain(`https://github.com/GetAster/aster-ui/blob/${"a".repeat(40)}/packages/elements/src/index.ts#L1`);
  expect(pages.entryPage(navigator)).not.toContain("https://github.com/");
  expect(pages.entryPage(navigator)).toContain("Proprietary extension");
});
