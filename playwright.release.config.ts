import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SITE_TEST_PORT ?? 4191);
export default defineConfig({
  testDir: "tests/site-release",
  fullyParallel: true,
  use: { baseURL: `http://localhost:${port}`, locale: "en-GB", timezoneId: "UTC" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `PORT=${port} bun scripts/serve-static.ts dist-site --strict`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
