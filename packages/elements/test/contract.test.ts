import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPONENT_VAR_NAMES, DENSITIES, DENSITY_NAMES, TOKEN_NAMES } from "../src/styles/contract.ts";

const styles = join(import.meta.dir, "../src/styles");
const app = join(import.meta.dir, "../../../apps/showcase/src/workspace");
const appSheets = [app, join(app, "../app")].flatMap(dir => readdirSync(dir).filter(file => file.endsWith(".css")).map(file => ({ file, dir })));
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
    ...appSheets.map(({ dir, file }) => read(dir, file)),
  ];
  const used = new Set(sheets.flatMap((css) => [...css.matchAll(/var\((--aster-[\w-]+)/g)].map((m) => m[1]!)));
  expect([...used].filter((t) => !TOKEN_NAMES.includes(t) && !DENSITY_NAMES.includes(t) && !COMPONENT_VAR_NAMES.includes(t))).toEqual([]);
});

test("base.css gives every component intent a default", () => {
  const css = read(styles, "base.css");
  expect(COMPONENT_VAR_NAMES.filter((name) => !new RegExp(`${name}\\s*:`).test(css))).toEqual([]);
});

test("component stylesheets consume every component intent", () => {
  const css = read(styles, "elements.css");
  expect(COMPONENT_VAR_NAMES.filter((name) => !css.includes(`var(${name}`))).toEqual([]);
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
    ...appSheets.map(({ dir, file }): [string, string] => [file, read(dir, file)]),
  ];
  // oklch(from var(…)) and oklch(var(…)) build on tokens.
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|lab|lch|oklab|color)\(|oklch\((?!from |var\()/gi;
  const found = sheets.flatMap(([f, css]) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(literal)].map((m) => `${f}: ${m[0]}`));
  expect(found).toEqual([]);
});
