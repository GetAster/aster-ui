import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../dist-release");
const pending = ["data", "elements", "elements-preview", "mock"].map(name => {
  const manifest = JSON.parse(readFileSync(join(directory, name, "package.json"), "utf8"));
  const file = join(directory, `getaster-${name}-${manifest.version}.tgz`);
  return { name: manifest.name, version: manifest.version, integrity: `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`, tag: manifest.version.includes("-") ? "next" : "latest" };
});
const deadline = Date.now() + 15 * 60_000;
while (pending.length) {
  for (const plan of [...pending]) {
    const base = `https://registry.npmjs.org/${encodeURIComponent(plan.name)}`;
    const options = { signal: AbortSignal.timeout(20_000), headers: { "cache-control": "no-cache" } };
    const response = await fetch(`${base}/${plan.version}`, options);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Registry returned ${response.status} for ${plan.name}`);
    const published = await response.json();
    if (published.dist?.integrity !== plan.integrity) throw new Error(`Registry integrity differs for ${plan.name}@${plan.version}`);
    const tagsResponse = await fetch(`https://registry.npmjs.org/-/package/${encodeURIComponent(plan.name)}/dist-tags`, options);
    if (tagsResponse.status === 404) continue;
    if (!tagsResponse.ok) throw new Error(`Cannot verify tags for ${plan.name}`);
    if ((await tagsResponse.json())[plan.tag] !== plan.version) continue;
    const tarball = new URL(published.dist.tarball);
    if (tarball.protocol !== "https:" || tarball.hostname !== "registry.npmjs.org") throw new Error("Unexpected tarball origin");
    const archive = await fetch(tarball, { signal: AbortSignal.timeout(60_000) });
    if (archive.status === 404) continue;
    if (!archive.ok) throw new Error(`Cannot download ${plan.name}: HTTP ${archive.status}`);
    const actual = `sha512-${createHash("sha512").update(Buffer.from(await archive.arrayBuffer())).digest("base64")}`;
    if (actual !== plan.integrity) throw new Error(`Downloaded tarball differs for ${plan.name}`);
    console.log(`Verified ${plan.name}@${plan.version}: registry, ${plan.tag} tag and downloaded tarball match`);
    pending.splice(pending.indexOf(plan), 1);
  }
  if (!pending.length) break;
  if (Date.now() >= deadline) throw new Error(`Publication is not yet visible: ${pending.map(plan => plan.name).join(", ")}`);
  console.log(`Waiting for registry publication: ${pending.map(plan => plan.name).join(", ")}`);
  await setTimeout(15_000);
}
