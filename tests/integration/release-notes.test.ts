import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseNotes } from "../../scripts/release-notes.ts";

const changelog = "# Release notes\n\nIntro.\n\n## 0.4.72\n\nSummary.\n\n### Added\n\n- A thing.\n\n## 0.4.47\n\nOlder.\n";

test("a version's notes are its section, without the heading or the next release", () => {
  expect(releaseNotes(changelog, "0.4.72")).toBe("Summary.\n\n### Added\n\n- A thing.");
  expect(releaseNotes(changelog, "0.4.47")).toBe("Older.");
});

test("wrapped paragraphs and list items join onto one line; code blocks and nested lists keep theirs", () => {
  const text = "## 1.0.0\n\nOne\ntwo.\n\n### Added\n\n- **A.** First\n  second.\n- B.\n  - nested\n\n```sh\nbun add x\nbun run y\n```\n";
  expect(releaseNotes(text, "1.0.0")).toBe("One two.\n\n### Added\n\n- **A.** First second.\n- B.\n  - nested\n\n```sh\nbun add x\nbun run y\n```");
});

test("a version without a section, or a prefix of one, has no notes", () => {
  expect(releaseNotes(changelog, "0.4.7")).toBeUndefined();
  expect(releaseNotes(changelog, "0.4.99")).toBeUndefined();
});

test("the newest changelog section has notes", () => {
  const text = readFileSync(resolve(import.meta.dir, "../../CHANGELOG.md"), "utf8");
  const newest = /^## (\d+\.\d+\.\d+)$/m.exec(text)![1]!;
  expect(releaseNotes(text, newest)?.length).toBeGreaterThan(40);
});
