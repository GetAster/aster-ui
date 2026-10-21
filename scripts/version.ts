import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Public snapshots carry the originating repository count in BUILD_NUMBER. */
export function buildVersion(root: string, environment: Record<string, string | undefined> = process.env): string {
  const lines = readFileSync(resolve(root, "VERSION"), "utf8").split("\n").filter(line => line.trim() && !line.trim().startsWith("#"));
  if (lines.length !== 1) throw new Error("VERSION must contain one major.minor and offset");
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\s+(0|[1-9]\d*)$/.exec(lines[0]!.trim());
  if (!match) throw new Error("Invalid VERSION base or offset");
  let count = environment.ASTER_BUILD_NUMBER;
  if (count === undefined && existsSync(resolve(root, "BUILD_NUMBER"))) count = readFileSync(resolve(root, "BUILD_NUMBER"), "utf8").trim();
  if (count === undefined) {
    if (execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() === "true") throw new Error("Version needs full Git history or BUILD_NUMBER");
    count = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  }
  if (!/^(0|[1-9]\d*)$/.test(count)) throw new Error("Invalid build number");
  const patch = BigInt(count) - BigInt(match[3]!);
  if (patch < 0n) throw new Error("Build number is below VERSION offset");
  return `${match[1]}.${match[2]}.${patch}`;
}

export function releaseVersion(base: string, channel: string, build?: string): string {
  switch (channel) {
    case "stable": return base;
    case "preview":
      if (!build || !/^(0|[1-9]\d*)$/.test(build)) throw new Error("Preview version needs a numeric build number");
      return `${base}-preview.${build}`;
    default: throw new Error("Release channel must be preview or stable");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const args = process.argv.slice(2);
  const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const base = buildVersion(root);
  console.log(args.length ? releaseVersion(base, option("--channel") ?? "preview", option("--build")) : base);
}
