#!/usr/bin/env bun
// aster-theme-check <theme.css>…: checks each identity in a theme file
// against the token contract and the contrast pairs (docs/guide/themes.md).
// Exits 1 if any check fails.
import { readFileSync } from "node:fs";
import { check, identities } from "./theme-check.ts";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: aster-theme-check <theme.css>…");
  process.exit(2);
}
let failed = false;
for (const file of files) {
  const found = identities(readFileSync(file, "utf8"));
  if (found.length === 0) {
    console.log(`✗ ${file}: no :root rule with --aster- tokens`);
    failed = true;
  }
  for (const identity of found) {
    const report = check(identity);
    const ok = report.errors.length === 0;
    failed ||= !ok;
    console.log(`${ok ? "✓" : "✗"} ${file}, identity ${report.identity}`);
    for (const e of report.errors) console.log(`  ✗ ${e.scheme}: ${e.message}`);
    for (const w of report.warnings) console.log(`  ! ${w.scheme}: ${w.message}`);
  }
}
process.exit(failed ? 1 : 0);
