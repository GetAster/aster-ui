import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DENSITIES, DENSITY_NAMES, TOKEN_NAMES } from "../src/styles/contract.ts";

const styles = join(import.meta.dir, "../src/styles");
const app = join(import.meta.dir, "../../../apps/aster/src");
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

/** Custom properties declared in the first rule whose selector matches. */
function declared(css: string, selector: RegExp): Set<string> {
  const m = selector.exec(css);
  if (!m) return new Set();
  const body = css.slice(m.index + m[0].length, css.indexOf("\n  }", m.index));
  return new Set([...body.matchAll(/(--aster-[\w-]+)\s*:/g)].map((d) => d[1]!));
}

const identities: [string, RegExp][] = [
  ["lamplight.css", /\n  :root \{/],
  ["harbour.css", /\n  :root\[data-identity="harbour"\] \{/],
];

for (const [file, selector] of identities) {
  test(`${file} defines every contract token`, () => {
    const have = declared(read(styles, file), selector);
    expect(TOKEN_NAMES.filter((t) => !have.has(t))).toEqual([]);
    expect([...have].filter((t) => !TOKEN_NAMES.includes(t))).toEqual([]);
  });
}

test("elements and the app use only contract tokens", () => {
  const sheets = [
    ...["base.css", "elements.css"].map((f) => read(styles, f)),
    ...readdirSync(app).filter((f) => f.endsWith(".css")).map((f) => read(app, f)),
  ];
  const used = new Set(sheets.flatMap((css) => [...css.matchAll(/var\((--aster-[\w-]+)/g)].map((m) => m[1]!)));
  expect([...used].filter((t) => !TOKEN_NAMES.includes(t) && !DENSITY_NAMES.includes(t))).toEqual([]);
});

test("base.css defines every density token for every density", () => {
  const css = read(styles, "base.css");
  for (const density of DENSITIES) {
    const rule = new RegExp(`\\[data-density="${density}"\\][^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(DENSITY_NAMES.filter((t) => !rule.includes(`${t}:`))).toEqual([]);
  }
});

test("colours come from tokens: no literal colour outside the themes", () => {
  const sheets: [string, string][] = [
    ...["base.css", "elements.css"].map((f): [string, string] => [f, read(styles, f)]),
    ...readdirSync(app).filter((f) => f.endsWith(".css")).map((f): [string, string] => [f, read(app, f)]),
  ];
  // oklch(from var(…)) and oklch(var(…)) build on tokens.
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|lab|lch|oklab|color)\(|oklch\((?!from |var\()/gi;
  const found = sheets.flatMap(([f, css]) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(literal)].map((m) => `${f}: ${m[0]}`));
  expect(found).toEqual([]);
});
