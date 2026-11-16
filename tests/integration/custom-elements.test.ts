import { describe, expect, test } from "bun:test";
import { build } from "../../scripts/docs/build.ts";
import { customElementsManifest } from "../../scripts/docs/custom-elements.ts";

const manifest = customElementsManifest(build().entries, "elements") as {
  schemaVersion: string;
  modules: { path: string; declarations: Record<string, any>[]; exports: { kind: string; name: string }[] }[];
};
const [module] = manifest.modules;
const element = (tag: string) => module!.declarations.find(declaration => declaration.tagName === tag)!;

describe("custom elements manifest", () => {
  test("declares every public element with a definition export", () => {
    expect(manifest.schemaVersion).toBe("2.1.0");
    expect(module!.path).toBe("dist/index.js");
    for (const tag of ["aster-grid", "aster-form", "aster-list-editor", "aster-field"]) {
      expect(element(tag)?.customElement).toBe(true);
      expect(module!.exports).toContainEqual(expect.objectContaining({ kind: "custom-element-definition", name: tag }));
    }
  });

  test("lists properties as fields with types and defaults, and no attributes", () => {
    const columns = element("aster-list-editor").members.find((member: any) => member.name === "columns");
    expect(columns).toMatchObject({ kind: "field", type: { text: "readonly ListColumn[]" }, default: "[]" });
    expect(module!.declarations.every(declaration => !("attributes" in declaration))).toBe(true);
  });

  test("lists events, and leaves no internal reference links or relative URLs in descriptions", () => {
    expect(element("aster-tabs").events.map((event: any) => event.name)).toContain("close");
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/\[\[[a-zA-Z]+:/);
    expect(text).not.toMatch(/\]\((?!https?:|#)/);
    expect(text).toContain("https://ui.getaster.now/docs/guide/getting-started.html");
  });
});
