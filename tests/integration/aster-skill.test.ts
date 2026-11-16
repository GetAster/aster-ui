import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tool = resolve(import.meta.dir, "../../packages/elements/tools/aster-skill.ts");
const run = (...args: string[]) => Bun.spawnSync(["bun", tool, ...args], { stdout: "pipe", stderr: "pipe" });

function project(): string {
  return mkdtempSync(join(tmpdir(), "aster-skill-"));
}

describe("aster-skill", () => {
  test("installs the skill for Claude Code and Codex, and check reports it current", () => {
    const dir = project();
    try {
      expect(run("check", "--dir", dir).exitCode).toBe(1);
      expect(run("install", "--dir", dir).exitCode).toBe(0);
      for (const target of [".claude/skills/aster-ui", ".agents/skills/aster-ui"]) {
        const skill = readFileSync(join(dir, target, "SKILL.md"), "utf8");
        expect(skill).toStartWith("---\nname: aster-ui\n");
        expect(skill).toContain("Installed by aster-skill from @getaster/elements");
      }
      expect(run("check", "--dir", dir).exitCode).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("replaces a stale copy, and check finds it stale first", () => {
    const dir = project();
    try {
      run("install", "--dir", dir);
      writeFileSync(join(dir, ".claude/skills/aster-ui/SKILL.md"), "old");
      expect(run("check", "--dir", dir).exitCode).toBe(1);
      run("install", "--dir", dir);
      expect(readFileSync(join(dir, ".claude/skills/aster-ui/SKILL.md"), "utf8")).toContain("name: aster-ui");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("leaves a symbolic link the user manages alone", () => {
    const dir = project();
    const own = project();
    try {
      writeFileSync(join(own, "SKILL.md"), "mine");
      mkdirSync(join(dir, ".agents/skills"), { recursive: true });
      symlinkSync(own, join(dir, ".agents/skills/aster-ui"));
      const result = run("install", "--dir", dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(".agents/skills/aster-ui: a symbolic link");
      expect(lstatSync(join(dir, ".agents/skills/aster-ui")).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(own, "SKILL.md"), "utf8")).toBe("mine");
      expect(existsSync(join(dir, ".claude/skills/aster-ui/SKILL.md"))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(own, { recursive: true, force: true }); }
  });

  test("rejects an unknown argument", () => {
    expect(run("--bogus").exitCode).toBe(2);
  });
});
