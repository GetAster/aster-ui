import { PUBLIC_PACKAGES } from "./package-policy.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../dist-release");
const names = PUBLIC_PACKAGES;
const allowedNames = new Set(names.map(name => `@getaster/${name}`));
for (const file of readdirSync(directory).filter(file => file.endsWith(".tgz"))) {
  const result = spawnSync("tar", ["-xOf", join(directory, file), "package/package.json"], { encoding: "utf8" });
  if (result.status) throw new Error(`Cannot inspect publication artifact: ${file}`);
  const manifest = JSON.parse(result.stdout);
  if (!allowedNames.has(manifest.name) || manifest.private) throw new Error(`Package is not permitted in public publication: ${manifest.name}`);
}

if (!dryRun && (process.env.GITHUB_REPOSITORY?.toLowerCase() !== "getaster/aster-ui" || process.env.GITHUB_REF !== "refs/heads/main" || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL)) {
  throw new Error("Publish from the public repository's main-branch trusted-publishing workflow");
}
const run = (args) => spawnSync(args[0], args.slice(1), { cwd: directory, encoding: "utf8" });
const plans = names.map(name => {
  const manifest = JSON.parse(readFileSync(join(directory, name, "package.json"), "utf8"));
  if (manifest.name !== `@getaster/${name}` || manifest.private) throw new Error(`Invalid public package manifest: ${name}`);
  const file = `getaster-${name}-${manifest.version}.tgz`;
  const integrity = `sha512-${createHash("sha512").update(readFileSync(join(directory, file))).digest("base64")}`;
  return { name: manifest.name, version: manifest.version, file, integrity, tag: manifest.version.includes("-") ? "next" : "latest", exists: false };
});
// Check every version before publishing any package, including retries after a partial release.
if (!dryRun) for (const plan of plans) {
  const result = run(["npm", "view", `${plan.name}@${plan.version}`, "dist.integrity", "--json", "--registry", "https://registry.npmjs.org"]);
  if (result.status) {
    let code;
    try { code = JSON.parse(result.stdout.toString()).error?.code; } catch { /* CLI failures may have no JSON output. */ }
    if (code !== "E404") throw new Error(`Cannot verify registry version for ${plan.name}; no packages published`);
  } else {
    if (JSON.parse(result.stdout.toString()) !== plan.integrity) throw new Error(`Published ${plan.name}@${plan.version} differs from this build; choose a new version`);
    plan.exists = true;
  }
}
for (const plan of plans) {
  if (dryRun || plan.exists) {
    console.log(`${dryRun ? "Would publish" : "Already published"} ${plan.name}@${plan.version} (${plan.tag})`);
    continue;
  }
  const result = run(["npm", "publish", plan.file, "--access", "public", "--tag", plan.tag, "--provenance", "--ignore-scripts", "--registry", "https://registry.npmjs.org"]);
  if (result.status) throw new Error(`Publication failed for ${plan.name}: ${result.stderr.toString()}`);
  console.log(`Published ${plan.name}@${plan.version}`);
}
