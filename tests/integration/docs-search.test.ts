import { expect, test } from "bun:test";
import { createSearchIndex, searchExcerpt } from "../../packages/docs/src/features/search/index.ts";

import { exampleSearchItems, searchItems } from "../../apps/docs/build/search.ts";
import { examples } from "../../apps/docs/build/examples.ts";

const search = createSearchIndex([
  { name: "Connect a grid and form", description: "Selection and drafts remain shared across views.", href: "/guide/connected", kind: "Guide" },
  { name: "Grid.selection", description: "The selection model for this grid. Connect a form to use its current record.", href: "/api/selection", kind: "API" },
  { name: "Authentication and session recovery", description: "Provide a sign in interaction and retain drafts.", href: "/guide/authentication", kind: "Guide" },
  { name: "TileGrid", description: "Accessible cards for a collection.", href: "/api/tiles", kind: "API" },
]);

test("task queries match separate words and unfinished words, with titles before incidental prose", () => {
  expect(search("how do I connect form grid")[0]?.href).toBe("/guide/connected");
  expect(search("grid for")[0]?.href).toBe("/guide/connected");
  expect(search("grid selection")[0]?.href).toBe("/api/selection");
  expect(search("Grid.selection")[0]?.href).toBe("/api/selection");
});

test("component names work as identifiers, ordinary words or a recoverable typo", () => {
  for (const query of ["TileGrid", "tilegrid", "tile grid"]) expect(search(query)[0]?.href).toBe("/api/tiles");
  expect(search("authentcation")[0]?.href).toBe("/guide/authentication");
  expect(search("zzzz-no-result")).toEqual([]);
  expect(search(" ")).toEqual([]);
});

test("results stay bounded and excerpts include nearby matching text", () => {
  expect(search("grid", 1)).toHaveLength(1);
  const description = "Context. ".repeat(30) + "Authentication recovery retains unsent drafts. " + "Other detail. ".repeat(30);
  const excerpt = searchExcerpt(description, "authentication");
  expect(excerpt).toContain("Authentication recovery");
  expect(excerpt.length).toBeLessThanOrEqual(157);
});

test("example discovery matches short names and related terms alongside guide results", () => {
  const find = createSearchIndex(searchItems([
    { name: "Authentication", description: "Retain mail drafts and recover requests.", href: "/guide/authentication", kind: "Guide" },
    ...exampleSearchItems(examples),
  ], []));
  for (const query of ["mail", "webmail", "email", "inbox", "mail sign in"]) {
    expect(find(query)[0]?.href).toBe("../examples/mail.html");
  }
  for (const example of examples) {
    expect(find(example.id).some(item => item.href === `../examples/${example.id}.html`)).toBe(true);
  }
});
