import { chooseAppearance } from "./appearance.ts";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const open = async (page: Page) => {
  await page.goto("/playground/components.html?debug");
  await expect(page.locator("#platforms svg")).toBeVisible();
  await expect(page.locator("#costs svg")).toBeVisible();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("240 rows");
};

test("live controls edit the shared data, update totals and add devices", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.getByRole("button", { name: "Raise displayed costs", exact: true }).click();
  await expect(page.locator("#data-status")).toHaveText("Raised costs by 10 for 20 devices.");
  await expect(page.locator("#costs tbody td:nth-child(2)").first()).toHaveText("30");
  await page.locator("#costs").getByRole("button", { name: "Device 001", exact: true }).click();
  await page.getByRole("button", { name: "Raise selected costs", exact: true }).click();
  await expect(page.locator("#data-status")).toHaveText("Raised costs by 10 for 1 device.");
  await expect(page.locator("#costs tbody td:nth-child(2)").first()).toHaveText("40");
  await page.locator("#costs").getByRole("button", { name: "Device 001", exact: true }).click();
  await page.getByLabel("Online only").check();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("120 rows");
  await page.locator("#costs").getByRole("button", { name: "Device 001", exact: true }).click();
  await page.getByRole("button", { name: "Toggle selected status", exact: true }).click();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("119 rows");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["39", "40", "40"]);
  await page.getByRole("button", { name: "Add Linux device", exact: true }).click();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("120 rows");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["40", "40", "40"]);
  await page.getByRole("button", { name: "Add Windows device", exact: true }).click();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("121 rows");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["40", "41", "40"]);
});

test("chart changes animate when motion is allowed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page);
  await page.waitForTimeout(500);
  const heights = await page.evaluate(async () => {
    const samples: number[] = [];
    document.querySelector<HTMLButtonElement>("#raise-costs")!.click();
    const start = performance.now();
    await new Promise<void>(resolve => {
      const frame = () => {
        const bar = document.querySelector('#costs svg path[d$="Z"]');
        if (bar) samples.push(Math.round(bar.getBoundingClientRect().height));
        if (performance.now() - start < 750) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    return [...new Set(samples)];
  });
  expect(heights.length).toBeGreaterThan(5);
  await expect(page.locator("#costs tbody td:nth-child(2)").first()).toHaveText("30");
});

test("adding a device transitions only its platform bar without clearing the others", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page);
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["80", "80", "80"]);
  await page.waitForTimeout(350);
  for (const [button, changed] of [["add-linux", 0], ["add-windows", 1]] as const) {
    const result = await page.evaluate(async ({ button }) => {
      const bars = () => [...document.querySelectorAll('#platforms svg path[d$="Z"]')];
      const original = bars();
      const before = original.map(bar => bar.getBoundingClientRect().height);
      const samples: number[][] = [];
      document.querySelector<HTMLButtonElement>(`#${button}`)!.click();
      const start = performance.now();
      await new Promise<void>(resolve => {
        const frame = () => {
          samples.push(bars().map(bar => bar.getBoundingClientRect().height));
          if (performance.now() - start < 700) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
      return { before, samples, sameNodes: bars().every((bar, index) => bar === original[index]) };
    }, { button });
    expect(result.before).toHaveLength(3);
    expect(result.sameNodes).toBe(true);
    for (const sample of result.samples) {
      expect(sample).toHaveLength(3);
      for (let index = 0; index < 3; index++) {
        if (index !== changed) expect(Math.abs(sample[index]! - result.before[index]!)).toBeLessThan(0.5);
        else expect(sample[index]!).toBeGreaterThanOrEqual(result.before[index]! - 0.5);
      }
    }
    expect(result.samples.at(-1)![changed]!).toBeGreaterThan(result.before[changed]! + 1);
  }
});

test("writes refresh charts and a scrolled grid without blank rows, layout jumps or lost focus", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.evaluate(async () => {
    const demo = (globalThis as any).componentDemo;
    const grid = document.querySelector("#devices") as any;
    await grid.focusIndex(30);
    demo.selection.select("[31]");
    demo.mock.faults.latencyMs = 80;
  });
  const result = await page.evaluate(async () => {
    const grid = document.querySelector("#devices")!;
    const scroll = grid.querySelector<HTMLElement>(".aster-grid-scroll")!;
    scroll.focus();
    const before = { top: grid.getBoundingClientRect().top, scroll: scroll.scrollTop };
    const original = [...grid.querySelectorAll<HTMLElement>("[data-key]")];
    const frames: { missing: number; retained: boolean; top: number; scroll: number; focused: boolean; total: string | null }[] = [];
    document.querySelector<HTMLButtonElement>("#add-windows")!.click();
    const start = performance.now();
    await new Promise<void>(resolve => {
      const sample = () => {
        frames.push({ missing: grid.querySelectorAll("[data-placeholder]").length,
          retained: original.every(row => row.isConnected), top: grid.getBoundingClientRect().top,
          scroll: scroll.scrollTop, focused: document.activeElement === scroll,
          total: grid.querySelector(".aster-grid-total")!.textContent });
        if (performance.now() - start < 900) requestAnimationFrame(sample); else resolve();
      };
      requestAnimationFrame(sample);
    });
    return { before, frames, original: original.length, selection: (globalThis as any).componentDemo.selection.keys.value };
  });
  expect(result.original).toBeGreaterThan(0);
  expect(result.selection).toEqual(["[31]"]);
  for (const frame of result.frames) {
    expect(frame.missing).toBe(0); expect(frame.retained).toBe(true); expect(frame.focused).toBe(true);
    expect(frame.scroll).toBe(result.before.scroll);
    expect(Math.abs(frame.top - result.before.top)).toBeLessThan(1);
    expect(frame.total).toMatch(/^24[01] rows$/);
  }
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("241 rows");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["80", "81", "80"]);
});

