import { expect, type Locator, type Page } from "@playwright/test";

export const NOW = "2026-10-07T15:15:00Z";

/**
 * Opens the demo with a frozen clock, in-memory data and the debug handle, and waits for the figures.
 * `extra` (`&time=20000`) adds or replaces parameters.
 */
export async function open(page: Page, hash = "#projects/active", extra = ""): Promise<void> {
  const params = new URLSearchParams(`memory&debug&clients=2000&time=200&now=${NOW}`);
  for (const [k, v] of new URLSearchParams(extra)) params.set(k, v);
  await page.goto(`/?${params.toString().replace(/=(?=&|$)/g, "")}${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-figure="Budget left"]')).not.toHaveText("–");
}

interface Row {
  id: number;
  name: string;
  state: string;
  health: string;
  updatedAt: string;
}

/** The server's rows, read from the mock. */
export async function server(page: Page): Promise<{ Projects: Row[]; Tasks: { projectId: number; parentId: number | null; done: boolean }[] }> {
  return page.evaluate(async () => (await (globalThis as unknown as { aster: { mock: { dump(): Promise<{ data: never }> } } }).aster.mock.dump()).data);
}

/**
 * Every figure, badge, tab and row on the Projects screen agrees with the
 * server's data.
 */
export async function expectConsistent(page: Page): Promise<void> {
  await expect(async () => {
    const data = await server(page);
    const active = data.Projects.filter((p) => p.state === "active");
    const open = data.Tasks.filter((t) => !t.done && t.parentId === null);
    const onTrack = active.filter((p) => p.health === "onTrack").length;
    const tab = new URL(page.url()).hash.split("/")[1] ?? "active";
    const rows = data.Projects.filter((p) => p.state === tab)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id - b.id)
      .map((p) => p.name);

    const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n);
    expect(await page.locator('[data-figure="Active projects"]').textContent()).toBe(fmt(active.length));
    expect(await page.locator(".aster-nav .aster-count").textContent()).toBe(String(active.length));
    expect(await page.locator('[data-figure="Open tasks"]').textContent()).toBe(fmt(open.length));
    expect(await page.locator('[data-figure="On schedule"]').textContent()).toBe(`${Math.round((onTrack / active.length) * 100)}%`);
    expect(await page.locator("#projects-list .name").allTextContents()).toEqual(rows);

    const first = data.Projects.find((p) => p.name === rows[0]);
    if (first) {
      const openFirst = open.filter((t) => t.projectId === first.id).length;
      expect(await page.locator("#projects-list [role=option]").first().locator(".open").textContent()).toBe(String(openFirst));
    }
  }).toPass({ timeout: 5000 });
}

export function row(page: Page, name: string) {
  return page.locator("#projects-list [role=option]", { has: page.locator(".name", { hasText: new RegExp(`^${escape(name)}$`) }) });
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Another user's write, without touching the page's focus. */
export async function externalPatch(page: Page, url: string, body: object): Promise<void> {
  await page.evaluate(
    async ([url, body]) => {
      const { mock } = (globalThis as unknown as { aster: { mock: { external(r: object): Promise<{ status: number }> } } }).aster;
      await mock.external({ method: "PATCH", url, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    },
    [url, body] as const,
  );
}

/** Waits until no animation or transition is running. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

/** The element's size: what a layout shift would change. */
export async function size(l: Locator): Promise<{ width: number; height: number }> {
  const box = await l.boundingBox();
  if (!box) throw new Error("not rendered");
  return { width: box.width, height: box.height };
}
