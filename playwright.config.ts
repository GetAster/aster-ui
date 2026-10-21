import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets suites in separate worktrees run at once.
const PORT = Number(process.env.E2E_PORT ?? 4174);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: "UTC",
    locale: "en-GB",
    viewport: { width: 1280, height: 820 },
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 820 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 820 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 820 } } },
  ],
  webServer: {
    // The static build, as deployed: pages load as separate chunks.
    command: `bun scripts/build-site.ts && PORT=${PORT} bun scripts/serve-static.ts dist-local/showcase --strict`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