test("optional vendor loading leaves ordinary library pages independent", async ({ page }) => {
  const vendor: string[] = [];
  page.on("request", request => { if (request.url().includes("vendor/echarts")) vendor.push(request.url()); });
  await page.goto("/playground/filtering.html");
  await expect(page.getByRole("heading", { name: "Advanced filtering", exact: true })).toBeVisible();
  expect(vendor).toEqual([]);
  await open(page);
  expect(vendor).toHaveLength(1);
});

test("server chart filters all records and excludes its own contribution", async ({ page }) => {
  await open(page);
  const linux = page.locator("#platforms").getByRole("button", { name: "Linux", exact: true });
  await linux.focus();
  await linux.press("Enter");
  await expect(linux).toHaveAttribute("aria-pressed", "true");
  await expect(linux).toBeFocused();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("80 rows");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["80", "80", "80"]);
  await page.getByLabel("Online only").check();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("40 rows");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["40", "40", "40"]);
  await page.getByRole("button", { name: "Remove filter: Platform is Linux", exact: true }).click();
  await expect(linux).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("120 rows");
  expect(await page.evaluate(() => (globalThis as any).componentDemo.collection.complete.value)).toBe(false);
});

test("real SVG pointer actions filter and select through the public models", async ({ page }) => {
  await open(page);
  const platformBar = page.locator('#platforms svg path[d$="Z"]').first();
  await platformBar.click();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("80 rows");
  await expect(page.locator("#platforms").getByRole("button", { name: "Linux", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator('#costs svg path[d$="Z"]').first().click();
  await expect(page.locator("#costs").getByRole("button", { name: "Device 001", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (globalThis as any).componentDemo.selection.keys.value)).toEqual(["[1]"]);
  await expect(page.locator('#devices [data-key="[1]"]')).toHaveAttribute("aria-selected", "true");
});

test("grid expression refinements reach the server aggregate chart", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const grid = document.querySelector("#devices") as any;
    grid.view = { ...grid.view, criteria: { op: "le", field: "id", value: 9 } };
  });
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("9 rows");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["3", "3", "3"]);
});

