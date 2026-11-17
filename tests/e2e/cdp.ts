import { chromium, test as base, expect, type Page } from "@playwright/test";

/** CDP checks borrow one explicitly designated tab; they never create or activate tabs. */
export const test = process.env.ASTER_CDP_URL ? base.extend<{}, { sharedPage: Page }>({
  browser: [async ({}, use) => {
    const browser = await chromium.connectOverCDP(process.env.ASTER_CDP_URL!);
    try { await use(browser); }
    finally { await browser.close(); }
  }, { scope: "worker" }],
  sharedPage: [async ({ browser }, use) => {
    const targetId = process.env.ASTER_CDP_TARGET_ID;
    if (!targetId) throw new Error("Set ASTER_CDP_TARGET_ID to the existing coordinator tab; browser checks do not create tabs");
    for (const context of browser.contexts()) for (const page of context.pages()) {
      const session = await context.newCDPSession(page);
      const { targetInfo } = await session.send("Target.getTargetInfo");
      if (targetInfo.targetId === targetId) {
        await session.send("Network.setCacheDisabled", { cacheDisabled: true });
        try { await use(page); }
        finally { await session.send("Network.setCacheDisabled", { cacheDisabled: false }); await session.detach(); }
        return;
      }
      await session.detach();
    }
    throw new Error("The designated CDP tab is unavailable; browser checks do not create a replacement");
  }, { scope: "worker" }],
  context: async ({ browser }, use) => {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The shared CDP browser has no persistent context");
    await use(context);
  },
  page: async ({ sharedPage }, use) => {
    await sharedPage.emulateMedia({ reducedMotion: "reduce", forcedColors: "none", colorScheme: "light" });
    await sharedPage.setViewportSize({ width: 1440, height: 1000 });
    // Each scenario owns the showcase's saved preferences; reloads inside it retain them.
    await sharedPage.evaluate(() => { try { localStorage.removeItem("aster-navigator:showcase-data-navigator"); } catch {} });
    await use(sharedPage);
  },
}) : base;
export { expect };

export const pageUrl = (path: string): string => process.env.ASTER_CDP_URL ? new URL(path, process.env.ASTER_BASE_URL).href : path;
