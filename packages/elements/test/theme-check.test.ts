import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, contrast, identities, parseColor } from "../tools/theme-check.ts";

const styles = join(import.meta.dir, "../src/styles");
const theme = (f: string) => identities(readFileSync(join(styles, f), "utf8"));

describe("theme check", () => {
  test("Lamplight and Harbour pass, in both schemes", () => {
    for (const identity of [...theme("lamplight.css"), ...theme("harbour.css")]) {
      expect([identity.name, check(identity).errors]).toEqual([identity.name, []]);
    }
  });

  test("a missing token, a misspelt one, and text too faint each fail", () => {
    const invalid = readFileSync(join(styles, "harbour.css"), "utf8")
      .replace(/\n\s*--aster-toast-mark:[^;]+;/, "")
      .replace(/--aster-text-2:[^;]+;/, "--aster-text2: #606870; --aster-text-2: #a0a8b0;");
    const errors = check(identities(invalid)[0]!).errors.map((e) => `${e.scheme}: ${e.message}`);
    expect(errors).toContain("light: missing --aster-toast-mark");
    expect(errors).toContain("light: not in the contract (misspelt?): --aster-text2");
    expect(errors.some((e) => e.startsWith("light: text-2 on surface is 2."))).toBe(true);
  });

  test("colours: hex, rgb, oklch, relative oklch, color-mix and var", () => {
    const lookup = (n: string) => (n === "--x" ? parseColor("#12658b") : undefined);
    expect(parseColor("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(parseColor("var(--x)", lookup)).toEqual(parseColor("#12658b")!);
    expect(parseColor("oklch(from var(--x) l c h / .7)", lookup)!.a).toBe(0.7);
    expect(parseColor("color-mix(in srgb, #000 50%, transparent)")!.a).toBeCloseTo(0.5);
    expect(contrast(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21);
    expect(parseColor("hsl(10 50% 50%)")).toBeUndefined();
  });
});

test("every token has a role, and the theme guide's tables are up to date", async () => {
  const { ROLES } = await import("../tools/roles.ts");
  const { TOKENS } = await import("../src/styles/contract.ts");
  const { GUIDE, updated } = await import("../tools/theme-guide.ts");
  const names = Object.values(TOKENS).flat() as string[];
  expect(names.filter((n) => !ROLES[n])).toEqual([]);
  expect(Object.keys(ROLES).filter((n) => !names.includes(n))).toEqual([]);
  const guide = readFileSync(GUIDE, "utf8");
  // Run `bun packages/elements/tools/theme-guide.ts` to update it.
  expect(updated(guide) === guide).toBe(true);
});