test("keyboard data actions and grid selection update both views without remounting", async ({ page }) => {
  await open(page);
  await page.locator("#costs svg").evaluate(el => { (el as any).stable = true; });
  const device = page.locator("#costs").getByRole("button", { name: "Device 001", exact: true });
  await device.focus(); await device.press("Space");
  await expect(device).toHaveAttribute("aria-pressed", "true");
  await expect(device).toBeFocused();
  expect(await page.locator("#costs svg").evaluate(el => (el as any).stable)).toBe(true);
  await page.locator("#devices").getByRole("button", { name: "Deselect Device 001", exact: true }).click();
  await expect(device).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Remount charts", exact: true }).click();
  await expect(page.locator("#costs svg")).toBeVisible();
  expect(await page.evaluate(() => (globalThis as any).componentDemo.collection.count.value)).toBe(240);
});

test("failed optional import keeps the data alternative usable and supports retry", async ({ page }) => {
  await page.route("**/vendor/echarts.js", route => route.abort());
  await page.goto("/playground/components.html?debug");
  await expect(page.locator("#platforms").getByRole("button", { name: "Retry visualisation" })).toBeVisible();
  await page.locator("#platforms").getByRole("button", { name: "Linux", exact: true }).click();
  await expect(page.locator("#devices .aster-grid-total")).toHaveText("80 rows");
  await page.unroute("**/vendor/echarts.js");
  await page.locator("#platforms").getByRole("button", { name: "Retry visualisation" }).click();
  await expect(page.locator("#platforms svg")).toBeVisible();
});

test("mount cancellation isolates late work, disposes once and reconnects cleanly", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js";
    const { signal, html } = await import(url);
    const host = document.createElement("aster-component") as any;
    host.label = "Lifecycle probe"; host.alternative = () => html`<p>Probe data</p>`;
    const state = { host, pending: [] as (() => void)[], events: [] as string[], contexts: [] as any[], value: signal(1) };
    (globalThis as any).probe = state;
    host.adapter = { mount: (context: any) => {
      const index = state.contexts.length; state.contexts.push(context); state.events.push(`mount${index}`);
      return new Promise(resolve => state.pending.push(() => resolve({
        update(env: any) { state.events.push(`update${index}:${state.value.value}:${env.visible}:${env.locale}`); context.node.textContent = "Vendor content"; },
        dispose() { state.events.push(`dispose${index}`); },
      })));
    } };
    document.querySelector("main")!.append(host);
  });
  await expect.poll(() => page.evaluate(() => (globalThis as any).probe.contexts.length)).toBe(1);
  await page.evaluate(() => { const p = (globalThis as any).probe; p.host.retry(); });
  await expect.poll(() => page.evaluate(() => (globalThis as any).probe.contexts.length)).toBe(2);
  await page.evaluate(() => { const p = (globalThis as any).probe; p.pending[1](); p.pending[0](); });
  await expect.poll(() => page.evaluate(() => (globalThis as any).probe.events.includes("dispose0"))).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).probe.contexts[0].signal.aborted)).toBe(true);
  await page.evaluate(() => { const p = (globalThis as any).probe; p.value.value = 2; p.host.locale = "fr-FR"; });
  await expect.poll(() => page.evaluate(() => (globalThis as any).probe.events.at(-1))).toBe("update1:2:true:fr-FR");
  await page.evaluate(() => { (globalThis as any).probe.host.style.display = "none"; });
  await expect.poll(() => page.evaluate(() => (globalThis as any).probe.events.at(-1))).toBe("update1:2:false:fr-FR");
  await page.evaluate(() => { const p = (globalThis as any).probe; p.host.remove(); p.value.value = 3; });
  expect(await page.evaluate(() => (globalThis as any).probe.events.filter((s: string) => s === "dispose1").length)).toBe(1);
  expect(await page.evaluate(() => (globalThis as any).probe.events.some((s: string) => s.startsWith("update1:3")))).toBe(false);
  await page.evaluate(() => { const p = (globalThis as any).probe; p.host.style.display = "block"; document.querySelector("main")!.append(p.host); });
  await expect.poll(() => page.evaluate(() => (globalThis as any).probe.contexts.length)).toBe(3);
  await page.evaluate(() => { const p = (globalThis as any).probe; p.pending[2](); });
  await expect.poll(() => page.evaluate(() => (globalThis as any).probe.events.at(-1))).toBe("update2:3:true:fr-FR");
});

