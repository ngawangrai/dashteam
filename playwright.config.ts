import { defineConfig, devices } from "@playwright/test";
import { FILING_TODAY, TEST_CRON_SECRET } from "./tests/e2e/test-clock";

// E2E_PORT lets the suite start its own server (with the test clock) beside a dev server on 3000.
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;



export default defineConfig({
  testDir: "tests/e2e",
  // Serial: every project signs in to the same two local accounts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone-light", use: { ...devices["iPhone 15"], colorScheme: "light" } },
    { name: "phone-dark", use: { ...devices["iPhone 15"], colorScheme: "dark" } },
  ],
  webServer: {
    command: process.env.CI ? `pnpm start --port ${port}` : `pnpm dev --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    // The filing tests play a fixed day; only the test server honours it (ALLOW_TEST_CLOCK).
    env: { ALLOW_TEST_CLOCK: "1", FILING_TODAY, CRON_SECRET: TEST_CRON_SECRET },
    timeout: 120_000,
  },
});
