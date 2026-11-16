// Decides whether a website-only deployment may go ahead, for the publish
// workflow's site_only run. The site must describe exactly the packages on npm,
// so the checked-out commit has to descend from the commit whose packages were
// released, and must not change anything that is built into those packages or
// the site's copy of them. Prints `version=` and `package_revision=` lines for
// $GITHUB_OUTPUT, or exits 1 with the reason.
import { execFileSync } from "node:child_process";

/** Paths whose content is the released packages; a website-only run may not change them. */
export const PACKAGE_PATHS = ["packages", "mock", "bun.lock"] as const;

export interface Receipt {
  readonly version: string;
  readonly revision: string;
  /** The public commit whose packages the site describes; older receipts only have `revision`. */
  readonly packageRevision?: string;
}

export interface Repository {
  isAncestor(ancestor: string, descendant: string): boolean;
  changedPaths(from: string, to: string, paths: readonly string[]): string[];
}

export function siteOnlyRelease(receipt: Receipt, head: string, repository: Repository, published: (version: string) => boolean): { version: string; packageRevision: string } {
  const packageRevision = receipt.packageRevision ?? receipt.revision;
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(receipt.version)) throw new Error(`The live receipt has no release version: ${receipt.version}`);
  if (!/^[a-f0-9]{40}$/.test(packageRevision)) throw new Error("The live receipt has no public package revision");
  if (!published(receipt.version)) throw new Error(`@getaster/elements@${receipt.version} is not on npm`);
  if (!repository.isAncestor(packageRevision, head)) throw new Error(`${head} does not descend from the released commit ${packageRevision}; branch from it`);
  const changed = repository.changedPaths(packageRevision, head, PACKAGE_PATHS);
  if (changed.length) throw new Error(`Package sources changed since ${receipt.version}; release them instead:\n${changed.join("\n")}`);
  return { version: receipt.version, packageRevision };
}

if (import.meta.main) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
  const repository: Repository = {
    isAncestor(ancestor, descendant) {
      try { git("merge-base", "--is-ancestor", ancestor, descendant); return true; } catch { return false; }
    },
    changedPaths: (from, to, paths) => git("diff", "--name-only", from, to, "--", ...paths).split("\n").filter(Boolean),
  };
  const published = (version: string) => {
    try { return execFileSync("npm", ["view", `@getaster/elements@${version}`, "version"], { encoding: "utf8" }).trim() === version; } catch { return false; }
  };
  const response = await fetch("https://ui.getaster.now/deployment.json");
  if (!response.ok) throw new Error(`The live receipt answered ${response.status}`);
  try {
    const release = siteOnlyRelease(await response.json() as Receipt, git("rev-parse", "HEAD").trim(), repository, published);
    console.log(`version=${release.version}\npackage_revision=${release.packageRevision}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