test("update errors dispose the session and retry creates a fresh surface", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { html, signal } = await import(url);
    const bad = signal(false); const events: string[] = [];
    const host = document.createElement("aster-component") as any;
    host.label = "Error probe"; host.alternative = () => html`<p>Fallback is available</p>`;
    host.adapter = { mount: () => { events.push("mount"); return { update() { if (bad.value) throw Error("bad update"); }, dispose() { events.push("dispose"); } }; } };
    (globalThis as any).errorProbe = { host, bad, events };
    document.querySelector("main")!.append(host);
  });
  await expect.poll(() => page.evaluate(() => (globalThis as any).errorProbe.events)).toEqual(["mount"]);
  await page.evaluate(() => { (globalThis as any).errorProbe.bad.value = true; });
  await expect(page.getByRole("region", { name: "Error probe", exact: true }).getByRole("button", { name: "Retry visualisation" })).toBeVisible();
  await page.evaluate(() => { (globalThis as any).errorProbe.bad.value = false; });
  await page.getByRole("region", { name: "Error probe", exact: true }).getByRole("button", { name: "Retry visualisation" }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).errorProbe.events)).toEqual(["mount", "dispose", "mount"]);
});

test("hidden hosts wait for an alternative and late vendor loads never initialise detached charts", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { html, echartsAdapter } = await import(url);
    const p = { host: document.createElement("aster-component") as any, loads: 0, inits: 0, disposed: 0, resolve: (() => {}) as () => void, alternative: () => html`<p>Pending vendor data</p>` };
    const runtime = { init() { p.inits++; return { setOption() {}, resize() {}, on() {}, off() {}, dispose() { p.disposed++; } }; } };
    const pending = new Promise(resolve => { p.resolve = () => resolve(runtime); });
    p.host.label = "Deferred probe";
    p.host.adapter = echartsAdapter({ load: () => { p.loads++; return pending; }, option: () => ({ series: [] }) });
    (globalThis as any).deferredProbe = p;
    document.querySelector("main")!.append(p.host);
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => (globalThis as any).deferredProbe.loads)).toBe(0);
  await page.evaluate(async () => {
    const p = (globalThis as any).deferredProbe;
    p.host.style.display = "none";
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    p.host.alternative = p.alternative;
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => (globalThis as any).deferredProbe.loads)).toBe(0);
  await page.evaluate(() => { (globalThis as any).deferredProbe.host.style.display = "block"; });
  await expect.poll(() => page.evaluate(() => (globalThis as any).deferredProbe.loads)).toBe(1);
  await page.evaluate(async () => {
    const p = (globalThis as any).deferredProbe; p.host.remove(); p.resolve();
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => (globalThis as any).deferredProbe.inits)).toBe(0);
  await page.evaluate(() => { document.querySelector("main")!.append((globalThis as any).deferredProbe.host); });
  await expect.poll(() => page.evaluate(() => (globalThis as any).deferredProbe.inits)).toBe(1);
  await page.evaluate(() => { (globalThis as any).deferredProbe.host.remove(); });
  expect(await page.evaluate(() => (globalThis as any).deferredProbe.disposed)).toBe(1);
});

