import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildVersion, releaseVersion } from "../../scripts/version.ts";

test("snapshots derive the originating commit version without their own Git history", () => {
  const root = mkdtempSync(join(tmpdir(), "aster-version-"));
  try {
    writeFileSync(join(root, "VERSION"), "# Base and offset\n0.1 156\n");
    writeFileSync(join(root, "BUILD_NUMBER"), "158\n");
    expect(buildVersion(root, {})).toBe("0.1.2");
    expect(buildVersion(root, { ASTER_BUILD_NUMBER: "159" })).toBe("0.1.3");
    expect(releaseVersion(buildVersion(root, {}), "preview", "42")).toBe("0.1.2-preview.42");
    expect(releaseVersion(buildVersion(root, {}), "stable")).toBe("0.1.2");
    for (const count of ["155", "", "-1", "1.5", "158junk"]) expect(() => buildVersion(root, { ASTER_BUILD_NUMBER: count })).toThrow();
    expect(() => releaseVersion("0.1.2", "preview")).toThrow();
    expect(() => releaseVersion("0.1.2", "other", "1")).toThrow();
    writeFileSync(join(root, "VERSION"), "0.1 -1\n");
    expect(() => buildVersion(root, {})).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
