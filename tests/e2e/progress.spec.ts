import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/playground/components.html?debug");
  await page.waitForFunction(() => !!(globalThis as any).componentDemo);
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const host = document.createElement("section"); host.id = "progress-test";
    const status = new lib.ProgressStatus(); status.id = "progress-probe";
    status.pendingText = "Updating test data…"; status.completeText = "Test data updated";
    status.progressPolicy = { delayMs: 80, minVisibleMs: 300 };
    host.append(status); document.querySelector("main")!.prepend(host);
    (globalThis as any).progressProbe = { lib, host, status };
  });
}

test("quick work never flashes while real busy state remains immediate", async ({ page }) => {
  await open(page);
  const actual = await page.evaluate(() => {
    const { status, host } = (globalThis as any).progressProbe;
    status.busy = true; host.setAttribute("aria-busy", String(status.busy));
    return { busy: status.busy, ariaBusy: host.getAttribute("aria-busy") };
  });
  expect(actual).toEqual({ busy: true, ariaBusy: "true" });
  await page.evaluate(() => { const { status, host } = (globalThis as any).progressProbe; status.busy = false; host.setAttribute("aria-busy", "false"); });
  await expect(page.locator("#progress-probe [role=status]")).toBeEmpty();
  await page.waitForTimeout(150);
  await expect(page.locator("#progress-probe [role=status]")).toBeEmpty();
});

test("slow work uses completion text for the minimum visible interval without delaying results", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (globalThis as any).progressProbe.status.busy = true; });
  const status = page.locator("#progress-probe [role=status]");
  await expect(status).toHaveText("Updating test data…");
  const actual = await page.evaluate(() => {
    const { status } = (globalThis as any).progressProbe;
    status.busy = false;
    return status.busy;
  });
  expect(actual).toBe(false);
  await expect(status).toHaveText("Test data updated");
  await expect(status).toBeEmpty();
});

test("errors show immediately during a pending delay and remain accessible under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.evaluate(() => {
    const { status } = (globalThis as any).progressProbe;
    status.progressPolicy = { delayMs: 5000, minVisibleMs: 5000 };
    status.busy = true; status.error = "Unable to update test data"; status.busy = false;
  });
  await expect(page.locator("#progress-probe [role=status]")).toHaveText("Unable to update test data");
  const violations = (await new AxeBuilder({ page }).include("#progress-test").analyze()).violations;
  expect(violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("application, region and per-control policies inherit and update without restarting work", async ({ page }) => {
  await open(page);
  const policies = await page.evaluate(() => {
    const { lib, host, status } = (globalThis as any).progressProbe;
    status.progressPolicy = {};
    lib.provideProgressPolicy(document.documentElement, { delayMs: 5000, minVisibleMs: 600 });
    lib.provideProgressPolicy(host, { delayMs: 3000 });
    status.busy = true;
    return lib.progressPolicyOf(status);
  });
  expect(policies).toEqual({ delayMs: 3000, minVisibleMs: 600 });
  await expect(page.locator("#progress-probe [role=status]")).toBeEmpty();
  await page.evaluate(() => {
    const { lib, host } = (globalThis as any).progressProbe;
    lib.provideProgressPolicy(host, { delayMs: 0, minVisibleMs: 0 });
  });
  await expect(page.locator("#progress-probe [role=status]")).toHaveText("Updating test data…");
  await page.evaluate(() => {
    const { status } = (globalThis as any).progressProbe;
    status.progressPolicy = { minVisibleMs: 300 }; status.busy = false;
  });
  await expect(page.locator("#progress-probe [role=status]")).toHaveText("Test data updated");
  await expect(page.locator("#progress-probe [role=status]")).toBeEmpty();
});

test("framework totals stay silent on fast refreshes and use the inherited policy for slow ones", async ({ page }) => {
  await open(page);
  const totals = page.locator("#platforms .component-data-state [role=status]");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["80", "80", "80"]);
  await page.evaluate(() => {
    (globalThis as any).statusMessages = [];
    const status = document.querySelector("#platforms .component-data-state")!;
    new MutationObserver(() => (globalThis as any).statusMessages.push(status.textContent.trim())).observe(status, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole("button", { name: "Add Linux device", exact: true }).click();
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["81", "80", "80"]);
  expect(await page.evaluate(() => (globalThis as any).statusMessages.filter(Boolean))).toEqual([]);
  await page.evaluate(() => { (globalThis as any).componentDemo.mock.faults.latencyMs = 450; });
  await page.getByRole("button", { name: "Add Windows device", exact: true }).click();
  await expect(totals).toHaveText("Updating totals…");
  await expect(page.locator("#platforms tbody td:nth-child(2)")).toHaveText(["81", "81", "80"]);
  await expect(totals).toHaveText("Totals updated");
  await expect(totals).toBeEmpty();
});