test("ECharts policy handles preferences, signal updates, locale and cleanup", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const url = "/lib/aster-ui.js"; const { html, signal, echartsAdapter } = await import(url);
    const probe = { host: document.createElement("aster-component") as any, value: signal(1), options: [] as any[], resizes: [] as any[], inits: [] as any[], disposed: 0, listeners: 0 };
    const runtime = { init(_node: any, _theme: any, options: any) {
      probe.inits.push(options);
      return { setOption(option: any, policy: any) { probe.options.push({ option, policy }); }, resize(size: any) { probe.resizes.push(size); }, on() { probe.listeners++; }, off() { probe.listeners--; }, dispose() { probe.disposed++; } };
    } };
    probe.host.label = "Policy probe"; probe.host.alternative = () => html`<p>Accessible probe</p>`;
    probe.host.adapter = echartsAdapter({ load: async () => runtime, option: () => ({ series: [{ type: "bar", animation: true, data: [probe.value.value] }], animation: true, tooltip: { show: true } }) });
    (globalThis as any).policyProbe = probe;
    document.querySelector("main")!.append(probe.host);
  });
  await expect.poll(() => page.evaluate(() => (globalThis as any).policyProbe.options.length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => (globalThis as any).policyProbe.options.at(-1).option.animation)).toBe(false);
  expect(await page.evaluate(() => (globalThis as any).policyProbe.options.at(-1).option.series[0].animation)).toBe(false);
  expect(await page.evaluate(() => (globalThis as any).policyProbe.options.at(-1).option.tooltip.show)).toBe(false);
  expect(await page.evaluate(() => (globalThis as any).policyProbe.options.at(-1).policy)).toEqual({ notMerge: true, silent: true });
  const resizes = await page.evaluate(() => (globalThis as any).policyProbe.resizes.length);
  await page.evaluate(() => { (globalThis as any).policyProbe.value.value = 2; });
  await expect.poll(() => page.evaluate(() => (globalThis as any).policyProbe.options.at(-1).option.series[0].data)).toEqual([2]);
  expect(await page.evaluate(() => (globalThis as any).policyProbe.resizes.length)).toBe(resizes);
  await page.evaluate(() => { (globalThis as any).policyProbe.host.locale = "fr-FR"; });
  await expect.poll(() => page.evaluate(() => (globalThis as any).policyProbe.inits.at(-1).locale)).toBe("fr-FR");
  expect(await page.evaluate(() => (globalThis as any).policyProbe.listeners)).toBe(1);
  await page.evaluate(() => { const p = (globalThis as any).policyProbe; p.host.remove(); p.value.value = 3; });
  expect(await page.evaluate(() => (globalThis as any).policyProbe.disposed)).toBe(2);
  expect(await page.evaluate(() => (globalThis as any).policyProbe.listeners)).toBe(0);
  expect(await page.evaluate(() => (globalThis as any).policyProbe.options.at(-1).option.series[0].data)).toEqual([2]);
});

test("theme, low motion, forced colours and narrow resizing keep alternatives accessible", async ({ page }) => {
  await open(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["lamplight", "harbour"]) {
    await chooseAppearance(page, "Theme", theme);
    for (const scheme of ["light", "dark"]) {
      await chooseAppearance(page, "Scheme", scheme);
      await page.waitForTimeout(500);
      const serious = (await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical");
      expect(serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("#platforms svg").evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.locator("#platforms .aster-component-content")).toBeHidden();
  await expect(page.locator("#platforms").getByRole("button", { name: "Linux", exact: true })).toBeVisible();
  await page.emulateMedia({ forcedColors: "none" });
  await expect(page.locator("#platforms svg")).toBeVisible();
  await page.getByRole("button", { name: "Hide charts", exact: true }).click();
  await expect(page.locator("#platforms")).toBeHidden();
  await page.getByRole("button", { name: "Show charts", exact: true }).click();
  await expect(page.locator("#platforms svg")).toBeVisible();
});

test.describe("component touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("data actions have touch targets and share state with the grid", async ({ page }) => {
    await open(page);
    const linux = page.locator("#platforms").getByRole("button", { name: "Linux", exact: true });
    expect((await linux.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await linux.tap();
    await expect(page.locator("#devices .aster-grid-total")).toHaveText("80 rows");
    const device = page.locator("#costs").getByRole("button", { name: "Device 001", exact: true });
    expect((await device.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await device.tap();
    await expect(device).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => (globalThis as any).componentDemo.selection.keys.value)).toEqual(["[1]"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
